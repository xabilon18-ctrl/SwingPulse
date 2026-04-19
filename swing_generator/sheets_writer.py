"""
Output writer — Google Sheets (primary) with CSV fallback (always written).

Google Sheets setup (one-time):
───────────────────────────────
1. Go to https://console.cloud.google.com and create a project.
2. Enable "Google Sheets API" and "Google Drive API".
3. Create a Service Account under IAM & Admin → Service Accounts.
4. Generate a JSON key and save it to:
       swing_generator/credentials/service_account.json
5. Open your target Google Sheet, click Share, and add the service account
   email address (looks like xxx@yyy.iam.gserviceaccount.com) as an Editor.
6. Set SPREADSHEET_NAME in config.py to match the exact sheet title.

If credentials/service_account.json is missing, the script skips Sheets and
writes only the local CSV — all other functionality is unaffected.
"""

from __future__ import annotations

import os
from datetime import date
from typing import Optional

import pandas as pd

from config import (
    CREDENTIALS_FILE,
    SPREADSHEET_NAME,
    OUTPUT_COLUMNS,
    OUTPUT_DIR,
)


# ---------------------------------------------------------------------------
# CSV (always written — zero dependencies)
# ---------------------------------------------------------------------------

def write_csv(df: pd.DataFrame, run_date: date) -> str:
    """Write the daily snapshot to a dated CSV file. Returns the file path."""
    os.makedirs(OUTPUT_DIR, exist_ok=True)
    path = os.path.join(OUTPUT_DIR, f'signals_{run_date.isoformat()}.csv')
    df.to_csv(path, index=False)
    return path


def write_excel(df: pd.DataFrame, run_date: date) -> str:
    """Write the daily snapshot to a styled Excel file. Returns the file path."""
    os.makedirs(OUTPUT_DIR, exist_ok=True)
    path = os.path.join(OUTPUT_DIR, f'signals_{run_date.isoformat()}.xlsx')

    try:
        import openpyxl
        from openpyxl.styles import PatternFill, Font, Alignment, Border, Side
        from openpyxl.utils import get_column_letter

        wb = openpyxl.Workbook()
        ws = wb.active
        ws.title = str(run_date)

        # Styles
        header_fill = PatternFill(start_color='1a2332', end_color='1a2332', fill_type='solid')
        header_font = Font(color='FFFFFF', bold=True, size=10)
        buy_fill = PatternFill(start_color='d4edda', end_color='d4edda', fill_type='solid')
        sell_fill = PatternFill(start_color='f8d7da', end_color='f8d7da', fill_type='solid')
        thin_border = Border(
            bottom=Side(style='thin', color='e2e8f0')
        )

        # Write header
        headers = df.columns.tolist()
        for col_idx, header in enumerate(headers, 1):
            cell = ws.cell(row=1, column=col_idx, value=header)
            cell.fill = header_fill
            cell.font = header_font
            cell.alignment = Alignment(horizontal='center')

        # Write data rows
        for row_idx, (_, row) in enumerate(df.iterrows(), 2):
            for col_idx, header in enumerate(headers, 1):
                val = row[header]
                cell = ws.cell(row=row_idx, column=col_idx, value=val)
                cell.border = thin_border
                cell.alignment = Alignment(horizontal='center')

            # Highlight buy/sell rows
            status = str(row.get('confirmation_status', '')).lower()
            if 'buy' in status:
                for col_idx in range(1, len(headers) + 1):
                    ws.cell(row=row_idx, column=col_idx).fill = buy_fill
            elif 'sell' in status:
                for col_idx in range(1, len(headers) + 1):
                    ws.cell(row=row_idx, column=col_idx).fill = sell_fill

        # Auto-width columns (cap at 20)
        for col_idx, header in enumerate(headers, 1):
            width = min(max(len(str(header)) + 2, 10), 20)
            ws.column_dimensions[get_column_letter(col_idx)].width = width

        # Freeze header row
        ws.freeze_panes = 'A2'
        ws.auto_filter.ref = ws.dimensions

        wb.save(path)

    except ImportError:
        # Fallback: use pandas if openpyxl styling isn't available
        df.to_excel(path, index=False, sheet_name=str(run_date))

    return path


# ---------------------------------------------------------------------------
# Google Sheets
# ---------------------------------------------------------------------------

def _get_or_create_worksheet(spreadsheet, tab_name: str):
    """Return the worksheet named tab_name, creating it if necessary."""
    try:
        ws = spreadsheet.worksheet(tab_name)
        ws.clear()
        return ws
    except Exception:
        return spreadsheet.add_worksheet(title=tab_name, rows=300, cols=60)


def write_sheets(df: pd.DataFrame, run_date: date) -> bool:
    """
    Write df to a new tab (named YYYY-MM-DD) in SPREADSHEET_NAME.
    Returns True on success, False if credentials are missing or an error occurs.
    """
    if not os.path.exists(CREDENTIALS_FILE):
        print(
            f'  [Sheets] credentials not found at:\n'
            f'           {CREDENTIALS_FILE}\n'
            f'  [Sheets] Skipping Google Sheets upload. See sheets_writer.py for setup.'
        )
        return False

    try:
        import gspread
        from google.oauth2.service_account import Credentials

        scopes = [
            'https://www.googleapis.com/auth/spreadsheets',
            'https://www.googleapis.com/auth/drive',
        ]
        creds  = Credentials.from_service_account_file(CREDENTIALS_FILE, scopes=scopes)
        client = gspread.authorize(creds)

        spreadsheet = client.open(SPREADSHEET_NAME)
        tab_name    = run_date.isoformat()           # e.g. "2026-04-01"
        ws          = _get_or_create_worksheet(spreadsheet, tab_name)

        # Write header + data
        headers = df.columns.tolist()
        rows    = df.astype(str).values.tolist()
        ws.update([headers] + rows, value_input_option='USER_ENTERED')

        # Freeze the header row
        ws.freeze(rows=1)

        print(f'  [Sheets] Written to "{SPREADSHEET_NAME}" → tab "{tab_name}"')
        return True

    except Exception as exc:
        print(f'  [Sheets] ERROR: {exc}')
        return False


# ---------------------------------------------------------------------------
# Convenience wrapper
# ---------------------------------------------------------------------------

def write_output(df: pd.DataFrame, run_date: Optional[date] = None) -> None:
    """Write the daily snapshot to CSV and (if configured) Google Sheets."""
    if run_date is None:
        run_date = date.today()

    # Reorder to spec column order, filling any missing cols with ''
    out = pd.DataFrame()
    for col in OUTPUT_COLUMNS:
        out[col] = df[col] if col in df.columns else ''

    # Always write CSV
    csv_path = write_csv(out, run_date)
    print(f'  [CSV]    Saved → {csv_path}')

    # Write Excel
    xlsx_path = write_excel(out, run_date)
    print(f'  [Excel]  Saved → {xlsx_path}')

    # Attempt Google Sheets
    write_sheets(out, run_date)

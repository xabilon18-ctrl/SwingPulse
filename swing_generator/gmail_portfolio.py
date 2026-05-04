#!/usr/bin/env python3
"""
gmail_portfolio.py — Parse XM Daily Confirmation emails from Gmail
and produce portfolio.json for the SwingPulse dashboard.

Usage:
  python3 gmail_portfolio.py              # parse latest email, upload to R2
  python3 gmail_portfolio.py --local      # parse latest email, save locally only
  python3 gmail_portfolio.py --auth-only  # just do OAuth login (first-time setup)

First run opens a browser for OAuth consent. After that, token.json is reused.
"""

import os, sys, json, re, base64
from datetime import datetime
from pathlib import Path
from html.parser import HTMLParser

# ── Google API auth ─────────────────────────────────────────────────────
from google.auth.transport.requests import Request
from google.oauth2.credentials import Credentials
from google_auth_oauthlib.flow import InstalledAppFlow
from googleapiclient.discovery import build

SCOPES = ['https://www.googleapis.com/auth/gmail.readonly']
BASE_DIR = Path(__file__).parent
CREDS_FILE = BASE_DIR / 'credentials.json'
TOKEN_FILE = BASE_DIR / 'token.json'


def get_gmail_service():
    """Authenticate and return a Gmail API service object."""
    creds = None
    if TOKEN_FILE.exists():
        creds = Credentials.from_authorized_user_file(str(TOKEN_FILE), SCOPES)
    if not creds or not creds.valid:
        if creds and creds.expired and creds.refresh_token:
            creds.refresh(Request())
        else:
            flow = InstalledAppFlow.from_client_secrets_file(str(CREDS_FILE), SCOPES)
            creds = flow.run_local_server(port=0)
        TOKEN_FILE.write_text(creds.to_json())
    return build('gmail', 'v1', credentials=creds)


# ── HTML table parser ───────────────────────────────────────────────────
class TableParser(HTMLParser):
    """Extract text from HTML tables into rows of cells."""
    def __init__(self):
        super().__init__()
        self.tables = []
        self.current_table = []
        self.current_row = []
        self.current_cell = ''
        self.in_td = False
        self.in_table = False

    def handle_starttag(self, tag, attrs):
        if tag == 'table':
            self.in_table = True
            self.current_table = []
        elif tag in ('td', 'th'):
            self.in_td = True
            self.current_cell = ''
        elif tag == 'tr':
            self.current_row = []

    def handle_endtag(self, tag):
        if tag in ('td', 'th'):
            self.in_td = False
            self.current_row.append(self.current_cell.strip())
        elif tag == 'tr':
            if self.current_row:
                self.current_table.append(self.current_row)
        elif tag == 'table':
            self.in_table = False
            if self.current_table:
                self.tables.append(self.current_table)

    def handle_data(self, data):
        if self.in_td:
            self.current_cell += data


def parse_number(s):
    """Parse a number string, handling spaces as thousand separators."""
    s = s.strip().replace('\xa0', '').replace(' ', '')
    try:
        return float(s)
    except (ValueError, TypeError):
        return 0.0


def parse_xm_email(html_body):
    """Parse the full XM Daily Confirmation email HTML and return structured data.

    The email is one big flat table. Sections are identified by rows containing
    keywords like 'Positions:', 'Deals:', 'A/C Summary:' etc.
    """
    parser = TableParser()
    parser.feed(html_body)

    if not parser.tables:
        return {'date': '', 'account': {}, 'summary': {}, 'positions': [], 'deals': []}

    rows = parser.tables[0]  # Single flat table

    # ── Extract account info from row 1 ──
    account_no = ''
    currency = 'ZAR'
    name = ''
    for row in rows[:5]:
        for cell in row:
            m = re.search(r'A/C No:\s*(\d+)', cell)
            if m:
                account_no = m.group(1)
            m = re.search(r'Currency:\s*(\w+)', cell)
            if m:
                currency = m.group(1)
            m = re.search(r'Name:\s*(.+)', cell)
            if m:
                name = m.group(1).strip()

    # ── Find section start rows by keyword ──
    def find_section_start(keyword):
        for i, row in enumerate(rows):
            if row and row[0].strip().lower().startswith(keyword.lower()):
                return i
        return None

    # ── Parse POSITIONS ──
    positions = []
    pos_start = find_section_start('Positions')
    if pos_start is not None:
        # pos_start = "Positions:" row, pos_start+1 = headers, pos_start+2+ = data
        headers_row = pos_start + 1
        if headers_row < len(rows):
            headers = [h.strip().lower().replace(' / ', '/').replace(' ', '_')
                       for h in rows[headers_row]]
            for row in rows[headers_row + 1:]:
                if len(row) < 5:
                    break
                if not re.match(r'\d{4}', row[0].strip()):
                    break
                pos = {}
                for i, h in enumerate(headers):
                    if i < len(row):
                        pos[h] = row[i].strip()
                positions.append({
                    'open_time': pos.get('open_time', ''),
                    'ticket': pos.get('ticket', ''),
                    'type': pos.get('type', ''),
                    'size': parse_number(pos.get('size', '0')),
                    'item': pos.get('item', ''),
                    'price': parse_number(pos.get('price', '0')),
                    'sl': parse_number(pos.get('s/l', '0')),
                    'tp': parse_number(pos.get('t/p', '0')),
                    'market_price': parse_number(pos.get('market_price', '0')),
                    'swap': parse_number(pos.get('swap', '0')),
                    'profit': parse_number(pos.get('profit', '0')),
                })

    # ── Parse DEALS ──
    deals = []
    deals_start = find_section_start('Deals')
    if deals_start is not None:
        headers_row = deals_start + 1
        if headers_row < len(rows):
            headers = [h.strip().lower().replace(' ', '_') for h in rows[headers_row]]
            for row in rows[headers_row + 1:]:
                if len(row) < 5:
                    break
                if not re.match(r'\d{4}', row[0].strip()):
                    break
                deal = {}
                for i, h in enumerate(headers):
                    if i < len(row):
                        deal[h] = row[i].strip()
                deals.append({
                    'open_time': deal.get('open_time', ''),
                    'ticket': deal.get('ticket', ''),
                    'type': deal.get('type', ''),
                    'size': parse_number(deal.get('size', '0')),
                    'item': deal.get('item', ''),
                    'price': parse_number(deal.get('price', '0')),
                    'commission': parse_number(deal.get('commission', '0')),
                    'swap': parse_number(deal.get('swap', '0')),
                    'profit': parse_number(deal.get('profit', '0')),
                })

    # ── Parse A/C SUMMARY ──
    summary = {}
    summ_start = find_section_start('A/C Summary')
    if summ_start is not None:
        for row in rows[summ_start + 1:]:
            # Skip empty rows
            non_empty = [c.strip() for c in row if c.strip()]
            if not non_empty:
                continue
            # Stop at footer
            if any('XM Global' in c for c in row):
                break
            # Parse label: value pairs
            i = 0
            while i < len(row):
                cell = row[i].strip()
                if cell.endswith(':') and i + 1 < len(row):
                    label = cell.rstrip(':').lower().replace(' ', '_').replace('/', '_')
                    value = row[i + 1].strip()
                    if label and value:
                        summary[label] = parse_number(value)
                    i += 2
                else:
                    i += 1

    # Calculate floating P/L from positions if not in summary
    floating_pl = sum(p['profit'] for p in positions)

    return {
        'date': datetime.utcnow().strftime('%Y-%m-%d'),
        'account': {
            'account_no': account_no,
            'currency': currency,
            'name': name or 'Zabilon Mbandze',
        },
        'summary': {
            'balance': summary.get('balance', 0),
            'equity': summary.get('equity', 0),
            'floating_pl': summary.get('floating_p_l', floating_pl),
            'margin': summary.get('margin_requirements', 0),
            'available_margin': summary.get('available_margin', 0),
            'previous_balance': summary.get('previous_ledger_balance', 0),
            'previous_equity': summary.get('previous_equity', 0),
            'closed_pl': summary.get('closed_trade_p_l', 0),
        },
        'positions': positions,
        'deals': deals,
    }


def fetch_latest_xm_email(service):
    """Find and return the HTML body of the latest XM Daily Confirmation email."""
    # Search for forwarded XM emails
    results = service.users().messages().list(
        userId='me',
        q='subject:"Daily Confirmation" from:xabilon18@icloud.com',
        maxResults=1
    ).execute()

    messages = results.get('messages', [])
    if not messages:
        # Try direct from XM
        results = service.users().messages().list(
            userId='me',
            q='subject:"Daily Confirmation" from:report@xm.com',
            maxResults=1
        ).execute()
        messages = results.get('messages', [])

    if not messages:
        print("  No XM Daily Confirmation email found!")
        return None

    msg = service.users().messages().get(
        userId='me',
        id=messages[0]['id'],
        format='full'
    ).execute()

    # Extract HTML body
    html_body = extract_html_body(msg['payload'])
    if not html_body:
        print("  Could not extract HTML body from email")
        return None

    return html_body


def extract_html_body(payload):
    """Recursively extract HTML body from Gmail message payload."""
    if payload.get('mimeType') == 'text/html':
        data = payload.get('body', {}).get('data', '')
        if data:
            return base64.urlsafe_b64decode(data).decode('utf-8', errors='replace')

    parts = payload.get('parts', [])
    for part in parts:
        result = extract_html_body(part)
        if result:
            return result

    return None


def upload_to_r2(portfolio_data):
    """Upload portfolio.json to Cloudflare R2."""
    import subprocess

    output_path = BASE_DIR / 'output' / 'portfolio.json'
    output_path.parent.mkdir(exist_ok=True)
    output_path.write_text(json.dumps(portfolio_data, indent=2))

    # Upload to R2 using wrangler
    r2_bucket = 'swingpulse-data'
    cmd = [
        'npx', 'wrangler', 'r2', 'object', 'put',
        f'{r2_bucket}/portfolio.json',
        '--file', str(output_path),
        '--content-type', 'application/json',
    ]

    result = subprocess.run(cmd, capture_output=True, text=True, cwd=str(BASE_DIR))
    if result.returncode == 0:
        print("  ✓ Uploaded portfolio.json to R2")
    else:
        print(f"  ✗ R2 upload failed: {result.stderr}")


def main():
    args = sys.argv[1:]
    local_only = '--local' in args
    auth_only = '--auth-only' in args

    print("SwingPulse — Gmail Portfolio Parser")
    print("=" * 40)

    # Step 1: Authenticate
    print("  Authenticating with Gmail API...")
    service = get_gmail_service()
    print("  ✓ Authenticated")

    if auth_only:
        print("  Auth-only mode — done.")
        return

    # Step 2: Fetch latest email
    print("  Fetching latest XM Daily Confirmation...")
    html_body = fetch_latest_xm_email(service)
    if not html_body:
        sys.exit(1)
    print(f"  ✓ Email fetched ({len(html_body)} chars)")

    # Step 3: Parse
    print("  Parsing email...")
    portfolio = parse_xm_email(html_body)
    print(f"  ✓ Parsed: {len(portfolio['positions'])} positions, "
          f"{len(portfolio['deals'])} deals")
    print(f"  Balance: {portfolio['summary']['balance']} "
          f"{portfolio['account']['currency']}")
    print(f"  Equity:  {portfolio['summary']['equity']} "
          f"{portfolio['account']['currency']}")
    print(f"  Float:   {portfolio['summary']['floating_pl']} "
          f"{portfolio['account']['currency']}")

    # Step 4: Save / Upload
    output_path = BASE_DIR / 'output' / 'portfolio.json'
    output_path.parent.mkdir(exist_ok=True)
    output_path.write_text(json.dumps(portfolio, indent=2))
    print(f"  ✓ Saved to {output_path}")

    if not local_only:
        print("  Uploading to R2...")
        upload_to_r2(portfolio)

    print("  Done!")


if __name__ == '__main__':
    main()

"""Output writer — writes the daily snapshot CSV.

The CSV is NOT a convenience dump, despite reading like one. It is the handoff
between the signal engine and everything downstream, and four things read it:

  webapp/publish.py  load_latest_signals() — the newest signals_<date>.csv IS
                     what gets published to R2. Its FILE MTIME also becomes
                     summary.json's `fetched_at`, which drives the app's stale
                     banner and tools/health_check.py.
  webapp/server.py   the local dev server reads the same latest file
  signal_ledger.py   --backfill replays the whole signals_*.csv history
  main.py            compute_flow_volumes() backfills from the same glob

Stop writing it and the pipeline has nothing to publish. Route it somewhere
else and all four have to move together.

The .xlsx that used to be written beside it was removed on 2026-08-13: nothing
in the repo ever read it, and it cost 78 MB across 50 files.
"""

from __future__ import annotations

import os
from datetime import date
from typing import Optional

import pandas as pd

from _active_config import (
    OUTPUT_COLUMNS,
    OUTPUT_DIR,
)


def write_output(df: pd.DataFrame, run_date: Optional[date] = None,
                 output_dir: str = None, output_columns: list = None) -> None:
    """Write the daily snapshot CSV that publish.py picks up."""
    if run_date is None:
        run_date = date.today()

    cols = output_columns if output_columns is not None else OUTPUT_COLUMNS
    dest = output_dir    if output_dir    is not None else OUTPUT_DIR

    out = pd.DataFrame()
    for col in cols:
        out[col] = df[col] if col in df.columns else ''

    os.makedirs(dest, exist_ok=True)

    csv_path = os.path.join(dest, f'signals_{run_date.isoformat()}.csv')
    out.to_csv(csv_path, index=False)
    print(f'  [CSV]    Saved → {csv_path}')

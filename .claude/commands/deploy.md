# Deploy SwingPulse

Two separate deploy commands depending on what changed:

## 1. Data update (daily — after running signals)
Uploads signals, summary, trends, history charts to Cloudflare R2. No Pages deploy needed.

```bash
cd "/Users/zabmbandze/Documents/Trading/Swing Trading Strategy/swing_generator" && python3 webapp/publish.py
```

## 2. UI deploy (only when frontend code changes)
Builds UI with R2 URLs patched in, deploys to Cloudflare Pages.

```bash
cd "/Users/zabmbandze/Documents/Trading/Swing Trading Strategy/swing_generator" && python3 webapp/publish.py --ui-only
```

## Steps to execute

1. Ask the user which type of deploy they want (data or UI)
2. If unclear, default to data deploy (option 1)
3. Run the appropriate command above
4. Report: number of files uploaded, confirmation that https://swingpulse.pages.dev is updated

## Notes
- Data deploy: uploads 224 files to R2, ~60–90 seconds, no wrangler pages involved
- UI deploy: deploys only 5 files to Pages, fast (~15 sec), needed when index.html/app.js/style.css changes
- R2 public URL: https://pub-e74b1a3a64724b07a76b853093e21240.r2.dev
- Does NOT re-run signal generation — use `/run` for that

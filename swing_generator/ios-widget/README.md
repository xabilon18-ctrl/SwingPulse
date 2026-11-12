# SwingPulse lock-screen widget (iPhone)

Today's % change for 4 instruments, symbol and %, on the iPhone lock screen.
Add it twice for 8. It runs in **Scriptable**, a free iPhone app, because a
web app cannot put widgets on the lock screen.

## Set it up (about 5 minutes)

1. Install **Scriptable** from the App Store (free).
2. In Scriptable, tap **+**, paste all of `swingpulse-lock-widget.js`, tap the
   title at the top and name it **SwingPulse**. Tap **Done**.
3. Tap **▶** once to check it: it shows a preview with today's figures.
4. Lock the phone, then touch and hold the lock screen → **Customize** →
   **Lock Screen** → tap the widget row.
5. Remove the old widgets. Add **Scriptable** twice, choosing the **wide**
   (rectangular) size each time.
6. Tap the first new widget: **Script** = SwingPulse, **Parameter** =
   `BTCUSD, ETHUSD, US100, GOLD`.
   Tap the second: **Script** = SwingPulse, **Parameter** = your other 4,
   e.g. `US500, US30, USDZAR, SILVER`.
7. Tap **Done**.

To change instruments later, edit the Parameter the same way. Names are the
app's own (as in the Watchlist). An unknown name shows "—".

## What to expect

- **Updates:** iOS decides when lock-screen widgets refresh, often every
  15–60 minutes. The script asks for every 5 minutes; iOS may not allow it.
  No widget can refresh when you lift the phone.
- **The %** is today's change against the previous close, worked out exactly
  as the Watchlist does: the newest of the live feed and the hourly published
  price.
- **Colour:** iOS draws lock-screen widgets in white, so a fall is "−" and a
  rise "+", not red and green.
- **Offline:** the widget keeps showing the last figures it got.

## For developers

- Data: `quotes.json` on R2 (`q[name]`: `p`, `pc`, `t`, `y`, `b`, `yc`) and the
  cron Worker's `/live?s=` relay, as `modules/live-prices.js` and
  `app.js wlQuote`. If either changes shape, update the widget too.
- Test: `node tests/lock_widget_test.cjs` (not in CI).
- Look: "Before" mock-up of 2026-11-12, chosen by the user: symbol bold 13 pt,
  % regular 13 pt, both white, on the lock screen's own frosted tile.

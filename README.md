# Blind Spin

A tiny static site for blind-ranking songs from last.fm export files, 1–10, one track at a time — built for playing over a Discord screenshare.

No backend, no build step, no dependencies. Everything runs in the browser and saves to `localStorage`.

## How it works

1. **Load lists.** Upload (or paste) a `.txt` file for each slot: your last 365 days, your all-time, your friend's last 365 days, your friend's all-time. The parser accepts:
   - `Artist - Track`
   - `Artist<TAB>Track` (or `Artist<TAB>Track<TAB>playcount`)
   - `Track by Artist`
   - one track per line either way
2. **Six categories are built automatically**: You/365, You/All-time, Friend/365, Friend/All-time, Combined/365, Combined/All-time. "Combined" merges both lists and drops exact duplicate artist+track pairs.
3. **Pick a category.** Tracks are shuffled into a random queue.
4. **Play.** Click the record to reveal the artist and track, then rate it 1–10 on the level meter. It auto-advances to the next hidden track. You (as the host, screensharing) control the pace — nobody sees what's next until it's revealed.
5. **Results.** Sorted leaderboard for that session, with CSV / JSON export and a copy-as-text button. Every session is saved under "Past sessions" so you can revisit old rankings.

Everything (lists, names, history) is stored in your browser's `localStorage` — nothing is uploaded anywhere. If you play on a different browser/device, you'll need to re-load the lists there.

## Deploying to GitHub Pages

```bash
# from this folder
git init
git add .
git commit -m "Blind Spin"
git branch -M main
git remote add origin https://github.com/<your-username>/blind-spin.git
git push -u origin main
```

Then in the repo on GitHub: **Settings → Pages → Deploy from a branch → main / (root)**. Your site will be live at `https://<your-username>.github.io/blind-spin/` within a minute or two.

## Getting the last.fm text files

Any tool that exports your last.fm scrobbles as plain text works — e.g. lastfm-to-csv exporters, or a simple script hitting the last.fm API for `user.getTopTracks` with `period=12month` (365 days) and `period=overall` (all-time). One line per track, `Artist - Track` is the simplest format to produce.

## Local testing

No server needed — just open `index.html` directly in a browser, or run a quick local server:

```bash
python3 -m http.server 8000
```

then visit `http://localhost:8000`.

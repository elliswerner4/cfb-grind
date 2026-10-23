# The 44-Day Grind

**A live college football and NFL pick'em for four friends: one pick a day for 44 straight days.**

**Live site:** [cfb-grind.vercel.app](https://cfb-grind.vercel.app)

I built this with AI coding tools for a season-long pick'em with friends. Each day everyone picks one game from that day's real slate, against the spread or the total. Lines come from live sportsbook odds and lock at kickoff, and the server records final scores so picks are graded automatically. There's no sign-in, and every phone stays in sync within a few seconds.

## What it shows

- **Live data integration.** The app pulls each day's FBS and NFL games, DraftKings lines and live scores from ESPN's public scoreboard feed.
- **Server-side rules for slate games.** For games picked from the live slate, the server fills in the line, locks the pick at kickoff, blocks duplicate picks and records final scores. A manual-entry fallback exists for games the feed misses.
- **Race-safe writes.** A short Redis `SET NX` lock per day makes the check-and-write for picks atomic, so two phones can't grab the same side at the same moment.
- **Cheap real-time sync.** Clients poll a versioned state endpoint that returns "unchanged" when nothing has moved. That keeps the app fast and inside free-tier limits.
- **Grading with no manual work.** Settling runs whenever someone has the site open, and a Redis `SET NX EX` lease keeps it to one run every 40 seconds however many phones are polling. A daily Vercel Cron job is the backstop.

## Tech stack

| Layer | Tools |
|---|---|
| App | Next.js 14 API routes, TypeScript; single-page UI in `public/index.html`, installable on phones as a web app |
| Data | Vercel KV (Upstash Redis), with an in-memory fallback for local development |
| Live odds & scores | ESPN scoreboard API (DraftKings lines) |
| Hosting & scheduling | Vercel, plus a daily Vercel Cron job for grading |

## How it's organized

- `public/index.html`: the whole UI (standings, streaks, trophy case, pick sheet with All / College / NFL tabs)
- `src/app/api/state`: league state; `?since=<version>` returns `{unchanged: true}` for cheap polling
- `src/app/api/picks/[id]`: create, change or delete a pick
- `src/app/api/settings`: player names, Day 1, days with no games
- `src/app/api/games`: the day's FBS and NFL slate with lines and live scores, cached for 45 seconds
- `src/app/api/settle`: records final scores for open picks
- `src/lib/espn.ts`, `src/lib/league.ts`: ESPN parsing, server-filled lines, kickoff locks, result calculation
- `src/lib/store.ts`: KV storage and validation

## Run it locally

```bash
git clone https://github.com/elliswerner4/cfb-grind
cd cfb-grind
npm install
npm run dev   # uses the in-memory store; no keys needed
```

## Deploy

1. Import the repo in Vercel.
2. Under **Storage**, connect a KV / Upstash Redis store. That sets `KV_REST_API_URL` and `KV_REST_API_TOKEN`.
3. Redeploy.

---

Built by **Ellis Werner** · [LinkedIn](https://www.linkedin.com/in/Ellis-W-Werner) · [GitHub](https://github.com/elliswerner4)

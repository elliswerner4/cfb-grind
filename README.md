# The 44-Day Grind

College football pick'em for Ellis, Frankie, Blake and Carter: one pick a day (spread or total) for 44 straight days, starting Oct 17, 2026. No sign-in; everyone's phone stays in sync.

**Stack** (same as Killer Party): Next.js 14 on Vercel, data in Vercel KV / Upstash Redis via `@vercel/kv`.

- `public/index.html` — the whole UI (standings, streaks, units race, trophy case, pick sheet)
- `src/app/api/state` — GET league state; `?since=<version>` returns `{unchanged:true}` for cheap polling
- `src/app/api/picks/[id]` — PUT / DELETE a pick (ids `d00-p0` … `d43-p3`)
- `src/app/api/settings` — PUT names, Day 1, no-game days
- `src/lib/store.ts` — KV storage + validation; falls back to memory when KV env vars are missing

## Deploy
1. Import this repo in Vercel (New Project → Import).
2. Project → **Storage** → connect a KV / Upstash Redis store. That sets `KV_REST_API_URL` and `KV_REST_API_TOKEN`.
3. Redeploy. Clients poll every 3 s while open.

## Local
`npm install && npm run dev` — uses the in-memory store.

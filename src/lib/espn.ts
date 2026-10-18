/**
 * ESPN scoreboards (public JSON, no key): FBS college football (groups=80) and the NFL.
 * Odds come from ESPN's sportsbook partner (DraftKings at time of writing).
 */
import { kv } from '@vercel/kv'
import { useKV } from './store'

export type League = 'cfb' | 'nfl'
const SOURCES: Record<League, string> = {
  cfb: 'https://site.api.espn.com/apis/site/v2/sports/football/college-football/scoreboard?groups=80&limit=400&dates=',
  nfl: 'https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard?limit=100&dates=',
}

export interface Team {
  id: string
  name: string
  full: string
  abbr: string
  logo: string | null
  color: string | null
  rank: number | null
  score: number | null
}

export interface Game {
  id: string
  league: League
  start: string // ISO
  state: 'pre' | 'in' | 'post'
  completed: boolean
  detail: string // "Sat, October 17th at 12:00 PM EDT", "Q3 4:12", "Final"
  away: Team
  home: Team
  spreadHome: number | null
  spreadAway: number | null
  total: number | null
  provider: string | null
}

/** "+3", "-3.5", "o51.5", "EVEN", "PK", 3 → number | null */
export function num(v: unknown): number | null {
  if (v === null || v === undefined) return null
  if (typeof v === 'number') return isFinite(v) ? v : null
  const s = String(v).trim().toUpperCase()
  if (s === 'EVEN' || s === 'PK' || s === 'PICK') return 0
  const m = s.replace(/^[OU]/, '').match(/^[+-]?\d+(\.\d+)?$/)
  return m ? Number(m[0]) : null
}

function team(c: any): Team {
  const t = c?.team ?? {}
  const rank = num(c?.curatedRank?.current)
  return {
    id: String(t.id ?? c?.id ?? ''),
    name: t.shortDisplayName || t.location || t.displayName || 'TBD',
    full: t.displayName || t.shortDisplayName || 'TBD',
    abbr: t.abbreviation || '',
    logo: t.logo || t.logos?.[0]?.href || null,
    color: t.color ? `#${t.color}` : null,
    rank: rank !== null && rank >= 1 && rank <= 25 ? rank : null,
    score: num(c?.score),
  }
}

export function parseLines(odds: any, home: Team, away: Team) {
  const o = Array.isArray(odds) ? odds[0] : null
  if (!o) return { spreadHome: null, spreadAway: null, total: null, provider: null }
  // 1) explicit per-team point spreads (closing, else opening)
  let h = num(o?.pointSpread?.home?.close?.line ?? o?.pointSpread?.home?.open?.line)
  let a = num(o?.pointSpread?.away?.close?.line ?? o?.pointSpread?.away?.open?.line)
  // 2) "OSU -3" style details
  if (h === null && a === null && typeof o.details === 'string') {
    const d = o.details.trim()
    if (/^(EVEN|PK|PICK)/i.test(d)) { h = 0; a = 0 }
    const m = d.match(/^(\S+)\s+([+-]?\d+(?:\.\d+)?)$/)
    if (m) {
      const ab = m[1].toUpperCase(), line = Number(m[2])
      if (ab === home.abbr.toUpperCase()) h = line
      else if (ab === away.abbr.toUpperCase()) a = line
    }
  }
  // 3) favorite flags + absolute spread
  if (h === null && a === null && num(o.spread) !== null) {
    const s = Math.abs(num(o.spread)!)
    if (o?.homeTeamOdds?.favorite) h = -s
    else if (o?.awayTeamOdds?.favorite) a = -s
  }
  if (h === null && a !== null) h = a === 0 ? 0 : -a
  if (a === null && h !== null) a = h === 0 ? 0 : -h
  const total = num(o.overUnder) ?? num(o?.total?.over?.close?.line) ?? num(o?.total?.over?.open?.line)
  return { spreadHome: h, spreadAway: a, total: total !== null && total > 0 ? total : null, provider: o?.provider?.name ?? null }
}

export function parseScoreboard(json: any, league: League = 'cfb'): Game[] {
  const events: any[] = Array.isArray(json?.events) ? json.events : []
  return events.map((e) => {
    const comp = e?.competitions?.[0] ?? {}
    const cs: any[] = comp?.competitors ?? []
    const home = team(cs.find((c) => c.homeAway === 'home') ?? cs[0])
    const away = team(cs.find((c) => c.homeAway === 'away') ?? cs[1])
    const st = comp?.status?.type ?? e?.status?.type ?? {}
    const state: Game['state'] = st.state === 'in' ? 'in' : st.state === 'post' ? 'post' : 'pre'
    if (state === 'pre') { home.score = null; away.score = null }
    return {
      id: String(e.id),
      league,
      start: comp.date || e.date,
      state,
      completed: !!st.completed,
      detail: st.shortDetail || st.detail || '',
      away, home,
      ...parseLines(comp.odds, home, away),
    }
  }).filter((g) => g.id && g.start)
    .sort((x, y) => x.start.localeCompare(y.start) || x.home.name.localeCompare(y.home.name))
}

/** "2026-10-17" + 3 days → "20261020" */
export function espnDate(startDate: string, day: number): string {
  const [y, m, d] = startDate.split('-').map(Number)
  const dt = new Date(Date.UTC(y, m - 1, d + day))
  return dt.toISOString().slice(0, 10).replace(/-/g, '')
}

const memCache = new Map<string, { at: number; games: Game[] }>()
const TTL_SEC = 45

async function fetchLeague(league: League, date: string): Promise<Game[]> {
  // Local testing only: point ESPN_FIXTURE / ESPN_FIXTURE_NFL at saved scoreboard JSON files.
  const fixture = league === 'cfb' ? process.env.ESPN_FIXTURE : process.env.ESPN_FIXTURE_NFL
  if (process.env.ESPN_FIXTURE) {
    if (!fixture) return []
    const { readFile } = await import('fs/promises')
    return parseScoreboard(JSON.parse(await readFile(fixture, 'utf8')), league)
  }
  const res = await fetch(SOURCES[league] + date, {
    cache: 'no-store',
    headers: { 'User-Agent': 'Mozilla/5.0 (cfb-grind pick tracker)' },
  })
  if (!res.ok) throw new Error(`ESPN ${league} ${res.status}`)
  return parseScoreboard(await res.json(), league)
}

/** College + NFL slate for one ET date, cached ~45s in KV so many phones don't hammer ESPN. */
export async function getSlate(date: string, fresh = false): Promise<Game[]> {
  const key = `slate2:${date}`
  if (!fresh) {
    if (useKV()) {
      const hit = await kv.get<Game[]>(key)
      if (hit) return hit
    } else {
      const hit = memCache.get(key)
      if (hit && Date.now() - hit.at < TTL_SEC * 1000) return hit.games
    }
  }
  const results = await Promise.allSettled([fetchLeague('cfb', date), fetchLeague('nfl', date)])
  if (results.every((r) => r.status === 'rejected')) throw (results[0] as PromiseRejectedResult).reason
  const games = results.flatMap((r) => (r.status === 'fulfilled' ? r.value : []))
    .sort((x, y) => x.start.localeCompare(y.start) || x.home.name.localeCompare(y.home.name))
  if (useKV()) await kv.set(key, games, { ex: TTL_SEC })
  else memCache.set(key, { at: Date.now(), games })
  return games
}

export const hasStarted = (g: Game) => g.state !== 'pre' || Date.parse(g.start) <= Date.now()

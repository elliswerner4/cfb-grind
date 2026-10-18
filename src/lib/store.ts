import { kv } from '@vercel/kv'

/**
 * League storage — Vercel KV in production, in-memory fallback for local dev.
 *
 *   grind:settings  JSON  { players, startDate, offDays }
 *   grind:picks     hash  pickId -> pick JSON   (pickId like d00-p0 … d43-p3)
 *   grind:version   int   bumped on every write so clients can poll cheaply
 */

export const PLAYER_COUNT = 4
export const DAYS = 44
export const DEFAULT_SETTINGS: Settings = {
  players: ['Ellis', 'Frankie', 'Blake', 'Carter'],
  startDate: '2026-10-17',
  offDays: [],
}

export interface Settings {
  players: string[]
  startDate: string
  offDays: number[]
}

export interface Pick {
  day: number
  slot: number
  type: 'spread' | 'total'
  side: 'away' | 'home' | 'over' | 'under'
  away: string
  home: string
  line: number
  awayScore: number | null
  homeScore: number | null
  manual: 'W' | 'L' | 'P' | null
  updatedAt: number
  // Set when the pick was made from the live ESPN slate
  eventId?: string | null
  kickoff?: string | null
  awayAbbr?: string
  homeAbbr?: string
  awayLogo?: string | null
  homeLogo?: string | null
  live?: { state: 'pre' | 'in' | 'post'; detail: string; away: number | null; home: number | null } | null
}

const K_SETTINGS = 'grind:settings'
const K_PICKS = 'grind:picks'
const K_VERSION = 'grind:version'

const mem = {
  settings: null as Settings | null,
  picks: new Map<string, Pick>(),
  version: 0,
}

export function useKV(): boolean {
  return !!(process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN)
}

export async function getVersion(): Promise<number> {
  if (!useKV()) return mem.version
  return Number((await kv.get<number>(K_VERSION)) ?? 0)
}

async function bump(): Promise<number> {
  if (!useKV()) return ++mem.version
  return kv.incr(K_VERSION)
}

export async function getState(): Promise<{ version: number; settings: Settings; picks: Record<string, Pick> }> {
  if (!useKV()) {
    return {
      version: mem.version,
      settings: mem.settings ?? DEFAULT_SETTINGS,
      picks: Object.fromEntries(mem.picks),
    }
  }
  const [version, settings, picks] = await Promise.all([
    kv.get<number>(K_VERSION),
    kv.get<Settings>(K_SETTINGS),
    kv.hgetall<Record<string, Pick>>(K_PICKS),
  ])
  return { version: Number(version ?? 0), settings: settings ?? DEFAULT_SETTINGS, picks: picks ?? {} }
}

export async function getSettings(): Promise<Settings> {
  if (!useKV()) return mem.settings ?? DEFAULT_SETTINGS
  return (await kv.get<Settings>(K_SETTINGS)) ?? DEFAULT_SETTINGS
}

export async function getPick(id: string): Promise<Pick | null> {
  if (!useKV()) return mem.picks.get(id) ?? null
  return (await kv.hget<Pick>(K_PICKS, id)) ?? null
}

export async function getAllPicks(): Promise<Record<string, Pick>> {
  if (!useKV()) return Object.fromEntries(mem.picks)
  return (await kv.hgetall<Record<string, Pick>>(K_PICKS)) ?? {}
}

/** Write several picks with one version bump (used by auto-grading). */
export async function putPicks(picks: Record<string, Pick>): Promise<number> {
  if (!Object.keys(picks).length) return getVersion()
  if (!useKV()) for (const [id, p] of Object.entries(picks)) mem.picks.set(id, p)
  else await kv.hset(K_PICKS, picks)
  return bump()
}

let memSettleAt = 0
/** True at most once per `sec` seconds across all requests (SET NX with expiry). */
export async function claimSettle(sec: number): Promise<boolean> {
  if (!useKV()) {
    if (Date.now() - memSettleAt < sec * 1000) return false
    memSettleAt = Date.now(); return true
  }
  return (await kv.set('grind:settle-lock', Date.now(), { nx: true, ex: sec })) === 'OK'
}

export async function putPick(id: string, pick: Pick): Promise<number> {
  if (!useKV()) mem.picks.set(id, pick)
  else await kv.hset(K_PICKS, { [id]: pick })
  return bump()
}

export async function deletePick(id: string): Promise<number> {
  if (!useKV()) mem.picks.delete(id)
  else await kv.hdel(K_PICKS, id)
  return bump()
}

export async function putSettings(settings: Settings): Promise<number> {
  if (!useKV()) mem.settings = settings
  else await kv.set(K_SETTINGS, settings)
  return bump()
}

/* ---------- validation (the site has no sign-in, so the server checks shape) ---------- */

export const PICK_ID = /^d([0-4][0-9])-p([0-9])$/
const clean = (s: unknown, max = 40) => String(s ?? '').trim().slice(0, max)
const numOrNull = (v: unknown) => (v === null || v === undefined || v === '' || isNaN(Number(v)) ? null : Number(v))

export function parsePick(id: string, body: any): Pick | string {
  const m = PICK_ID.exec(id)
  if (!m) return 'Bad pick id'
  const day = Number(m[1]), slot = Number(m[2])
  if (day >= DAYS || slot >= PLAYER_COUNT) return 'Day or player out of range'
  if (!body || typeof body !== 'object') return 'Missing pick'
  const type = body.type
  if (type !== 'spread' && type !== 'total') return 'Bet type must be spread or total'
  const side = body.side
  const okSide = type === 'spread' ? side === 'away' || side === 'home' : side === 'over' || side === 'under'
  if (!okSide) return 'Pick a valid side'
  const away = clean(body.away), home = clean(body.home)
  if (!away || !home) return 'Both teams are required'
  const line = numOrNull(body.line)
  if (line === null || Math.abs(line) > 200) return 'Line is missing or out of range'
  if (type === 'total' && line <= 0) return 'A total must be above zero'
  const awayScore = numOrNull(body.awayScore), homeScore = numOrNull(body.homeScore)
  for (const s of [awayScore, homeScore]) if (s !== null && (s < 0 || s > 300 || !Number.isInteger(s))) return 'Scores must be whole numbers'
  const manual = ['W', 'L', 'P'].includes(body.manual) ? body.manual : null
  return { day, slot, type, side, away, home, line, awayScore, homeScore, manual, updatedAt: Date.now() }
}

export function parseSettings(body: any): Settings | string {
  if (!body || !Array.isArray(body.players) || body.players.length !== PLAYER_COUNT) return `Need exactly ${PLAYER_COUNT} players`
  const players = body.players.map((p: unknown, i: number) => clean(p, 20) || `Player ${i + 1}`)
  const startDate = /^\d{4}-\d{2}-\d{2}$/.test(body.startDate) ? body.startDate : DEFAULT_SETTINGS.startDate
  const offDays = Array.isArray(body.offDays)
    ? Array.from(new Set<number>(body.offDays.map(Number).filter((d: number) => Number.isInteger(d) && d >= 0 && d < DAYS))).sort((a, b) => a - b)
    : []
  return { players, startDate, offDays }
}

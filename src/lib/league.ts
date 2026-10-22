import { espnDate, getSlate, hasStarted, Game, num } from './espn'
import { addCheckedDay, claimSettle, DAYS, getAllPicks, getCheckedDays, getPick, getSettings, Pick, PICK_ID, PLAYER_COUNT, putPicks, putSettings, Settings } from './store'

/** Day number (0-based) for today's date in US Eastern time. */
export function dayIndexET(startDate: string): number {
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' }) // YYYY-MM-DD
  return Math.round((Date.parse(today + 'T00:00:00Z') - Date.parse(startDate + 'T00:00:00Z')) / 86400000)
}

export class HttpError extends Error {
  constructor(public status: number, message: string) { super(message) }
}

/** Build a pick from the live slate: the server fills teams and the line, so lines can't be fudged. */
export async function buildEventPick(id: string, body: any): Promise<Pick> {
  const m = PICK_ID.exec(id)
  if (!m) throw new HttpError(400, 'Bad pick id')
  const day = Number(m[1]), slot = Number(m[2])
  if (day >= DAYS || slot >= PLAYER_COUNT) throw new HttpError(400, 'Day or player out of range')
  const type = body?.type, side = body?.side
  if (type !== 'spread' && type !== 'total') throw new HttpError(400, 'Bet type must be spread or total')
  const okSide = type === 'spread' ? side === 'away' || side === 'home' : side === 'over' || side === 'under'
  if (!okSide) throw new HttpError(400, 'Pick a valid side')

  await assertNotLocked(id)
  const settings = await getSettings()
  const games = await getSlate(espnDate(settings.startDate, day), true)
  const g = games.find((x) => x.id === String(body.eventId) && (!body.league || x.league === body.league))
  if (!g) throw new HttpError(400, "That game isn't on this day's slate")
  // One-time exception: Day 1 picks were made before the site existed, so they can be logged
  // after kickoff with the line the group actually took. Closed after Oct 18, 2026.
  const backfill = day === 0 && Date.now() < Date.parse('2026-10-19T04:00:00Z') && num(body?.backfillLine) !== null
  if (hasStarted(g) && !backfill) throw new HttpError(409, 'That game has kicked off. Picks lock at kickoff.')
  const line = backfill ? num(body.backfillLine) : type === 'total' ? g.total : side === 'home' ? g.spreadHome : g.spreadAway
  if (line === null) throw new HttpError(409, `No ${type === 'total' ? 'total' : 'spread'} posted for this game yet`)

  await assertNotTaken(day, slot, { eventId: g.id, league: g.league, away: g.away.name, home: g.home.name, type, side }, settings)

  return {
    day, slot, type, side, line,
    away: g.away.name, home: g.home.name,
    awayAbbr: g.away.abbr, homeAbbr: g.home.abbr,
    awayLogo: g.away.logo, homeLogo: g.home.logo,
    awayScore: null, homeScore: null, manual: null,
    eventId: g.id, league: g.league, kickoff: g.start,
    live: { state: g.state, detail: g.detail, away: null, home: null },
    updatedAt: Date.now(),
  }
}

const gameKey = (p: { away?: string; home?: string }) => `${(p.away || '').trim().toLowerCase()}@${(p.home || '').trim().toLowerCase()}`

/** No two players may hold the exact same bet (same game, same side or same over/under) on a day. */
export async function assertNotTaken(
  day: number, slot: number,
  bet: { eventId?: string | null; league?: string; away: string; home: string; type: string; side: string },
  settings?: Settings,
) {
  const picks = await getAllPicks()
  for (const p of Object.values(picks)) {
    if (p.day !== day || p.slot === slot || p.type !== bet.type || p.side !== bet.side) continue
    const sameGame = bet.eventId && p.eventId
      ? p.eventId === bet.eventId && (!p.league || !bet.league || p.league === bet.league)
      : gameKey(p) === gameKey(bet)
    if (sameGame) {
      const s = settings ?? (await getSettings())
      const who = s.players[p.slot] || 'Someone'
      throw new HttpError(409, `${who} already took ${bet.type === 'total' ? (bet.side === 'over' ? 'the over' : 'the under') : 'that side'}. Pick something else.`)
    }
  }
}

/** Event picks can't be changed or deleted once their game has started. */
export async function assertNotLocked(id: string) {
  const existing = await getPick(id)
  if (existing?.eventId && existing.kickoff && Date.parse(existing.kickoff) <= Date.now()) {
    throw new HttpError(409, 'This pick locked at kickoff')
  }
}

/**
 * Past days with no college or NFL games become days off automatically, so nobody takes a
 * missed-pick loss for them. Each past day is checked once; a fetch failure just retries later.
 */
async function markEmptyDays(settings: Settings, today: number): Promise<Settings> {
  const checked = await getCheckedDays()
  const off = new Set(settings.offDays)
  const toCheck: number[] = []
  for (let d = 0; d < Math.min(today, DAYS); d++) if (!off.has(d) && !checked.has(d)) toCheck.push(d)
  if (!toCheck.length) return settings
  const newlyOff: number[] = []
  for (const d of toCheck.slice(0, 6)) {
    const games = await getSlate(espnDate(settings.startDate, d), true, true)
    if (games.length === 0) newlyOff.push(d)
    await addCheckedDay(d)
  }
  if (!newlyOff.length) return settings
  const next = { ...settings, offDays: Array.from(off).concat(newlyOff).sort((a, b) => a - b) }
  await putSettings(next)
  return next
}

/**
 * Pull live/final scores for every unfinished slate pick and write them back.
 * Throttled so it runs at most every `everySec` seconds no matter how many phones poll.
 */
export async function settle(opts: { everySec?: number; force?: boolean } = {}): Promise<{ ran: boolean; updated: number }> {
  if (!opts.force && !(await claimSettle(opts.everySec ?? 40))) return { ran: false, updated: 0 }
  let settings = await getSettings()
  const today = dayIndexET(settings.startDate)
  try { settings = await markEmptyDays(settings, today) } catch (e) { console.error('off-day check failed', e) }
  const picks = await getAllPicks()
  const now = Date.now()
  // Unfinished slate picks from today or earlier (late games can finish after midnight ET)
  const pending = Object.entries(picks).filter(([, p]) =>
    p.eventId && (p.awayScore === null || p.homeScore === null) && p.day <= today)
  if (!pending.length) return { ran: true, updated: 0 }

  const byDate = new Map<string, Game[]>()
  for (const [, p] of pending) {
    const date = espnDate(settings.startDate, p.day)
    if (!byDate.has(date)) {
      try { byDate.set(date, await getSlate(date)) } catch { byDate.set(date, []) }
    }
  }

  const changed: Record<string, Pick> = {}
  for (const [id, p] of pending) {
    const g = byDate.get(espnDate(settings.startDate, p.day))?.find((x) => x.id === p.eventId && (!p.league || x.league === p.league))
    if (!g) continue
    const live = { state: g.state, detail: g.detail, away: g.away.score, home: g.home.score }
    const final = g.state === 'post' && g.completed && g.away.score !== null && g.home.score !== null
    const next: Pick = { ...p, live, kickoff: g.start, ...(final ? { awayScore: g.away.score, homeScore: g.home.score } : {}) }
    if (JSON.stringify(next.live) !== JSON.stringify(p.live) || next.awayScore !== p.awayScore || next.homeScore !== p.homeScore || next.kickoff !== p.kickoff) {
      changed[id] = { ...next, updatedAt: now }
    }
  }
  if (Object.keys(changed).length) await putPicks(changed)
  return { ran: true, updated: Object.keys(changed).length }
}

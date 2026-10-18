import { NextRequest, NextResponse } from 'next/server'
import { espnDate, getSlate } from '@/lib/espn'
import { DAYS, getSettings } from '@/lib/store'

export const dynamic = 'force-dynamic'

// GET /api/games?day=0..43 → that day's FBS slate with current lines and scores
export async function GET(req: NextRequest) {
  const day = Number(req.nextUrl.searchParams.get('day'))
  if (!Number.isInteger(day) || day < 0 || day >= DAYS) return NextResponse.json({ error: 'Bad day' }, { status: 400 })
  try {
    const settings = await getSettings()
    const date = espnDate(settings.startDate, day)
    return NextResponse.json({ date, games: await getSlate(date) })
  } catch (e) {
    console.error('games error', e)
    return NextResponse.json({ error: "Couldn't load the slate from ESPN. Try again in a minute." }, { status: 502 })
  }
}

import { NextRequest, NextResponse } from 'next/server'
import { getState, getVersion } from '@/lib/store'
import { settle } from '@/lib/league'

export const dynamic = 'force-dynamic'

// GET /api/state?since=<version>
// Also kicks off throttled auto-grading, so live scores flow in while anyone has the site open.
// Returns { unchanged: true, version } when nothing changed, so polling stays cheap.
export async function GET(req: NextRequest) {
  try {
    try { await settle({ everySec: 40 }) } catch (e) { console.error('settle error', e) }
    const since = req.nextUrl.searchParams.get('since')
    if (since !== null) {
      const version = await getVersion()
      if (String(version) === since) return NextResponse.json({ unchanged: true, version })
    }
    return NextResponse.json(await getState())
  } catch (e) {
    console.error('state error', e)
    return NextResponse.json({ error: 'Storage unavailable' }, { status: 503 })
  }
}

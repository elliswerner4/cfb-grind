import { NextRequest, NextResponse } from 'next/server'
import { getState, getVersion } from '@/lib/store'

export const dynamic = 'force-dynamic'

// GET /api/state?since=<version>
// Returns { unchanged: true, version } when nothing changed, so polling stays cheap.
export async function GET(req: NextRequest) {
  try {
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

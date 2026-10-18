import { NextRequest, NextResponse } from 'next/server'
import { parseSettings, putSettings } from '@/lib/store'

export const dynamic = 'force-dynamic'

export async function PUT(req: NextRequest) {
  const body = await req.json().catch(() => null)
  const settings = parseSettings(body)
  if (typeof settings === 'string') return NextResponse.json({ error: settings }, { status: 400 })
  try {
    const version = await putSettings(settings)
    return NextResponse.json({ ok: true, version, settings })
  } catch (e) {
    console.error('put settings error', e)
    return NextResponse.json({ error: 'Storage unavailable' }, { status: 503 })
  }
}

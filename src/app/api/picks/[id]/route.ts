import { NextRequest, NextResponse } from 'next/server'
import { deletePick, parsePick, putPick } from '@/lib/store'

export const dynamic = 'force-dynamic'

export async function PUT(req: NextRequest, { params }: { params: { id: string } }) {
  const body = await req.json().catch(() => null)
  const pick = parsePick(params.id, body)
  if (typeof pick === 'string') return NextResponse.json({ error: pick }, { status: 400 })
  try {
    const version = await putPick(params.id, pick)
    return NextResponse.json({ ok: true, version, pick })
  } catch (e) {
    console.error('put pick error', e)
    return NextResponse.json({ error: 'Storage unavailable' }, { status: 503 })
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  if (!/^d[0-4][0-9]-p[0-9]$/.test(params.id)) return NextResponse.json({ error: 'Bad pick id' }, { status: 400 })
  try {
    const version = await deletePick(params.id)
    return NextResponse.json({ ok: true, version })
  } catch (e) {
    console.error('delete pick error', e)
    return NextResponse.json({ error: 'Storage unavailable' }, { status: 503 })
  }
}

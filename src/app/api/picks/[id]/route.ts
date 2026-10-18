import { NextRequest, NextResponse } from 'next/server'
import { deletePick, parsePick, putPick } from '@/lib/store'
import { assertNotLocked, buildEventPick, HttpError } from '@/lib/league'

export const dynamic = 'force-dynamic'

function fail(e: unknown) {
  if (e instanceof HttpError) return NextResponse.json({ error: e.message }, { status: e.status })
  console.error('pick error', e)
  return NextResponse.json({ error: 'Storage unavailable' }, { status: 503 })
}

export async function PUT(req: NextRequest, { params }: { params: { id: string } }) {
  const body = await req.json().catch(() => null)
  try {
    let pick
    if (body?.eventId) {
      pick = await buildEventPick(params.id, body)
    } else {
      await assertNotLocked(params.id)
      const parsed = parsePick(params.id, body)
      if (typeof parsed === 'string') throw new HttpError(400, parsed)
      pick = { ...parsed, eventId: null }
    }
    const version = await putPick(params.id, pick)
    return NextResponse.json({ ok: true, version, pick })
  } catch (e) { return fail(e) }
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  if (!/^d[0-4][0-9]-p[0-9]$/.test(params.id)) return NextResponse.json({ error: 'Bad pick id' }, { status: 400 })
  try {
    await assertNotLocked(params.id)
    const version = await deletePick(params.id)
    return NextResponse.json({ ok: true, version })
  } catch (e) { return fail(e) }
}

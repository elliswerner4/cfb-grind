import { NextResponse } from 'next/server'
import { settle } from '@/lib/league'

export const dynamic = 'force-dynamic'

// Daily Vercel cron backstop; normal grading happens whenever someone has the site open.
export async function GET() {
  try {
    return NextResponse.json(await settle({ force: true }))
  } catch (e) {
    console.error('settle error', e)
    return NextResponse.json({ error: 'Settle failed' }, { status: 500 })
  }
}

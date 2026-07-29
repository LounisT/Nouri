import { NextRequest, NextResponse } from 'next/server'

// URL OTP côté serveur — non exposée au client (pas NEXT_PUBLIC_)
const OTP_INTERNAL = process.env.OTP_INTERNAL_URL ?? 'http://localhost:8080'

export async function GET(
  req: NextRequest,
  { params }: { params: { path: string[] } }
) {
  const path = params.path.join('/')
  const search = req.nextUrl.search
  const target = `${OTP_INTERNAL}/otp/${path}${search}`

  try {
    const res = await fetch(target, {
      headers: { Accept: 'application/json' },
      next: { revalidate: 30 },
    })

    const data = await res.text()

    return new NextResponse(data, {
      status: res.status,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'public, max-age=30, stale-while-revalidate=60',
      },
    })
  } catch {
    return NextResponse.json({ error: 'OTP unavailable' }, { status: 503 })
  }
}

'use client'

import { getLegColor, type OtpLeg } from '@/lib/otp'

// Séquence de trajet façon « Bonjour RATP » : 🚶10 · [M1] · [T1] · 🚶8
// Chaque tronçon transport = pastille colorée à sa couleur de mode ; chaque
// marche = petit piéton + minutes. Séparés par des points médians.
export default function LegSequence({ legs, size = 'md' }: { legs: OtpLeg[]; size?: 'sm' | 'md' }) {
  const badgeText = size === 'sm' ? 'text-caption' : 'text-label'
  const walkText = size === 'sm' ? 'text-caption' : 'text-label'
  const items: React.ReactNode[] = []

  legs.forEach((leg, i) => {
    const mins = Math.max(1, Math.round(leg.duration / 60))
    if (leg.mode === 'WALK') {
      items.push(
        <span key={`w${i}`} className={`inline-flex items-center gap-0.5 ${walkText} font-medium text-ink-600`}>
          <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
            <circle cx="13" cy="4" r="1.6" strokeWidth={2} />
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 8l-2 4 3 2 1 6M11 12l-3 2M14 14l3-1" />
          </svg>
          {mins}
        </span>,
      )
    } else {
      items.push(
        <span
          key={`t${i}`}
          className={`inline-flex items-center justify-center rounded-md px-1.5 py-0.5 ${badgeText} font-bold text-white`}
          style={{ backgroundColor: getLegColor(leg.mode), minWidth: 24 }}
          dir="ltr"
        >
          {leg.routeShortName || modeShort(leg.mode)}
        </span>,
      )
    }
  })

  // Intercale un point médian entre chaque élément.
  const withSeparators: React.ReactNode[] = []
  items.forEach((item, i) => {
    if (i > 0) withSeparators.push(<span key={`s${i}`} className="text-ink-400">·</span>)
    withSeparators.push(item)
  })

  return <div className="flex flex-wrap items-center gap-1.5">{withSeparators}</div>
}

function modeShort(mode: OtpLeg['mode']): string {
  if (mode === 'SUBWAY') return 'M'
  if (mode === 'TRAM') return 'T'
  if (mode === 'RAIL') return 'R'
  return 'B'
}

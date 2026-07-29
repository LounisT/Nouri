'use client'

import { allStations, getStationName } from '@/lib/stations'
import { formatDistance } from '@/lib/otp'
import { getServiceFrequency, getHeadwayLabel } from '@/lib/gtfs'
import { METRO_COLOR, TRAM_COLOR } from '@/lib/stations'
import type { Coordinate } from '@/lib/otp'
import { useTranslation } from '@/hooks/useTranslation'

interface NearbyStationsProps {
  lat: number
  lon: number
  onSelect?: (coord: Coordinate) => void
}

export default function NearbyStations({ lat, lon, onSelect }: NearbyStationsProps) {
  const { t, locale } = useTranslation()
  const latRad = lat * (Math.PI / 180)
  const nearby = allStations
    .map((s) => {
      const dLat = (s.lat - lat) * 111000
      const dLon = (s.lon - lon) * 111000 * Math.cos(latRad)
      return { ...s, dist: Math.hypot(dLat, dLon) }
    })
    .sort((a, b) => a.dist - b.dist)
    .slice(0, 3)

  const service = getServiceFrequency()

  return (
    <div className="shrink-0 border-t border-line px-5 py-3">
      <p className="pb-2 text-label font-semibold uppercase tracking-[0.06em] text-ink-600">
        {t('nearbyStations')}
      </p>
      {/* Rangées plates : la mise en page s inverse par les propriétés
          logiques (start/end), jamais par un flex-row-reverse conditionnel —
          celui-ci s ajoutait à l inversion CSS et la doublait. */}
      {nearby.map((s, i) => (
        <button
          key={s.id}
          type="button"
          onClick={() => onSelect?.({ lat: s.lat, lon: s.lon, name: getStationName(s, locale) })}
          disabled={!onSelect}
          className={`tap flex min-h-[44px] w-full items-center gap-3 py-2 text-start disabled:cursor-default ${
            i < nearby.length - 1 ? 'border-b border-line' : ''
          }`}
        >
          <span
            className="flex h-[18px] min-w-[20px] shrink-0 items-center justify-center rounded-md px-1.5 text-[10px] font-semibold text-white"
            style={{ backgroundColor: s.type === 'metro' ? METRO_COLOR : TRAM_COLOR }}
            aria-hidden="true"
          >
            {s.type === 'metro' ? 'M1' : 'T1'}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-emph text-ink-900">{getStationName(s, locale)}</span>
            <span className="block truncate text-label text-ink-400">
              {formatDistance(s.dist)} · {Math.round(s.dist / 1.33 / 60)} {t('walkMin')}
            </span>
          </span>
        </button>
      ))}
      {/* Fréquence, jamais un temps d attente : rien ne dit quand la prochaine
          rame arrive, et l app ne peut pas le savoir. Hors service reste gris
          — c est un état, pas une panne. */}
      <p className="mt-2 text-label text-ink-400">
        {service.isOpen ? getHeadwayLabel(service.headwaySecs, locale) : t('outOfService')}
      </p>
    </div>
  )
}

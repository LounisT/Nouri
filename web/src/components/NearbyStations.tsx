'use client'

import { useMemo } from 'react'
import { lineModeLabel, lineStopName, nextPassLabel } from '@/lib/lines'
import { lineBadgeColors, lineServiceState, nearbyLineEntries, stopHeadway, NEARBY_RADIUS_M } from '@/lib/line-catalog'
import { formatDistance } from '@/lib/otp'
import type { Coordinate } from '@/lib/otp'
import { useTranslation } from '@/hooks/useTranslation'
import { useMinuteTick } from '@/hooks/useMinuteTick'

interface NearbyStationsProps {
  lat: number
  lon: number
  onSelect?: (coord: Coordinate) => void
  /** Rayon de recherche ; le texte d'état vide parle de 1,5 km. */
  radiusM?: number
  /** Nombre de lignes affichées ; les suivantes sont comptées, jamais tues. */
  max?: number
  /**
   * Point autre que la position de l'usager (départ d'une recherche sans
   * résultat) : nommé sous le titre, et l'état vide parle de « ce point ».
   */
  pointName?: string
  /** Bouton ✕ : le parent retire le bloc. */
  onClose?: () => void
}

// « Lignes à proximité » : métro, tram ET bus dont un arrêt est à moins de
// 1,5 km, une rangée par ligne (son arrêt le plus proche). Auparavant : les
// trois stations de métro/tram les plus proches sans limite de distance
// (« station proche » à 20 km depuis Zéralda), bus ignorés, « Toutes les
// 10 min » sans « ~ ». Fréquence et état viennent de la même source que le
// catalogue et le calculateur (départs du GTFS, heure d'Alger).
export default function NearbyStations({
  lat,
  lon,
  onSelect,
  radiusM = NEARBY_RADIUS_M,
  max = 5,
  pointName,
  onClose,
}: NearbyStationsProps) {
  const { t, tf, locale } = useTranslation()
  const now = useMinuteTick()
  const { entries, others } = useMemo(() => nearbyLineEntries(lat, lon, { radiusM, max }), [lat, lon, radiusM, max])

  return (
    <section className="shrink-0 px-5 py-3" aria-label={t('cat_nearbyTitle')}>
      <div className="flex items-start gap-2 pb-2">
        <div className="min-w-0 flex-1">
          <p className="text-label font-semibold uppercase tracking-[0.06em] text-ink-600">
            {t('cat_nearbyTitle')}
          </p>
          {pointName ? (
            <p className="mt-0.5 truncate text-label text-ink-600">
              {tf('cat_nearPoint', { name: '⁨' + pointName + '⁩' })}
            </p>
          ) : null}
        </div>
        {onClose ? (
          <button
            type="button"
            onClick={onClose}
            aria-label={t('close')}
            className="tap -my-2 -me-3 flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-ink-600 focus:outline-none focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-brand"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
          </button>
        ) : null}
      </div>

      {entries.length === 0 ? (
        <div className="pb-1">
          <p className="text-body font-medium text-ink-900">{t('noNearbyLines')}</p>
          <p className="mt-1 text-label text-ink-600">{t(pointName ? 'cat_noNearbyPointExplain' : 'noNearbyLinesExplain')}</p>
        </div>
      ) : (
        <>
          {/* Rangées plates : la mise en page s'inverse par les propriétés
              logiques (start/end), jamais par un flex-row-reverse conditionnel —
              celui-ci s'ajoutait à l'inversion CSS et la doublait. */}
          {entries.map((entry, i) => {
            const { line, stop } = entry
            const { background, color } = lineBadgeColors(line)
            // Heure inconnue avant l'hydratation (null) : état affiché juste après.
            const state = now ? lineServiceState(line, now) : null
            const headway = now && state?.kind === 'open' ? stopHeadway(line, stop, now) : null
            const name = lineStopName(stop, locale)
            return (
              <button
                key={line.id}
                type="button"
                onClick={() => onSelect?.({ lat: stop.lat, lon: stop.lon, name })}
                disabled={!onSelect}
                className={`tap flex min-h-[44px] w-full items-center gap-3 py-2 text-start focus:outline-none focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-brand disabled:cursor-default ${
                  i < entries.length - 1 ? 'border-b border-line' : ''
                }`}
              >
                <span
                  className="inline-flex h-5 min-w-[26px] shrink-0 items-center justify-center rounded-[6px] px-1.5 text-[11px] font-semibold"
                  style={{ backgroundColor: background, color }}
                  dir="ltr"
                  role="img"
                  aria-label={`${lineModeLabel(line.mode, locale)} ${line.shortName}`}
                >
                  {line.shortName}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-emph text-ink-900">{name}</span>
                  <span className="tnum block truncate text-label text-ink-400">
                    {tf('cat_walkEstimate', { d: formatDistance(entry.distanceM, locale), n: entry.walkMin })}
                  </span>
                </span>
                {/* Fréquence, jamais un temps d'attente : rien ne dit quand le
                    prochain véhicule arrive, et l'app ne peut pas le savoir.
                    Hors service reste gris — c'est un état, pas une panne. */}
                <span className="tnum shrink-0 text-end text-label text-ink-600">
                  {state?.kind === 'open' && headway !== null ? nextPassLabel(headway, locale) : null}
                  {state?.kind === 'open' && headway === null ? <span className="text-open">{t('open')}</span> : null}
                  {state?.kind === 'ending' ? t('cat_ending') : null}
                  {state?.kind === 'closed' ? (
                    <span className="text-ink-400">
                      {t('closed')}
                      {state.firstDeparture ? <> · {t('opensAt')} <bdi dir="ltr">{state.firstDeparture}</bdi></> : null}
                    </span>
                  ) : null}
                </span>
              </button>
            )
          })}
          {others > 0 && (
            <p className="mt-1.5 text-label text-ink-600">{tf('cat_nearbyMore', { n: others })}</p>
          )}
        </>
      )}
      <p className="mt-2 text-label text-ink-400">{t('cat_nearbyNote')}</p>
    </section>
  )
}

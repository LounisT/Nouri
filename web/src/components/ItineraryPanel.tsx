'use client'

import { OtpItinerary, OtpLeg, formatDuration, formatDistance, formatTime, getLegColor, computeFare, isSchematicLeg } from '@/lib/otp'
import { allLines, estimatedHeadwayMin, isDeducedShape, nextPassLabel } from '@/lib/lines'
import { useTranslation } from '@/hooks/useTranslation'

interface ItineraryPanelProps {
  itineraries: OtpItinerary[]
  selectedIndex: number
  onSelect: (index: number) => void
  onClose: () => void
  fromName?: string
  toName?: string
  hideHeader?: boolean
}

export default function ItineraryPanel({
  itineraries,
  selectedIndex,
  onSelect,
  onClose,
  fromName,
  toName,
  hideHeader = false,
}: ItineraryPanelProps) {
  const selected = itineraries[selectedIndex]
  const { t } = useTranslation()

  return (
    <div className="h-full flex flex-col" style={{ backgroundColor: '#ffffff', color: '#111827' }}>
      {/* Header (desktop uniquement — le mobile a son propre header 1h) */}
      {!hideHeader && (
        <>
          <div className="flex items-start justify-between px-4 pt-3 pb-2 shrink-0">
            <div className="min-w-0">
              {fromName && toName ? (
                <>
                  <p className="text-[11px] text-gray-400 font-medium uppercase tracking-wide truncate">
                    {fromName} › {toName}
                  </p>
                  <p className="font-bold text-gray-800 text-sm mt-0.5">
                    {itineraries.length} {itineraries.length > 1 ? t('itinerariesPlural') : t('itineraries')}
                  </p>
                </>
              ) : (
                <h2 className="font-bold text-gray-800 text-sm">
                  {itineraries.length} {itineraries.length > 1 ? t('itinerariesPlural') : t('itineraries')} {itineraries.length > 1 ? t('routesFoundPlural') : t('routesFound')}
                </h2>
              )}
            </div>
            <button
              onClick={onClose}
              className="text-gray-400 hover:text-gray-600 p-1 shrink-0 ml-2 rounded-xl hover:bg-gray-100 transition-colors"
              aria-label={t('close')}
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          {/* Sélecteur d'itinéraire (desktop) — un seul traitement par état */}
          {itineraries.length > 1 && (
            <div className="flex gap-2 px-4 pb-2 shrink-0">
              {itineraries.map((it, i) => (
                <button
                  key={i}
                  type="button"
                  onClick={() => onSelect(i)}
                  aria-pressed={i === selectedIndex}
                  className={`flex-1 py-1.5 px-2 rounded-control text-xs font-semibold transition-colors flex flex-col items-center gap-0.5 ${
                    i === selectedIndex ? 'bg-brand text-white' : 'bg-paper-2 text-ink-600'
                  }`}
                >
                  <span className="tnum">{formatDuration(it.duration)}</span>
                  <ModeChips legs={it.legs} />
                </button>
              ))}
            </div>
          )}

          <div className="h-px bg-line mx-4 shrink-0" />
        </>
      )}

      {/* Détail (planche 1h) : résumé, barre de segments, fil vertical, tarif */}
      {selected && (
        <div className="overflow-y-auto flex-1 px-5 pb-3">

          <div className="flex items-baseline gap-2.5 pt-3.5">
            <span className="tnum text-display font-semibold text-ink-900">{formatDuration(selected.duration)}</span>
            <span className="tnum text-body text-ink-600" dir="ltr">
              {formatTime(selected.startTime)} → {formatTime(selected.endTime)}
            </span>
          </div>

          <JourneyFlow legs={selected.legs} />

          <ol className="mt-1">
            {selected.legs.map((leg, i) => (
              <LegItem
                key={i}
                leg={leg}
                index={i}
                legs={selected.legs}
                isLast={i === selected.legs.length - 1}
              />
            ))}
          </ol>

          {/* Tarif — rangée plate à filet (planche 1h) */}
          {computeFare(selected.legs) > 0 && (
            <div className="mt-[18px] flex items-center justify-between border-t border-line py-4">
              <span className="text-body text-ink-600">{t('estimatedFare')}</span>
              <span className="tnum text-emph font-semibold text-ink-900">{computeFare(selected.legs)} DZD</span>
            </div>
          )}

          <p className="text-label text-ink-400">{t('tildeNote')}</p>
          {/* Un tronçon dessiné en tirets larges n'a pas de tracé relevé : on
              l'écrit, sinon la carte laisse croire à un itinéraire connu. */}
          {selected.legs.some((leg) => leg.mode !== 'WALK' && isSchematicLeg(leg)) && (
            <p className="text-label text-ink-400">{t('routeNotMapped')}</p>
          )}
          {/* Tracé déduit par routage sur la voirie (standard décidé le 19/07 :
              routes réelles reliant les arrêts). C'est une estimation : on le
              dit, comme pour les horaires. */}
          {selected.legs.some((leg) => leg.mode !== 'WALK' && !isSchematicLeg(leg) && isDeducedShape(leg.routeShortName, leg.headsign)) && (
            <p className="text-label text-ink-400">{t('routeEstimated')}</p>
          )}
        </div>
      )}
    </div>
  )
}

// ─── JourneyFlow — barre de segments h6 + légende séquentielle (planche 1h) ──
function JourneyFlow({ legs }: { legs: OtpLeg[] }) {
  const { t } = useTranslation()
  const total = legs.reduce((s, l) => s + l.duration, 0)
  if (total === 0) return null

  const legendParts = legs.map((l) => {
    const min = Math.max(1, Math.round(l.duration / 60))
    return l.mode === 'WALK' ? `${min} ${t('walkMin')}` : `${l.routeShortName ?? ''} ${min} ${t('min')}`
  })

  return (
    <div className="mt-3">
      <div className="flex h-1.5 gap-0.5 overflow-hidden rounded-[4px]" role="img" aria-hidden="true">
        {legs.map((leg, i) => (
          <div
            key={i}
            style={{
              width: `${(leg.duration / total) * 100}%`,
              minWidth: 4,
              backgroundColor: leg.mode === 'WALK' ? '#E5E7EB' : getLegColor(leg.mode),
            }}
          />
        ))}
      </div>
      <p className="tnum mt-1.5 text-label text-ink-400">{legendParts.join(' · ')}</p>
    </div>
  )
}

// ─── Fil vertical (planche 1h) ───────────────────────────────────────────────
// Départ = dot 8px bleu (la position) ; embarquement/descente = cercle blanc
// bordé 3px couleur de ligne ; marche = fil pointillé gris ; arrivée = carré noir.
function LegItem({ leg, index, legs, isLast }: {
  leg: OtpLeg
  index: number
  legs: OtpLeg[]
  isLast: boolean
}) {
  const { t, locale } = useTranslation()
  const color = getLegColor(leg.mode)
  const isWalk = leg.mode === 'WALK'
  const prevTransit = [...legs.slice(0, index)].reverse().find((l) => l.mode !== 'WALK')
  const line = !isWalk ? allLines.find((l) => l.shortName === leg.routeShortName) : undefined
  const headway = line ? estimatedHeadwayMin(line, new Date(leg.startTime)) : null
  const stopCount = leg.intermediateStops ? leg.intermediateStops.length + 1 : null
  const durMin = Math.max(1, Math.round(leg.duration / 60))

  const marker = isWalk
    ? index === 0
      ? <span className="mt-[5px] h-2 w-2 shrink-0 rounded-full bg-brand" aria-hidden="true" />
      : (
        <span
          className="h-[18px] w-[18px] shrink-0 rounded-full border-[3px] bg-white"
          style={{ borderColor: prevTransit ? getLegColor(prevTransit.mode) : '#9CA3AF' }}
          aria-hidden="true"
        />
      )
    : (
      <span
        className="h-[18px] w-[18px] shrink-0 rounded-full border-[3px] bg-white"
        style={{ borderColor: color }}
        aria-hidden="true"
      />
    )

  const rail = isWalk
    ? (
      <span
        className="mt-1 w-0.5 flex-1"
        style={{ background: 'repeating-linear-gradient(#9CA3AF 0 4px, transparent 4px 9px)', minHeight: 18 }}
        aria-hidden="true"
      />
    )
    : (
      <span
        className="mt-0.5 w-[3px] flex-1"
        style={{ backgroundColor: color, minHeight: 18 }}
        aria-hidden="true"
      />
    )

  return (
    <>
      <li className="flex gap-3.5">
        <div className="flex w-[18px] shrink-0 flex-col items-center">
          {marker}
          {rail}
        </div>

        <div className="min-w-0 flex-1 pb-4">
          <div className="flex items-baseline justify-between gap-2">
            <p className="min-w-0 truncate text-emph font-medium text-ink-900">{leg.from.name}</p>
            <span className="tnum shrink-0 text-label text-ink-400" dir="ltr">
              {index === 0 ? formatTime(leg.startTime) : `~${formatTime(leg.startTime)}`}
            </span>
          </div>

          {isWalk ? (
            <p className="tnum mt-0.5 text-label text-ink-400">
              {t('walkVerb')} {formatDistance(leg.distance)} · {durMin} {t('min')}
            </p>
          ) : (
            <>
              <div className="mt-1.5 flex items-center gap-2">
                <span
                  className="inline-flex h-6 min-w-[32px] items-center justify-center rounded-[8px] px-[7px] text-label font-semibold text-white"
                  style={{ backgroundColor: color }}
                  dir="ltr"
                >
                  {leg.routeShortName}
                </span>
                <span className="min-w-0 truncate text-body text-ink-600">
                  {t('directionShort')} {leg.headsign}
                </span>
              </div>
              <p className="tnum mt-1.5 text-label text-ink-400">
                {stopCount ? `${stopCount} ${t('stops')} · ` : ''}
                {durMin} {t('min')}
                {headway ? ` · ${nextPassLabel(headway, locale)}` : ''}
              </p>
            </>
          )}
        </div>
      </li>

      {isLast && (
        <li className="flex gap-3.5">
          <div className="flex w-[18px] shrink-0 justify-center">
            <span className="mt-[5px] h-2 w-2 shrink-0 rounded-[2px] bg-ink-900" aria-hidden="true" />
          </div>
          <div className="flex min-w-0 flex-1 items-baseline justify-between gap-2">
            <p className="min-w-0 truncate text-emph font-medium text-ink-900">{leg.to.name}</p>
            <span className="tnum shrink-0 text-label text-ink-400" dir="ltr">
              ~{formatTime(leg.endTime)}
            </span>
          </div>
        </li>
      )}
    </>
  )
}

// ─── Chips de modes pour le sélecteur desktop ────────────────────────────────
function ModeChips({ legs }: { legs: OtpLeg[] }) {
  const { t } = useTranslation()
  const transit = legs.filter((l) => l.mode !== 'WALK')
  if (transit.length === 0) return <span className="text-[11px] opacity-70">{t('walkingOnly')}</span>
  return (
    <div className="flex gap-0.5">
      {transit.map((l, i) => (
        <span
          key={i}
          className="rounded px-1 text-[11px] font-semibold"
          style={{ backgroundColor: 'rgba(255,255,255,0.25)', color: 'inherit' }}
        >
          {l.routeShortName}
        </span>
      ))}
    </div>
  )
}

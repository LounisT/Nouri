'use client'

import { useMemo, useState } from 'react'
import {
  linesByMode,
  allLines,
  lineModeLabel,
  lineDisplayName,
  lineStopName,
  isInService,
  estimatedHeadwayMin,
  type TransitLine,
  type LineMode,
  type LineStop,
  nextPassLabel,
} from '@/lib/lines'
import { useTranslation } from '@/hooks/useTranslation'
import type { Locale } from '@/lib/i18n'
import type { Coordinate } from '@/lib/otp'

interface LineViewProps {
  onSelectStation?: (coord: Coordinate) => void
}

const MODE_ORDER: LineMode[] = ['metro', 'tram', 'bus']

function ModeBadge({ line, locale }: { line: TransitLine; locale: Locale }) {
  return (
    <span
      className="inline-flex h-[26px] shrink-0 items-center justify-center rounded-[8px] px-2 text-[13px] font-semibold text-white"
      style={{ backgroundColor: line.color, minWidth: 36 }}
      dir="ltr"
      aria-label={`${lineModeLabel(line.mode, locale)} ${line.shortName}`}
    >
      {line.shortName}
    </span>
  )
}

// État de service — le libellé porte l'info, la couleur ne fait que l'appuyer (a11y).
function ServiceState({ line, now, locale, t }: {
  line: TransitLine; now: Date; locale: Locale; t: (k: never) => string
}) {
  const open = isInService(line, now)
  if (open) {
    return (
      <span className="shrink-0 text-label font-medium text-open">
        {(t as (k: string) => string)('open')}
      </span>
    )
  }
  return (
    <span className="tnum shrink-0 text-label font-medium text-ink-400" dir={locale === 'ar' ? 'rtl' : 'ltr'}>
      {(t as (k: string) => string)('closed')}
      {line.hours ? ` · ${(t as (k: string) => string)('opensAt')} ${line.hours.first}` : ''}
    </span>
  )
}

// Correspondances à un arrêt (planche 1d) : autres lignes passant à < 150 m.
// Métro/tram = mini badge coloré ; bus = texte gris « Bus 14 · 15 · 16 ».
interface StopConnections {
  badges: { label: string; color: string }[]
  busRefs: string[]
}

function metersBetween(aLat: number, aLon: number, bLat: number, bLon: number): number {
  const dLat = (aLat - bLat) * 111320
  const dLon = (aLon - bLon) * 111320 * Math.cos((aLat * Math.PI) / 180)
  return Math.hypot(dLat, dLon)
}

function computeConnections(line: TransitLine, stops: LineStop[]): StopConnections[] {
  return stops.map((stop) => {
    const badges: { label: string; color: string }[] = []
    const busRefs: string[] = []
    for (const other of allLines) {
      if (other.id === line.id) continue
      const near = other.directions[0]?.stops.some(
        (s) => metersBetween(stop.lat, stop.lon, s.lat, s.lon) < 150,
      )
      if (!near) continue
      if (other.mode === 'bus') busRefs.push(other.shortName)
      else badges.push({ label: other.shortName, color: other.color })
    }
    return { badges: badges.slice(0, 2), busRefs: busRefs.slice(0, 3) }
  })
}

export default function LineView({ onSelectStation }: LineViewProps) {
  const { t, locale } = useTranslation()
  const [selected, setSelected] = useState<TransitLine | null>(null)
  const [dir, setDir] = useState(0)
  const [filter, setFilter] = useState<LineMode | 'all'>('all')
  const now = new Date()

  const direction = selected ? (selected.directions[dir] ?? selected.directions[0]) : null
  const connections = useMemo(
    () => (selected && direction ? computeConnections(selected, direction.stops) : []),
    [selected, direction],
  )

  // ── Détail de ligne (handoff 1d) ────────────────────────────────────────
  if (selected && direction) {
    const open = isInService(selected, now)
    const headway = estimatedHeadwayMin(selected, now)
    return (
      <div className="flex h-full flex-col">
        {/* Header planche 1d : chevron nu + badge + nom, méta, état */}
        <div className="flex shrink-0 items-start gap-3 px-5 pt-1.5">
          <button
            type="button"
            onClick={() => { setSelected(null); setDir(0) }}
            className="tap relative shrink-0 pe-0.5 pt-1.5 after:absolute after:-inset-[11px] after:content-['']"
            aria-label={t('back')}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" className="rtl:rotate-180" aria-hidden="true">
              <path d="M14.5 5l-7 7 7 7" stroke="#111827" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2.5">
              <ModeBadge line={selected} locale={locale} />
              <h2 className="min-w-0 truncate text-title font-semibold text-ink-900">
                {lineDisplayName(selected)}
              </h2>
            </div>
            <p className="tnum mt-1.5 text-label text-ink-600">
              {lineModeLabel(selected.mode, locale)} · {direction.stops.length} {t('stops')}
              {selected.fare ? ` · ${selected.fare}` : ''}
              {/* dir=ltr sur la SEULE plage : en arabe, le tiret entre deux
                  heures est un neutre bidi qui, en contexte RTL, inverserait
                  « 05:00–00:30 » en « 00:30–05:00 » (dernier départ avant le
                  premier). */}
              {selected.hours ? <> · <span dir="ltr">{selected.hours.first}–{selected.hours.last}</span></> : ''}
              {` · ${nextPassLabel(headway, locale)}`}
            </p>
            <p className={`mt-[3px] text-label font-medium ${open ? 'text-open' : 'text-ink-400'}`}>
              {open
                ? `${t('open')}${selected.hours ? ` · ${t('lastDeparture')} ${selected.hours.last}` : ''}`
                : `${t('closed')}${selected.hours ? ` · ${t('opensAt')} ${selected.hours.first}` : ''}`}
            </p>
          </div>
        </div>

        {selected.directions.length > 1 && (
          <div className="flex shrink-0 gap-[22px] border-b border-line px-5 pt-4" role="group" aria-label={t('chooseDirection')}>
            {selected.directions.map((d, i) => (
              <button
                key={i}
                type="button"
                onClick={() => setDir(i)}
                onMouseDown={(e) => e.preventDefault()}
                aria-pressed={i === dir}
                className="min-w-0 truncate pb-[7px] text-[13px] leading-[18px] transition-colors duration-state focus:outline-none"
                style={{
                  fontWeight: i === dir ? 600 : 500,
                  color: i === dir ? '#111827' : '#6B7280',
                  borderBottom: i === dir ? '2px solid #111827' : '2px solid transparent',
                }}
              >
                {t('towards')} {d.headsign}
              </button>
            ))}
          </div>
        )}

        {/* Fil vertical planche 1d : pastilles 12px bordées 3px, fil 2px couleur,
            correspondances à droite, terminus plein + libellé.
            Le padding bas reprend la safe-area que portait le pied « Voir sur
            la carte » (retiré) — sinon le dernier arrêt passe sous le bord. */}
        <div
          className="flex-1 overflow-y-auto pt-1.5"
          style={{ paddingBottom: 'max(16px, env(safe-area-inset-bottom, 0px))' }}
        >
          {direction.stops.map((stop, index) => {
            const isFirst = index === 0
            const isLastStop = index === direction.stops.length - 1
            const conn = connections[index]
            return (
              <button
                key={`${stop.name}-${index}`}
                type="button"
                onClick={() => onSelectStation?.({ lat: stop.lat, lon: stop.lon, name: lineStopName(stop, locale) })}
                className="tap relative flex h-11 w-full items-center gap-3.5 px-5 text-start"
              >
                <span
                  className="z-[1] h-[18px] w-[18px] shrink-0 rounded-full border-[3px]"
                  style={{
                    borderColor: selected.color,
                    backgroundColor: isLastStop ? selected.color : '#ffffff',
                  }}
                  aria-hidden="true"
                />
                <span className={`min-w-0 flex-1 truncate text-emph text-ink-900 ${isFirst || isLastStop ? 'font-medium' : ''}`}>
                  {lineStopName(stop, locale)}
                </span>
                {isLastStop ? (
                  <span className="shrink-0 text-label text-ink-400">{t('terminus')}</span>
                ) : conn && conn.badges.length > 0 ? (
                  <span className="flex shrink-0 items-center gap-1.5">
                    {conn.badges.map((b) => (
                      <span
                        key={b.label}
                        className="inline-flex h-5 min-w-[26px] items-center justify-center rounded-[6px] px-1.5 text-[11px] font-semibold text-white"
                        style={{ backgroundColor: b.color }}
                        dir="ltr"
                      >
                        {b.label}
                      </span>
                    ))}
                  </span>
                ) : conn && conn.busRefs.length > 0 ? (
                  // dir=ltr sur les SEULS numéros : « حافلة » (Bus) doit rester
                  // en arabe RTL, seuls « 14 · 15 » sont latins.
                  <span className="shrink-0 text-label text-ink-400">
                    {t('busMode')} <span dir="ltr">{conn.busRefs.join(' · ')}</span>
                  </span>
                ) : null}
                {!isLastStop && (
                  <span
                    className="absolute top-7 w-0.5"
                    style={{ insetInlineStart: '28px', bottom: '-16px', backgroundColor: selected.color }}
                    aria-hidden="true"
                  />
                )}
              </button>
            )
          })}
        </div>
      </div>
    )
  }

  // ── Catalogue (handoff 1c) : filtres texte soulignés + rangées plates ──
  const filters: { id: LineMode | 'all'; label: string }[] = [
    { id: 'all', label: t('allFilter') },
    { id: 'metro', label: lineModeLabel('metro', locale) },
    { id: 'tram', label: lineModeLabel('tram', locale) },
    { id: 'bus', label: t('busMode') },
  ]
  const visibleModes = filter === 'all' ? MODE_ORDER : [filter]

  return (
    <div className="flex h-full flex-col">
      <div className="shrink-0 px-5 pb-3">
        <h1 className="text-display font-semibold text-ink-900">{t('tabLines')}</h1>
      </div>

      <div className="flex shrink-0 gap-[22px] border-b border-line px-5" role="group" aria-label={t('filterMode')}>
        {filters.map((f) => (
          <button
            key={f.id}
            type="button"
            onClick={() => setFilter(f.id)}
            onMouseDown={(e) => e.preventDefault()}
            aria-pressed={filter === f.id}
            className="pb-[7px] text-[13px] leading-[18px] transition-colors duration-state focus:outline-none"
            style={{
              fontWeight: filter === f.id ? 600 : 500,
              color: filter === f.id ? '#111827' : '#6B7280',
              borderBottom: filter === f.id ? '2px solid #111827' : '2px solid transparent',
            }}
          >
            {f.label}
          </button>
        ))}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto pb-4">
        {visibleModes.map((mode, mi) => {
          const lines = linesByMode[mode]
          if (!lines.length) return null
          return (
            <div key={mode}>
              {mi > 0 && <div className="h-2 bg-paper-2" aria-hidden="true" />}
              <p className="px-5 pb-2 pt-[18px] text-label font-semibold uppercase tracking-[0.06em] text-ink-600">
                {lineModeLabel(mode, locale)}
              </p>
              {lines.map((line, i) => {
                const headway = estimatedHeadwayMin(line, now)
                const stopsCount = line.directions[0]?.stops.length ?? 0
                const hasRule = mode === 'bus' || i < lines.length - 1
                return (
                  <button
                    key={line.id}
                    type="button"
                    onClick={() => { setSelected(line); setDir(0) }}
                    className={`tap flex min-h-[44px] w-full items-center gap-3 px-5 py-[13px] text-start ${hasRule ? 'border-b border-line' : ''}`}
                  >
                    <ModeBadge line={line} locale={locale} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-emph font-medium text-ink-900">
                        {lineDisplayName(line)}
                      </span>
                      <span className="tnum mt-[1px] block truncate text-label text-ink-400">
                        {nextPassLabel(headway, locale)}
                        {mode !== 'bus' ? ` · ${stopsCount} ${t('stationsUnit')}` : ''}
                      </span>
                    </span>
                    <ServiceState line={line} now={now} locale={locale} t={t as never} />
                  </button>
                )
              })}
            </div>
          )
        })}
      </div>
    </div>
  )
}

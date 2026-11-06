'use client'

import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import {
  linesByMode,
  metroLine,
  lineModeLabel,
  lineDisplayName,
  lineStopName,
  lineFareLabel,
  headwayAt,
  directionHeadsign,
  directionOriginLabel,
  oneDirectionNotice,
  shapeSourceNotice,
  lineEstimateNoteKey,
  specialPeriodNotice,
  stopPassWindow,
  nextPassLabel,
  type TransitLine,
  type LineMode,
  type LineSearchHit,
} from '@/lib/lines'
import {
  lineBadgeColors,
  lineServiceState,
  directionServiceState,
  stopConnections,
  catalogSearch,
  hasArabicLetters,
  type ServiceState,
} from '@/lib/line-catalog'
import { deviceShowsAlgiersTime } from '@/lib/algiers-time'
import type { Locale } from '@/lib/i18n'
import type { Coordinate } from '@/lib/otp'
import { useTranslation } from '@/hooks/useTranslation'
import { useBackHandler } from '@/hooks/useBackHandler'
import { useEdgeSwipeBack } from '@/hooks/useEdgeSwipeBack'
import { useMinuteTick } from '@/hooks/useMinuteTick'
import { ReportLink } from '@/components/FeedbackCard'
import NearbyStations from '@/components/NearbyStations'

interface LineViewProps {
  /** Toucher un arrêt : il devient la destination du formulaire d'accueil. */
  onSelectStation?: (coord: Coordinate) => void
  /**
   * « Voir le tracé sur la carte » : le parent passe sur l'onglet Carte avec
   * cette ligne seule (MapView focusLine). Sans callback, pas de bouton.
   */
  onShowLineOnMap?: (lineId: string, directionIndex: number) => void
  /**
   * false quand l'onglet Lignes est masqué mais gardé monté : la fiche ouverte
   * ne capte plus le retour système et l'heure n'est plus rafraîchie.
   */
  active?: boolean
  /** Incrémenté par le parent (onglet Lignes touché alors qu'il est affiché) : referme la fiche. */
  resetSignal?: number
  /**
   * « Lignes à proximité » en tête du catalogue : départ d'une recherche sans
   * résultat (« Voir les lignes proches du départ », name renseigné) ou
   * position de l'usager (sans name).
   */
  near?: { lat: number; lon: number; name?: string } | null
  /** Retire le bloc « Lignes à proximité » (bouton ✕, point explicite seulement). */
  onClearNear?: () => void
}

const MODE_ORDER: LineMode[] = ['metro', 'tram', 'bus']

// Anneau de focus clavier : `focus:outline-none` seul supprimait tout repère.
const FOCUS_RING = 'focus:outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand'
// Rangées pleine largeur : anneau à l'intérieur, sinon coupé par le défilement.
const ROW_FOCUS_RING = 'focus:outline-none focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-brand'

/**
 * Gabarit traduit → nœuds, avec les heures isolées en `dir=ltr` : en arabe,
 * une heure collée à un tiret ou à « ~ » ne doit pas être réordonnée.
 */
function fill(template: string, vars: Record<string, string>, ltr: string[] = []): ReactNode[] {
  const out: ReactNode[] = []
  const re = /\{(\w+)\}/g
  let last = 0
  let m: RegExpExecArray | null
  while ((m = re.exec(template))) {
    if (m.index > last) out.push(template.slice(last, m.index))
    const value = vars[m[1]] ?? m[0]
    out.push(ltr.includes(m[1]) ? <bdi key={m.index} dir="ltr">{value}</bdi> : value)
    last = re.lastIndex
  }
  if (last < template.length) out.push(template.slice(last))
  return out
}

function ModeBadge({ line, locale, small = false }: { line: TransitLine; locale: Locale; small?: boolean }) {
  const { background, color } = lineBadgeColors(line)
  return (
    <span
      className={small
        ? 'inline-flex h-5 min-w-[26px] shrink-0 items-center justify-center rounded-[6px] px-1.5 text-[11px] font-semibold'
        : 'inline-flex h-[26px] min-w-[36px] shrink-0 items-center justify-center rounded-[8px] px-2 text-[13px] font-semibold'}
      style={{ backgroundColor: background, color }}
      dir="ltr"
      role="img"
      aria-label={`${lineModeLabel(line.mode, locale)} ${line.shortName}`}
    >
      {line.shortName}
    </span>
  )
}

/** Nombre de stations distinctes (M1 : 19 sur deux branches, pas 16). */
function uniqueStopCount(line: TransitLine): number {
  const ids = new Set<string>()
  for (const d of line.directions) for (const s of d.stops) ids.add(s.id ?? s.name)
  return ids.size
}

// État de service d'une rangée du catalogue — le libellé porte l'info, la
// couleur ne fait que l'appuyer (a11y).
function ServiceBadge({ state }: { state: ServiceState }) {
  const { t } = useTranslation()
  if (state.kind === 'open') {
    return <span className="shrink-0 text-label font-medium text-open">{t('open')}</span>
  }
  if (state.kind === 'ending') {
    return <span className="shrink-0 text-label font-medium text-ink-600">{t('cat_ending')}</span>
  }
  return (
    <span className="tnum shrink-0 text-label font-medium text-ink-400">
      {t('closed')}
      {state.firstDeparture ? <> · {t('opensAt')} <bdi dir="ltr">{state.firstDeparture}</bdi></> : null}
    </span>
  )
}

export default function LineView({ onSelectStation, onShowLineOnMap, active = true, resetSignal, near, onClearNear }: LineViewProps) {
  const { t, tf, tn, locale } = useTranslation()
  const [selected, setSelected] = useState<TransitLine | null>(null)
  const [dir, setDir] = useState(0)
  const [filter, setFilter] = useState<LineMode | 'all'>('all')
  const [query, setQuery] = useState('')
  // Heure d'Alger rafraîchie à la minute : « Ouvert » ne reste pas affiché
  // après le dernier départ parce que rien d'autre n'a provoqué de rendu.
  // null au rendu serveur et à l'hydratation : rien de ce qui dépend de
  // l'heure n'est rendu avant (sinon l'hydratation échoue, onglet monté).
  const now = useMinuteTick(active)
  const detailRef = useRef<HTMLDivElement>(null)
  // Position dans le catalogue, retrouvée en refermant une fiche (sinon
  // retour en haut de 39 lignes à chaque consultation).
  const catalogScroll = useRef(0)
  const restoreCatalogScroll = useRef(false)
  const catalogList = useRef<HTMLDivElement | null>(null)
  // Focus clavier / lecteur d'écran : la rangée touchée est démontée à
  // l'ouverture de la fiche (le focus tomberait sur <body>). Le titre de la
  // fiche le reçoit, puis la rangée d'origine le retrouve au retour — et
  // seulement au retour depuis la fiche (pas sur l'onglet retouché, ni quand
  // un nouveau point « lignes proches » remet la liste en haut).
  const headingRef = useRef<HTMLHeadingElement>(null)
  const lastOpenedId = useRef<string | null>(null)
  const refocusRow = useRef(false)
  const catalogListRef = useCallback((el: HTMLDivElement | null) => {
    catalogList.current = el
    if (el && restoreCatalogScroll.current) {
      el.scrollTop = catalogScroll.current
      restoreCatalogScroll.current = false
      const id = lastOpenedId.current
      if (refocusRow.current && id) {
        el.querySelector<HTMLElement>(`[data-line-id="${CSS.escape(id)}"]`)?.focus({ preventScroll: true })
      }
    }
    if (el) refocusRow.current = false
  }, [])

  const closeDetail = useCallback(() => {
    restoreCatalogScroll.current = true
    setSelected(null)
    setDir(0)
  }, [])

  // Retour depuis la fiche (chevron, retour système, geste de bord) : le
  // focus revient à la rangée ouverte.
  const backFromDetail = useCallback(() => {
    refocusRow.current = true
    closeDetail()
  }, [closeDetail])

  // Retour système (Android, geste iOS, navigateur) : referme la fiche au lieu
  // de quitter l'app. Hooks appelés avant tout `return` conditionnel.
  useBackHandler(active && selected !== null, backFromDetail)
  useEdgeSwipeBack(detailRef, { enabled: active && selected !== null, rtl: locale === 'ar', onBack: backFromDetail })

  // Fiche ouverte : le titre reçoit le focus (lu en premier, point de départ
  // du parcours clavier). Pas de refocalisation au changement de sens.
  const selectedId = selected?.id ?? null
  useEffect(() => {
    if (selectedId) headingRef.current?.focus({ preventScroll: true })
  }, [selectedId])

  const lastReset = useRef(resetSignal)
  useEffect(() => {
    if (resetSignal === lastReset.current) return
    lastReset.current = resetSignal
    closeDetail()
  }, [resetSignal, closeDetail])

  // Nouveau point « lignes proches » : le bloc est en tête de liste, le
  // catalogue repart donc du haut au lieu de la position mémorisée.
  const nearKey = near?.name ? `${near.lat},${near.lon},${near.name}` : null
  useEffect(() => {
    if (!nearKey) return
    restoreCatalogScroll.current = false
    catalogScroll.current = 0
    lastOpenedId.current = null
    catalogList.current?.scrollTo({ top: 0 })
  }, [nearKey])

  const direction = selected ? (selected.directions[dir] ?? selected.directions[0]) : null
  const connections = useMemo(
    () => (selected && direction ? stopConnections(selected, direction.stops) : []),
    [selected, direction],
  )
  const showAlgiersNote = now !== null && !deviceShowsAlgiersTime(now.getTime())

  // ── Détail de ligne (handoff 1d) ────────────────────────────────────────
  if (selected && direction && now) {
    const state = directionServiceState(selected, direction, now)
    const headway = headwayAt(selected, now, dir)
    const origin = direction.stops[0]
    const originName = origin ? lineStopName(origin, locale) : ''
    const fare = lineFareLabel(selected, locale)
    const isBus = selected.mode === 'bus'
    const oneDirection = oneDirectionNotice(selected, locale)
    const shapeNote = shapeSourceNotice(direction)
    const periodNote = specialPeriodNotice(selected, now)

    return (
      <div key={`detail-${selected.id}`} ref={detailRef} className="flex h-full flex-col bg-white">
        {/* Header planche 1d : chevron nu + badge + nom, méta, état */}
        <div className="flex shrink-0 items-start gap-3 px-5 pt-1.5">
          <button
            type="button"
            onClick={backFromDetail}
            className={`tap relative shrink-0 rounded-[6px] pe-0.5 pt-1.5 after:absolute after:-inset-[11px] after:content-[''] ${FOCUS_RING}`}
            aria-label={t('back')}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" className="rtl:rotate-180" aria-hidden="true">
              <path d="M14.5 5l-7 7 7 7" stroke="#111827" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2.5">
              <ModeBadge line={selected} locale={locale} />
              {/* dir=auto : nom latin (bus sans longNameAr) isolé en arabe —
                  « 5 Maisons » ne devient pas « Maisons 5 », l'ellipse tombe en
                  fin de texte ; rtl:text-right garde l'alignement de l'UI. */}
              <h2
                ref={headingRef}
                tabIndex={-1}
                dir="auto"
                className="line-clamp-2 min-w-0 text-title font-semibold text-ink-900 focus:outline-none rtl:text-right"
              >
                {lineDisplayName(selected, locale)}
              </h2>
            </div>
            <p className="tnum mt-1.5 text-label text-ink-600">
              {lineModeLabel(selected.mode, locale)} · {tn('ux_stops', direction.stops.length)}
              {fare ? ` · ${fare}` : ''}
              {/* dir=ltr sur la SEULE plage : en arabe, le tiret entre deux
                  heures est un neutre bidi qui, en contexte RTL, inverserait
                  « 05:00–00:30 » en « 00:30–05:00 » (dernier départ avant le
                  premier). */}
              {selected.hours ? <> · <bdi dir="ltr">{selected.hours.first}–{selected.hours.last}</bdi></> : null}
            </p>
            {/* État du sens affiché, rattaché à SON terminus d'origine : le
                dernier départ de Place des Martyrs n'est pas celui d'Aïn Naâdja. */}
            <p className="tnum mt-[3px] text-label">
              {state.kind === 'open' && (
                <>
                  <span className="font-medium text-open">{t('open')}</span>
                  {state.lastDeparture && originName ? (
                    <span className="text-ink-600"> · {fill(t('data_lastDepartureFrom'), { name: originName, time: state.lastDeparture }, ['time'])}</span>
                  ) : null}
                </>
              )}
              {state.kind === 'ending' && (
                <span className="font-medium text-ink-600">
                  {state.lastPass ? fill(t('cat_endingUntil'), { time: state.lastPass }, ['time']) : t('cat_ending')}
                </span>
              )}
              {state.kind === 'closed' && (
                <>
                  <span className="font-medium text-ink-400">{t('closed')}</span>
                  {state.firstDeparture && originName ? (
                    <span className="text-ink-600"> · {fill(t('cat_firstDepartureFrom'), { name: originName, time: state.firstDeparture }, ['time'])}</span>
                  ) : null}
                </>
              )}
            </p>
            {/* Fréquence du sens affiché (une branche du M1 : une rame sur
                deux), seulement en service — jamais à côté de « Fermé ». */}
            {headway !== null && (
              <p className="tnum mt-[3px] text-label text-ink-600">
                {nextPassLabel(headway, locale)} · {t(isBus ? 'cat_freqModelled' : 'cat_freqEstimated')}
              </p>
            )}
            {showAlgiersNote && <p className="mt-[3px] text-label text-ink-400">{t('cat_algiersTimeNote')}</p>}
            {onShowLineOnMap && (
              <button
                type="button"
                onClick={() => onShowLineOnMap(selected.id, selected.directions.indexOf(direction))}
                className={`tap relative mt-2.5 inline-flex h-8 items-center gap-1.5 rounded-full border border-line px-3 text-body font-medium text-ink-900 after:absolute after:inset-x-0 after:-inset-y-[6px] after:content-[''] ${FOCUS_RING}`}
              >
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                  <path d="M9 4L3 6.5v13L9 17l6 2.5 6-2.5V4l-6 2.5L9 4z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
                  <path d="M9 4v13M15 6.5v13" stroke="currentColor" strokeWidth="1.8" />
                </svg>
                {t('cat_showOnMap')}
              </button>
            )}
          </div>
        </div>

        {periodNote && (
          <p className="mx-5 mt-3 shrink-0 rounded-control bg-paper-2 px-3 py-2 text-label text-ink-900" role="note">
            {t(periodNote)}
          </p>
        )}

        {selected.directions.length > 1 ? (
          // Onglets défilants : le M1 a quatre sens, dont deux « vers Place des
          // Martyrs », distingués par leur origine.
          <div
            className="no-scrollbar flex shrink-0 items-end gap-[22px] overflow-x-auto border-b border-line px-5 pt-3"
            role="group"
            aria-label={t('chooseDirection')}
          >
            {selected.directions.map((d, i) => {
              const from = directionOriginLabel(selected, i, locale)
              const current = i === dir
              return (
                <button
                  key={i}
                  type="button"
                  onClick={(e) => {
                    setDir(i)
                    e.currentTarget.scrollIntoView?.({ block: 'nearest', inline: 'nearest' })
                  }}
                  onMouseDown={(e) => e.preventDefault()}
                  aria-pressed={current}
                  className={`relative shrink-0 whitespace-nowrap pb-[7px] text-start transition-colors duration-state after:absolute after:inset-x-0 after:-top-[12px] after:bottom-0 after:content-[''] ${FOCUS_RING}`}
                  style={{
                    color: current ? '#111827' : '#6B7280',
                    borderBottom: current ? '2px solid #111827' : '2px solid transparent',
                  }}
                >
                  <span className="block text-[13px] leading-[18px]" style={{ fontWeight: current ? 600 : 500 }}>
                    {t('towards')} {directionHeadsign(d, locale)}
                  </span>
                  {from && <span className="block text-label">{from}</span>}
                </button>
              )
            })}
          </div>
        ) : (
          // Un seul sens relevé : pas d'onglet trompeur, le sens est dit.
          <div className="shrink-0 border-b border-line px-5 pb-[9px] pt-3">
            <p className="text-[13px] font-semibold leading-[18px] text-ink-900">
              {t('towards')} {directionHeadsign(direction, locale)}
            </p>
          </div>
        )}

        {/* Fil vertical planche 1d : pastilles 18 px bordées 3 px, fil 2 px
            couleur, passages estimés sous le nom, correspondances à droite.
            Le padding bas reprend la safe-area (sinon le pied passe sous le bord). */}
        <div
          key={`stops-${dir}`}
          className="flex-1 overflow-y-auto"
          style={{ paddingBottom: 'max(16px, env(safe-area-inset-bottom, 0px))' }}
        >
          {(oneDirection || shapeNote) && (
            <div className="space-y-1 px-5 pt-2.5 text-label text-ink-600">
              {oneDirection && <p>{oneDirection}</p>}
              {shapeNote && <p>{t(shapeNote)}</p>}
            </div>
          )}
          <div className="pt-1.5">
            {direction.stops.map((stop, index) => {
              const isFirst = index === 0
              const isLastStop = index === direction.stops.length - 1
              const conn = connections[index]
              const pass = stopPassWindow(direction, index)
              const name = lineStopName(stop, locale)
              const hasConn = Boolean(conn && (conn.rail.length || conn.bus.length))
              // Abréviation dite, jamais muette : « Bus 6 · 10 · 14 +8 », la
              // liste complète restant lue par les lecteurs d'écran.
              const busShown = conn ? conn.bus.slice(0, conn.rail.length ? 2 : 3) : []
              const busMore = conn ? conn.bus.length - busShown.length : 0
              const connList = conn
                ? [...conn.rail, ...conn.bus].map((l) => `${lineModeLabel(l.mode, locale)} ${l.shortName}`).join(', ')
                : ''
              return (
                <button
                  key={`${stop.id ?? stop.name}-${index}`}
                  type="button"
                  onClick={() => onSelectStation?.({ lat: stop.lat, lon: stop.lon, name })}
                  className={`tap relative flex min-h-[52px] w-full items-center gap-3.5 px-5 py-1.5 text-start ${ROW_FOCUS_RING}`}
                >
                  <span
                    className="z-[1] h-[18px] w-[18px] shrink-0 rounded-full border-[3px]"
                    style={{
                      borderColor: selected.color,
                      backgroundColor: isLastStop ? selected.color : '#ffffff',
                    }}
                    aria-hidden="true"
                  />
                  <span className="min-w-0 flex-1">
                    {/* dir=auto sur l'élément qui tronque (pas un <bdi> dedans) :
                        en arabe, un arrêt latin est coupé par sa fin, pas son début. */}
                    <span dir="auto" className={`block truncate text-emph text-ink-900 rtl:text-right ${isFirst || isLastStop ? 'font-medium' : ''}`}>
                      {name}
                    </span>
                    {pass && (
                      <span className="tnum block truncate text-label text-ink-400">
                        {isFirst
                          ? fill(t('cat_departures'), { first: pass.first, last: pass.last }, ['first', 'last'])
                          : fill(t('data_stopPasses'), { first: pass.first, last: pass.last }, ['first', 'last'])}
                      </span>
                    )}
                  </span>
                  {hasConn && conn && (
                    <span className="flex shrink-0 items-center gap-1.5" aria-hidden="true">
                      {conn.rail.map((l) => (
                        <ModeBadge key={l.id} line={l} locale={locale} small />
                      ))}
                      {busShown.length > 0 && (
                        // dir=ltr sur les SEULS numéros : « حافلة » (Bus) reste
                        // en arabe RTL, seuls « 14 · 15 » sont latins.
                        <span className="text-label text-ink-400">
                          {t('busMode')}{' '}
                          <bdi dir="ltr">
                            {busShown.map((l) => l.shortName).join(' · ')}
                            {busMore > 0 ? ` +${busMore}` : ''}
                          </bdi>
                        </span>
                      )}
                    </span>
                  )}
                  {hasConn && <span className="sr-only">{tf('cat_connections', { list: connList })}</span>}
                  {isLastStop && (
                    // Le terminus est déjà marqué par la pastille pleine ; le mot
                    // ne s'affiche que s'il ne prend pas la place des correspondances.
                    <span className={hasConn ? 'sr-only' : 'shrink-0 text-label text-ink-400'}>{t('terminus')}</span>
                  )}
                  {!isLastStop && (
                    <span
                      className="absolute w-0.5"
                      style={{ insetInlineStart: '28px', top: '50%', height: '100%', backgroundColor: selected.color }}
                      aria-hidden="true"
                    />
                  )}
                </button>
              )
            })}
          </div>

          {/* Provenance des chiffres : jamais un horaire, toujours sa source. */}
          <div className="mt-2 space-y-2 border-t border-line px-5 pt-3 text-label text-ink-600">
            {selected.id === metroLine.id && <p>{t('data_metroBranches')}</p>}
            <p>{t(lineEstimateNoteKey(selected))}</p>
            {isBus ? (
              <>
                <p>{t('data_busSource')}</p>
                <p>{t('data_busHoursNotice')}</p>
              </>
            ) : (
              <p>{t('cat_railHoursNotice')}</p>
            )}
            <p className="text-ink-400">{t('data_osmCredit')}</p>
            <ReportLink
              context={{ kind: 'line', line: selected.shortName, mode: selected.mode, direction: direction.headsign }}
              className={`-ms-0.5 ${FOCUS_RING}`}
            />
          </div>
        </div>
      </div>
    )
  }

  // ── Catalogue (handoff 1c) : recherche, filtres texte soulignés, rangées plates ──
  const filters: { id: LineMode | 'all'; label: string }[] = [
    { id: 'all', label: t('allFilter') },
    { id: 'metro', label: lineModeLabel('metro', locale) },
    { id: 'tram', label: lineModeLabel('tram', locale) },
    { id: 'bus', label: t('busMode') },
  ]
  const visibleModes = filter === 'all' ? MODE_ORDER : [filter]
  const trimmed = query.trim()
  const hits: LineSearchHit[] | null = trimmed
    ? catalogSearch(trimmed, locale).filter((h) => filter === 'all' || h.line.mode === filter)
    : null
  const ramadan = now !== null && specialPeriodNotice(metroLine, now) !== null

  const openLine = (line: TransitLine) => {
    catalogScroll.current = catalogList.current?.scrollTop ?? 0
    lastOpenedId.current = line.id
    setSelected(line)
    setDir(0)
  }

  const renderRow = (line: TransitLine, hit: LineSearchHit | null, rule: boolean, clock: Date) => {
    const headway = headwayAt(line, clock)
    const state = lineServiceState(line, clock)
    const parts: ReactNode[] = []
    if (hit?.stop) parts.push(tf('cat_passesAt', { name: lineStopName(hit.stop, locale) }))
    // Fréquence seulement quand la ligne roule : jamais « ~ toutes les
    // 10 min » à côté de « Fermé ».
    if (headway !== null && state.kind === 'open') parts.push(nextPassLabel(headway, locale))
    if (line.mode !== 'bus') parts.push(tn('ux_stations', uniqueStopCount(line)))
    return (
      <button
        key={line.id}
        type="button"
        data-line-id={line.id}
        onClick={() => openLine(line)}
        className={`tap flex min-h-[44px] w-full items-center gap-3 px-5 py-[13px] text-start ${rule ? 'border-b border-line' : ''} ${ROW_FOCUS_RING}`}
      >
        <ModeBadge line={line} locale={locale} />
        <span className="min-w-0 flex-1">
          {/* dir=auto sur l'élément qui tronque : en arabe, un titre latin
              (« Place 1er Mai ↔ … ») garde son début, l'ellipse en fin. */}
          <span dir="auto" className="block truncate text-emph font-medium text-ink-900 rtl:text-right">
            {lineDisplayName(line, locale)}
          </span>
          {parts.length > 0 && (
            <span className="tnum mt-[1px] block truncate text-label text-ink-400">
              {parts.map((p, i) => (
                <Fragment key={i}>{i > 0 ? ' · ' : ''}{p}</Fragment>
              ))}
            </span>
          )}
        </span>
        <ServiceBadge state={state} />
      </button>
    )
  }

  return (
    <div key="catalog" className="flex h-full flex-col">
      <div className="shrink-0 px-5 pb-3">
        <h1 className="text-display font-semibold text-ink-900">{t('tabLines')}</h1>
        {showAlgiersNote && <p className="mt-1 text-label text-ink-400">{t('cat_algiersTimeNote')}</p>}
      </div>

      {/* Recherche : numéro (préfixe, jamais « contient » : « 1 » ne doit pas
          trouver 12 lignes), nom de ligne, arrêt desservi, mode — FR/AR. */}
      <div className="shrink-0 px-5 pb-2" role="search">
        <div className="relative">
          <svg
            width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true"
            className="pointer-events-none absolute start-3 top-1/2 -translate-y-1/2 text-ink-400"
          >
            <circle cx="11" cy="11" r="6.5" stroke="currentColor" strokeWidth="2" />
            <path d="M16 16l4 4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </svg>
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur() }}
            // Saisie libre en latin ou en arabe ; vide, le texte d'aide suit la langue.
            dir={query ? 'auto' : locale === 'ar' ? 'rtl' : 'ltr'}
            placeholder={t('cat_searchPlaceholder')}
            aria-label={t('cat_searchLabel')}
            enterKeyHint="search"
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
            className="h-11 w-full appearance-none rounded-control bg-paper-2 pe-11 ps-9 text-emph text-ink-900 placeholder:text-ink-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/40 [&::-webkit-search-cancel-button]:hidden"
          />
          {query && (
            <button
              type="button"
              onClick={() => setQuery('')}
              className={`tap absolute end-0 top-0 flex h-11 w-11 items-center justify-center rounded-control text-ink-400 ${FOCUS_RING}`}
              aria-label={t('cat_searchClear')}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <path d="M7 7l10 10M17 7L7 17" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              </svg>
            </button>
          )}
        </div>
      </div>

      <div className="flex shrink-0 gap-[22px] border-b border-line px-5" role="group" aria-label={t('filterMode')}>
        {filters.map((f) => (
          <button
            key={f.id}
            type="button"
            onClick={() => setFilter(f.id)}
            onMouseDown={(e) => e.preventDefault()}
            aria-pressed={filter === f.id}
            // Zone de toucher ≈ 44 px (WCAG 2.5.5) : 8 px de marge haute plus une
            // extension invisible de 8 px, sans empiéter sur le champ de recherche.
            className={`relative pb-[7px] pt-2 text-[13px] leading-[18px] transition-colors duration-state after:absolute after:inset-x-[-8px] after:-top-[8px] after:bottom-0 after:content-[''] ${FOCUS_RING}`}
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

      <div ref={catalogListRef} className="min-h-0 flex-1 overflow-y-auto pb-4">
        {/* Liste rendue une fois l'heure du téléphone connue (après hydratation). */}
        {now && ramadan && (
          <p className="mx-5 mt-3 rounded-control bg-paper-2 px-3 py-2 text-label text-ink-900" role="note">
            {t('cat_ramadanNotice')}
          </p>
        )}

        {/* Lignes à proximité : masqué pendant une recherche dans le catalogue. */}
        {now && near && !hits && (
          <>
            <NearbyStations
              lat={near.lat}
              lon={near.lon}
              onSelect={onSelectStation}
              pointName={near.name}
              onClose={near.name ? onClearNear : undefined}
            />
            <div className="h-2 bg-paper-2" aria-hidden="true" />
          </>
        )}

        {!now ? null : hits ? (
          <div>
            {/* Annoncé aux lecteurs d'écran : nombre de lignes, ou l'absence
                de résultat dite factuellement (« correspond », pas « dessert » :
                des lignes peuvent manquer aux données). */}
            <div aria-live="polite">
              {hits.length > 0 ? (
                <p className="px-5 pb-2 pt-[18px] text-label font-semibold text-ink-600">{tn('ux_lines', hits.length)}</p>
              ) : (
                <div className="space-y-1.5 px-5 pt-[18px] text-body text-ink-600">
                  <p>{tf('cat_noMatch', { q: trimmed })}</p>
                  {hasArabicLetters(trimmed) && <p>{t('data_searchArabicStops')}</p>}
                </div>
              )}
            </div>
            {hits.map((hit, i) => renderRow(hit.line, hit, i < hits.length - 1, now))}
          </div>
        ) : (
          visibleModes.map((mode, mi) => {
            const lines = linesByMode[mode]
            if (!lines.length) return null
            return (
              <div key={mode}>
                {mi > 0 && <div className="h-2 bg-paper-2" aria-hidden="true" />}
                <p className="px-5 pb-2 pt-[18px] text-label font-semibold uppercase tracking-[0.06em] text-ink-600">
                  {lineModeLabel(mode, locale)}
                </p>
                {lines.map((line, i) => renderRow(line, null, mode === 'bus' || i < lines.length - 1, now))}
              </div>
            )
          })
        )}

        <p className="px-5 pt-4 text-label text-ink-400">{t('cat_catalogNote')}</p>
      </div>
    </div>
  )
}

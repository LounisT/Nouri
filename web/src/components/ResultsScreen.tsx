'use client'

// Écran Résultats (planche 1g) et feuille Détail (planche 1h), extraits de
// page.tsx. L'état de la recherche (SearchState) et sa mise en forme
// (results-format.ts) viennent du parent ; cet écran ne calcule rien qui
// puisse diverger de la navigation ou du détail : tarifs, qualificatifs et
// heures sortent des mêmes fonctions.
//
// Sur téléphone, le détail est une feuille basse à mi-hauteur : la moitié
// haute laisse voir le trajet sur la carte AVANT d'appuyer sur « Commencer »
// (arrêt de montée, côté de la rue). Une poignée l'agrandit. Sur grand écran,
// la carte est à côté de la colonne : le détail occupe toute la colonne.

import { useEffect, useRef, type ReactNode, type RefObject } from 'react'
import ItineraryPanel, { ItinerarySummary } from '@/components/ItineraryPanel'
import DetailSheet, { type DetailSnap } from '@/components/DetailSheet'
import RouteLabel, { PlaceLabel } from '@/components/RouteLabel'
import { BackIosIcon, NavigationIcon } from '@/components/icons'
import { useTranslation } from '@/hooks/useTranslation'
import { useInert } from '@/hooks/useInert'
import { useMinuteTick } from '@/hooks/useMinuteTick'
import {
  describePlanError,
  isRetryablePlanError,
  itineraryBadges,
  ITINERARY_BADGE_KEY,
  type ItineraryBadge,
} from '@/lib/otp'
import { badgeColor } from '@/lib/nav-format'
import { algiersDayDiff, algiersParts, formatAlgiersDay, formatAlgiersTime } from '@/lib/algiers-time'
import { allLines, oneDirectionNotice, railSpecialPeriodNotice } from '@/lib/lines'
import {
  errorTitleKey,
  nextServiceHeader,
  queryLabel,
  rowSummary,
  stateIsDemo,
  stateItineraries,
  stateQuery,
  usesMode,
  type SearchState,
} from '@/lib/results-format'

export type { DetailSnap }

/**
 * Au-delà de ce délai avant le départ prévu, « Commencer » est remplacé par
 * une phrase : la navigation compte depuis MAINTENANT et annoncerait une
 * arrivée inventée (trajet de nuit, recherche « Départ 18:00 » faite à 14:00).
 * Partagé avec page.tsx (garde de handleGo).
 */
export const START_LATER_MS = 20 * 60_000

interface ResultsScreenProps {
  open: boolean
  state: SearchState
  fromName?: string
  toName?: string
  /** Trajet ouvert dans le détail. */
  selectedIndex: number
  detailOpen: boolean
  detailSnap: DetailSnap
  /** Grand écran : le détail occupe toute la colonne, la carte est à côté. */
  wide: boolean
  /** Pour le geste « glisser depuis le bord » (page.tsx). */
  panelRef: RefObject<HTMLDivElement>
  detailRef: RefObject<HTMLDivElement>
  onBack: () => void
  onOpenDetail: (index: number) => void
  onCloseDetail: () => void
  onSnapChange: (snap: DetailSnap) => void
  /** Hauteur de carte cachée par la feuille du détail (cadrage du trajet). */
  onDetailMapInset?: (px: number) => void
  /** Bouton flottant du détail : recadrer la carte sur le trajet. */
  onRefitRoute?: () => void
  onGo: () => void
  onRetry: () => void
  onSeeNearbyLines: () => void
  /** Rangée « Reprendre la navigation » (session quittée il y a peu). */
  resumeSlot?: ReactNode
}

// Qualificatif principal (selon le mode demandé) en vert foncé AA ; les
// autres en gris AA — jamais #9CA3AF (2,5:1) sur blanc.
const BADGE_COLOR: Record<ItineraryBadge, string> = {
  earliestArrival: '#047857',
  latestDeparture: '#047857',
  shortest: '#6B7280',
  lessWalking: '#6B7280',
  cheapest: '#6B7280',
}

function BackIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" className="rtl:rotate-180" aria-hidden="true">
      <path d="M14.5 5l-7 7 7 7" stroke="#111827" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

export default function ResultsScreen({
  open,
  state,
  fromName,
  toName,
  selectedIndex,
  detailOpen,
  detailSnap,
  wide,
  panelRef,
  detailRef,
  onBack,
  onOpenDetail,
  onCloseDetail,
  onSnapChange,
  onDetailMapInset,
  onRefitRoute,
  onGo,
  onRetry,
  onSeeNearbyLines,
  resumeSlot,
}: ResultsScreenProps) {
  const { t, tf, locale } = useTranslation()
  const listRef = useRef<HTMLDivElement>(null)
  const headingRef = useRef<HTMLHeadingElement>(null)
  const detailTitleRef = useRef<HTMLHeadingElement>(null)
  const rowRefs = useRef<(HTMLButtonElement | null)[]>([])

  const itineraries = stateItineraries(state)
  const query = stateQuery(state)
  const demo = stateIsDemo(state)
  const selected = itineraries[selectedIndex] ?? null
  // Horloge à la minute (jamais Date.now() au rendu) : null avant le montage.
  const now = useMinuteTick(open && detailOpen)
  const startsLater = Boolean(selected && now && selected.startTime - now.getTime() > START_LATER_MS)

  // Hors champ ou recouvert : hors du parcours clavier et des lecteurs d'écran.
  useInert(panelRef, !open)
  useInert(listRef, !open || detailOpen)
  useInert(detailRef, !open || !detailOpen)

  // ── Focus ──────────────────────────────────────────────────────────────────
  // L'écran qui s'ouvre reçoit le focus (son titre) : le lecteur d'écran dit
  // où l'on est, et le balayage ne retombe plus sur le formulaire recouvert.
  // À la fermeture du détail, le focus revient sur la rangée d'origine.
  const wasDetailOpen = useRef(detailOpen)
  useEffect(() => {
    if (!open) return
    const frame = requestAnimationFrame(() => {
      const target = detailOpen ? detailTitleRef.current : headingRef.current
      target?.focus({ preventScroll: true })
    })
    return () => cancelAnimationFrame(frame)
    // Seulement à l'ouverture de l'écran : le détail a son propre effet.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  // Nouvelle recherche depuis l'écran déjà ouvert (Réessayer) : le bouton
  // touché disparaît, le focus revient au titre au lieu de tomber sur <body>.
  const loading = state.status === 'loading'
  useEffect(() => {
    if (!open || !loading) return
    const frame = requestAnimationFrame(() => headingRef.current?.focus({ preventScroll: true }))
    return () => cancelAnimationFrame(frame)
  }, [open, loading])

  useEffect(() => {
    const was = wasDetailOpen.current
    wasDetailOpen.current = detailOpen
    if (!open || was === detailOpen) return
    const frame = requestAnimationFrame(() => {
      if (detailOpen) detailTitleRef.current?.focus({ preventScroll: true })
      else (rowRefs.current[selectedIndex] ?? headingRef.current)?.focus({ preventScroll: true })
    })
    return () => cancelAnimationFrame(frame)
  }, [detailOpen, open, selectedIndex])

  // ── Rangées ────────────────────────────────────────────────────────────────
  // Repli « premières arrivées » : requête « partir à » ; « dernières
  // arrivées » : « arriver avant ». Les qualificatifs suivent la requête qui
  // a produit les rangées, pas la recherche initiale.
  const rankArriveBy = state.status === 'nextService'
    ? state.serviceQuery?.arriveBy ?? query?.arriveBy ?? false
    : query?.arriveBy ?? false
  const badges = state.status === 'ok' || state.status === 'nextService'
    ? itineraryBadges(itineraries, rankArriveBy)
    : itineraries.map(() => null)

  const rows = itineraries.map((it, index) => {
    const badge = badges[index]
    const qualifier = badge ? t(ITINERARY_BADGE_KEY[badge]) : null
    const row = rowSummary(it, { locale, query, qualifier })
    // Marche proposée sous un message d'erreur : explicitement « à pied
    // uniquement », jamais « la plus rapide ».
    const fallback = state.status === 'error'
    return (
      <button
        key={`${index}-${it.startTime}`}
        ref={(el) => { rowRefs.current[index] = el }}
        type="button"
        onClick={() => onOpenDetail(index)}
        className={`tap w-full px-5 py-4 text-start active:bg-paper-2 ${index > 0 || fallback ? 'border-t border-line' : ''}`}
        aria-label={fallback ? `${t('itin_walkOnly')}, ${row.aria}` : row.aria}
      >
        <div className="flex items-center justify-between gap-3.5">
          <div className="min-w-0 flex-1">
            {/* Séquence planche 1g : pastilles + chevrons + marche agrégée */}
            <div className="flex flex-wrap items-center gap-2">
              {row.transitLegs.map((leg, li) => (
                <span key={li} className="flex items-center gap-2">
                  {li > 0 && (
                    <svg width="10" height="10" viewBox="0 0 10 10" fill="none" className="rtl:rotate-180" aria-hidden="true">
                      <path d="M3 1.5L7 5 3 8.5" stroke="#6B7280" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  )}
                  {/* Teinte foncée : texte blanc lisible (AA), contrairement
                      aux couleurs de carte du bus et du tram. */}
                  <span
                    className="inline-flex h-6 min-w-[32px] items-center justify-center rounded-[8px] px-[7px] text-label font-semibold text-white"
                    style={{ backgroundColor: badgeColor(leg.mode) }}
                    dir="ltr"
                  >
                    {leg.routeShortName}
                  </span>
                </span>
              ))}
              {fallback && (
                <span className="text-body font-medium text-ink-900">{t('itin_walkOnly')}</span>
              )}
              {row.walkMin > 0 && (
                <span className="text-body text-ink-600">
                  {row.direct ? `${t('direct')} ` : ''}
                  {row.transitLegs.length > 0 ? '+ ' : ''}
                  {tf('page_walkMinutes', { n: row.walkMin })}
                </span>
              )}
            </div>
            {/* dir=ltr sur la SEULE plage horaire : le tarif et la 3e info
                peuvent être en arabe et doivent suivre le sens du document. */}
            <p className="tnum mt-1.5 truncate text-label text-ink-600">
              {row.day ? `${row.day} · ` : ''}
              <span dir="ltr">{row.start} → {row.end}</span>
              {row.fare ? ` · ${row.fare}` : ''}
              {fallback ? '' : ` · ${row.thirdInfo}`}
            </p>
          </div>
          <span className="shrink-0 text-end">
            <span className="tnum block text-title font-semibold leading-[22px] text-ink-900">
              {row.duration}
            </span>
            {badge && (
              <span className="mt-0.5 block text-label" style={{ color: BADGE_COLOR[badge] }}>
                {qualifier}
              </span>
            )}
          </span>
        </div>
      </button>
    )
  })
  rowRefs.current.length = itineraries.length

  // ── Corps de la liste selon l'état ─────────────────────────────────────────
  let body: ReactNode
  if (state.status === 'loading' || state.status === 'idle') {
    body = (
      /* Chargement (handoff 1j) : squelette de 2 rangées, jamais de spinner */
      <div className="skeleton-pulse" aria-hidden="true">
        {[0, 1].map((row) => (
          <div key={row} className={`flex items-center gap-3 px-5 py-[13px] ${row > 0 ? 'border-t border-line' : ''}`}>
            <span className="h-[26px] w-9 rounded-[8px] bg-skeleton" />
            <span className="flex-1">
              <span className="block h-3 rounded-[6px] bg-skeleton" style={{ width: row === 0 ? '60%' : '48%' }} />
              <span className="mt-1.5 block h-[9px] rounded-[5px] bg-paper-2" style={{ width: row === 0 ? '35%' : '30%' }} />
            </span>
            <span className="h-3.5 w-[52px] rounded-[7px] bg-skeleton" />
          </div>
        ))}
      </div>
    )
  } else if (state.status === 'error') {
    const { error } = state
    const retryable = isRetryablePlanError(error)
    // « Voir les lignes proches » n'a de sens que si le calculateur a répondu
    // qu'aucun trajet n'existe (pas pour une panne ni deux points voisins).
    const showLines = error.kind === 'noPath' && error.reason !== 'tooClose'
    // Ligne dont un seul sens est relevé et qui bloque ce trajet (otp.ts) :
    // phrase factuelle tirée des données, jamais un horaire du sens retour.
    const oneDirection = (error.oneDirectionLineIds ?? [])
      .map((id) => allLines.find((line) => line.id === id))
      .map((line) => (line ? oneDirectionNotice(line, locale) : null))
      .filter((text): text is string => Boolean(text))
    body = (
      <>
        {/* Aucun itinéraire (handoff 1j) : expliquer, proposer, jamais de rouge */}
        <div className="px-5 pb-[30px] pt-7 text-center">
          <p className="text-emph font-medium text-ink-900">{t(errorTitleKey(error))}</p>
          <p className="mt-1.5 text-body text-ink-600">{describePlanError(error, locale)}</p>
          {oneDirection.map((text) => (
            <p key={text} className="mt-1.5 text-body text-ink-600">{text}</p>
          ))}
          {retryable ? (
            <button
              type="button"
              onClick={onRetry}
              className="tap mt-4 inline-flex min-h-[44px] items-center justify-center rounded-control border border-line px-5 text-body font-medium text-ink-900"
            >
              {t('itin_retry')}
            </button>
          ) : showLines ? (
            <button
              type="button"
              onClick={onSeeNearbyLines}
              className="tap relative mt-3.5 text-body font-medium text-brand after:absolute after:inset-x-0 after:-inset-y-[13px] after:content-['']"
            >
              {t('seeNearbyLines')}
            </button>
          ) : null}
        </div>
        {rows}
      </>
    )
  } else {
    const hasBus = usesMode(itineraries, 'BUS')
    // Ramadan (fenêtre estimée, lines.ts) : les horaires changent et ne sont
    // pas modélisés — le dire sous des trajets calculés sur l'horaire courant.
    const tripDay = itineraries[0]?.startTime ?? query?.epoch
    const ramadan = tripDay !== undefined && railSpecialPeriodNotice(new Date(tripDay)) !== null
    // Vendredi : le GTFS n'a qu'un service « all-week », or les horaires des
    // bus peuvent changer ce jour-là (data_busHoursNotice, déjà affichée dans
    // la fiche ligne). Le dire ici aussi, là où l'usager choisit son trajet.
    // Rien pour le métro ni le tram : aucune source ne l'appuie.
    const busFriday = itineraries.some((it) =>
      it.legs.some((leg) => leg.mode === 'BUS' && algiersParts(leg.startTime).weekday === 5))
    const header = state.status === 'nextService' ? nextServiceHeader(state, locale) : null
    body = (
      <>
        {header && (
          // Rien dans la fenêtre demandée, mais une SECONDE recherche a trouvé
          // des trajets (plus tard, demain matin, arrivées possibles). On le
          // dit avant de les montrer.
          <div className="border-b border-line bg-paper-2 px-5 py-3">
            <p className="text-body font-medium text-ink-900">{header.title}</p>
            <p className="mt-0.5 text-label text-ink-600">{header.subtitle}</p>
          </div>
        )}
        {state.status === 'ok' && state.notice && (
          <p className="border-b border-line px-5 py-3 text-body text-ink-600">
            {t(state.notice === 'tooClose' ? 'itin_errTooClose' : 'itin_walkOnly')}
          </p>
        )}
        {rows}
        <div className="px-5 py-3.5 text-label text-ink-600">
          {/* Mode démo : trajet FABRIQUÉ, le dire sans détour. Sinon la source
              des « ~ » : fréquences estimées, et pour le bus, modélisées. */}
          {demo ? (
            <p>{t('itin_demoNote')}</p>
          ) : (
            <>
              <p>{t('estimatedNote')}</p>
              {hasBus && <p className="mt-1.5">{t('data_busEstimateNote')}</p>}
              {/* Pendant le Ramadan, cat_ramadanNotice le dit déjà. */}
              {busFriday && !ramadan && <p className="mt-1.5 text-ink-900">{t('data_busHoursNotice')}</p>}
              {ramadan && <p className="mt-1.5 text-ink-900">{t('cat_ramadanNotice')}</p>}
            </>
          )}
        </div>
      </>
    )
  }


  return (
    <div
      ref={panelRef}
      className={`absolute inset-0 z-20 ${open ? 'translate-x-0' : 'ltr:translate-x-full rtl:-translate-x-full'}`}
      style={{ transition: 'transform 320ms cubic-bezier(0.2, 0, 0, 1)', pointerEvents: 'none' }}
      role="region"
      aria-label={t('page_resultsRegion')}
    >
      {/* ── Liste ── */}
      <div
        ref={listRef}
        className={`absolute inset-0 flex flex-col bg-white ${detailOpen ? 'ltr:-translate-x-1/4 rtl:translate-x-1/4' : ''}`}
        style={{
          // Le détail ouvert, la liste recule puis s'efface : sur téléphone,
          // c'est la carte (et le trajet) qui doit apparaître au-dessus de la
          // feuille, pas la liste.
          // visibility : masquée APRÈS le glissement, rendue visible tout de
          // suite au retour (sinon le focus rendu à la rangée est refusé).
          transition: `transform 320ms cubic-bezier(0.2, 0, 0, 1), opacity 320ms ease, visibility 0s linear ${detailOpen ? '320ms' : '0s'}`,
          opacity: detailOpen ? 0 : 1,
          visibility: detailOpen ? 'hidden' : 'visible',
          pointerEvents: open && !detailOpen ? 'auto' : 'none',
        }}
      >
        {/* En-tête résultats (planche 1g) */}
        <div
          className="flex shrink-0 items-center gap-3 border-b border-line px-5 pb-3.5"
          style={{ paddingTop: 'calc(env(safe-area-inset-top, 0px) + 12px)' }}
        >
          <button
            type="button"
            onClick={onBack}
            aria-label={t('back')}
            className="tap relative shrink-0 pe-0.5 pt-0.5 after:absolute after:-inset-[11px] after:content-['']"
          >
            <BackIcon />
          </button>
          <div className="min-w-0 flex-1">
            <h1
              ref={headingRef}
              tabIndex={-1}
              className="truncate text-emph font-semibold text-ink-900 outline-none"
            >
              <RouteLabel from={fromName} to={toName} />
            </h1>
            {query && (
              // L'heure DEMANDÉE (un fait), pas celle du premier trajet.
              <p className="tnum mt-0.5 truncate text-label text-ink-600">{queryLabel(query, locale)}</p>
            )}
          </div>
          {demo && (
            <span className="ms-auto shrink-0 rounded-full bg-paper-2 px-2 py-0.5 text-xs font-medium text-ink-600">
              {t('itin_demoBadge')}
            </span>
          )}
        </div>

        <div
          className="min-h-0 flex-1 overflow-y-auto"
          style={{ paddingBottom: 'max(8px, env(safe-area-inset-bottom, 0px))' }}
        >
          {resumeSlot}
          {body}
        </div>
      </div>

      {/* ── Détail (handoff « Itinéraire Alger ») : glisse depuis le côté ──
          Sur téléphone, la carte reste visible au-dessus d'une feuille
          glissable (DetailSheet) ; sur grand écran, le détail occupe la
          colonne et la carte est à côté. */}
      <div
        ref={detailRef}
        className={`absolute inset-0 ${detailOpen ? 'translate-x-0' : 'ltr:translate-x-full rtl:-translate-x-full'}`}
        style={{
          transition: 'transform 320ms cubic-bezier(0.2, 0, 0, 1)',
          // La zone vide au-dessus de la feuille laisse passer les gestes vers
          // la carte ; la feuille, le bouton flottant et la barre du bas
          // reprennent les leurs (DetailSheet).
          pointerEvents: 'none',
        }}
        data-snap={wide ? 'wide' : detailSnap}
        role="region"
        aria-label={t('page_detailRegion')}
      >
        <DetailSheet
          wide={wide}
          interactive={open && detailOpen}
          snap={detailSnap}
          onSnapChange={onSnapChange}
          onMapInset={onDetailMapInset}
          onRefit={onRefitRoute}
          header={
            <div className="flex items-center gap-0.5 pe-4 ps-1.5">
              <button
                type="button"
                onClick={onCloseDetail}
                aria-label={t('back')}
                className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full"
                style={{ color: '#111418' }}
              >
                <BackIosIcon size={20} className="rtl:-scale-x-100" />
              </button>
              <div className="min-w-0 flex-1">
                <h2 ref={detailTitleRef} tabIndex={-1} className="flex min-w-0 flex-col gap-0.5 outline-none">
                  <span className="truncate text-[12px] leading-4" style={{ color: '#5F6670' }}>
                    <PlaceLabel name={fromName} />
                  </span>
                  {/* Le lecteur d'écran lit « départ → arrivée ». */}
                  <span className="sr-only"> {t('routeArrow')} </span>
                  <span className="truncate text-[14px] font-semibold leading-[18px]" style={{ color: '#111418' }}>
                    <PlaceLabel name={toName} />
                  </span>
                </h2>
              </div>
              {(demo || selected?.demo) && (
                <span className="shrink-0 rounded-full bg-paper-2 px-2 py-0.5 text-xs font-medium text-ink-600">
                  {t('itin_demoBadge')}
                </span>
              )}
            </div>
          }
          summary={
            <div>
              {selected && <ItinerarySummary itinerary={selected} query={query} />}
              <div className="mx-5 mt-3.5 h-px" style={{ background: '#EEF0F2' }} />
            </div>
          }
          topSlot={resumeSlot}
          footer={startsLater && selected ? (
            // Départ dans plus de 20 min : pas de guidage (il compterait depuis
            // maintenant). Phrase factuelle, non interactive.
            <p className="flex min-h-[50px] items-center justify-center text-center text-body text-ink-900" role="note">
              {tf('itin_startsLater', {
                time: `${algiersDayDiff(selected.startTime, now?.getTime() ?? selected.startTime) !== 0
                  ? `${formatAlgiersDay(selected.startTime, locale)} `
                  : ''}~${formatAlgiersTime(selected.startTime)}`,
              })}
            </p>
          ) : (
            <button
              type="button"
              onClick={onGo}
              disabled={!selected}
              className="flex h-[50px] w-full items-center justify-center gap-2 rounded-[14px] bg-[#1E6FE0] text-[16px] font-semibold text-white transition-colors active:bg-[#1857B0] disabled:opacity-50"
            >
              <NavigationIcon size={22} />
              {t('go')}
            </button>
          )}
        >
          {selected && (
            <ItineraryPanel
              itinerary={selected}
              fromName={fromName}
              toName={toName}
              demo={demo || Boolean(selected.demo)}
              requestedAt={query?.epoch}
            />
          )}
        </DetailSheet>
      </div>
    </div>
  )
}

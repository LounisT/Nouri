'use client'

// Contenu de l'écran Itinéraire (handoff « Itinéraire Alger ») : résumé du
// trajet (durée, heures, tarif, pastilles des tronçons) et fil vertical
// (départ, marche avec ses consignes OTP, transports, arrivée), puis la note
// sur les estimations et le tarif. La feuille glissable qui les porte, la
// carte et le bouton « Commencer » appartiennent à ResultsScreen/DetailSheet.
//
// Règles du produit, prioritaires sur la maquette :
// - aucune heure publiée ni temps réel à Alger : toute heure ou attente
//   estimée porte « ~ » ; seul un départ à pied à l'heure demandée est exact ;
// - données réelles : consignes de marche d'OTP, tarifs des fare_rules du
//   GTFS (otp.ts), tracés non relevés annoncés au tronçon concerné ;
// - trilingue avec RTL complet : noms isolés (<bdi>), chiffres latins.

import { useId, useState, type ReactNode } from 'react'
import {
  OtpItinerary,
  OtpLeg,
  formatDuration,
  formatFare,
  formatTime,
  isSchematicLeg,
  itineraryFareDzd,
  legHeadsign,
  legWait,
  type PlanQuery,
} from '@/lib/otp'
import { isDeducedShape, normalizeSearchTerm } from '@/lib/lines'
import { directionIndexForLeg, lineForLeg } from '@/lib/leg-headway'
import { translations, type Locale } from '@/lib/i18n'
import { badgeColor, fill, formatMeters, lineTint, placeName, plural } from '@/lib/nav-format'
import { describeWalkStep, simplifyWalkSteps, type WalkStep } from '@/lib/walk-steps'
import { isExactStart, modeLabel, rowSummary } from '@/lib/results-format'
import { reportMailto } from '@/lib/report'
import { useTranslation } from '@/hooks/useTranslation'
import { ExpandMoreIcon, InfoIcon, ManeuverIcon, WalkIcon, type ManeuverKind } from '@/components/icons'

// Jetons du handoff (gris froids de la maquette). L'app force le thème clair
// (globals.css) : pas de variante sombre à dériver ici.
const INK = '#111418'
const BODY = '#2A2F36'
const STRONG_2 = '#3B4149'
const MUTED = '#5F6670'
// #7A818B de la maquette donnait 3,9:1 sur blanc pour un texte de 12 px :
// assombri pour atteindre l'AA (≈ 4,9:1).
const NOTE = '#6B727C'
const RAIL_WALK = '#D5DAE1'
const CHIP = '#F1F3F5'
const INSET = '#F6F7F9'
const SEPARATOR = '#E6E9ED'
const PRIMARY = '#1E6FE0'
const HALO = '#D6E5FB'

const ARABIC = /[؀-ۿ]/

/** Nom propre isolé ; en arabe, un nom latin est prononcé en français. */
function Name({ children, locale }: { children: string; locale: Locale }) {
  return <bdi lang={locale === 'ar' && !ARABIC.test(children) ? 'fr' : undefined}>{children}</bdi>
}

/** Gabarit traduit dont une variable est rendue par un nœud (gras, isolat). */
function withNode(template: string, key: string, node: ReactNode, vars: Record<string, string | number> = {}): ReactNode {
  const [before, after = ''] = template.split(`{${key}}`)
  return <>{fill(before, vars)}{node}{fill(after, vars)}</>
}

// Un départ qui coïncide avec l'heure demandée (on part à pied tout de suite)
// est un fait ; toute autre heure vient des fréquences et porte « ~ ».
function departLabel(it: OtpItinerary, requestedAt?: number): string {
  const exact = isExactStart(it, requestedAt ?? Date.now())
  return exact ? formatTime(it.startTime) : `~${formatTime(it.startTime)}`
}

// ─── Résumé ─────────────────────────────────────────────────────────────────

/**
 * « ~1 h 40 min   ~05:15 – ~06:55   80 DZD » puis les pastilles des tronçons.
 * Mêmes valeurs que la rangée de la liste (rowSummary) : rien ne diverge.
 */
export function ItinerarySummary({ itinerary, query }: { itinerary: OtpItinerary; query: PlanQuery | null }) {
  const { t, locale } = useTranslation()
  const row = rowSummary(itinerary, { locale, query })
  const unit = t('itin_unitMin')
  return (
    <div className="px-5 pt-2">
      <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-0.5">
        <span className="tnum text-[26px] font-bold leading-8 tracking-[-0.5px]" style={{ color: INK }}>
          {row.duration}
        </span>
        <span className="tnum text-[15px] leading-5" style={{ color: BODY }}>
          {row.day ? `${row.day} · ` : ''}
          {/* La plage horaire seule est LTR : « ~05:15 – ~06:55 » se lit pareil en arabe. */}
          <span dir="ltr">{row.start} – {row.end}</span>
        </span>
        {row.fare && (
          <span className="tnum ms-auto text-[15px] font-bold leading-5" style={{ color: INK }}>{row.fare}</span>
        )}
      </div>

      {/* Pastilles des tronçons : redites dans le fil, masquées au lecteur d'écran. */}
      <div className="mt-2.5 flex flex-wrap items-center gap-1" aria-hidden="true">
        {itinerary.legs.map((leg, i) => {
          const min = Math.max(1, Math.round(leg.duration / 60))
          if (leg.mode === 'WALK') {
            // Marche de moins de 30 s (même quai) : pas de pastille.
            if (leg.duration < 30) return null
            return (
              <span
                key={i}
                className="flex h-[26px] shrink-0 items-center gap-px whitespace-nowrap rounded-[9px] pe-1.5 ps-0.5 text-[13px] font-semibold"
                style={{ background: CHIP, color: STRONG_2 }}
              >
                <WalkIcon size={17} className="rtl:-scale-x-100" />
                {/* Correspondance de quelques minutes : l'icône seule (maquette). */}
                {min >= 3 ? `${min} ${unit}` : null}
              </span>
            )
          }
          const color = badgeColor(leg.mode)
          return (
            <span
              key={i}
              className="tnum flex h-[26px] shrink-0 items-center gap-[5px] whitespace-nowrap rounded-[9px] pe-1.5 ps-[3px] text-[13px] font-semibold"
              style={{ background: lineTint(color), color: INK }}
            >
              <span dir="ltr" className="rounded-[5px] px-[5px] py-px text-[12px] font-bold leading-4 text-white" style={{ background: color }}>
                {leg.routeShortName}
              </span>
              {/* Durée à bord estimée (distance ÷ vitesse) : « ~ ». */}
              ~{min} {unit}
            </span>
          )
        })}
      </div>
    </div>
  )
}

// ─── Fil du trajet ──────────────────────────────────────────────────────────

interface ItineraryPanelProps {
  itinerary: OtpItinerary
  fromName?: string
  toName?: string
  /** Trajet fabriqué (mode démo). Par défaut : itinerary.demo. */
  demo?: boolean
  /** Heure de la recherche (epoch ms) : un départ à cette heure est un fait, pas une estimation. */
  requestedAt?: number
}

export default function ItineraryPanel({ itinerary, fromName, toName, demo, requestedAt }: ItineraryPanelProps) {
  const { t, locale } = useTranslation()
  const isDemo = demo ?? Boolean(itinerary.demo)
  const legs = itinerary.legs
  const first = legs[0]
  const last = legs[legs.length - 1]
  if (!first || !last) return null

  return (
    <div className="px-5 pt-3.5">
      <ol>
        {/* Départ : pastille bleue à halo. Un trajet qui commence à bord
            (départ à l'arrêt même) la porte sur son premier anneau. */}
        {first.mode === 'WALK' && (
          <li className="flex gap-3.5">
            <div className="flex h-5 w-5 shrink-0 items-center justify-center" aria-hidden="true">
              <StartDot />
            </div>
            <StationRow name={placeName(first.from, locale)} time={departLabel(itinerary, requestedAt)} />
          </li>
        )}

        {legs.map((leg, i) => (leg.mode === 'WALK'
          ? <WalkSegment key={i} leg={leg} />
          : (
            <TransitSegment
              key={i}
              itinerary={itinerary}
              leg={leg}
              index={i}
              startTime={i === 0 ? departLabel(itinerary, requestedAt) : undefined}
              final={i === legs.length - 1}
            />
          )))}

        {/* Arrivée : carré noir (sur le dernier anneau si l'on descend à destination). */}
        {last.mode === 'WALK' && (
          <li className="flex gap-3.5">
            <div className="flex h-5 w-5 shrink-0 items-center justify-center" aria-hidden="true">
              <EndSquare />
            </div>
            <StationRow name={placeName(last.to, locale)} time={`~${formatTime(last.endTime)}`} />
          </li>
        )}
      </ol>

      {/* Note finale : source des « ~ » et tarif réel (tickets × prix). */}
      <div className="mt-5 flex items-start gap-2 text-[12px] leading-4" style={{ color: NOTE }}>
        <InfoIcon size={15} className="mt-px shrink-0" />
        <p className="min-w-0">
          {isDemo
            ? t('itin_demoNote')
            : legs.some((leg) => leg.mode !== 'WALK') ? t('itin_estimateNote') : t('itin_walkOnlyNote')}
          {' '}
          <FareSentence itinerary={itinerary} />
        </p>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 ps-[23px]">
        {!isDemo && <ShareButton itinerary={itinerary} fromName={fromName} toName={toName} />}
        <a
          href={reportMailto(reportContext(itinerary, fromName, toName, locale), locale)}
          className="inline-flex min-h-[32px] items-center text-[12px] underline underline-offset-2"
          style={{ color: MUTED }}
        >
          {t('nav_report')}
        </a>
      </div>
    </div>
  )
}

function StartDot() {
  return <span className="h-3.5 w-3.5 rounded-full" style={{ background: PRIMARY, boxShadow: `0 0 0 3px ${HALO}` }} />
}

function EndSquare() {
  return <span className="h-3.5 w-3.5 rounded-[3px]" style={{ background: INK }} />
}

function StationRow({ name, time }: { name: string; time: string }) {
  const { locale } = useTranslation()
  return (
    <div className="flex min-w-0 flex-1 justify-between gap-2.5 leading-5">
      <p className="min-w-0 text-[15px] font-semibold" style={{ color: INK }}><Name locale={locale}>{name}</Name></p>
      <span className="tnum shrink-0 text-[14px]" style={{ color: STRONG_2 }} dir="ltr">{time}</span>
    </div>
  )
}

// ─── Marche ─────────────────────────────────────────────────────────────────

function maneuverOf(step: WalkStep): { kind: ManeuverKind; bearing?: number } {
  if (step.stairs) return { kind: 'stairs' }
  switch (step.relative) {
    case 'DEPART': {
      const bearings: Record<string, number> = {
        NORTH: 0, NORTHEAST: 45, EAST: 90, SOUTHEAST: 135, SOUTH: 180, SOUTHWEST: 225, WEST: 270, NORTHWEST: 315,
      }
      const bearing = step.absolute ? bearings[step.absolute] : undefined
      return bearing === undefined ? { kind: 'straight' } : { kind: 'depart', bearing }
    }
    case 'LEFT': case 'HARD_LEFT': return { kind: 'left' }
    case 'RIGHT': case 'HARD_RIGHT': return { kind: 'right' }
    case 'SLIGHTLY_LEFT': return { kind: 'slightLeft' }
    case 'SLIGHTLY_RIGHT': return { kind: 'slightRight' }
    case 'UTURN_LEFT': case 'UTURN_RIGHT': return { kind: 'uturn' }
    case 'CIRCLE_CLOCKWISE': case 'CIRCLE_COUNTERCLOCKWISE': return { kind: 'roundabout' }
    default: return { kind: 'straight' }
  }
}

function WalkSegment({ leg }: { leg: OtpLeg }) {
  const { t, tn, locale } = useTranslation()
  const [open, setOpen] = useState(false)
  const listId = useId()
  // Consignes rue par rue d'OTP (regroupées, jamais inventées).
  const steps = simplifyWalkSteps(leg)
  const hasSteps = steps.length >= 2
  const summary = (
    <>
      <WalkIcon size={19} className="shrink-0 text-[#5F6670] rtl:-scale-x-100" />
      <span className="min-w-0 flex-1 text-[14px] leading-[18px]" style={{ color: BODY }}>
        {withNode(
          t('itin_walkLeg'),
          'duration',
          <span className="font-semibold">{formatDuration(leg.duration, locale)}</span>,
          { distance: formatMeters(leg.distance, locale) },
        )}
      </span>
    </>
  )

  return (
    <li className="flex gap-3.5">
      <div className="flex w-5 shrink-0 justify-center" aria-hidden="true">
        <span className="w-1 rounded-[2px]" style={{ background: RAIL_WALK }} />
      </div>
      <div className="min-w-0 flex-1 py-1.5">
        {hasSteps ? (
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
            aria-controls={listId}
            className="flex min-h-[44px] w-full items-center gap-2 text-start"
          >
            {summary}
            <span className="flex shrink-0 items-center gap-0.5 py-1.5 ps-2 text-[13px] font-semibold" style={{ color: PRIMARY }}>
              {open ? t('itin_stepsHide') : tn('itin_steps', steps.length)}
              {/* Le chevron pivote de 180° à l'ouverture (0,2 s). */}
              <ExpandMoreIcon size={20} className={`transition-transform duration-200 ${open ? 'rotate-180' : ''}`} />
            </span>
          </button>
        ) : (
          <div className="flex min-h-[44px] items-center gap-2">{summary}</div>
        )}
        {hasSteps && (
          <ol
            id={listId}
            // Classe et non attribut `hidden` : « flex » l'emporterait sur lui.
            className={`${open ? 'flex' : 'hidden'} mt-1.5 flex-col rounded-[14px] px-3.5 py-1`}
            style={{ background: INSET }}
          >
            {steps.map((step, k) => {
              const m = maneuverOf(step)
              return (
                <li
                  key={k}
                  className="flex items-center gap-3 py-2"
                  style={{ borderBottom: k < steps.length - 1 ? `1px solid ${SEPARATOR}` : 'none' }}
                >
                  <ManeuverIcon kind={m.kind} bearing={m.bearing} size={18} className="shrink-0 text-[#3B4149]" />
                  <span className="min-w-0 flex-1 text-[13px] leading-[18px]" style={{ color: BODY }}>{describeWalkStep(step, t)}</span>
                  <span className="tnum shrink-0 text-[13px]" style={{ color: MUTED }}>{formatMeters(step.distance, locale)}</span>
                </li>
              )
            })}
          </ol>
        )}
      </div>
    </li>
  )
}

// ─── Transport ──────────────────────────────────────────────────────────────

function TransitSegment({ itinerary, leg, index, startTime, final }: {
  itinerary: OtpItinerary
  leg: OtpLeg
  index: number
  /** Premier tronçon : heure de départ du trajet (exacte ou « ~ »). */
  startTime?: string
  /** Dernier tronçon : on descend à destination. */
  final?: boolean
}) {
  const { t, tf, locale } = useTranslation()
  const color = badgeColor(leg.mode)
  const wait = legWait(itinerary, index)
  const stopCount = leg.intermediateStops ? leg.intermediateStops.length + 1 : null
  const headsign = legHeadsign(leg, locale)
  const comma = locale === 'ar' ? '، ' : ', '
  const schematic = isSchematicLeg(leg)
  const deduced = !schematic && isDeducedShape(leg.routeShortName, leg.headsign, leg.tripId)
  const ring = (
    <span className="box-border h-5 w-5 shrink-0 rounded-full border-4 bg-white" style={{ borderColor: color }} />
  )
  return (
    <li className="flex gap-3.5">
      <div className="flex w-5 shrink-0 flex-col items-center" aria-hidden="true">
        {startTime ? <span className="flex h-5 w-5 items-center justify-center"><StartDot /></span> : ring}
        <span className="w-1.5 flex-1" style={{ background: color }} />
        {final ? <span className="flex h-5 w-5 items-center justify-center"><EndSquare /></span> : ring}
      </div>
      <div className="flex min-w-0 flex-1 flex-col">
        <StationRow name={placeName(leg.from, locale)} time={startTime ?? `~${formatTime(leg.startTime)}`} />
        <div className="flex flex-col gap-2 pb-3 pt-2.5">
          <div className="flex min-w-0 items-center gap-2">
            <span
              dir="ltr"
              className="shrink-0 rounded-[6px] px-2 py-0.5 text-[13px] font-bold leading-[18px] text-white"
              style={{ background: color }}
            >
              {leg.routeShortName}
            </span>
            <p className="min-w-0 truncate text-[14px]" style={{ color: BODY }}>
              {headsign
                ? withNode(
                  t('itin_rideTowards'),
                  'dest',
                  <span className="font-semibold"><Name locale={locale}>{headsign}</Name></span>,
                  { mode: modeLabel(leg.mode, locale) },
                )
                : modeLabel(leg.mode, locale)}
            </p>
          </div>
          <div className="tnum flex flex-wrap items-center gap-2 text-[13px]" style={{ color: MUTED }}>
            {/* Attente ESTIMÉE (fréquences) : « ~ », jamais un horaire. */}
            {wait && wait.waitMin >= 1 && (
              <span className="rounded-[6px] px-[7px] py-0.5 font-semibold" style={{ background: lineTint(color), color: BODY }}>
                {tf('itin_waitChip', { n: wait.waitMin })}
              </span>
            )}
            <span>
              {stopCount ? `${plural(stopCount, 'nav_stops', t, locale)}${comma}` : ''}
              ~{formatDuration(leg.duration, locale)}
            </span>
          </div>
          {recordedTerminus(leg) && (
            // Le sens s'arrête, dans nos données, avant le terminus de la
            // girouette : on dit jusqu'où il est relevé.
            <p className="text-[12px] leading-4" style={{ color: MUTED }}>
              {withNode(t('itin_traceRecordedTo'), 'stop', <Name locale={locale}>{placeName(leg.to, locale)}</Name>)}
            </p>
          )}
          {/* Tracé non relevé (droites d'arrêt à arrêt) ou déduit de la voirie :
              la carte le dessine en plein, plus pâle — on l'écrit ici. */}
          {(schematic || deduced) && (
            <p className="text-[12px] leading-4" style={{ color: MUTED }}>
              {t(schematic ? 'routeNotMapped' : 'routeEstimated')}
            </p>
          )}
        </div>
        <StationRow name={placeName(leg.to, locale)} time={`~${formatTime(leg.endTime)}`} />
      </div>
    </li>
  )
}

/**
 * Bus : le tronçon descend au DERNIER arrêt relevé de son sens, et ce dernier
 * ne porte pas le nom de la girouette (100 « dir. Place des Martyrs » qui
 * finit à l'Hôtel Es-Safir). Vrai pour afficher « Tracé relevé jusqu'à … ».
 */
function recordedTerminus(leg: OtpLeg): boolean {
  if (leg.mode !== 'BUS' || !leg.headsign || !leg.to.stopId) return false
  const line = lineForLeg(leg)
  if (!line) return false
  const index = directionIndexForLeg(line, leg)
  const stops = line.directions[index]?.stops
  const last = stops?.[stops.length - 1]
  if (!last?.id || last.id !== leg.to.stopId.split(':').pop()) return false
  const a = normalizeSearchTerm(last.name)
  const b = normalizeSearchTerm(leg.headsign)
  return !(a.includes(b) || b.includes(a))
}

// ─── Tarif : fare_rules du GTFS via OTP (un ticket par montée) ──────────────

function FareSentence({ itinerary }: { itinerary: OtpItinerary }) {
  const { t, tn, locale } = useTranslation()
  const transit = itinerary.legs.filter((leg) => leg.mode !== 'WALK')
  if (transit.length === 0) return null // tout à pied : pas de tarif
  const total = itinerary.fareDzd !== undefined ? itinerary.fareDzd : itineraryFareDzd(itinerary)
  if (total === null || total === undefined) return <>{t('itin_fareUnknown')}.</>
  // Un tronçon à 0 DZD est couvert par le ticket précédent (changement de
  // quai du métro) : il ne compte pas comme un ticket.
  const prices = transit.map((leg) => leg.fareDzd).filter((p) => p !== 0)
  const n = prices.length
  if (n === 0) return null
  const same = prices.every((p) => typeof p === 'number' && p === prices[0])
  return (
    <span className="tnum">
      {same
        ? tn('itin_tickets', n, { price: formatFare(prices[0] as number, locale) })
        : tn('itin_ticketsTotal', n, { total: formatFare(total, locale) })}
    </span>
  )
}

// ─── Partage et signalement (inchangés) ─────────────────────────────────────

const MY_LOCATION_LABELS = new Set(Object.values(translations).map((dict) => dict.myLocation))

/**
 * Lien que l'app sait déjà relire (?from=lat,lon,nom&to=…). « Ma position »
 * n'est pas un nom de lieu pour le destinataire : on n'envoie alors que les
 * coordonnées.
 */
function shareUrl(it: OtpItinerary, fromName?: string, toName?: string): string {
  const first = it.legs[0].from
  const last = it.legs[it.legs.length - 1].to
  const part = (p: { lat: number; lon: number }, name?: string) => {
    const label = name && !MY_LOCATION_LABELS.has(name) ? `,${encodeURIComponent(name.replace(/%/g, ''))}` : ''
    return `${p.lat.toFixed(5)},${p.lon.toFixed(5)}${label}`
  }
  const base = typeof window !== 'undefined' ? `${window.location.origin}${window.location.pathname}` : ''
  return `${base}?from=${part(first, fromName ?? first.name)}&to=${part(last, toName ?? last.name)}`
}

function reportContext(it: OtpItinerary, fromName: string | undefined, toName: string | undefined, locale: Locale) {
  const first = it.legs[0].from
  const last = it.legs[it.legs.length - 1].to
  return {
    kind: 'itinerary' as const,
    from: { name: fromName ?? first.name, lat: first.lat, lon: first.lon },
    to: { name: toName ?? last.name, lat: last.lat, lon: last.lon },
    legs: it.legs.map((leg) => {
      const label = leg.mode === 'WALK' ? 'WALK' : `${leg.mode} ${leg.routeShortName ?? ''}`.trim()
      const direction = leg.mode === 'WALK' ? '' : ` (${legHeadsign(leg, 'fr') ?? ''})`
      return `${label}${direction} ${placeName(leg.from, locale)} → ${placeName(leg.to, locale)} ~${formatTime(leg.startTime)}–~${formatTime(leg.endTime)}`
    }),
  }
}

function ShareButton({ itinerary, fromName, toName }: { itinerary: OtpItinerary; fromName?: string; toName?: string }) {
  const { t } = useTranslation()
  const [state, setState] = useState<{ kind: 'idle' | 'copied' } | { kind: 'manual'; url: string }>({ kind: 'idle' })

  const handleShare = async () => {
    const url = shareUrl(itinerary, fromName, toName)
    const from = fromName ?? itinerary.legs[0].from.name
    const to = toName ?? itinerary.legs[itinerary.legs.length - 1].to.name
    const text = fill(t('nav_shareText'), { from, to })
    if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
      try {
        await navigator.share({ title: 'Nouri', text, url })
        return
      } catch (error) {
        // Partage annulé par l'usager : rien d'autre à faire.
        if ((error as DOMException)?.name === 'AbortError') return
      }
    }
    try {
      await navigator.clipboard.writeText(url)
      setState({ kind: 'copied' })
      setTimeout(() => setState({ kind: 'idle' }), 3000)
    } catch {
      // Presse-papiers refusé (http, ancien navigateur) : on montre le lien.
      setState({ kind: 'manual', url })
    }
  }

  return (
    <div className="flex min-w-0 flex-wrap items-center gap-2">
      <button
        type="button"
        onClick={handleShare}
        className="tap inline-flex min-h-[32px] items-center gap-1.5 rounded-full border px-3 text-[12px] font-medium"
        style={{ borderColor: SEPARATOR, color: BODY }}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path d="M12 3v12M7 8l5-5 5 5M5 14v5a2 2 0 002 2h10a2 2 0 002-2v-5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        {t('nav_share')}
      </button>
      {state.kind === 'copied' && (
        <span className="text-[12px]" style={{ color: MUTED }} role="status">{t('nav_linkCopied')}</span>
      )}
      {state.kind === 'manual' && (
        <label className="flex min-w-0 flex-1 items-center gap-2 text-[12px]" style={{ color: MUTED }}>
          <span className="shrink-0">{t('nav_copyLink')}</span>
          <input
            readOnly
            value={state.url}
            dir="ltr"
            onFocus={(e) => e.currentTarget.select()}
            className="min-w-0 flex-1 rounded-[6px] border border-line px-2 py-1 text-label text-ink-900"
          />
        </label>
      )}
    </div>
  )
}

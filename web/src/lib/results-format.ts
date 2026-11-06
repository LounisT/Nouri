// Écran Résultats : état de la recherche, rangées et en-tête mis en forme.
//
// Module pur (aucune dépendance React) : la traduction passe par translate()
// et pluralize(), ce qui permet de le vérifier hors navigateur
// (web/scripts/page/check-results.ts), sous plusieurs fuseaux.
//
// Règles tenues ici, pour que la liste, l'en-tête et l'annonce vocale ne
// divergent jamais :
// - une heure d'arrivée porte toujours « ~ » ; une heure de départ aussi, sauf
//   un départ à pied à l'heure demandée (c'est un fait, pas une estimation) ;
// - heures à l'heure d'ALGER, quel que soit le fuseau du téléphone ;
// - le tarif vient d'OTP (it.fareDzd) : une seule source pour la liste et le
//   détail, jamais de total partiel ;
// - la fréquence d'une ligne directe vient des départs du GTFS (headwayAt),
//   celle-là même qu'utilise le calculateur ; null hors service → on affiche
//   l'heure de départ plutôt qu'une fréquence inventée.

import type { NextServiceFallback, OtpItinerary, OtpLeg, PlanError, PlanQuery } from './otp'
import { formatDuration, formatFare, isRetryablePlanError } from './otp'
import { nextPassLabel } from './lines'
import { legHeadwayMin } from './leg-headway'
import { algiersDayDiff, deviceShowsAlgiersTime, formatAlgiersDay, formatAlgiersTime } from './algiers-time'
import { pluralize, translate, type Locale, type TranslationKey } from './i18n'

// ─── État de la recherche ────────────────────────────────────────────────────

export type SearchState =
  | { status: 'idle' }
  | { status: 'loading'; query: PlanQuery }
  | {
      status: 'ok'
      query: PlanQuery
      itineraries: OtpItinerary[]
      /** tooClose / walkOnly : seule la marche est pertinente, et on le dit. */
      notice?: 'tooClose' | 'walkOnly'
      /** Trajets FABRIQUÉS (NEXT_PUBLIC_DEMO=1 seulement) : étiquetés partout. */
      demo?: boolean
    }
  | {
      status: 'nextService'
      /** La recherche initiale, celle qui n'a rien donné. */
      query: PlanQuery
      itineraries: OtpItinerary[]
      dayOffset: 0 | 1
      /** Type de repli (plus tard, demain matin, arrivées possibles) ; absent = matin. */
      fallback?: NextServiceFallback
      /** La requête de repli : son mode (arriver avant / partir à) classe les rangées. */
      serviceQuery?: PlanQuery
    }
  | {
      status: 'error'
      query: PlanQuery
      error: PlanError
      /** Marche ≤ 60 min proposée SOUS le message, sinon vide. */
      itineraries: OtpItinerary[]
    }

export function stateItineraries(state: SearchState): OtpItinerary[] {
  return state.status === 'ok' || state.status === 'nextService' || state.status === 'error'
    ? state.itineraries
    : []
}

export function stateQuery(state: SearchState): PlanQuery | null {
  return state.status === 'idle' ? null : state.query
}

export function stateIsDemo(state: SearchState): boolean {
  return state.status === 'ok' && Boolean(state.demo || state.itineraries.some((it) => it.demo))
}

/** Titre du message d'échec : « aucun itinéraire » seulement si le calculateur a RÉPONDU. */
export function errorTitleKey(error: PlanError): TranslationKey {
  return isRetryablePlanError(error) ? 'page_searchFailed' : 'noRoutesAvailable'
}

// ─── En-tête ─────────────────────────────────────────────────────────────────

/**
 * « Départ maintenant · 14:05 », « Départ 08:30 · demain », « Arrivée avant
 * 09:00 ». L'heure affichée est celle DEMANDÉE (un fait, sans « ~ ») — pas le
 * départ du premier trajet, qu'OTP peut décaler. « heure d'Alger » est ajouté
 * quand le téléphone n'est pas à l'heure d'Alger (diaspora, voyageurs).
 */
export function queryLabel(query: PlanQuery, locale: Locale, nowMs: number = Date.now()): string {
  let text = query.arriveBy
    ? translate(locale, 'itin_arriveBy', { time: query.time })
    : query.isNow
      ? `${translate(locale, 'itin_departNow')} · ${query.time}`
      : translate(locale, 'itin_departAt', { time: query.time })
  if (!query.isNow) {
    const days = algiersDayDiff(query.epoch, nowMs)
    if (days === 1) text += ` · ${translate(locale, 'itin_tomorrow')}`
    else if (days !== 0) text += ` · ${formatAlgiersDay(query.epoch, locale)}`
  }
  if (!deviceShowsAlgiersTime(nowMs)) text += ` · ${translate(locale, 'itin_algiersTime')}`
  return text
}

/**
 * En-tête de l'état 'nextService' : un constat (ce que la recherche initiale
 * n'a pas trouvé) puis ce que montre la liste. Partagé par l'écran et
 * l'annonce vocale.
 */
export function nextServiceHeader(
  state: { query: PlanQuery; dayOffset: 0 | 1; fallback?: NextServiceFallback },
  locale: Locale,
): { title: string; subtitle: string } {
  const time = state.query.time
  switch (state.fallback) {
    case 'laterToday':
      return { title: translate(locale, 'itin_noDepartureSoon'), subtitle: translate(locale, 'itin_nextServiceLaterToday') }
    case 'latestArrival':
      return {
        title: translate(locale, 'itin_departEarlier', { time }),
        subtitle: translate(locale, 'itin_latestArrivalBefore', { time }),
      }
    case 'firstArrival':
      return {
        title: translate(locale, 'itin_noArrivalFoundBefore', { time }),
        subtitle: translate(locale, 'itin_firstArrivalsAfter', { time }),
      }
    case 'morning':
    default:
      return {
        title: translate(locale, 'itin_errOutOfService'),
        subtitle: translate(locale, state.dayOffset ? 'itin_nextServiceTomorrow' : 'itin_nextServiceThisMorning'),
      }
  }
}

// ─── Lignes et fréquences ────────────────────────────────────────────────────
// Règle partagée avec le détail (legWait) et la navigation : leg-headway.ts.
export { lineForLeg, directionIndexForLeg, legHeadwayMin } from './leg-headway'

// ─── Rangées ─────────────────────────────────────────────────────────────────

/** Un départ à pied à l'heure demandée est un fait ; toute autre heure est estimée. */
export function isExactStart(it: OtpItinerary, requestedAt?: number): boolean {
  return requestedAt !== undefined
    && it.legs[0]?.mode === 'WALK'
    && Math.abs(it.startTime - requestedAt) < 60_000
}

export function modeLabel(mode: OtpLeg['mode'], locale: Locale): string {
  switch (mode) {
    case 'SUBWAY': return translate(locale, 'metro')
    case 'TRAM': return translate(locale, 'tram')
    case 'BUS': return translate(locale, 'busMode')
    case 'WALK': return translate(locale, 'onFoot')
    default: return ''
  }
}

export interface RowSummary {
  transitLegs: OtpLeg[]
  /** Une seule ligne, sans correspondance : « direct ». */
  direct: boolean
  walkMin: number
  /** « ~08:12 » ou « 08:12 » (départ à pied à l'heure demandée). */
  start: string
  /** Toujours « ~HH:MM ». */
  end: string
  /** « ~52 min » : durée estimée (fréquences, vitesse commerciale) dès qu'un véhicule est emprunté. */
  duration: string
  /** « 70 DZD » ; null si inconnu ou trajet à pied (le détail le dit). */
  fare: string | null
  /** Correspondances, fréquence d'une ligne directe, ou départ du premier véhicule. */
  thirdInfo: string
  /** Jour du trajet s'il diffère du jour demandé (trajet de nuit → demain matin). */
  day: string | null
  /** Libellé complet pour lecteur d'écran, sans « ~ ». */
  aria: string
}

export function rowSummary(
  it: OtpItinerary,
  opts: { locale: Locale; query: PlanQuery | null; qualifier?: string | null },
): RowSummary {
  const { locale, query } = opts
  const transitLegs = it.legs.filter((leg) => leg.mode !== 'WALK')
  const direct = transitLegs.length === 1
  const walkMin = Math.round(it.legs.filter((l) => l.mode === 'WALK').reduce((s, l) => s + l.duration, 0) / 60)
  const exactStart = isExactStart(it, query?.epoch)
  const rawStart = formatAlgiersTime(it.startTime)
  const rawEnd = formatAlgiersTime(it.endTime)
  const start = exactStart ? rawStart : `~${rawStart}`
  const end = `~${rawEnd}`
  const fare = typeof it.fareDzd === 'number' ? formatFare(it.fareDzd, locale) : null

  let thirdInfo: string
  const first = transitLegs[0]
  if (it.transfers > 0) {
    thirdInfo = pluralize(locale, 'ux_transfers', it.transfers)
  } else if (direct && first) {
    const headway = legHeadwayMin(first)
    thirdInfo = headway !== null
      ? nextPassLabel(headway, locale)
      : `${translate(locale, 'departPrefix')} ~${formatAlgiersTime(first.startTime)}`
  } else if (first) {
    thirdInfo = `${translate(locale, 'departPrefix')} ~${formatAlgiersTime(first.startTime)}`
  } else {
    thirdInfo = translate(locale, 'itin_walkOnly')
  }

  const reference = query?.epoch ?? Date.now()
  const day = algiersDayDiff(it.startTime, reference) !== 0 ? formatAlgiersDay(it.startTime, locale) : null
  const rawDuration = formatDuration(it.duration, locale)
  const duration = transitLegs.length ? `~${rawDuration}` : rawDuration

  // Virgule arabe « ، » en arabe : la synthèse vocale y marque la pause.
  const comma = locale === 'ar' ? '، ' : ', '
  const modes = transitLegs.length
    ? transitLegs.map((leg) => `${modeLabel(leg.mode, locale)} ${leg.routeShortName ?? ''}`.trim()).join(comma)
    : translate(locale, 'onFoot')
  const withoutTilde = (text: string) => text.replace(/~\s?/g, '')
  const aria = [
    modes,
    rawDuration,
    opts.qualifier ?? null,
    walkMin > 0 && transitLegs.length > 0 ? translate(locale, 'page_walkMinutes', { n: walkMin }) : null,
    day,
    translate(locale, exactStart ? 'page_timesExactAria' : 'page_timesAria', { start: rawStart, end: rawEnd }),
    fare,
    withoutTilde(thirdInfo),
  ].filter(Boolean).join(comma)

  return { transitLegs, direct, walkMin, start, end, duration, fare, thirdInfo, day, aria }
}

/** Les trajets affichés empruntent-ils un bus (note de source ETUSA) ? */
export function usesMode(itineraries: OtpItinerary[], mode: OtpLeg['mode']): boolean {
  return itineraries.some((it) => it.legs.some((leg) => leg.mode === mode))
}

// ─── Annonce pour lecteur d'écran ────────────────────────────────────────────

/** Texte de la région live de l'écran : recherche en cours, nombre de trajets, échec. */
export function resultsAnnouncement(state: SearchState, locale: Locale, errorMessage?: string): string {
  switch (state.status) {
    case 'idle':
      return ''
    case 'loading':
      return translate(locale, 'searching')
    case 'error':
      return `${translate(locale, errorTitleKey(state.error))}. ${errorMessage ?? ''}`.trim()
    case 'nextService': {
      const header = nextServiceHeader(state, locale)
      return `${header.title} ${header.subtitle}. ${pluralize(locale, 'ux_routesFound', state.itineraries.length)}`
    }
    case 'ok': {
      const parts = [pluralize(locale, 'ux_routesFound', state.itineraries.length)]
      if (state.notice === 'tooClose') parts.push(translate(locale, 'itin_errTooClose'))
      if (state.notice === 'walkOnly') parts.push(translate(locale, 'itin_walkOnly'))
      if (stateIsDemo(state)) parts.push(translate(locale, 'itin_demoBadge'))
      return parts.join('. ')
    }
  }
}

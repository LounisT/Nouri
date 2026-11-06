import { allStations, railStationsBetween, Station } from './stations'
import { allLines, isUnmappedShape, legHeadsignLabel, nearbyLines, stopById } from './lines'
import {
  addAlgiersDays,
  algiersOtpDateTime,
  algiersParts,
  algiersToEpoch,
  formatAlgiersTime,
} from './algiers-time'
import type { Locale } from './i18n'
import { itinText, type ItinKey } from './strings/itin'
import { legHeadwayMin } from './leg-headway'

// Côté client : passe par le proxy Next.js /api/otp
// Côté serveur : appel direct via OTP_INTERNAL_URL (même convention que le
// proxy : l'URL désigne le serveur, le préfixe /otp est ajouté ici).
const SERVER_OTP_ROOT = (process.env.OTP_INTERNAL_URL ?? 'http://localhost:8080').replace(/\/+$/, '')
const OTP_BASE_URL = typeof window !== 'undefined'
  ? '/api/otp'
  : (SERVER_OTP_ROOT.endsWith('/otp') ? SERVER_OTP_ROOT : `${SERVER_OTP_ROOT}/otp`)

/** Délai max d'une recherche côté client. Le proxy coupe à 12 s et répond 504. */
export const PLAN_TIMEOUT_MS = 15000

// ─── Santé d'OTP ─────────────────────────────────────────────────────────────
// Le statut n'est qu'une INFORMATION (bandeau) : chaque recherche retente OTP.
// Une sonde ratée (métro sans réseau, OTP qui redémarre) ne doit jamais
// condamner la session à des trajets simulés.

export interface OtpInfo {
  ok: boolean
  /** Début et fin des horaires chargés dans le graphe (epoch ms), si connus. */
  serviceStarts?: number
  serviceEnds?: number
  /**
   * Sonde refusée par la limite de débit du proxy (429) : l'état d'OTP est
   * INCONNU, ce n'est pas une panne. Sous CGNAT, des centaines d'abonnés
   * partagent une IP : annoncer « ne répond pas » serait faux.
   */
  rateLimited?: boolean
  /** Délai demandé par le proxy avant la prochaine sonde (Retry-After), en ms. */
  retryAfterMs?: number
}

const RETRY_AFTER_MIN_MS = 2000
const RETRY_AFTER_MAX_MS = 60000

export async function fetchOtpInfo(signal?: AbortSignal, timeoutMs = 5000): Promise<OtpInfo> {
  try {
    const res = await fetchWithTimeout(`${OTP_BASE_URL}/routers/default`, signal, timeoutMs)
    if (res.status === 429) {
      const sec = Number(res.headers.get('Retry-After'))
      const ms = Number.isFinite(sec) && sec > 0 ? sec * 1000 : RETRY_AFTER_MIN_MS
      return { ok: false, rateLimited: true, retryAfterMs: Math.min(RETRY_AFTER_MAX_MS, Math.max(RETRY_AFTER_MIN_MS, ms)) }
    }
    if (!res.ok) return { ok: false }
    const data = await res.json() as { transitServiceStarts?: number; transitServiceEnds?: number }
    return {
      ok: true,
      serviceStarts: typeof data.transitServiceStarts === 'number' ? data.transitServiceStarts * 1000 : undefined,
      serviceEnds: typeof data.transitServiceEnds === 'number' ? data.transitServiceEnds * 1000 : undefined,
    }
  } catch {
    return { ok: false }
  }
}

/**
 * Surveille OTP pour un bandeau informatif. Tant qu'il est injoignable, réessaie
 * avec un délai croissant (2 s → 60 s) ; revérifie aussitôt au retour du réseau
 * ou quand l'app revient au premier plan. Renvoie la fonction d'arrêt.
 */
export function watchOtpHealth(
  onChange: (info: OtpInfo) => void,
  opts: { minDelayMs?: number; maxDelayMs?: number } = {},
): () => void {
  const minDelay = opts.minDelayMs ?? 2000
  const maxDelay = opts.maxDelayMs ?? 60000
  let stopped = false
  let failures = 0
  let timer: ReturnType<typeof setTimeout> | null = null
  let lastOk: boolean | null = null
  let lastCheck = 0
  let inFlight = false

  const schedule = (ms: number) => {
    if (timer) clearTimeout(timer)
    timer = setTimeout(run, ms)
  }

  async function run() {
    if (stopped || inFlight) return
    inFlight = true
    timer = null
    const info = await fetchOtpInfo()
    inFlight = false
    if (stopped) return
    lastCheck = Date.now()
    if (info.rateLimited) {
      // État inconnu : le bandeau garde son état précédent (jamais « ne répond
      // pas » sur un 429) ; nouvel essai après Retry-After, sans compter
      // d'échec — les relances en rafale entretiendraient la saturation.
      schedule(Math.max(info.retryAfterMs ?? minDelay, minDelay) * (0.8 + Math.random() * 0.4))
      return
    }
    if (info.ok !== lastOk || info.ok) onChange(info)
    lastOk = info.ok
    if (info.ok) {
      failures = 0
      return
    }
    failures += 1
    // Gigue de ±20 % : des milliers de téléphones ne doivent pas réessayer en rafale.
    const base = Math.min(maxDelay, minDelay * 2 ** (failures - 1))
    schedule(base * (0.8 + Math.random() * 0.4))
  }

  const onOnline = () => { failures = 0; schedule(0) }
  const onVisible = () => {
    if (typeof document !== 'undefined' && document.visibilityState === 'visible' && Date.now() - lastCheck > 30000) {
      schedule(0)
    }
  }
  if (typeof window !== 'undefined') {
    window.addEventListener('online', onOnline)
    document.addEventListener('visibilitychange', onVisible)
  }
  schedule(0)

  return () => {
    stopped = true
    if (timer) clearTimeout(timer)
    if (typeof window !== 'undefined') {
      window.removeEventListener('online', onOnline)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }
}

// ─── Types OTP ───────────────────────────────────────────────────────────────

export interface Coordinate {
  lat: number
  lon: number
  name?: string
}

export interface LegGeometry {
  points: string // encoded polyline
}

export interface OtpPlace extends Coordinate {
  name: string
  stopId?: string
  /** Nom arabe tiré des données (stations métro/tram) ; absent = pas de nom arabe sourcé. */
  nameAr?: string
}

/**
 * Consigne de marche telle qu'OTP la renvoie (une par rue empruntée). Les
 * noms de rue suivent la `locale` envoyée à OTP. Mise en forme : walk-steps.ts.
 */
export interface OtpWalkStep {
  distance: number
  relativeDirection?: string
  absoluteDirection?: string
  streetName?: string
  /** Nom générique fabriqué par OTP (« route sans nom », « service road »). */
  bogusName?: boolean
  stayOn?: boolean
  area?: boolean
  lat: number
  lon: number
}

export interface OtpLeg {
  mode: 'WALK' | 'SUBWAY' | 'TRAM' | 'BUS' | 'RAIL'
  startTime: number
  endTime: number
  duration: number
  distance: number
  from: OtpPlace
  to: OtpPlace
  legGeometry: LegGeometry
  routeShortName?: string
  routeLongName?: string
  routeColor?: string
  /** « alger:ETUSA-98 » : préfixe de flux + route_id du GTFS. */
  routeId?: string
  /** « alger:ETUSA-98-dir1 » : le suffixe -dir0/-dir1 désigne le sens. */
  tripId?: string
  headsign?: string
  /** Destination en arabe (métro/tram, d'après stations.ts) — jamais traduite à la volée. */
  headsignAr?: string
  /**
   * Intervalle entre deux passages en secondes, tel qu'OTP le lit dans
   * frequencies.txt. Avec isNonExactFrequency, OTP compte une attente d'un
   * intervalle complet : l'heure de montée est un majorant, pas un horaire.
   */
  headway?: number
  isNonExactFrequency?: boolean
  intermediateStops?: Array<{ name: string; lat: number; lon: number; stopId?: string; nameAr?: string }>
  steps?: OtpWalkStep[]
  /**
   * Tarif de ce tronçon en DZD : fare_rules du GTFS via OTP (legProducts),
   * sinon catalogue des lignes. null = tarif inconnu. Absent sur la marche.
   */
  fareDzd?: number | null
}

export interface OtpFareProduct {
  id: string
  name?: string
  amount: { cents: number; currency?: { defaultFractionDigits?: number; currencyCode?: string } }
}

export interface OtpItinerary {
  duration: number
  startTime: number
  endTime: number
  walkTime: number
  transitTime: number
  waitingTime: number
  walkDistance: number
  transfers: number
  legs: OtpLeg[]
  /** Tarification brute d'OTP (un produit par usage de ticket). */
  fare?: { legProducts?: Array<{ legIndices: number[]; products: OtpFareProduct[] }> }
  /**
   * Tarif total en DZD, un ticket par montée (pas de correspondance tarifaire
   * entre lignes à Alger) ; le changement de branche du M1 à quai (Haï El
   * Badr) reste couvert par le même ticket. null = au moins un tronçon sans
   * tarif connu : jamais de total partiel. Absent pour un trajet à pied.
   */
  fareDzd?: number | null
  /** Vrai si l'itinéraire est entièrement à pied. */
  walkOnly?: boolean
  /** Vrai si l'itinéraire est FABRIQUÉ (mode démo, NEXT_PUBLIC_DEMO=1). */
  demo?: boolean
}

export interface OtpPlanResponse {
  plan?: {
    itineraries: OtpItinerary[]
  }
  error?: {
    id: number
    msg: string
    message?: string   // OTP 2.x error code (PATH_NOT_FOUND, LOCATION_NOT_ACCESSIBLE, etc.)
    noPath?: boolean   // OTP 1.x compat
    /** FROM_PLACE / TO_PLACE : extrémité(s) sans arrêt accessible. */
    missing?: string[]
  }
}

// ─── Heure de la recherche ───────────────────────────────────────────────────

/**
 * Moment de la recherche :
 * - 'now' (ou absent) : l'instant où la requête part — pas l'heure figée à
 *   l'ouverture du formulaire ;
 * - { date, time } : heure MURALE d'Alger (« 08:30 » = 08:30 à Alger), quel
 *   que soit le fuseau du téléphone ;
 * - Date / epoch : un instant absolu, converti en heure d'Alger.
 */
export type PlanWhen = 'now' | Date | number | { date: string; time: string }

export interface PlanQuery {
  /** YYYY-MM-DD, calendrier d'Alger. */
  date: string
  /** HH:mm sur 24 h, heure d'Alger (format accepté par OTP, sans AM/PM). */
  time: string
  /** Instant correspondant (epoch ms). */
  epoch: number
  arriveBy: boolean
  /** Vrai pour « partir maintenant ». */
  isNow: boolean
}

export function resolvePlanQuery(when: PlanWhen | undefined, arriveBy = false): PlanQuery {
  if (when !== undefined && when !== 'now') {
    if (typeof when === 'number' || when instanceof Date) {
      const epoch = typeof when === 'number' ? when : when.getTime()
      if (Number.isFinite(epoch)) {
        return { ...algiersOtpDateTime(epoch), epoch, arriveBy, isNow: false }
      }
    } else if (/^\d{4}-\d{2}-\d{2}$/.test(when.date)) {
      const m = /^(\d{1,2}):(\d{2})/.exec(when.time ?? '')
      if (m && Number(m[1]) < 24 && Number(m[2]) < 60) {
        const time = `${m[1].padStart(2, '0')}:${m[2]}`
        return { date: when.date, time, epoch: algiersToEpoch(when.date, time), arriveBy, isNow: false }
      }
    }
  }
  const epoch = Date.now()
  return { ...algiersOtpDateTime(epoch), epoch, arriveBy, isNow: true }
}

// ─── Erreurs typées ──────────────────────────────────────────────────────────

/** Échec de transport (réseau, proxy, délai) : aucune réponse exploitable d'OTP. */
export type OtpFailureKind = 'otpUnavailable' | 'timeout' | 'busy' | 'aborted'

export class OtpRequestError extends Error {
  readonly kind: OtpFailureKind
  readonly status?: number
  readonly retryAfterSec?: number
  readonly offline?: boolean
  constructor(kind: OtpFailureKind, extra: { status?: number; retryAfterSec?: number; offline?: boolean } = {}) {
    super(`OTP ${kind}${extra.status ? ` (${extra.status})` : ''}`)
    // 'AbortError' : les gardes existantes (e.name === 'AbortError') restent valables.
    this.name = kind === 'aborted' ? 'AbortError' : kind === 'timeout' ? 'TimeoutError' : 'OtpRequestError'
    this.kind = kind
    this.status = extra.status
    this.retryAfterSec = extra.retryAfterSec
    this.offline = extra.offline
  }
}

export type PlanErrorKind = 'noPath' | 'outsideArea' | 'otpUnavailable' | 'timeout' | 'busy' | 'aborted'

/**
 * Raison d'un « aucun trajet », quand OTP la donne :
 * - outOfService : rien pour CE trajet de nuit, mais des départs le matin
 *   (vérifié par une seconde requête, pas supposé) — ce n'est pas un état du
 *   réseau entier ;
 * - noTransitTimes : la date sort du calendrier GTFS ;
 * - tooFar : aucun arrêt à distance de marche d'une extrémité (voir side) ;
 * - tooClose : départ et arrivée quasi confondus ;
 * - noRoute : aucun enchaînement trouvé.
 */
export type NoPathReason = 'outOfService' | 'noTransitTimes' | 'tooFar' | 'tooClose' | 'noRoute'

export interface PlanError {
  kind: PlanErrorKind
  reason?: NoPathReason
  /** Extrémité en cause (tooFar, outsideArea). */
  side?: 'from' | 'to' | 'both'
  /** Code brut d'OTP, pour le diagnostic — jamais affiché tel quel. */
  otpCode?: string
  /** Le téléphone se déclarait hors ligne au moment de l'échec. */
  offline?: boolean
  retryAfterSec?: number
  /** Marche ≤ 60 min proposée SOUS le message (« à pied uniquement »). */
  walkFallback?: OtpItinerary
  /**
   * noRoute : lignes desservant le départ ou l'arrivée dont un seul sens est
   * relevé dans les données (oneDirection), au plus 2. L'écran le dit
   * (data_oneDirection) au lieu d'attribuer l'échec à l'heure.
   */
  oneDirectionLineIds?: string[]
}

export interface PlanSuccess {
  status: 'ok'
  /** Classées (arrivée la plus tôt d'abord), dédupliquées, au plus 4. */
  itineraries: OtpItinerary[]
  query: PlanQuery
  /** tooClose / walkOnly : seule la marche est pertinente, à dire tel quel. */
  notice?: 'tooClose' | 'walkOnly'
  /** Trajets FABRIQUÉS (mode démo explicite) : à étiqueter partout. */
  demo?: boolean
}

/**
 * Repli quand rien n'est trouvé à l'heure demandée (fenêtre de 2 h), vérifié
 * par une nouvelle requête OTP — jamais supposé :
 * - laterToday : « partir à » — premiers départs plus tard le même jour ;
 * - morning : « partir à » — rien jusqu'à minuit, premiers départs du matin ;
 * - latestArrival : « arriver avant » — trajets qui arrivent avant l'heure
 *   demandée, partis plus tôt que la fenêtre de 2 h ;
 * - firstArrival : « arriver avant » — aucune arrivée possible avant l'heure
 *   demandée : premières arrivées après elle.
 */
export type NextServiceFallback = 'laterToday' | 'morning' | 'latestArrival' | 'firstArrival'

/** Rien à l'heure demandée : trajets d'une seconde requête OTP (voir NextServiceFallback). */
export interface PlanNextService {
  status: 'nextService'
  itineraries: OtpItinerary[]
  /** La recherche initiale (celle qui n'a rien donné). */
  query: PlanQuery
  /** La recherche de repli qui a produit ces itinéraires. */
  serviceQuery: PlanQuery
  /** Jour des trajets proposés : 0 = jour demandé, 1 = lendemain. */
  dayOffset: 0 | 1
  fallback: NextServiceFallback
}

export interface PlanFailure {
  status: 'error'
  error: PlanError
  query: PlanQuery
}

export type PlanOutcome = PlanSuccess | PlanNextService | PlanFailure

export interface PlanOptions {
  /** Annulation d'une recherche devenue obsolète. */
  signal?: AbortSignal
  /** Langue de l'interface : OTP renvoie alors les noms de rue en arabe/anglais quand OSM les a. */
  locale?: Locale
  timeoutMs?: number
}

/** Phrase factuelle, traduite, pour une erreur de calcul. Vide pour une annulation. */
export function describePlanError(error: PlanError, locale: Locale = 'fr'): string {
  return error.kind === 'aborted' ? '' : itinText(locale, planErrorKey(error))
}

/** Clé de traduction (strings/itin.ts) d'une erreur, pour qui préfère t(). */
export function planErrorKey(error: PlanError): ItinKey {
  const side = error.side === 'from' ? 'From' : error.side === 'to' ? 'To' : 'Both'
  switch (error.kind) {
    case 'outsideArea': return `itin_errOutside${side}` as ItinKey
    case 'otpUnavailable': return error.offline ? 'itin_errOffline' : 'itin_errUnavailable'
    case 'timeout': return 'itin_errTimeout'
    case 'busy': return 'itin_errBusy'
    case 'aborted': return 'itin_errUnavailable'
    case 'noPath':
    default:
      switch (error.reason) {
        case 'outOfService': return 'itin_errOutOfService'
        case 'noTransitTimes': return 'itin_errNoTransitTimes'
        case 'tooFar': return `itin_errTooFar${side}` as ItinKey
        case 'tooClose': return 'itin_errTooClose'
        default: return 'itin_errNoRoute'
      }
  }
}

/** Vrai si un bouton « Réessayer » a un sens (panne passagère, pas une réponse d'OTP). */
export function isRetryablePlanError(error: PlanError): boolean {
  return error.kind === 'otpUnavailable' || error.kind === 'timeout' || error.kind === 'busy'
}

// ─── Requête ─────────────────────────────────────────────────────────────────

const isBrowserOffline = () => typeof navigator !== 'undefined' && navigator.onLine === false

/**
 * fetch avec délai max ET annulation externe, sans AbortSignal.any ni
 * AbortSignal.timeout (absents de Safari < 16/17.4 et de vieux WebView).
 */
async function fetchWithTimeout(url: string, signal: AbortSignal | undefined, timeoutMs: number): Promise<Response> {
  const ctrl = new AbortController()
  let timedOut = false
  const timer = setTimeout(() => { timedOut = true; ctrl.abort() }, timeoutMs)
  const onAbort = () => ctrl.abort()
  if (signal) {
    if (signal.aborted) ctrl.abort()
    else signal.addEventListener('abort', onAbort, { once: true })
  }
  try {
    const res = await fetch(url, { headers: { Accept: 'application/json' }, signal: ctrl.signal, cache: 'no-store' })
    // Le corps est lu dans le même délai : un flux qui stagne compte aussi.
    const body = await res.text()
    return new Response(body || null, { status: res.status, statusText: res.statusText, headers: res.headers })
  } catch (err) {
    if (signal?.aborted) throw new OtpRequestError('aborted')
    if (timedOut) throw new OtpRequestError('timeout')
    throw new OtpRequestError('otpUnavailable', { offline: isBrowserOffline() })
  } finally {
    clearTimeout(timer)
    signal?.removeEventListener('abort', onAbort)
  }
}

const coord = (c: Coordinate) => `${c.lat.toFixed(6)},${c.lon.toFixed(6)}`

/** Fenêtre de recherche ordinaire (voir requestPlan). */
const SEARCH_WINDOW_S = 7200
/**
 * Fenêtre élargie des requêtes de repli (searchItineraries), jamais de la
 * recherche ordinaire. Le proxy plafonne searchWindow à cette même valeur.
 */
const FALLBACK_WINDOW_S = 21600

async function requestPlan(
  from: Coordinate,
  to: Coordinate,
  query: PlanQuery,
  opts: PlanOptions,
  searchWindowSec: number = SEARCH_WINDOW_S,
): Promise<OtpPlanResponse> {
  const params = new URLSearchParams({
    fromPlace: coord(from),
    toPlace: coord(to),
    date: query.date,
    // HH:mm sur 24 h, heure d'Alger : « 09:00 AM » avec l'espace fine d'ICU
    // était ignoré EN SILENCE par OTP (calcul depuis l'heure courante).
    time: query.time,
    mode: 'TRANSIT,WALK',
    // 8 propositions : la déduplication en écrase la moitié (lignes en
    // fréquences), il en reste assez pour 4 rangées.
    numItineraries: '8',
    // Pas de maxWalkDistance : mesuré sans effet en OTP 2.5 (réponses
    // identiques de 500 à 100000). Le plafonnement se fait côté app.
    walkSpeed: '1.2',
    // Marcher « coûte » 4x le temps en transport. Mesuré : à 2.2 OTP renvoyait
    // des marches intégrales de 2 h en tête de liste ; à 4 elles disparaissent
    // sans perdre un seul itinéraire en transport (plateau stable 4→6).
    walkReluctance: '4',
    // Fenêtre de recherche 2 h : indispensable avec des lignes qui passent
    // toutes les 30-60 min. Mesuré : à 45 min, un bus direct dont le prochain
    // départ est dans 1 h 40 disparaît et l'écran se vide.
    searchWindow: String(Math.round(searchWindowSec)),
    // Les arrêts traversés : ils portent le « N arrêts restants » de la
    // navigation et les pastilles du tracé (planche 1i).
    showIntermediateStops: 'true',
    arriveBy: String(query.arriveBy),
    // Langue demandée à OTP. Avec 'ar', OTP renvoie en arabe les noms de rue
    // d'OSM (« نهج مرابط عثمان ») et, d'après translations.txt, les noms
    // d'arrêts et les girouettes (bus, métro, tram). page.tsx force pourtant
    // 'fr' : les rapprochements par girouette (sens d'une ligne, tracé
    // déduit) attendent le français du GTFS ; l'arabe est choisi au rendu
    // (placeName, legHeadsign).
    locale: opts.locale ?? 'fr',
  })

  const res = await fetchWithTimeout(
    `${OTP_BASE_URL}/routers/default/plan?${params}`,
    opts.signal,
    opts.timeoutMs ?? PLAN_TIMEOUT_MS,
  )

  if (!res.ok) {
    let proxyError = ''
    try { proxyError = String(((await res.json()) as { error?: string }).error ?? '') } catch { /* corps non JSON */ }
    const retryAfter = Number(res.headers.get('Retry-After')) || undefined
    if (res.status === 429 || /busy/i.test(proxyError)) {
      throw new OtpRequestError('busy', { status: res.status, retryAfterSec: retryAfter })
    }
    if (res.status === 504 || /timeout/i.test(proxyError)) throw new OtpRequestError('timeout', { status: res.status })
    throw new OtpRequestError('otpUnavailable', { status: res.status, offline: isBrowserOffline() })
  }

  try {
    return (await res.json()) as OtpPlanResponse
  } catch {
    throw new OtpRequestError('otpUnavailable', { status: res.status })
  }
}

/**
 * Appel OTP + post-traitement (noms arabes, tarifs, dédup, classement).
 * Compatibilité : l'erreur OTP est renvoyée telle quelle dans `error` ; une
 * marche seule de plus d'une heure n'est jamais renvoyée comme « plan » quand
 * OTP signale une erreur ou ne trouve aucun transport.
 * Les échecs réseau lèvent une OtpRequestError typée (kind).
 * Préférer searchItineraries, qui renvoie un résultat déjà qualifié.
 */
export async function planTrip(
  from: Coordinate,
  to: Coordinate,
  when?: PlanWhen,
  arriveBy = false,
  opts: PlanOptions = {},
): Promise<OtpPlanResponse> {
  const query = resolvePlanQuery(when, arriveBy)
  const data = await requestPlan(from, to, query, opts)
  const verdict = classifyResponse(data, from, to, query)
  if (data.plan) {
    data.plan.itineraries = verdict.status === 'ok'
      ? verdict.itineraries
      : verdict.error.walkFallback ? [verdict.error.walkFallback] : []
  }
  return data
}

/**
 * Recherche complète, sans jamais lever d'exception : un résultat qualifié que
 * l'écran n'a plus qu'à afficher.
 * - Aucun transport, mais une marche ≤ 60 min faisable tout de suite : c'est
 *   LA réponse (« à pied uniquement »), à l'heure demandée — jamais décalée au
 *   premier départ du matin.
 * - Rien dans la fenêtre de 2 h : requêtes de repli (findNextService) ; s'il
 *   y a des trajets, statut 'nextService' avec le type de repli.
 * - OTP injoignable : erreur typée, JAMAIS de trajet fabriqué (sauf mode démo
 *   explicite NEXT_PUBLIC_DEMO=1, étiqueté demo).
 */
export async function searchItineraries(
  from: Coordinate,
  to: Coordinate,
  opts: PlanOptions & { when?: PlanWhen; arriveBy?: boolean; nightFallback?: boolean } = {},
): Promise<PlanOutcome> {
  const query = resolvePlanQuery(opts.when, opts.arriveBy ?? false)

  let data: OtpPlanResponse
  try {
    data = await requestPlan(from, to, query, opts)
  } catch (err) {
    const error = failureToPlanError(err)
    if (isDemoEnabled() && (error.kind === 'otpUnavailable' || error.kind === 'timeout')) {
      const mock = mockPlanTrip(from, to, query)
      return { status: 'ok', itineraries: mock.plan?.itineraries ?? [], query, demo: true }
    }
    return { status: 'error', error, query }
  }

  const verdict = classifyResponse(data, from, to, query)
  if (verdict.status === 'ok') return { ...verdict, query }

  const noRoute = verdict.error.kind === 'noPath' && verdict.error.reason === 'noRoute'
  // Une marche de 60 min au plus, faisable dès maintenant, bat tout départ
  // plus tardif : on la donne à l'heure demandée, sans repli ni badge.
  if (noRoute && verdict.error.walkFallback) {
    return { status: 'ok', itineraries: [verdict.error.walkFallback], notice: 'walkOnly', query }
  }
  if (!noRoute || opts.nightFallback === false) {
    return { status: 'error', error: withOneDirectionLines(verdict.error, from, to), query }
  }

  // Requêtes de repli : elles seules permettent de dire « plus tard » ou
  // « demain matin » plutôt que « pas de chemin » — sinon ce serait supposé.
  let hit: NextServiceHit | null
  try {
    hit = await findNextService(from, to, query, opts)
  } catch (err) {
    // Repli injoignable (panne, délai, limite de débit) : la recherche n'a
    // pas pu aller au bout. On rend CET échec, réessayable — pas « aucun
    // trajet dans nos données », qui n'est pas vérifié. Rien d'inventé.
    return { status: 'error', error: failureToPlanError(err), query }
  }
  if (!hit) return { status: 'error', error: withOneDirectionLines(verdict.error, from, to), query }
  return { status: 'nextService', query, ...hit }
}

function failureToPlanError(err: unknown): PlanError {
  if (err instanceof OtpRequestError) {
    return { kind: err.kind, offline: err.offline, retryAfterSec: err.retryAfterSec }
  }
  if (err instanceof Error && err.name === 'AbortError') return { kind: 'aborted' }
  return { kind: 'otpUnavailable', offline: isBrowserOffline() }
}

// ─── Replis : plus tard, demain matin, arrivées possibles ────────────────────
// Premier service : 04:30 + fenêtre couvre les premiers métros (05:00), trams
// (05:30) et bus (05:40–07:00). Une requête de repli cherche sur 6 h au plus
// (plafond du proxy) ; le reste du jour est couvert par fenêtres successives.

const MORNING_SEARCH = '04:30'
const MORNING_MIN = 4 * 60 + 30
const END_OF_DAY = '23:59'

interface NextServiceHit {
  itineraries: OtpItinerary[]
  serviceQuery: PlanQuery
  dayOffset: 0 | 1
  fallback: NextServiceFallback
}

const queryAt = (epoch: number, arriveBy: boolean): PlanQuery =>
  ({ ...algiersOtpDateTime(epoch), epoch, arriveBy, isNow: false })

const morningQuery = (date: string): PlanQuery =>
  ({ date, time: MORNING_SEARCH, epoch: algiersToEpoch(date, MORNING_SEARCH), arriveBy: false, isNow: false })

/**
 * Cascade de replis après un noRoute (les échecs réseau sont levés, l'appelant
 * rend alors l'erreur d'origine) :
 * - « partir à », avant 04:30 : premiers départs du matin même ;
 * - « partir à », sinon : premiers départs plus tard le même jour (jusqu'à
 *   23:59), sinon demain matin. Le lendemain est interrogé D'ABORD : sans
 *   rien demain matin non plus, inutile de balayer la journée (lignes à sens
 *   unique, arrêts non desservis) ;
 * - « arriver avant » : trajets partis plus tôt que la fenêtre de 2 h (sans
 *   remonter avant 04:30 le même jour), sinon premières arrivées après
 *   l'heure demandée, le jour même ou le lendemain.
 * Seuls des trajets en transport sont gardés : une marche ne se décale jamais.
 * null = rien trouvé (l'appelant garde l'erreur d'origine).
 */
async function findNextService(
  from: Coordinate,
  to: Coordinate,
  query: PlanQuery,
  opts: PlanOptions,
): Promise<NextServiceHit | null> {
  const T = query.epoch
  const minutes = algiersParts(T).minutesOfDay
  const dayStart = algiersToEpoch(query.date, MORNING_SEARCH)
  const dayEnd = algiersToEpoch(query.date, END_OF_DAY)

  const transitFor = async (q: PlanQuery, windowSec: number, keep: (it: OtpItinerary) => boolean = () => true) => {
    const data = await requestPlan(from, to, q, opts, Math.min(FALLBACK_WINDOW_S, Math.max(60, Math.round(windowSec))))
    const verdict = classifyResponse(data, from, to, q)
    if (verdict.status !== 'ok') return null
    const kept = verdict.itineraries.filter((it) => !it.walkOnly && keep(it))
    return kept.length ? kept : null
  }
  /** « Partir à » sur [start, dayEnd], par fenêtres de 6 h au plus ; première fenêtre qui donne un trajet. */
  const scanDay = async (start: number, keep?: (it: OtpItinerary) => boolean) => {
    let cursor = start
    while (cursor < dayEnd) {
      const windowSec = Math.min(FALLBACK_WINDOW_S, (dayEnd - cursor) / 1000)
      const q = queryAt(cursor, false)
      const found = await transitFor(q, windowSec, keep)
      if (found) return { itineraries: found, serviceQuery: q }
      cursor += windowSec * 1000
    }
    return null
  }

  const tomorrow = morningQuery(addAlgiersDays(query.date, 1))

  if (!query.arriveBy) {
    if (minutes < MORNING_MIN) {
      const q = morningQuery(query.date)
      const found = await transitFor(q, FALLBACK_WINDOW_S)
      return found ? { itineraries: found, serviceQuery: q, dayOffset: 0, fallback: 'morning' } : null
    }
    const morning = await transitFor(tomorrow, FALLBACK_WINDOW_S)
    if (!morning) return null
    // Les 2 h suivant l'heure demandée sont déjà cherchées.
    const later = await scanDay(T + SEARCH_WINDOW_S * 1000)
    if (later) return { ...later, dayOffset: 0, fallback: 'laterToday' }
    return { itineraries: morning, serviceQuery: tomorrow, dayOffset: 1, fallback: 'morning' }
  }

  // « Arriver avant T » : la recherche initiale couvre les départs de T − 2 h à T.
  const lowerBound = minutes >= MORNING_MIN ? dayStart : T - FALLBACK_WINDOW_S * 1000
  const span = T - lowerBound
  if (span > SEARCH_WINDOW_S * 1000) {
    const q = queryAt(T, true)
    const found = await transitFor(q, Math.min(FALLBACK_WINDOW_S, span / 1000), (it) => it.endTime <= T + 60_000)
    if (found) return { itineraries: found, serviceQuery: q, dayOffset: 0, fallback: 'latestArrival' }
  }
  const arrivesAfter = (it: OtpItinerary) => it.endTime > T
  const morning = await transitFor(tomorrow, FALLBACK_WINDOW_S)
  if (!morning) return null
  // Premières arrivées après T le jour même : depuis 04:30 si la journée est
  // déjà couverte jusqu'à T, sinon à partir de T − 2 h.
  const start = minutes < MORNING_MIN || span <= FALLBACK_WINDOW_S * 1000 ? dayStart : T - SEARCH_WINDOW_S * 1000
  const sameDay = await scanDay(start, arrivesAfter)
  if (sameDay) return { ...sameDay, dayOffset: 0, fallback: 'firstArrival' }
  return { itineraries: morning, serviceQuery: tomorrow, dayOffset: 1, fallback: 'firstArrival' }
}

// ─── Lignes à sens unique ────────────────────────────────────────────────────

const ONE_DIRECTION_RADIUS_M = 800

/**
 * Lignes à un seul sens relevé (oneDirection) qui bloquent réellement le
 * trajet : au départ, l'arrêt le plus proche est le TERMINUS de l'unique sens
 * (on ne peut qu'y descendre) ; à l'arrivée, c'est son PREMIER arrêt (on ne
 * peut qu'en partir). Au plus 2 lignes.
 */
function withOneDirectionLines(error: PlanError, from: Coordinate, to: Coordinate): PlanError {
  if (error.kind !== 'noPath' || error.reason !== 'noRoute') return error
  const ids: string[] = []
  const add = (id: string) => { if (!ids.includes(id) && ids.length < 2) ids.push(id) }
  for (const near of nearbyLines(from.lat, from.lon, ONE_DIRECTION_RADIUS_M)) {
    if (near.line.oneDirection && near.direction.stops[near.direction.stops.length - 1] === near.stop) add(near.line.id)
  }
  for (const near of nearbyLines(to.lat, to.lon, ONE_DIRECTION_RADIUS_M)) {
    if (near.line.oneDirection && near.direction.stops[0] === near.stop) add(near.line.id)
  }
  return ids.length ? { ...error, oneDirectionLineIds: ids } : error
}

// ─── Qualification d'une réponse OTP ─────────────────────────────────────────

const MAX_ITINERARIES = 4
/** Marche seule gardée À CÔTÉ du transport si elle n'arrive pas plus tard et dure ≤ 90 min. */
const WALK_BESIDE_TRANSIT_MAX_S = 90 * 60
/** Marche seule présentée comme LA réponse (aucun transport, aucune erreur) : ≤ 60 min. */
const WALK_ALONE_MAX_S = 60 * 60
/** Marche proposée sous un message d'erreur : ≤ 60 min, sinon on n'en parle pas. */
const WALK_FALLBACK_MAX_S = 60 * 60
/** « Départ et arrivée presque au même endroit » : marche de moins de 400 m ou 6 min. */
const TOO_CLOSE_MAX_M = 400
const TOO_CLOSE_MAX_S = 6 * 60

type Verdict =
  | { status: 'ok'; itineraries: OtpItinerary[]; notice?: 'tooClose' | 'walkOnly' }
  | { status: 'error'; error: PlanError }

function classifyResponse(data: OtpPlanResponse, from: Coordinate, to: Coordinate, query: PlanQuery): Verdict {
  const all = normalizeItineraries(data.plan?.itineraries ?? [], from, to)
  const transit = all.filter((it) => !it.walkOnly)
  const bestWalk = all.filter((it) => it.walkOnly).sort((a, b) => a.duration - b.duration)[0]
  const code = data.error?.message
    ?? (data.error?.noPath ? 'PATH_NOT_FOUND' : undefined)
    ?? (data.error?.msg?.toLowerCase().includes('trivial distance') ? 'TOO_CLOSE' : undefined)

  // Un transport existe : l'erreur éventuelle (TOO_CLOSE…) ne compte plus.
  if (transit.length > 0) {
    return { status: 'ok', itineraries: finalizeItineraries(all, query.arriveBy) }
  }
  // TOO_CLOSE d'OTP 2.5 = WALKING_BETTER_THAN_TRANSIT : la marche bat les
  // transports, pas forcément « deux points confondus » (mesuré : 1 268 m,
  // 18 min). « Presque au même endroit » seulement pour une marche vraiment
  // courte ; sinon « à pied uniquement » (≤ 60 min), au-delà un échec ordinaire.
  if (code === 'TOO_CLOSE' && bestWalk) {
    if (bestWalk.walkDistance < TOO_CLOSE_MAX_M || bestWalk.duration < TOO_CLOSE_MAX_S) {
      return { status: 'ok', itineraries: [bestWalk], notice: 'tooClose' }
    }
    if (bestWalk.duration <= WALK_ALONE_MAX_S) {
      return { status: 'ok', itineraries: [bestWalk], notice: 'walkOnly' }
    }
    return { status: 'error', error: { kind: 'noPath', reason: 'noRoute', otpCode: code } }
  }
  if (!code && bestWalk && bestWalk.duration <= WALK_ALONE_MAX_S) {
    return { status: 'ok', itineraries: [bestWalk], notice: 'walkOnly' }
  }

  // Sinon : erreur qualifiée. Une marche de 3 h n'est jamais « le plus rapide ».
  const error = errorFromOtpCode(code, data.error?.missing)
  if (error.kind === 'noPath' && bestWalk && bestWalk.duration <= WALK_FALLBACK_MAX_S) {
    error.walkFallback = bestWalk
  }
  return { status: 'error', error }
}

function sideFromMissing(missing?: string[]): PlanError['side'] {
  const f = missing?.includes('FROM_PLACE')
  const t = missing?.includes('TO_PLACE')
  return f && t ? 'both' : f ? 'from' : t ? 'to' : undefined
}

function errorFromOtpCode(code: string | undefined, missing?: string[]): PlanError {
  const side = sideFromMissing(missing)
  switch (code) {
    case 'NO_TRANSIT_TIMES':
      return { kind: 'noPath', reason: 'noTransitTimes', otpCode: code }
    case 'LOCATION_NOT_ACCESSIBLE':
    case 'NO_STOPS_IN_RANGE':
      return { kind: 'noPath', reason: 'tooFar', side: side ?? 'both', otpCode: code }
    case 'GEOCODE_FROM_NOT_FOUND':
      return { kind: 'noPath', reason: 'tooFar', side: 'from', otpCode: code }
    case 'GEOCODE_TO_NOT_FOUND':
      return { kind: 'noPath', reason: 'tooFar', side: 'to', otpCode: code }
    case 'GEOCODE_FROM_TO_NOT_FOUND':
      return { kind: 'noPath', reason: 'tooFar', side: 'both', otpCode: code }
    case 'OUTSIDE_BOUNDS':
    case 'OUTSIDE_SERVICE_AREA':
      return { kind: 'outsideArea', side: side ?? 'both', otpCode: code }
    case 'TOO_CLOSE':
      return { kind: 'noPath', reason: 'tooClose', otpCode: code }
    case 'PROCESSING_TIMEOUT':
      return { kind: 'timeout', otpCode: code }
    case 'SYSTEM_ERROR':
      return { kind: 'otpUnavailable', otpCode: code }
    default:
      // PATH_NOT_FOUND, plan vide sans erreur, ou code inconnu.
      return { kind: 'noPath', reason: 'noRoute', otpCode: code }
  }
}

// ─── Post-traitement ─────────────────────────────────────────────────────────

const isWalkOnly = (it: OtpItinerary) => it.legs.every((leg) => leg.mode === 'WALK')

function normalizeItineraries(itineraries: OtpItinerary[], from: Coordinate, to: Coordinate): OtpItinerary[] {
  for (const it of itineraries) {
    it.walkOnly = isWalkOnly(it)
    localizeStops(it)
    annotateFares(it)
  }
  nameEndpoints(itineraries, from, to)
  return itineraries
}

/** Dédup, marche seule inutile écartée, classement, 4 rangées au plus. */
function finalizeItineraries(itineraries: OtpItinerary[], arriveBy: boolean): OtpItinerary[] {
  const deduped = dedupeItineraries(itineraries, arriveBy)
  return rankItineraries(hideUselessWalkOnly(deduped, arriveBy), arriveBy).slice(0, MAX_ITINERARIES)
}

/**
 * OTP nomme « Origin » et « Destination » les extrémités d'un trajet quand ce
 * sont des coordonnées libres et non des arrêts. Ces deux mots anglais
 * apparaissaient tels quels dans le détail d'itinéraire et dans la navigation.
 * On leur redonne le nom que l'usager a saisi — corrigé ici, à la source, pour
 * que tous les écrans en profitent.
 */
function nameEndpoints(itineraries: OtpItinerary[], from: Coordinate, to: Coordinate) {
  for (const itinerary of itineraries) {
    const first = itinerary.legs[0]
    const last = itinerary.legs[itinerary.legs.length - 1]
    if (first && from.name && isGenericPlaceName(first.from.name)) first.from.name = from.name
    if (last && to.name && isGenericPlaceName(last.to.name)) last.to.name = to.name
  }
}

function isGenericPlaceName(name: string | undefined): boolean {
  if (!name) return true
  return name === 'Origin' || name === 'Destination'
}

// Noms arabes : stations métro/tram (stations.ts) et, pour les bus, le name:ar
// OSM du même nœud et les girouettes arabes de translations.txt
// (generated-lines.json). On n'invente rien, on ne translittère rien : sans
// nom arabe sourcé, le nom d'origine reste affiché. name et headsign ne sont
// JAMAIS écrasés — ils servent de clés ailleurs (isDeducedShape, tracés). Le
// choix de langue se fait au rendu (placeName, legHeadsign).
let stationByStopId: Map<string, Station> | null = null

function stationForStopId(stopId?: string): Station | undefined {
  if (!stopId) return undefined
  if (!stationByStopId) stationByStopId = new Map(allStations.map((s) => [s.id, s]))
  return stationByStopId.get(stopId.split(':').pop() ?? '')
}

function arabicStopName(stopId?: string): string | undefined {
  return stationForStopId(stopId)?.nameAr ?? stopById(stopId)?.nameAr
}

function localizeStops(it: OtpItinerary) {
  for (const leg of it.legs) {
    const fromAr = arabicStopName(leg.from.stopId)
    if (fromAr) leg.from.nameAr = fromAr
    const toAr = arabicStopName(leg.to.stopId)
    if (toAr) leg.to.nameAr = toAr
    for (const stop of leg.intermediateStops ?? []) {
      const ar = arabicStopName(stop.stopId)
      if (ar) stop.nameAr = ar
    }
    if (leg.mode === 'BUS' && leg.headsign) {
      // Girouette française du GTFS (OTP interrogé en « fr ») → arabe sourcé.
      const ar = legHeadsignLabel(leg.routeShortName, leg.headsign, 'ar')
      if (ar !== leg.headsign) leg.headsignAr = ar
    }
    if ((leg.mode === 'SUBWAY' || leg.mode === 'TRAM') && leg.headsign) {
      const type = leg.mode === 'SUBWAY' ? 'metro' : 'tram'
      const key = stationNameKey(leg.headsign)
      const terminus = allStations.find((s) => s.type === type && s.name === leg.headsign)
        ?? allStations.find((s) => s.type === type && stationNameKey(s.name) === key)
      if (terminus?.nameAr) leg.headsignAr = terminus.nameAr
    }
  }
}

// Le headsign d'OTP est le nom du terminus dans le GTFS chargé ; il peut
// différer de stations.ts par la ponctuation ou l'article pendant une mise à
// jour des données (« Harrach Centre » / « El Harrach Centre »,
// « Tafourah Grande Poste » / « Tafourah - Grande Poste »).
function stationNameKey(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/^(el|al)\s+/, '')
    .replace(/[^a-z0-9]/g, '')
}

/** Nom d'un arrêt ou d'un lieu dans la langue de l'interface (arabe seulement s'il est sourcé). */
export function placeName(place: { name: string; nameAr?: string }, locale: Locale): string {
  return locale === 'ar' && place.nameAr ? place.nameAr : place.name
}

/** Destination affichée d'un tronçon (« direction … »), dans la langue de l'interface. */
export function legHeadsign(leg: OtpLeg, locale: Locale): string | undefined {
  return locale === 'ar' && leg.headsignAr ? leg.headsignAr : leg.headsign
}

// ─── Tarifs ──────────────────────────────────────────────────────────────────
// Source unique pour la liste ET le détail : les fare_rules du GTFS, telles
// qu'OTP les applique (legProducts, un produit par ticket). Repli sur le
// catalogue des lignes (mêmes fare_rules, embarquées) quand OTP n'en donne pas.

let fareByLineKey: Map<string, number> | null = null

function catalogFare(leg: OtpLeg): number | null {
  if (!fareByLineKey) {
    fareByLineKey = new Map()
    for (const line of allLines) {
      const price = line.fare ? parseInt(line.fare, 10) : NaN
      if (Number.isNaN(price)) continue
      fareByLineKey.set(`id:${line.id}`, price)
      fareByLineKey.set(`short:${line.shortName}`, price)
    }
  }
  const routeId = leg.routeId?.split(':').pop()
  return (routeId ? fareByLineKey.get(`id:${routeId}`) : undefined)
    ?? (leg.routeShortName ? fareByLineKey.get(`short:${leg.routeShortName}`) : undefined)
    ?? null
}

function annotateFares(it: OtpItinerary) {
  const fromOtp = new Map<number, number>()
  for (const entry of it.fare?.legProducts ?? []) {
    const product = entry.products?.[0]
    if (!product || !entry.legIndices?.length) continue
    const digits = product.amount.currency?.defaultFractionDigits ?? 2
    const amount = product.amount.cents / 10 ** digits
    // Un produit qui couvrirait plusieurs tronçons est compté une seule fois.
    entry.legIndices.forEach((index, k) => {
      fromOtp.set(index, (fromOtp.get(index) ?? 0) + (k === 0 ? amount : 0))
    })
  }
  let previous: OtpLeg | null = null
  it.legs.forEach((leg, index) => {
    if (leg.mode === 'WALK') return
    leg.fareDzd = fromOtp.has(index) ? Math.round(fromOtp.get(index)!) : catalogFare(leg)
    // Changement de branche du M1 à quai (même station, aucun tronçon en
    // transport entre les deux, sans sortir de la zone payante) : le ticket
    // compté sur le premier tronçon couvre le second, quel que soit le
    // regroupement des legProducts par OTP. Jamais pour le bus ni le tram.
    if (previous && isMetroPlatformChange(previous, leg)) leg.fareDzd = 0
    previous = leg
  })
  it.fareDzd = itineraryFareDzd(it)
}

function isMetroPlatformChange(previous: OtpLeg, leg: OtpLeg): boolean {
  if (previous.mode !== 'SUBWAY' || leg.mode !== 'SUBWAY') return false
  const sameLine = (previous.routeId && leg.routeId && previous.routeId === leg.routeId)
    || (previous.routeShortName && previous.routeShortName === leg.routeShortName)
  return Boolean(sameLine && previous.to.stopId && previous.to.stopId === leg.from.stopId)
}

/** Tarif total en DZD ; null si un tronçon n'a pas de tarif connu, undefined si tout à pied. */
export function itineraryFareDzd(it: OtpItinerary): number | null | undefined {
  const transit = it.legs.filter((leg) => leg.mode !== 'WALK')
  if (transit.length === 0) return undefined
  let total = 0
  for (const leg of transit) {
    const fare = leg.fareDzd !== undefined ? leg.fareDzd : catalogFare(leg)
    if (fare === null) return null
    total += fare
  }
  return total
}

/** « 70 DZD » / « 70 دج » — chiffres latins, montant publié (pas d'estimation). */
export function formatFare(dzd: number, locale: Locale = 'fr'): string {
  return `${dzd} ${itinText(locale, 'itin_currency')}`
}

// ─── Dédup et classement ─────────────────────────────────────────────────────

// Pénalité de marche mesurée (au-delà de 15 min, 0,3 s par seconde de marche),
// appliquée à l'heure d'arrivée et plafonnée à 5 min : à arrivée quasi égale,
// on remonte le trajet qui fait moins marcher, mais jamais devant un trajet
// qui arrive plus de 5 min plus tôt. Le classement reste celui de l'arrivée.
const WALK_FREE_S = 900
const WALK_PENALTY = 0.3
const WALK_PENALTY_MAX_MS = 5 * 60 * 1000

const walkPenaltyMs = (it: OtpItinerary) =>
  Math.min(WALK_PENALTY_MAX_MS, 1000 * WALK_PENALTY * Math.max(0, it.walkTime - WALK_FREE_S))

/**
 * Clé de tri : plus petit = meilleur. Mode « partir à » : arrivée (+ pénalité
 * de marche). Mode « arriver avant » : départ le plus TARDIF (− pénalité).
 */
function rankKey(it: OtpItinerary, arriveBy: boolean): number {
  return arriveBy ? -(it.startTime - walkPenaltyMs(it)) : it.endTime + walkPenaltyMs(it)
}

/** Classement : arrivée la plus tôt (ou départ le plus tard), puis correspondances, puis marche. */
export function rankItineraries(itineraries: OtpItinerary[], arriveBy = false): OtpItinerary[] {
  const minute = (ms: number) => Math.floor(ms / 60000)
  return [...itineraries].sort((a, b) => {
    const d = minute(rankKey(a, arriveBy)) - minute(rankKey(b, arriveBy))
    if (d !== 0) return d
    if (a.transfers !== b.transfers) return a.transfers - b.transfers
    if (a.walkTime !== b.walkTime) return a.walkTime - b.walkTime
    return arriveBy ? a.endTime - b.endTime : b.startTime - a.startTime
  })
}

// OTP renvoie le même trajet en plusieurs exemplaires avec les lignes en
// fréquences : mêmes lignes, mêmes sens, départs décalés. Ces heures sont des
// pas d'itération du calcul (mesuré : métro « toutes les 2 min » pour un
// intervalle de 5), PAS des départs publiés : on ne les garde pas. On conserve
// l'exemplaire le mieux classé (arrivée la plus tôt), pas le premier venu.
const isRailMode = (mode: OtpLeg['mode']) => mode === 'SUBWAY' || mode === 'TRAM' || mode === 'RAIL'

function dedupeItineraries(itineraries: OtpItinerary[], arriveBy: boolean): OtpItinerary[] {
  const kept = new Map<string, OtpItinerary>()
  const order: string[] = []
  for (const it of itineraries) {
    const signature = it.legs
      .filter((leg) => leg.mode !== 'WALK')
      // Rail : n'importe quelle rame dessert un trajet sur le tronc commun du
      // M1 (Place des Martyrs … Haï El Badr), quelle que soit sa branche :
      // l'arrêt de descente remplace la girouette. Bus : la girouette reste
      // (deux variantes de sens peuvent desservir des arrêts différents).
      .map((leg) => `${leg.mode}:${leg.routeId ?? leg.routeShortName ?? ''}:${
        isRailMode(leg.mode) ? leg.to.stopId ?? leg.headsign ?? '' : leg.headsign ?? ''}`)
      .join('>') || 'WALK_ONLY'
    const previous = kept.get(signature)
    if (!previous) {
      kept.set(signature, it)
      order.push(signature)
    } else if (rankKey(it, arriveBy) < rankKey(previous, arriveBy)) {
      kept.set(signature, it)
    }
  }
  return order.map((signature) => kept.get(signature)!)
}

// La marche intégrale n'est masquée que si elle est RÉELLEMENT moins bonne :
// un transport arrive strictement avant elle (ou, en « arriver avant », part
// strictement plus tard). Mesuré : Martyrs → 1er Mai à 13:00, marcher arrive à
// 13:47 comme le métro — la masquer privait l'usager d'un choix équivalent.
// Au-delà de 90 min de marche, on ne la propose pas à côté du transport.
function hideUselessWalkOnly(itineraries: OtpItinerary[], arriveBy: boolean): OtpItinerary[] {
  const transit = itineraries.filter((it) => !it.walkOnly)
  if (transit.length === 0) return itineraries
  const minute = (ms: number) => Math.floor(ms / 60000)
  const bestEnd = Math.min(...transit.map((it) => minute(it.endTime)))
  const bestStart = Math.max(...transit.map((it) => minute(it.startTime)))
  return itineraries.filter((it) => {
    if (!it.walkOnly) return true
    if (it.duration > WALK_BESIDE_TRANSIT_MAX_S) return false
    return arriveBy ? minute(it.startTime) >= bestStart : minute(it.endTime) <= bestEnd
  })
}

// ─── Qualificatifs des rangées ───────────────────────────────────────────────

export type ItineraryBadge = 'earliestArrival' | 'latestDeparture' | 'shortest' | 'lessWalking' | 'cheapest'

export const ITINERARY_BADGE_KEY: Record<ItineraryBadge, ItinKey> = {
  earliestArrival: 'itin_badgeEarliest',
  latestDeparture: 'itin_badgeLatest',
  shortest: 'itin_badgeShortest',
  lessWalking: 'itin_badgeLessWalking',
  cheapest: 'itin_badgeCheapest',
}

/**
 * Un qualificatif au plus par rangée, calculé sur les vraies valeurs, jamais
 * attribué par défaut : une seule rangée n'en reçoit aucun ; une égalité non
 * plus (reduce désignait arbitrairement la première).
 * - earliestArrival / latestDeparture : selon le mode demandé ;
 * - shortest : seulement si une AUTRE rangée dure ≥ 5 min de moins ;
 * - lessWalking : ≥ 5 min de marche en moins que la rangée de tête ;
 * - cheapest : tous les tarifs connus et un minimum strict.
 */
export function itineraryBadges(itineraries: OtpItinerary[], arriveBy = false): (ItineraryBadge | null)[] {
  const badges: (ItineraryBadge | null)[] = itineraries.map(() => null)
  if (itineraries.length < 2) return badges

  const uniqueBest = (score: (it: OtpItinerary) => number): number => {
    let best = -1
    let bestScore = Infinity
    let tie = false
    itineraries.forEach((it, i) => {
      const s = score(it)
      if (s < bestScore) { bestScore = s; best = i; tie = false } else if (s === bestScore) tie = true
    })
    return tie ? -1 : best
  }
  const minute = (ms: number) => Math.floor(ms / 60000)

  const primary = arriveBy
    ? uniqueBest((it) => -minute(it.startTime))
    : uniqueBest((it) => minute(it.endTime))
  if (primary >= 0) badges[primary] = arriveBy ? 'latestDeparture' : 'earliestArrival'
  const reference = itineraries[primary >= 0 ? primary : 0]

  const shortest = uniqueBest((it) => Math.round(it.duration / 60))
  if (shortest >= 0 && !badges[shortest] && reference.duration - itineraries[shortest].duration >= 300) {
    badges[shortest] = 'shortest'
  }
  const lessWalk = uniqueBest((it) => Math.round(it.walkTime / 60))
  if (lessWalk >= 0 && !badges[lessWalk] && reference.walkTime - itineraries[lessWalk].walkTime >= 300) {
    badges[lessWalk] = 'lessWalking'
  }
  const fares = itineraries.map((it) => (typeof it.fareDzd === 'number' ? it.fareDzd : null))
  if (fares.every((f) => f !== null)) {
    const cheapest = uniqueBest((it) => it.fareDzd as number)
    if (cheapest >= 0 && !badges[cheapest]) badges[cheapest] = 'cheapest'
  }
  return badges
}

// ─── Attentes estimées (fréquences) ──────────────────────────────────────────

export interface LegWait {
  /**
   * Intervalle entre deux passages (min) : celui d'OTP (frequencies.txt), ou,
   * pour des départs explicites, celui des mêmes départs du GTFS (catalogue,
   * leg-headway.ts). null hors service ou sans donnée.
   */
  headwayMin: number | null
  /** Attente comptée par le calcul avant la montée (min) : un majorant avec les fréquences. */
  waitMin: number
  /** Passage plausible entre windowStart et windowEnd (epoch ms) — à afficher avec « ~ ». */
  windowStart: number
  windowEnd: number
  source: 'frequency' | 'schedule'
}

/**
 * Attente avant un tronçon en transport. Avec une ligne en fréquence, OTP
 * suppose le pire (un intervalle complet) : l'heure de montée n'est qu'une
 * borne haute, le bus peut passer dès l'arrivée à l'arrêt.
 */
export function legWait(it: OtpItinerary, legIndex: number): LegWait | null {
  const leg = it.legs[legIndex]
  if (!leg || leg.mode === 'WALK') return null
  const atStop = legIndex > 0 ? it.legs[legIndex - 1].endTime : leg.startTime
  const frequency = Boolean(leg.isNonExactFrequency && leg.headway && leg.headway > 0)
  const headwayMs = frequency ? (leg.headway as number) * 1000 : 0
  return {
    // Départs explicites (GTFS développé) : OTP ne donne plus d'intervalle,
    // le catalogue le connaît (mêmes départs) — sinon le détail n'en dirait rien.
    headwayMin: frequency ? Math.round((leg.headway as number) / 60) : legHeadwayMin(leg),
    waitMin: Math.max(0, Math.round((leg.startTime - atStop) / 60000)),
    windowStart: frequency ? Math.max(atStop, leg.startTime - headwayMs) : leg.startTime,
    windowEnd: leg.startTime,
    source: frequency ? 'frequency' : 'schedule',
  }
}

/** « passe ~ toutes les 20 min · attente jusqu'à ~21 min » ; vide sans fréquence. */
export function legWaitLabel(wait: LegWait | null, locale: Locale = 'fr'): string {
  if (!wait || wait.headwayMin === null) return ''
  const parts = [itinText(locale, 'itin_frequencyEvery', { n: wait.headwayMin })]
  if (wait.waitMin > 0) parts.push(itinText(locale, 'itin_waitUpTo', { n: wait.waitMin }))
  return parts.join(' · ')
}

/** Attente totale comptée dans la durée de l'itinéraire (min). */
export function itineraryWaitMin(it: OtpItinerary): number {
  return Math.round((it.waitingTime ?? 0) / 60)
}

// ─── Géométrie ───────────────────────────────────────────────────────────────

// Decode Google-encoded polyline to [lon, lat] pairs for MapLibre
export function decodePolyline(encoded: string): [number, number][] {
  const coords: [number, number][] = []
  let index = 0
  let lat = 0
  let lng = 0

  while (index < encoded.length) {
    let shift = 0
    let result = 0
    let byte: number

    do {
      byte = encoded.charCodeAt(index++) - 63
      result |= (byte & 0x1f) << shift
      shift += 5
    } while (byte >= 0x20)

    const dlat = result & 1 ? ~(result >> 1) : result >> 1
    lat += dlat

    shift = 0
    result = 0

    do {
      byte = encoded.charCodeAt(index++) - 63
      result |= (byte & 0x1f) << shift
      shift += 5
    } while (byte >= 0x20)

    const dlng = result & 1 ? ~(result >> 1) : result >> 1
    lng += dlng

    coords.push([lng / 1e5, lat / 1e5])
  }

  return coords
}

/**
 * Vrai quand la géométrie d un tronçon n a manifestement pas été relevée.
 *
 * 28 des 67 directions ETUSA n ont aucune trace dans OpenStreetMap ; 9 ont pu
 * emprunter celle de leur sens inverse, les autres non. Pour celles-là, OTP
 * relie les arrêts en segments droits — ce qui a fait passer la ligne 113 par
 * la BAIE d Alger.
 *
 * On le reconnaît à un segment démesuré : une voie réellement relevée est
 * découpée tous les 50 à 150 m, alors qu une droite d arrêt à arrêt fait
 * plusieurs kilomètres. Mesuré sur ce réseau : le plus long segment d un tracé
 * OSM réel reste sous 400 m, contre 3,5 km pour le saut de la 113. Le seuil de
 * 1600 m écarte les faux positifs du rail : le métro d Alger est souterrain et
 * son tracé est fait de stations reliées — 969 m mesurés entre deux d entre
 * elles, ce qui est légitime et se lit très bien à l écran. Le saut de la 113,
 * lui, fait 3,6 km.
 */
const SCHEMATIC_SEGMENT_M = 1600

/**
 * Géométrie d un tronçon, telle qu OTP la renvoie — SANS RETOUCHE.
 *
 * ⚠️ Une version précédente ajoutait un segment de jonction entre l arrêt et la
 * voie, parce que le trait « flottait » à 80 m de la pastille de montée. C était
 * une géométrie FABRIQUÉE : à l écran, le bus faisait un angle droit à travers
 * un îlot sans voirie. Signalé par l utilisateur — « c est de la triche ».
 *
 * L écart est réel et il a un sens : la pastille marque l arrêt à sa coordonnée
 * OSM (souvent sur le trottoir, parfois à 300 m de la chaussée), le trait marque
 * la voie. Deux informations exactes, et un espace entre les deux qui dit
 * honnêtement que le point d arrêt est imprécis. Le combler reviendrait à
 * affirmer un trajet qu on ne connaît pas.
 *
 * Ne PAS réintroduire de raccord ici. Si l espace gêne, la réponse est de
 * corriger la coordonnée de l arrêt dans OpenStreetMap, pas de la maquiller.
 */
export function legCoordinates(leg: OtpLeg): [number, number][] {
  return decodePolyline(leg.legGeometry.points)
}

export function isSchematicGeometry(coords: [number, number][]): boolean {
  for (let i = 1; i < coords.length; i += 1) {
    const [lon1, lat1] = coords[i - 1]
    const [lon2, lat2] = coords[i]
    if (metersBetween(lat1, lon1, lat2, lon2) > SCHEMATIC_SEGMENT_M) return true
  }
  return false
}

// Tolérance de coïncidence sommet ↔ arrêt. Mesuré : sans tracé, chaque sommet
// renvoyé par OTP est à ≤ 1,1 m d'un arrêt ; avec un tracé relevé, des sommets
// sont à 300 m et plus des arrêts.
const STOP_VERTEX_TOLERANCE_M = 3
// Un tracé relevé très court (un seul arrêt, rue rectiligne) peut n'avoir que
// ses deux extrémités : on ne conclut que sur un tronçon d'au moins 3 arrêts
// ou avec un saut de plus de 250 m.
const STOP_TO_STOP_MIN_SEGMENT_M = 250

/**
 * Vrai quand la géométrie d'un tronçon n'est QUE des droites d'arrêt à arrêt :
 * la direction n'a pas de tracé (shape_id vide dans trips.txt — 37 dir0,
 * 72 dir0, 98 dir1, 731 dir1). Indépendant de la longueur des segments, que le
 * seuil de 1600 m ne voyait pas (98 : sauts de 586 à 878 m).
 */
export function isStopToStopGeometry(leg: OtpLeg, coords: [number, number][] = legCoordinates(leg)): boolean {
  if (coords.length < 2) return false
  const stops = [leg.from, ...(leg.intermediateStops ?? []), leg.to]
  const onStop = coords.every(([lon, lat]) =>
    stops.some((s) => metersBetween(lat, lon, s.lat, s.lon) <= STOP_VERTEX_TOLERANCE_M))
  if (!onStop) return false
  if (stops.length >= 3) return true
  for (let i = 1; i < coords.length; i += 1) {
    if (metersBetween(coords[i - 1][1], coords[i - 1][0], coords[i][1], coords[i][0]) > STOP_TO_STOP_MIN_SEGMENT_M) return true
  }
  return false
}

/** Même chose depuis un tronçon OTP, pour les écrans qui n ont que le leg. */
export function isSchematicLeg(leg: OtpLeg): boolean {
  if (leg.mode === 'WALK') return false
  // Sur la géométrie BRUTE : un segment de raccord, borné à 400 m, ne doit pas
  // être pris pour un tracé manquant.
  const coords = decodePolyline(leg.legGeometry.points)
  if (isSchematicGeometry(coords)) return true
  if (leg.mode !== 'BUS') return false
  // Bus sur un sens que les données déclarent sans tracé (shapeSource
  // 'absent', retrouvé par trip_id puis girouette) : schématique même si OTP
  // n'a renvoyé que de courts segments.
  if (isUnmappedShape(leg.routeShortName, leg.headsign, leg.tripId) === true) return true
  // Sinon, droites d'arrêt à arrêt, même courtes (sens inconnu des données,
  // graphe pas encore reconstruit). Le rail garde la seule règle des 1600 m
  // (métro souterrain relié station à station).
  return isStopToStopGeometry(leg, coords)
}

function metersBetween(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371000
  const p1 = (lat1 * Math.PI) / 180
  const p2 = (lat2 * Math.PI) / 180
  const dp = p2 - p1
  const dl = ((lon2 - lon1) * Math.PI) / 180
  const a = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(a))
}

// ─── Formats ─────────────────────────────────────────────────────────────────

/**
 * « 350 m », « 1,5 km » ; en arabe « 350 م », « 1.5 كم ». Sans locale : format
 * historique (compatibilité des écrans pas encore migrés).
 */
export function formatDistance(meters: number, locale?: Locale): string {
  const unitM = locale ? itinText(locale, 'itin_unitM') : 'm'
  const unitKm = locale ? itinText(locale, 'itin_unitKm') : 'km'
  if (meters < 1000) return `${Math.round(meters)} ${unitM}`
  const km = meters / 1000
  let value = km % 1 === 0 ? km.toFixed(0) : km.toFixed(1)
  if (locale === 'fr') value = value.replace('.', ',')
  return `${value} ${unitKm}`
}

/**
 * « 52 min », « 1 h 5 min » ; en arabe « 52 د », « 1 س 5 د » (abréviations
 * invariables : pas d'accord de nombre à gérer). Sans locale : format historique.
 */
export function formatDuration(seconds: number, locale?: Locale): string {
  if (!locale) {
    const h = Math.floor(seconds / 3600)
    const m = Math.floor((seconds % 3600) / 60)
    if (h > 0) return `${h}h ${m}min`
    return `${m} min`
  }
  const min = itinText(locale, 'itin_unitMin')
  const hour = itinText(locale, 'itin_unitHour')
  const total = Math.round(seconds / 60)
  if (total < 1) return `< 1 ${min}`
  const h = Math.floor(total / 60)
  const m = total % 60
  if (h === 0) return `${m} ${min}`
  return m === 0 ? `${h} ${hour}` : `${h} ${hour} ${m} ${min}`
}

/**
 * « 14:05 » à l'heure d'ALGER, quel que soit le fuseau du téléphone : un
 * départ à 16:30 à Alger ne s'affiche plus « 10:30 » à Montréal.
 */
export function formatTime(ms: number): string {
  return formatAlgiersTime(ms)
}

/** Libellé de la recherche : « Départ maintenant », « Départ 08:30 », « Arrivée avant 09:00 ». */
export function describePlanQuery(query: PlanQuery, locale: Locale = 'fr'): string {
  if (query.arriveBy) return itinText(locale, 'itin_arriveBy', { time: query.time })
  if (query.isNow) return itinText(locale, 'itin_departNow')
  return itinText(locale, 'itin_departAt', { time: query.time })
}

export function getLegColor(mode: OtpLeg['mode']): string {
  switch (mode) {
    case 'SUBWAY': return '#1E3A8A'
    case 'TRAM': return '#059669'
    case 'BUS': return '#D97706'
    case 'RAIL': return '#7C3AED'
    default: return '#6B7280'
  }
}

// ─── Polyline encoder (inverse of decodePolyline) ────────────────────────────
function encodeValue(value: number): string {
  let v = value < 0 ? ~(value << 1) : value << 1
  let out = ''
  while (v >= 0x20) {
    out += String.fromCharCode((0x20 | (v & 0x1f)) + 63)
    v >>= 5
  }
  return out + String.fromCharCode(v + 63)
}

export function encodePolyline(coords: [number, number][]): string {
  let prevLat = 0, prevLng = 0, out = ''
  for (const [lng, lat] of coords) {
    const la = Math.round(lat * 1e5)
    const ln = Math.round(lng * 1e5)
    out += encodeValue(la - prevLat) + encodeValue(ln - prevLng)
    prevLat = la; prevLng = ln
  }
  return out
}

// ─── Mode démo (trajets FABRIQUÉS) ───────────────────────────────────────────
// Uniquement si NEXT_PUBLIC_DEMO=1 au build (développement, démonstration sans
// OTP). Jamais en production, jamais par un paramètre d'URL (un lien partagé
// afficherait un trajet inventé), jamais quand OTP a répondu « pas de chemin ».
// Chaque itinéraire porte demo: true pour être étiqueté sur TOUS les écrans.

export function isDemoEnabled(): boolean {
  return process.env.NEXT_PUBLIC_DEMO === '1'
}

// Correspondance entre Métro L1 et Tramway L1 (positions OSM) : la station de
// métro Les Fusillés (M07) est à ~86 m de l'arrêt de tram Ruisseau (T01) ;
// l'arrêt de tram « Les Fusillés » (T02) est, lui, à ~540 m. OTP fait la même
// correspondance M07 → Ruisseau.
const TRANSFER_METRO_ID = 'M07' // Les Fusillés (Métro L1)
const TRANSFER_TRAM_ID  = 'T01' // Ruisseau (Tram L1)

/**
 * Trajet SIMULÉ. Hors mode démo, renvoie un plan vide avec l'erreur
 * DEMO_DISABLED : aucun écran ne peut plus afficher un trajet inventé.
 */
export function mockPlanTrip(from: Coordinate, to: Coordinate, when?: PlanWhen | PlanQuery): OtpPlanResponse {
  if (!isDemoEnabled()) {
    return {
      plan: { itineraries: [] },
      error: { id: 0, msg: 'Demo mode disabled', message: 'DEMO_DISABLED' },
    }
  }

  // Heures de service : 05h00–23h00, heure d'Alger.
  const SERVICE_START_H = 5
  const SERVICE_END_H   = 23
  const query: PlanQuery = isPlanQuery(when) ? when : resolvePlanQuery(when)
  const totalMinutes = algiersParts(query.epoch).minutesOfDay
  const inService = totalMinutes >= SERVICE_START_H * 60 && totalMinutes < SERVICE_END_H * 60

  let baseTime: number
  if (inService) {
    baseTime = query.epoch
  } else {
    // Prochain départ = 05h00 à Alger (le jour même avant 05h, sinon demain).
    const date = totalMinutes >= SERVICE_END_H * 60 ? addAlgiersDays(query.date, 1) : query.date
    baseTime = algiersToEpoch(date, '05:00')
  }

  const metroLine = allStations.filter((s) => s.type === 'metro')
  const tramLine  = allStations.filter((s) => s.type === 'tram')

  const nearestOfType = (c: Coordinate, type: 'metro' | 'tram'): Station => {
    const pool = type === 'metro' ? metroLine : tramLine
    return pool.reduce((best, s) => {
      const d = Math.hypot(s.lat - c.lat, s.lon - c.lon)
      return d < best.d ? { s, d } : best
    }, { s: pool[0], d: Infinity }).s
  }

  const stationAt = (c: Coordinate, type: 'metro' | 'tram'): Station =>
    (type === 'metro' ? metroLine : tramLine)
      .find((s) => Math.hypot(s.lat - c.lat, s.lon - c.lon) < 0.002)
    ?? nearestOfType(c, type)

  const closestTo = (c: Coordinate) =>
    allStations.reduce((best, s) => {
      const d = Math.hypot(s.lat - c.lat, s.lon - c.lon)
      return d < best.d ? { s, d } : best
    }, { s: allStations[0], d: Infinity }).s

  const fromType = closestTo(from).type
  const toType   = closestTo(to).type

  // Marche : distance à vol d'oiseau réelle (plus de « 120 m » forfaitaires).
  function makeWalkLeg(
    fromC: { name?: string; lat: number; lon: number },
    toC:   { name?: string; lat: number; lon: number },
    startMs: number,
  ): OtpLeg {
    const dist = Math.round(metersBetween(fromC.lat, fromC.lon, toC.lat, toC.lon))
    const dur = Math.round(dist / 1.2)
    return {
      mode: 'WALK',
      startTime: startMs,
      endTime: startMs + dur * 1000,
      duration: dur,
      distance: dist,
      from: { name: fromC.name ?? 'Départ', lat: fromC.lat, lon: fromC.lon },
      to:   { name: toC.name   ?? 'Arrivée', lat: toC.lat,  lon: toC.lon  },
      legGeometry: { points: encodePolyline([[fromC.lon, fromC.lat], [toC.lon, toC.lat]]) },
    }
  }

  function makeTransitLeg(
    mode: 'SUBWAY' | 'TRAM',
    fromS: Station,
    toS: Station,
    startMs: number,
  ): OtpLeg {
    // Parcours réel d'un sens exploité (le M1 a deux branches : jamais un
    // découpage de la liste des stations).
    const stops = fromS.id === toS.id ? [fromS] : railStationsBetween(fromS.id, toS.id)?.stations ?? [fromS, toS]
    const dur = Math.max(120, stops.length * 120)
    const coords: [number, number][] = stops.map((s) => [s.lon, s.lat])
    if (coords.length < 2) coords.push([toS.lon, toS.lat])
    return {
      mode,
      startTime: startMs,
      endTime: startMs + dur * 1000,
      duration: dur,
      distance: stops.length * 800,
      from: { name: fromS.name, nameAr: fromS.nameAr, lat: fromS.lat, lon: fromS.lon },
      to:   { name: toS.name, nameAr: toS.nameAr, lat: toS.lat,   lon: toS.lon   },
      legGeometry: { points: encodePolyline(coords) },
      routeShortName: mode === 'SUBWAY' ? 'M1' : 'T1',
      routeLongName: mode === 'SUBWAY' ? 'Métro Ligne 1' : 'Tramway Ligne 1',
      headsign: toS.name,
      intermediateStops: stops.slice(1, -1).map((s) => ({ name: s.name, nameAr: s.nameAr, lat: s.lat, lon: s.lon })),
    }
  }

  let legs: OtpLeg[]
  let t = baseTime

  if (fromType === toType) {
    const mode: 'SUBWAY' | 'TRAM' = fromType === 'metro' ? 'SUBWAY' : 'TRAM'
    const fromS = stationAt(from, fromType)
    const toS   = stationAt(to,   toType)
    const wl1 = makeWalkLeg(from, fromS, t); t += wl1.duration * 1000
    const tl  = makeTransitLeg(mode, fromS, toS, t); t += tl.duration * 1000
    const wl2 = makeWalkLeg(toS, to, t)
    legs = [wl1, tl, wl2]
  } else {
    const txMetro = allStations.find((s) => s.id === TRANSFER_METRO_ID)!
    const txTram  = allStations.find((s) => s.id === TRANSFER_TRAM_ID)!

    if (fromType === 'metro') {
      const fromS = stationAt(from, 'metro')
      const toS   = stationAt(to,   'tram')
      const wl1  = makeWalkLeg(from, fromS, t);                 t += wl1.duration  * 1000
      const ml   = makeTransitLeg('SUBWAY', fromS, txMetro, t); t += ml.duration   * 1000
      const xfer = makeWalkLeg(txMetro, txTram, t);             t += xfer.duration * 1000
      const tl   = makeTransitLeg('TRAM', txTram, toS, t);      t += tl.duration   * 1000
      const wl2  = makeWalkLeg(toS, to, t)
      legs = [wl1, ml, xfer, tl, wl2]
    } else {
      const fromS = stationAt(from, 'tram')
      const toS   = stationAt(to,   'metro')
      const wl1  = makeWalkLeg(from, fromS, t);                 t += wl1.duration  * 1000
      const tl   = makeTransitLeg('TRAM', fromS, txTram, t);    t += tl.duration   * 1000
      const xfer = makeWalkLeg(txTram, txMetro, t);             t += xfer.duration * 1000
      const ml   = makeTransitLeg('SUBWAY', txMetro, toS, t);   t += ml.duration   * 1000
      const wl2  = makeWalkLeg(toS, to, t)
      legs = [wl1, tl, xfer, ml, wl2]
    }
  }

  const startTime = legs[0].startTime
  const endTime = legs[legs.length - 1].endTime
  const itinerary: OtpItinerary = {
    duration: Math.round((endTime - startTime) / 1000),
    startTime,
    endTime,
    walkTime: legs.filter((l) => l.mode === 'WALK').reduce((s, l) => s + l.duration, 0),
    transitTime: legs.filter((l) => l.mode !== 'WALK').reduce((s, l) => s + l.duration, 0),
    waitingTime: 0,
    walkDistance: legs.filter((l) => l.mode === 'WALK').reduce((s, l) => s + l.distance, 0),
    transfers: legs.filter((l) => l.mode !== 'WALK').length - 1,
    legs,
    walkOnly: false,
    demo: true,
  }
  annotateFares(itinerary)
  return { plan: { itineraries: [itinerary] } }
}

function isPlanQuery(value: unknown): value is PlanQuery {
  return typeof value === 'object' && value !== null && !(value instanceof Date)
    && typeof (value as PlanQuery).epoch === 'number' && typeof (value as PlanQuery).isNow === 'boolean'
}

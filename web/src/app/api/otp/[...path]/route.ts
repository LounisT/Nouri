import { NextRequest, NextResponse } from 'next/server'

// Toujours exécuté à la demande : aucune mise en cache statique de Next.
export const dynamic = 'force-dynamic'

// URL OTP côté serveur — non exposée au client (pas NEXT_PUBLIC_)
const OTP_INTERNAL = process.env.OTP_INTERNAL_URL ?? 'http://localhost:8080'

const ALLOWED_PATHS = new Set(['routers/default', 'routers/default/plan'])

// Au-delà, le proxy coupe et répond 504 : le client (15 s) affiche alors
// « le calcul a pris trop de temps » au lieu d'un squelette sans fin.
const PLAN_TIMEOUT_MS = 12000
const HEALTH_TIMEOUT_MS = 5000

const NO_STORE = { 'Cache-Control': 'no-store' }

// ─── Validation des paramètres de /plan ──────────────────────────────────────
// La requête est RECONSTRUITE à partir d'une liste blanche : rien n'est relayé
// tel quel. Le graphe couvre toute l'Algérie : sans ce filtre, mode=CAR ou
// numItineraries=200&searchWindow=86400 coûtaient 3 à 11 fois une recherche
// normale sur l'unique JVM d'OTP (mesuré : 3,3 s / 300-700 Ko).

const MAX_QUERY_LENGTH = 2048
const ALLOWED_MODES = new Set(['TRANSIT', 'WALK', 'BUS', 'TRAM', 'SUBWAY', 'RAIL'])
// Jusqu'à 20 décimales : l'ancien client (encore en cache après un
// déploiement) envoie la position GPS brute (15 à 17 décimales) ; la refuser
// lui faisait afficher un trajet simulé. Longueur bornée (MAX_COORD_LENGTH).
const COORD_RE = /^(-?\d{1,2}(?:\.\d{1,20})?),(-?\d{1,3}(?:\.\d{1,20})?)$/
const MAX_COORD_LENGTH = 64
const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/
// HH:mm[:ss] sur 24 h, ou ancien format 12 h « 09:00 AM » (clients en cache).
const TIME_RE = /^(\d{1,2}):(\d{2})(?::(\d{2}))?(?:\s*([AaPp])[Mm])?$/

// Zone desservie : emprise des arrêts du GTFS (Grand Alger) élargie d'environ
// 15 km. Un point hors de cette boîte n'a aucun arrêt à distance de marche ;
// on répond comme OTP (HTTP 200 + code) sans solliciter le calculateur.
const SERVICE_AREA = { minLat: 36.45, maxLat: 37.0, minLon: 2.6, maxLon: 3.55 }

type Params = Record<string, string>

class BadParam extends Error {
  constructor(readonly param: string) { super(`Invalid parameter: ${param}`) }
}

function clampNumber(raw: string | null, min: number, max: number, fallback: number, integer: boolean, name: string): string {
  if (raw === null || raw === '') return String(fallback)
  const n = Number(raw)
  if (!Number.isFinite(n)) throw new BadParam(name)
  const v = Math.min(max, Math.max(min, integer ? Math.round(n) : n))
  return String(v)
}

function parseBool(raw: string | null, name: string): string | undefined {
  if (raw === null) return undefined
  if (raw === 'true' || raw === 'false') return raw
  throw new BadParam(name)
}

function parseCoord(raw: string | null, name: string): { lat: number; lon: number; text: string } {
  const value = raw?.trim() ?? ''
  const m = value && value.length <= MAX_COORD_LENGTH ? COORD_RE.exec(value) : null
  if (!m) throw new BadParam(name)
  // Arrondi à 6 décimales (~0,1 m) : valeur relayée normalisée, clés de
  // cache d'OTP stables. Les contrôles portent sur les mêmes valeurs arrondies.
  const lat = Number(Number(m[1]).toFixed(6))
  const lon = Number(Number(m[2]).toFixed(6))
  if (Math.abs(lat) > 90 || Math.abs(lon) > 180) throw new BadParam(name)
  return { lat, lon, text: `${lat.toFixed(6)},${lon.toFixed(6)}` }
}

function normalizeTime(raw: string): string {
  // Les espaces insécables d'ICU (U+202F, U+00A0) faisaient ignorer l'heure.
  const m = TIME_RE.exec(raw.replace(/[  ]/g, ' ').trim())
  if (!m) throw new BadParam('time')
  let h = Number(m[1])
  const min = Number(m[2])
  const ampm = m[4]?.toUpperCase()
  if (ampm) {
    if (h < 1 || h > 12) throw new BadParam('time')
    if (ampm === 'A' && h === 12) h = 0
    if (ampm === 'P' && h !== 12) h += 12
  }
  if (h > 23 || min > 59) throw new BadParam('time')
  return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`
}

function normalizeDate(raw: string): string {
  const m = DATE_RE.exec(raw.trim())
  if (!m) throw new BadParam('date')
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])]
  const check = new Date(Date.UTC(y, mo - 1, d))
  if (check.getUTCFullYear() !== y || check.getUTCMonth() !== mo - 1 || check.getUTCDate() !== d) {
    throw new BadParam('date')
  }
  return raw.trim()
}

function normalizeMode(raw: string | null): string {
  if (raw === null || raw === '') return 'TRANSIT,WALK'
  const tokens = raw.toUpperCase().split(',').map((s) => s.trim()).filter(Boolean)
  if (tokens.length === 0 || tokens.length > 6 || tokens.some((tok) => !ALLOWED_MODES.has(tok))) {
    throw new BadParam('mode')
  }
  return Array.from(new Set(tokens)).join(',')
}

function inServiceArea(p: { lat: number; lon: number }): boolean {
  return p.lat >= SERVICE_AREA.minLat && p.lat <= SERVICE_AREA.maxLat
    && p.lon >= SERVICE_AREA.minLon && p.lon <= SERVICE_AREA.maxLon
}

/** Paramètres OTP reconstruits, ou une réponse « hors zone » à renvoyer telle quelle. */
function buildPlanParams(search: URLSearchParams): { params: Params } | { outside: string[] } {
  const from = parseCoord(search.get('fromPlace'), 'fromPlace')
  const to = parseCoord(search.get('toPlace'), 'toPlace')
  const outside: string[] = []
  if (!inServiceArea(from)) outside.push('FROM_PLACE')
  if (!inServiceArea(to)) outside.push('TO_PLACE')
  if (outside.length) return { outside }

  const params: Params = {
    fromPlace: from.text,
    toPlace: to.text,
    mode: normalizeMode(search.get('mode')),
    numItineraries: clampNumber(search.get('numItineraries'), 1, 8, 8, true, 'numItineraries'),
    // 7200 s pour la recherche ordinaire ; jusqu'à 21600 s (6 h) pour les
    // requêtes de repli du client (« plus tard aujourd'hui », « arriver
    // avant » : searchItineraries). Mesuré : ~1,5 fois le coût d'une
    // recherche de 2 h (0,2-0,3 s contre 0,15-0,2 s), loin des 24-48 h
    // (3 à 14 fois) qui ont motivé ce plafond.
    searchWindow: clampNumber(search.get('searchWindow'), 60, 21600, 7200, true, 'searchWindow'),
    walkSpeed: clampNumber(search.get('walkSpeed'), 0.5, 2, 1.2, false, 'walkSpeed'),
    walkReluctance: clampNumber(search.get('walkReluctance'), 1, 10, 4, false, 'walkReluctance'),
  }
  const date = search.get('date')
  if (date) params.date = normalizeDate(date)
  const time = search.get('time')
  if (time) {
    params.time = normalizeTime(time)
    // Mesuré : OTP 2.5 répond SYSTEM_ERROR à une heure sans date. On complète
    // avec la date du jour à Alger (UTC+1 fixe).
    if (!params.date) params.date = new Date(Date.now() + 3600000).toISOString().slice(0, 10)
  }
  const arriveBy = parseBool(search.get('arriveBy'), 'arriveBy')
  if (arriveBy) params.arriveBy = arriveBy
  const showStops = parseBool(search.get('showIntermediateStops'), 'showIntermediateStops')
  if (showStops) params.showIntermediateStops = showStops
  const wheelchair = parseBool(search.get('wheelchair'), 'wheelchair')
  if (wheelchair) params.wheelchair = wheelchair
  const locale = search.get('locale')
  params.locale = locale === 'ar' || locale === 'en' ? locale : 'fr'
  // pageCursor n'est PAS relayé : le curseur d'OTP est un simple base64 qui
  // porte sa propre fenêtre (« 48h » forgé = calcul 10 à 14 fois plus cher)
  // et contournait le plafond de searchWindow. Le client ne pagine jamais.
  // Tout autre paramètre (cache-busters, pageCursor compris) est ignoré, sans erreur :
  // un client resté en cache ne doit pas être cassé par un champ en trop.
  return { params }
}

// ─── Limitation de débit (mémoire du processus) ──────────────────────────────
// Seau à jetons par IP. Généreux : les opérateurs mobiles algériens partagent
// une même IP publique entre de nombreux abonnés (CGNAT). L'IP vient de
// X-Forwarded-For, que Caddy réécrit (il ignore celui du client non approuvé) :
// on prend la DERNIÈRE valeur, celle ajoutée par le proxy le plus proche.

interface Bucket { tokens: number; updated: number }

const LIMITS = {
  plan: { capacity: 30, refillPerSec: 1 },      // rafale de 30, puis 60/min
  // Sonde de santé : très peu coûteuse (index du routeur), et sous CGNAT des
  // centaines d'abonnés partagent une IP — un 429 y passait pour une panne.
  // Le client traite d'ailleurs un 429 comme « état inconnu » (otp.ts).
  health: { capacity: 120, refillPerSec: 2 },   // rafale de 120, puis 120/min
}
const buckets = new Map<string, Bucket>()
const MAX_BUCKETS = 20000

function clientIp(req: NextRequest): string {
  const xff = req.headers.get('x-forwarded-for')
  if (xff) {
    const parts = xff.split(',').map((s) => s.trim()).filter(Boolean)
    if (parts.length) return parts[parts.length - 1]
  }
  return req.headers.get('x-real-ip')?.trim() || 'local'
}

/** 0 si la requête passe, sinon le délai (s) avant le prochain jeton. */
function takeToken(kind: keyof typeof LIMITS, ip: string): number {
  const { capacity, refillPerSec } = LIMITS[kind]
  const key = `${kind}:${ip}`
  const now = Date.now()
  let bucket = buckets.get(key)
  if (!bucket) {
    if (buckets.size >= MAX_BUCKETS) pruneBuckets(now)
    bucket = { tokens: capacity, updated: now }
    buckets.set(key, bucket)
  }
  bucket.tokens = Math.min(capacity, bucket.tokens + ((now - bucket.updated) / 1000) * refillPerSec)
  bucket.updated = now
  if (bucket.tokens >= 1) {
    bucket.tokens -= 1
    return 0
  }
  return Math.max(1, Math.ceil((1 - bucket.tokens) / refillPerSec))
}

function pruneBuckets(now: number) {
  // Un seau plein depuis plus de 2 min n'apporte rien : on l'oublie.
  buckets.forEach((bucket, key) => {
    if (now - bucket.updated > 120000) buckets.delete(key)
  })
  if (buckets.size >= MAX_BUCKETS) buckets.clear()
}

// ─── Concurrence vers OTP ────────────────────────────────────────────────────
// Une seule JVM : au-delà de quelques calculs simultanés, tout le monde attend.
// On file les suivants quelques secondes, puis on répond 503 « busy ».
const MAX_IN_FLIGHT = 6
const QUEUE_WAIT_MS = 5000
let inFlight = 0
const waiters: Array<() => void> = []

async function acquireSlot(): Promise<boolean> {
  if (inFlight < MAX_IN_FLIGHT) {
    inFlight += 1
    return true
  }
  return new Promise<boolean>((resolve) => {
    const grant = () => { clearTimeout(timer); inFlight += 1; resolve(true) }
    const timer = setTimeout(() => {
      const i = waiters.indexOf(grant)
      if (i >= 0) waiters.splice(i, 1)
      resolve(false)
    }, QUEUE_WAIT_MS)
    waiters.push(grant)
  })
}

function releaseSlot() {
  inFlight = Math.max(0, inFlight - 1)
  const next = waiters.shift()
  if (next) next()
}

// ─── Handler ─────────────────────────────────────────────────────────────────

function json(body: unknown, status: number, headers: Record<string, string> = {}) {
  return NextResponse.json(body, { status, headers: { ...NO_STORE, ...headers } })
}

async function fetchUpstream(target: string, timeoutMs: number): Promise<Response> {
  return fetch(target, {
    headers: { Accept: 'application/json' },
    // Pas de Data Cache Next : chaque réponse (~150 Ko) était écrite sur disque
    // sans éviction, pour un taux de succès quasi nul (clé à la minute près).
    cache: 'no-store',
    signal: AbortSignal.timeout(timeoutMs),
  })
}

function upstreamFailure(err: unknown) {
  const name = (err as Error | undefined)?.name
  if (name === 'TimeoutError' || name === 'AbortError') {
    return json({ error: 'OTP timeout' }, 504)
  }
  return json({ error: 'OTP unavailable' }, 503)
}

export async function GET(
  req: NextRequest,
  { params }: { params: { path: string[] } }
) {
  const path = params.path.join('/')
  // Liste blanche : seuls les endpoints utilisés par le front sont relayés
  // (évite l'accès à d'autres routes OTP et toute traversée de chemin).
  if (!ALLOWED_PATHS.has(path)) {
    return json({ error: 'Not found' }, 404)
  }

  const ip = clientIp(req)

  // Sonde de santé : jamais servie depuis un cache (sinon OTP paraît en ligne
  // alors qu'il ne l'est pas), réponse réduite aux champs utiles.
  if (path === 'routers/default') {
    const wait = takeToken('health', ip)
    if (wait) return json({ error: 'Too many requests' }, 429, { 'Retry-After': String(wait) })
    try {
      const res = await fetchUpstream(`${OTP_INTERNAL}/otp/routers/default`, HEALTH_TIMEOUT_MS)
      if (!res.ok) return json({ error: 'OTP unavailable' }, 503)
      const data = await res.json() as Record<string, unknown>
      return json({
        routerId: data.routerId,
        buildTime: data.buildTime,
        transitServiceStarts: data.transitServiceStarts,
        transitServiceEnds: data.transitServiceEnds,
        transitModes: data.transitModes,
      }, 200)
    } catch (err) {
      return upstreamFailure(err)
    }
  }

  // /plan
  if (req.nextUrl.search.length > MAX_QUERY_LENGTH) {
    return json({ error: 'Query too long' }, 414)
  }
  let built: ReturnType<typeof buildPlanParams>
  try {
    built = buildPlanParams(req.nextUrl.searchParams)
  } catch (err) {
    if (err instanceof BadParam) return json({ error: 'Invalid parameter', param: err.param }, 400)
    throw err
  }
  if ('outside' in built) {
    // Même forme qu'une erreur OTP : le client la qualifie (« hors zone »).
    return json({
      error: {
        id: 4001,
        message: 'OUTSIDE_SERVICE_AREA',
        msg: 'The location is outside the area served by this planner.',
        missing: built.outside,
      },
    }, 200)
  }

  const wait = takeToken('plan', ip)
  if (wait) return json({ error: 'Too many requests' }, 429, { 'Retry-After': String(wait) })

  if (!(await acquireSlot())) {
    return json({ error: 'OTP busy' }, 503, { 'Retry-After': '3' })
  }
  try {
    const target = `${OTP_INTERNAL}/otp/routers/default/plan?${new URLSearchParams(built.params)}`
    const res = await fetchUpstream(target, PLAN_TIMEOUT_MS)
    const data = await res.text()
    return new NextResponse(data, {
      status: res.status,
      headers: {
        'Content-Type': 'application/json',
        // Réponse propre à une requête (coordonnées, minute) : cache du seul
        // navigateur, court ; jamais pour une erreur.
        'Cache-Control': res.ok ? 'private, max-age=30' : 'no-store',
      },
    })
  } catch (err) {
    return upstreamFailure(err)
  } finally {
    releaseSlot()
  }
}

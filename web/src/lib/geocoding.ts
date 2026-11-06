import { allStations } from './stations'
import { busLines, lineStopName } from './lines'
import type { Locale } from './i18n'
import { getStationName } from './stations'
import { itinText } from './strings/itin'

export interface PlaceResult {
  id: string
  name: string      // nom court (ex: "Rue Didouche Mourad")
  fullName: string  // nom complet (ex: "Rue Didouche Mourad, Hussein Dey, Alger")
  lat: number
  lon: number
  kind: 'station' | 'address'
  stationId?: string
  stationType?: 'metro' | 'tram'
}

// ─── Normalisation (recherche locale) ────────────────────────────────────────
// Latin : minuscules, sans accents. Arabe : sans voyelles brèves ni tatweel,
// hamzas et alif madda ramenés à ا, ة → ه, ى → ي, article « ال » retiré en
// tête de mot. « المطار » trouve alors « مطار », « ساحة » trouve « ساحه ».
function normalize(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[ً-ٰٟـ]/g, '')
    .replace(/[آأإٱ]/g, 'ا')
    .replace(/ة/g, 'ه')
    .replace(/ى/g, 'ي')
    .split(/\s+/)
    .map((word) => (word.length > 3 && word.startsWith('ال') ? word.slice(2) : word))
    .join(' ')
    .trim()
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

// ─── Index des arrêts de bus ─────────────────────────────────────────────────
// Sans lui, chercher « Vieux Kouba » ne renvoyait qu'un point Photon situé à
// 1,7 km de l'arrêt réel : OTP rabattait alors 47 min à pied vers le réseau.
// Un arrêt réel dans la liste = un itinéraire juste.
interface BusStopEntry {
  key: string
  name: string
  nameAr?: string
  norm: string
  lat: number
  lon: number
  lines: Set<string>
}

let busStopIndex: BusStopEntry[] | null = null

// Regroupement : même nom ET moins de 200 m (les deux trottoirs d'un même
// arrêt, ou 11 paires d'arrêts homonymes à moins de 10 m). Les homonymes
// éloignés (« Place des Martyrs » à Réghaïa, « El Alia » à 14,8 km) restent
// distincts — l'ancienne clé toFixed(3) coupait aussi des trottoirs voisins.
const SAME_STOP_M = 200

function getBusStopIndex(): BusStopEntry[] {
  if (busStopIndex) return busStopIndex

  const byName = new Map<string, BusStopEntry[]>()
  const entries: BusStopEntry[] = []
  for (const line of busLines) {
    for (const direction of line.directions) {
      for (const stop of direction.stops) {
        const nameKey = stop.name.toLowerCase()
        const group = byName.get(nameKey) ?? []
        const entry = group.find((e) => metersBetween(e.lat, e.lon, stop.lat, stop.lon) < SAME_STOP_M)
        if (entry) {
          entry.lines.add(line.shortName)
          if (!entry.nameAr && stop.nameAr) entry.nameAr = stop.nameAr
          continue
        }
        const created: BusStopEntry = {
          key: `${nameKey}|${stop.lat.toFixed(4)},${stop.lon.toFixed(4)}`,
          name: stop.name,
          nameAr: stop.nameAr,
          norm: normalize([stop.name, stop.nameAr].filter(Boolean).join(' ')),
          lat: stop.lat,
          lon: stop.lon,
          lines: new Set([line.shortName]),
        }
        group.push(created)
        byName.set(nameKey, group)
        entries.push(created)
      }
    }
  }

  busStopIndex = entries
  return busStopIndex
}

function searchBusStopsLocal(query: string, locale: Locale): PlaceResult[] {
  const q = normalize(query)
  if (!q) return []
  const busWord = itinText(locale, 'itin_geoBus')

  return getBusStopIndex()
    .filter((stop) => stop.norm.includes(q))
    // Un nom qui commence par la recherche est plus pertinent qu'une inclusion.
    .sort((a, b) => {
      const aStarts = a.norm.startsWith(q) ? 0 : 1
      const bStarts = b.norm.startsWith(q) ? 0 : 1
      if (aStarts !== bStarts) return aStarts - bStarts
      return b.lines.size - a.lines.size
    })
    .slice(0, 4)
    .map((stop) => {
      // Les numéros de ligne distinguent aussi les homonymes éloignés.
      const refs = Array.from(stop.lines).slice(0, 3).join(' · ')
      const name = lineStopName({ name: stop.name, nameAr: stop.nameAr, lat: stop.lat, lon: stop.lon }, locale)
      return {
        id: `busstop-${stop.key}`,
        name,
        fullName: `${name} — ${busWord} ${refs}`,
        lat: stop.lat,
        lon: stop.lon,
        kind: 'station' as const,
      }
    })
}

// ─── Recherche locale dans les stations métro/tram ───────────────────────────
function searchStationsLocal(query: string, locale: Locale): PlaceResult[] {
  const q = normalize(query)
  if (!q) return []
  return allStations
    .filter((s) => normalize([s.name, s.nameAr].filter(Boolean).join(' ')).includes(q))
    .slice(0, 4)
    .map((s) => ({
      id: `station-${s.id}`,
      name: getStationName(s, locale),
      fullName: `${getStationName(s, locale)} — ${itinText(locale, s.type === 'metro' ? 'itin_geoMetro' : 'itin_geoTram')}`,
      lat: s.lat,
      lon: s.lon,
      kind: 'station' as const,
      stationId: s.id,
      stationType: s.type,
    }))
}

/**
 * Résultats locaux (stations puis arrêts de bus), SYNCHRONES : à afficher à
 * chaque frappe, sans attendre le réseau. Les adresses arrivent ensuite.
 */
export function searchLocal(query: string, locale: Locale = 'fr'): PlaceResult[] {
  if (query.trim().length < 2) return []
  return [...searchStationsLocal(query, locale), ...searchBusStopsLocal(query, locale)]
}

// ─── Cache sessionStorage (TTL 5min) ─────────────────────────────────────────
const CACHE_TTL = 5 * 60 * 1000
// v2 : clés par langue ; les anciennes entrées (noms de rue à la place des
// lieux) ne sont plus relues.
const CACHE_PREFIX = 'photon:v2:'

function getCached(key: string): PlaceResult[] | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = sessionStorage.getItem(`${CACHE_PREFIX}${key}`)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed.ts !== 'number' || !Array.isArray(parsed.results)) {
      return null
    }
    if (Date.now() - parsed.ts > CACHE_TTL) return null
    return parsed.results
  } catch {
    return null
  }
}

function setCached(key: string, results: PlaceResult[]) {
  if (typeof window === 'undefined') return
  try {
    sessionStorage.setItem(`${CACHE_PREFIX}${key}`, JSON.stringify({ results, ts: Date.now() }))
  } catch (err) {
    // Silencieusement ignorer les erreurs (QuotaExceededError en incognito, etc.)
    if (!(err instanceof Error && err.name === 'QuotaExceededError')) {
      console.debug('sessionStorage set failed:', err)
    }
  }
}

// ─── Requête Photon (Komoot) — autocomplete ──────────────────────────────────
interface PhotonFeature {
  geometry: { coordinates: [number, number] }
  properties: {
    osm_id: number
    osm_key?: string
    osm_value?: string
    type?: string
    name?: string
    street?: string
    housenumber?: string
    city?: string
    district?: string
    locality?: string
    country?: string
    /** [lon_min, lat_max, lon_max, lat_min] */
    extent?: [number, number, number, number]
  }
}

// Centre d'Alger (Grande Poste) : Photon classe d'abord ce qui en est proche.
const BIAS = { lat: '36.7538', lon: '3.0588' }
const PHOTON_TIMEOUT_MS = 4000

// Échangeurs et voies rapides : jamais une destination. Mesuré : « aeroport »
// proposait l'échangeur « Aéroport — Les Eucalyptus », à 6 km du terminal.
const EXCLUDED_VALUES = new Set(['motorway_junction', 'motorway', 'motorway_link', 'trunk_link', 'trunk', 'construction', 'proposed'])
// Arrêts et stations que l'index local connaît déjà (doublons à 75 m près).
const TRANSIT_VALUES = new Set(['bus_stop', 'station', 'stop', 'tram_stop', 'subway_entrance', 'platform', 'halt', 'stop_position'])

/** Rang d'affichage : lieux d'abord, puis adresses, puis rues. */
function photonClass(p: PhotonFeature['properties']): number {
  if (p.osm_key === 'highway') return p.osm_value === 'bus_stop' ? 0 : 2
  if (p.osm_key === 'place' && (p.osm_value === 'house' || p.osm_value === 'street')) return 1
  return 0
}

const ARABIC_RE = /[؀-ۿݐ-ݿﭐ-﷿ﹰ-﻿]/
const LATIN_RE = /[A-Za-zÀ-ɏ]/
const TIFINAGH_RE = /[ⴰ-⵿]/

/** Plus longue suite de jetons dans l'écriture de l'interface, ou ''. */
function scriptRun(text: string, locale: Locale): string {
  const tokens = text.split(/\s+/).filter(Boolean)
  const wanted = (tok: string) => (locale === 'ar' ? ARABIC_RE.test(tok) : LATIN_RE.test(tok))
  const neutral = (tok: string) => !ARABIC_RE.test(tok) && !LATIN_RE.test(tok) && !TIFINAGH_RE.test(tok)
  let best: string[] = []
  let current: string[] = []
  for (const tok of tokens) {
    if (wanted(tok) || (current.length > 0 && neutral(tok))) {
      current.push(tok)
    } else {
      if (current.join(' ').length > best.join(' ').length) best = current
      current = []
    }
  }
  if (current.join(' ').length > best.join(' ').length) best = current
  // Retirer une ponctuation pendante (« Place des Martyrs - »).
  while (best.length && neutral(best[best.length - 1]) && !/\d/.test(best[best.length - 1])) best.pop()
  return best.join(' ')
}

/**
 * Les noms OSM d'Algérie sont souvent multilingues dans une seule valeur :
 * séparés par des espaces (« Bab Ezzouar ⴱⴰⴱ ⵣⵡⴰⵔ باب الزوار ») ou par « ; »,
 * séparateur OSM des valeurs multiples (« Alger-Centre;الجزائر الوسطى »).
 * On garde la partie dans l'écriture de l'interface quand elle existe (c'est
 * la donnée OSM, pas une traduction) ; jamais de « ; » affiché.
 */
function pickScript(text: string | undefined, locale: Locale): string | undefined {
  if (!text) return text
  const segments = text.split(';').map((s) => s.trim()).filter(Boolean)
  let fallback: string | undefined
  for (const segment of segments) {
    const run = scriptRun(segment, locale)
    if (run) return run
    // Rien dans l'écriture voulue : le premier segment, sans le tifinagh isolé.
    if (fallback === undefined) {
      const cleaned = segment.split(/\s+/).filter((tok) => tok && !TIFINAGH_RE.test(tok)).join(' ')
      if (cleaned) fallback = cleaned
    }
  }
  return fallback ?? segments[0] ?? text
}

interface StopPoint { name: string; lat: number; lon: number }

function allStopPoints(): StopPoint[] {
  return [
    ...allStations.map((s) => ({ name: s.name, lat: s.lat, lon: s.lon })),
    ...getBusStopIndex().map((s) => ({ name: s.name, lat: s.lat, lon: s.lon })),
  ]
}

// Une grande emprise (aérodrome, campus, parc) a un centroïde sans voirie :
// celui de l'aéroport tombe sur les pistes, et OTP répondait « aucun chemin ».
// Au-delà d'1 km de diagonale, on vise l'arrêt desservi le plus proche du
// centroïde À L'INTÉRIEUR de l'emprise, et on le dit (« — arrêt X »). En deçà
// (hôpital, lycée), le centroïde reste à distance de marche de l'entrée.
const LARGE_EXTENT_M = 1000

function snapLargeArea(
  p: PhotonFeature['properties'],
  lat: number,
  lon: number,
): { lat: number; lon: number; stop?: string; areaCenter?: boolean } {
  const ext = p.extent
  if (!ext || p.osm_key === 'place' || p.osm_key === 'highway' || p.osm_key === 'boundary') return { lat, lon }
  const [minLon, maxLat, maxLon, minLat] = ext
  if (metersBetween(minLat, minLon, maxLat, maxLon) < LARGE_EXTENT_M) return { lat, lon }
  let best: StopPoint | null = null
  let bestD = Infinity
  for (const s of allStopPoints()) {
    if (s.lat < minLat || s.lat > maxLat || s.lon < minLon || s.lon > maxLon) continue
    const d = metersBetween(lat, lon, s.lat, s.lon)
    if (d < bestD) { best = s; bestD = d }
  }
  return best ? { lat: best.lat, lon: best.lon, stop: best.name } : { lat, lon, areaCenter: true }
}

function photonLang(locale: Locale): string {
  // 'ar' n'existe pas chez Photon (HTTP 400) ; 'default' renvoie le nom OSM
  // d'origine, dont on extrait la partie arabe.
  return locale === 'en' ? 'en' : locale === 'ar' ? 'default' : 'fr'
}

export type AddressStatus = 'ok' | 'empty' | 'slow' | 'unavailable'

export interface AddressSearch {
  results: PlaceResult[]
  status: AddressStatus
}

const inFlight = new Map<string, Promise<AddressSearch>>()

/**
 * Adresses et lieux Photon pour `query`. Ne lève qu'en cas d'annulation
 * (AbortError) ; un délai dépassé ou une panne donnent un statut explicite
 * (« réseau lent », « indisponible ») au lieu d'une liste qui disparaît.
 */
export async function searchAddresses(
  query: string,
  opts: { signal?: AbortSignal; locale?: Locale; timeoutMs?: number } = {},
): Promise<AddressSearch> {
  const locale = opts.locale ?? 'fr'
  const lang = photonLang(locale)
  const q = query.trim()
  if (q.length < 2) return { results: [], status: 'empty' }
  const cacheKey = `${lang}:${q.toLowerCase()}`
  const cached = getCached(cacheKey)
  if (cached) return { results: cached, status: cached.length ? 'ok' : 'empty' }

  // Deux appels identiques simultanés (frappe + temporisation) partagent la
  // même requête réseau : l'API publique de Photon demande un usage mesuré.
  let pending = inFlight.get(cacheKey)
  if (!pending) {
    pending = fetchPhoton(q, locale, lang, opts.timeoutMs ?? PHOTON_TIMEOUT_MS)
      .then((result) => {
        // Mis en cache même si l'appelant a été annulé entre-temps.
        if (result.status === 'ok' || result.status === 'empty') setCached(cacheKey, result.results)
        return result
      })
      .finally(() => { inFlight.delete(cacheKey) })
    inFlight.set(cacheKey, pending)
  }
  return raceAbort(pending, opts.signal)
}

function raceAbort<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return promise
  if (signal.aborted) return Promise.reject(abortError())
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(abortError())
    signal.addEventListener('abort', onAbort, { once: true })
    promise.then(
      (v) => { signal.removeEventListener('abort', onAbort); resolve(v) },
      (e) => { signal.removeEventListener('abort', onAbort); reject(e) },
    )
  })
}

function abortError(): Error {
  const err = new Error('Aborted')
  err.name = 'AbortError'
  return err
}

async function fetchPhoton(query: string, locale: Locale, lang: string, timeoutMs: number): Promise<AddressSearch> {
  // bbox Alger : lon_min, lat_min, lon_max, lat_max
  const params = new URLSearchParams({
    q: query,
    lang,
    limit: '10',
    bbox: '2.4,36.5,3.6,37.0',
    lat: BIAS.lat,
    lon: BIAS.lon,
  })
  params.append('osm_tag', '!highway:motorway_junction')
  params.append('osm_tag', '!highway:motorway')

  // Pas d'en-tête User-Agent : interdit ou ignoré par les navigateurs, il ne
  // ferait que déclencher une requête CORS préalable. Le Referer identifie l'app.
  const ctrl = new AbortController()
  let timedOut = false
  const timer = setTimeout(() => { timedOut = true; ctrl.abort() }, timeoutMs)
  try {
    const res = await fetch(`https://photon.komoot.io/api/?${params}`, { signal: ctrl.signal })
    if (!res.ok) return { results: [], status: 'unavailable' }
    const data = await res.json()
    if (!data || !Array.isArray(data.features)) return { results: [], status: 'unavailable' }
    const results = mapPhoton(data.features as PhotonFeature[], locale)
    return { results, status: results.length ? 'ok' : 'empty' }
  } catch {
    return { results: [], status: timedOut ? 'slow' : 'unavailable' }
  } finally {
    clearTimeout(timer)
  }
}

function mapPhoton(features: PhotonFeature[], locale: Locale): PlaceResult[] {
  const localPoints = allStopPoints()
  const mapped: (PlaceResult & { cls: number; order: number })[] = []

  features.forEach((f, order) => {
    const p = f.properties
    if (p.osm_value && EXCLUDED_VALUES.has(p.osm_value)) return
    const [lon0, lat0] = f.geometry.coordinates

    // Arrêt ou station déjà présent dans l'index local : doublon.
    if (p.osm_value && TRANSIT_VALUES.has(p.osm_value)
      && localPoints.some((s) => metersBetween(lat0, lon0, s.lat, s.lon) < 75)) return

    // Nommage : le LIEU d'abord (« Hôpital Mustapha Pacha »), pas sa rue
    // (« Rue Nouvelle ») — ce nom devient celui des extrémités du trajet.
    const ownName = pickScript(p.name, locale)
    const street = pickScript(p.street, locale)
    const district = pickScript(p.district ?? p.locality, locale)
    const city = pickScript(p.city, locale)
    const name = ownName
      || [p.housenumber, street].filter(Boolean).join(' ')
      || district
      || city
      || ''
    if (!name) return

    const snapped = snapLargeArea(p, lat0, lon0)
    const details: string[] = []
    for (const part of [
      snapped.stop ? itinText(locale, 'itin_geoStop', { stop: snapped.stop }) : undefined,
      snapped.areaCenter ? itinText(locale, 'itin_geoAreaCenter') : undefined,
      ownName ? street : undefined,
      district,
      city,
    ]) {
      if (part && part !== name && !details.includes(part)) details.push(part)
    }
    const fullName = details.length ? `${name} — ${details.join(', ')}` : name

    // Homonymes Photon à moins de 50 m : un seul.
    if (mapped.some((m) => m.name === name && metersBetween(m.lat, m.lon, snapped.lat, snapped.lon) < 50)) return

    mapped.push({
      id: `photon-${p.osm_id}`,
      name,
      fullName,
      lat: snapped.lat,
      lon: snapped.lon,
      kind: 'address',
      cls: photonClass(p),
      order,
    })
  })

  return mapped
    .sort((a, b) => a.cls - b.cls || a.order - b.order)
    .slice(0, 5)
    .map(({ cls: _cls, order: _order, ...place }) => place)
}

// ─── Géocodage inverse (coordonnées → nom de rue) ─────────────────────────────
export async function reverseGeocode(lat: number, lon: number, locale: Locale = 'fr'): Promise<string> {
  const fallback = `${lat.toFixed(4)}, ${lon.toFixed(4)}`
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), 5000)
  try {
    // Langue en paramètre (pas d'en-tête personnalisé : pas de requête CORS
    // préalable) ; le navigateur envoie le Referer exigé par Nominatim.
    const params = new URLSearchParams({
      lat: String(lat),
      lon: String(lon),
      format: 'json',
      zoom: '18',
      'accept-language': locale === 'ar' ? 'ar,fr' : locale === 'en' ? 'en,fr' : 'fr',
    })
    const res = await fetch(`https://nominatim.openstreetmap.org/reverse?${params}`, { signal: ctrl.signal })
    if (!res.ok) return fallback
    const data = await res.json()
    const addr = data?.address ?? {}
    return addr.road ?? addr.pedestrian ?? addr.suburb ?? addr.village ?? data?.display_name?.split(',')[0] ?? fallback
  } catch {
    return fallback
  } finally {
    clearTimeout(timer)
  }
}

// ─── Recherche unifiée (stations + adresses) ──────────────────────────────────

const sleep = (ms: number, signal?: AbortSignal) => new Promise<void>((resolve, reject) => {
  if (signal?.aborted) { reject(abortError()); return }
  const timer = setTimeout(() => { signal?.removeEventListener('abort', onAbort); resolve() }, ms)
  const onAbort = () => { clearTimeout(timer); reject(abortError()) }
  signal?.addEventListener('abort', onAbort, { once: true })
})

/** Délai avant d'interroger Photon : une frappe qui suit l'annule. */
export const ADDRESS_DEBOUNCE_MS = 250

export interface PlaceSearch {
  /** Stations et arrêts (locaux), puis adresses ; 8 au plus. */
  results: PlaceResult[]
  /** État de la partie « adresses » : de quoi dire « aucune adresse », « réseau lent ». */
  addressStatus: AddressStatus
}

/**
 * Recherche complète avec statut. Temporisée (debounceMs) et annulable : une
 * nouvelle frappe qui annule `signal` évite l'appel réseau. Lève AbortError
 * si annulée.
 */
export async function searchPlacesDetailed(
  query: string,
  opts: { signal?: AbortSignal; locale?: Locale; debounceMs?: number } = {},
): Promise<PlaceSearch> {
  const locale = opts.locale ?? 'fr'
  const local = searchLocal(query, locale)
  if (query.trim().length < 2) return { results: [], addressStatus: 'empty' }
  const debounce = opts.debounceMs ?? ADDRESS_DEBOUNCE_MS
  if (debounce > 0) await sleep(debounce, opts.signal)
  const addresses = await searchAddresses(query, { signal: opts.signal, locale })
  return { results: [...local, ...addresses.results].slice(0, 8), addressStatus: addresses.status }
}

/**
 * Message factuel sous la liste, traduit, ou null. « Aucune adresse trouvée »
 * seulement si RIEN n'est trouvé (ni arrêt ni adresse).
 */
export function placeSearchMessage(search: PlaceSearch, locale: Locale = 'fr'): string | null {
  if (search.addressStatus === 'slow') return itinText(locale, 'itin_geoSlow')
  if (search.addressStatus === 'unavailable') return itinText(locale, 'itin_geoUnavailable')
  if (search.results.length === 0) return itinText(locale, 'itin_geoNoResults')
  return null
}

/**
 * Compatibilité (SearchBar, SavedPlaces) : stations + adresses, sans jamais
 * rejeter — en cas d'annulation ou de panne, les résultats locaux seuls.
 * Désormais temporisée (250 ms) : les deux appels que SearchBar fait par
 * frappe partagent UNE requête Photon, et une frappe rapide n'en fait aucune.
 */
export async function searchPlaces(
  query: string,
  signal: AbortSignal,
  locale: Locale = 'fr'
): Promise<PlaceResult[]> {
  if (query.trim().length < 2) return []
  try {
    return (await searchPlacesDetailed(query, { signal, locale })).results
  } catch {
    // AbortError → arrêts seulement
    return searchLocal(query, locale)
  }
}

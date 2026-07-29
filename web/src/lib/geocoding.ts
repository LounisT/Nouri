import { allStations } from './stations'
import { busLines, lineStopName } from './lines'
import { Coordinate } from './otp'
import type { Locale } from './i18n'
import { getStationName } from './stations'

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

// ─── Index des arrêts de bus ─────────────────────────────────────────────────
// Sans lui, chercher « Vieux Kouba » ne renvoyait qu'un point Photon situé à
// 1,7 km de l'arrêt réel : OTP rabattait alors 47 min à pied vers le réseau.
// Un arrêt réel dans la liste = un itinéraire juste.
interface BusStopEntry {
  key: string
  name: string
  nameAr?: string
  lat: number
  lon: number
  lines: Set<string>
}

let busStopIndex: BusStopEntry[] | null = null

function getBusStopIndex(): BusStopEntry[] {
  if (busStopIndex) return busStopIndex

  // Les homonymes sont fréquents (« Place des Martyrs » existe aussi à Réghaïa,
  // 25 km plus loin) : on regroupe par nom ET position, jamais par nom seul.
  const byKey = new Map<string, BusStopEntry>()
  for (const line of busLines) {
    for (const direction of line.directions) {
      for (const stop of direction.stops) {
        const key = `${stop.name.toLowerCase()}|${stop.lat.toFixed(3)},${stop.lon.toFixed(3)}`
        const entry = byKey.get(key)
        if (entry) {
          entry.lines.add(line.shortName)
        } else {
          byKey.set(key, {
            key,
            name: stop.name,
            nameAr: stop.nameAr,
            lat: stop.lat,
            lon: stop.lon,
            lines: new Set([line.shortName]),
          })
        }
      }
    }
  }

  busStopIndex = Array.from(byKey.values())
  return busStopIndex
}

function normalize(value: string): string {
  return value.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
}

function searchBusStopsLocal(query: string, locale: Locale): PlaceResult[] {
  const q = normalize(query)
  const busWord = locale === 'ar' ? 'حافلة' : 'Bus'

  return getBusStopIndex()
    .filter((stop) => {
      const names = [stop.name, stop.nameAr].filter(Boolean).map((n) => normalize(n!))
      return names.some((name) => name.includes(q))
    })
    // Un nom qui commence par la recherche est plus pertinent qu'une inclusion.
    .sort((a, b) => {
      const aStarts = normalize(a.name).startsWith(q) ? 0 : 1
      const bStarts = normalize(b.name).startsWith(q) ? 0 : 1
      if (aStarts !== bStarts) return aStarts - bStarts
      return b.lines.size - a.lines.size
    })
    .slice(0, 4)
    .map((stop) => {
      const refs = Array.from(stop.lines).slice(0, 3).join(' · ')
      return {
        id: `busstop-${stop.key}`,
        name: lineStopName({ name: stop.name, nameAr: stop.nameAr, lat: stop.lat, lon: stop.lon }, locale),
        fullName: `${stop.name} — ${busWord} ${refs}`,
        lat: stop.lat,
        lon: stop.lon,
        kind: 'station' as const,
      }
    })
}

export function placeToCoordinate(p: PlaceResult): Coordinate {
  return { lat: p.lat, lon: p.lon, name: p.name }
}

// ─── Recherche locale dans les 36 stations ────────────────────────────────────
function searchStationsLocal(query: string, locale: Locale): PlaceResult[] {
  const q = query.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  return allStations
    .filter((s) => {
      const names = [s.name, s.nameAr]
        .filter(Boolean)
        .map((name) => name!.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, ''))
      return names.some((name) => name.includes(q))
    })
    .slice(0, 4)
    .map((s) => ({
      id: `station-${s.id}`,
      name: getStationName(s, locale),
      fullName: `${getStationName(s, locale)} — ${s.type === 'metro'
        ? (locale === 'ar' ? 'مترو الخط 1' : locale === 'en' ? 'Metro L1' : 'Métro L1')
        : (locale === 'ar' ? 'ترامواي الخط 1' : locale === 'en' ? 'Tramway L1' : 'Tramway L1')}`,
      lat: s.lat,
      lon: s.lon,
      kind: 'station' as const,
      stationId: s.id,
      stationType: s.type,
    }))
}

// ─── Cache sessionStorage (TTL 5min) ─────────────────────────────────────────
const CACHE_TTL = 5 * 60 * 1000

function getCached(key: string): PlaceResult[] | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = sessionStorage.getItem(`nominatim:${key}`)
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
    sessionStorage.setItem(`nominatim:${key}`, JSON.stringify({ results, ts: Date.now() }))
  } catch (err) {
    // Silencieusement ignorer les erreurs (QuotaExceededError en incognito, etc.)
    if (!(err instanceof Error && err.name === 'QuotaExceededError')) {
      console.debug('sessionStorage set failed:', err)
    }
  }
}

// ─── Requête Photon (Komoot) — autocomplete rapide ───────────────────────────
interface PhotonFeature {
  geometry: { coordinates: [number, number] }
  properties: {
    osm_id: number
    name?: string
    street?: string
    housenumber?: string
    city?: string
    district?: string
    country?: string
  }
}

async function fetchPhoton(query: string, signal: AbortSignal): Promise<PlaceResult[]> {
  const cached = getCached(query)
  if (cached) return cached

  // bbox Alger : lon_min, lat_min, lon_max, lat_max
  const params = new URLSearchParams({
    q: query,
    lang: 'fr',
    limit: '5',
    bbox: '2.4,36.5,3.6,37.0',
  })

  try {
    const res = await fetch(
      `https://photon.komoot.io/api/?${params}`,
      { signal }
    )

    if (!res.ok) return []

    const data = await res.json()

    // Vérifier que data contient bien features
    if (!data || !Array.isArray(data.features)) {
      return []
    }

    const results = data.features.map((f: PhotonFeature) => {
      const p = f.properties
      const [lon, lat] = f.geometry.coordinates
      const shortName = p.street ?? p.name ?? p.district ?? ''
      const parts = [p.street, p.city ?? p.district, p.country].filter(Boolean).join(', ')

      return {
        id: `photon-${p.osm_id}`,
        name: shortName || parts.split(',')[0],
        fullName: parts || shortName,
        lat,
        lon,
        kind: 'address' as const,
      }
    }).filter((r: PlaceResult) => r.name)

    setCached(query, results)
    return results
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      throw err
    }
    return []
  }
}

// ─── Géocodage inverse (coordonnées → nom de rue) ─────────────────────────────
export async function reverseGeocode(lat: number, lon: number): Promise<string> {
  try {
    const params = new URLSearchParams({ lat: String(lat), lon: String(lon), format: 'json' })
    const res = await fetch(
      `https://nominatim.openstreetmap.org/reverse?${params}`,
      { headers: { 'Accept-Language': 'fr', 'User-Agent': 'AlgerTransit/1.0' } }
    )
    if (!res.ok) return `${lat.toFixed(4)}, ${lon.toFixed(4)}`
    const data = await res.json()
    const addr = data.address ?? {}
    return addr.road ?? addr.suburb ?? addr.village ?? data.display_name.split(',')[0]
  } catch {
    return `${lat.toFixed(4)}, ${lon.toFixed(4)}`
  }
}

// ─── Recherche unifiée (stations + adresses) ──────────────────────────────────
export async function searchPlaces(
  query: string,
  signal: AbortSignal,
  locale: Locale = 'fr'
): Promise<PlaceResult[]> {
  if (query.trim().length < 2) return []

  // Arrêts desservis d'abord (métro/tram puis bus), adresses ensuite : choisir
  // un arrêt réel plutôt qu'un point approximatif change radicalement la
  // qualité de l'itinéraire calculé.
  const stations = searchStationsLocal(query, locale)
  const busStops = searchBusStopsLocal(query, locale)

  try {
    const addresses = await fetchPhoton(query, signal)
    return [...stations, ...busStops, ...addresses].slice(0, 8)
  } catch {
    // AbortError ou réseau indisponible → arrêts seulement
    return [...stations, ...busStops]
  }
}

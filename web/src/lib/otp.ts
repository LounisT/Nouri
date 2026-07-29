import { allStations, Station } from './stations'

// Côté client : passe par le proxy Next.js /api/otp
// Côté serveur : appel direct via OTP_INTERNAL_URL
const OTP_BASE_URL = typeof window !== 'undefined'
  ? '/api/otp'
  : (process.env.OTP_INTERNAL_URL ?? process.env.NEXT_PUBLIC_OTP_URL ?? 'http://localhost:8080/otp')

export async function checkOtpHealth(): Promise<boolean> {
  try {
    const url = typeof window !== 'undefined'
      ? '/api/otp/routers/default'
      : `${OTP_BASE_URL}/routers/default`
    const res = await fetch(url, {
      signal: AbortSignal.timeout(3000),
    })
    return res.ok
  } catch {
    return false
  }
}

export interface Coordinate {
  lat: number
  lon: number
  name?: string
}

export interface LegGeometry {
  points: string // encoded polyline
}

export interface OtpLeg {
  mode: 'WALK' | 'SUBWAY' | 'TRAM' | 'BUS' | 'RAIL'
  startTime: number
  endTime: number
  duration: number
  distance: number
  from: Coordinate & { name: string; stopId?: string }
  to: Coordinate & { name: string; stopId?: string }
  legGeometry: LegGeometry
  routeShortName?: string
  routeLongName?: string
  routeColor?: string
  headsign?: string
  intermediateStops?: Array<{ name: string; lat: number; lon: number }>
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
  // Départs suivants du même trajet (horaires théoriques GTFS), conservés par
  // la déduplication au lieu d'être jetés. Jamais du temps réel.
  nextDepartures?: number[]
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
  }
}

export async function planTrip(
  from: Coordinate,
  to: Coordinate,
  date?: Date,
  arriveBy = false,
): Promise<OtpPlanResponse> {
  const d = date ?? new Date()
  // Date et heure doivent venir du MÊME référentiel. Prendre la date en UTC
  // (toISOString) avec une heure locale décalait la recherche d'un jour entier
  // entre 00 h et 01 h à Alger (UTC+1).
  const dateStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  const timeStr = d.toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  })

  const params = new URLSearchParams({
    fromPlace: `${from.lat},${from.lon}`,
    toPlace: `${to.lat},${to.lon}`,
    date: dateStr,
    time: timeStr,
    mode: 'TRANSIT,WALK',
    // 8 propositions : la déduplication en écrase la moitié (lignes en
    // fréquences), et les départs suivants alimentent nextDepartures.
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
    searchWindow: '7200',
    // Les arrêts traversés : ils portent le « N arrêts restants » de la
    // navigation et les pastilles du tracé (planche 1i).
    showIntermediateStops: 'true',
    arriveBy: String(arriveBy),
    locale: 'fr',
  })

  const base = typeof window !== 'undefined' ? '/api/otp' : OTP_BASE_URL
  const url = `${base}/routers/default/plan?${params}`

  const res = await fetch(url, {
    headers: { Accept: 'application/json' },
    next: { revalidate: 30 },
  })

  if (!res.ok) {
    throw new Error(`OTP API error: ${res.status} ${res.statusText}`)
  }

  const data = (await res.json()) as OtpPlanResponse
  if (data.plan?.itineraries) {
    data.plan.itineraries = hideUselessWalkOnly(dedupeItineraries(data.plan.itineraries))
    nameEndpoints(data.plan.itineraries, from, to)
  }
  return data
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

// La marche intégrale n'est masquée que si elle est RÉELLEMENT moins bonne :
// il faut qu'un itinéraire en transport existe ET qu'il soit plus rapide.
// Mesuré : sur 1,5–2,7 km le soir, marcher 32 min bat un bus à 63 min — la
// masquer sur un simple seuil de durée priverait l'usager du meilleur choix.
// Et sur un réseau peu dense, mieux vaut un trajet imparfait que rien.
function hideUselessWalkOnly(itineraries: OtpItinerary[]): OtpItinerary[] {
  const transit = itineraries.filter((it) => it.legs.some((l) => l.mode !== 'WALK'))
  if (transit.length === 0) return itineraries

  const bestTransit = Math.min(...transit.map((it) => it.duration))
  return itineraries.filter((it) => {
    const walkOnly = it.legs.every((l) => l.mode === 'WALK')
    return !walkOnly || it.duration <= bestTransit
  })
}

// OTP renvoie souvent le même itinéraire en plusieurs exemplaires avec les
// lignes en fréquences (frequencies.txt) : même enchaînement, mêmes durées.
// On ne garde que le départ le plus tôt — mais on conserve les heures des
// suivants, qui sont une vraie information horaire (GTFS), pas une invention.
function dedupeItineraries(itineraries: OtpItinerary[]): OtpItinerary[] {
  const kept = new Map<string, OtpItinerary>()

  for (const it of itineraries) {
    const signature = it.legs
      .filter((leg) => leg.mode !== 'WALK')
      .map((leg) => `${leg.mode}:${leg.routeShortName ?? ''}`)
      .join('>') || 'WALK_ONLY'

    const previous = kept.get(signature)
    if (!previous) {
      kept.set(signature, { ...it, nextDepartures: [] })
      continue
    }
    // Même trajet, départ plus tard : on l'archive comme passage suivant.
    const departures = previous.nextDepartures ?? []
    if (departures.length < 3 && it.startTime > previous.startTime) {
      previous.nextDepartures = [...departures, it.startTime]
    }
  }

  return Array.from(kept.values())
}

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

/** Même chose depuis un tronçon OTP, pour les écrans qui n ont que le leg. */
export function isSchematicLeg(leg: OtpLeg): boolean {
  if (leg.mode === 'WALK') return false
  // Sur la géométrie BRUTE : un segment de raccord, borné à 400 m, ne doit pas
  // être pris pour un tracé manquant.
  return isSchematicGeometry(decodePolyline(leg.legGeometry.points))
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

export function formatDistance(meters: number): string {
  if (meters < 1000) return `${Math.round(meters)} m`
  const km = meters / 1000
  return `${km % 1 === 0 ? km.toFixed(0) : km.toFixed(1)} km`
}

export function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  if (h > 0) return `${h}h ${m}min`
  return `${m} min`
}

export function formatTime(ms: number): string {
  return new Date(ms).toLocaleTimeString('fr-DZ', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })
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

export function getLegIcon(mode: OtpLeg['mode']): string {
  switch (mode) {
    case 'SUBWAY': return 'M'
    case 'TRAM': return 'T'
    case 'BUS': return 'B'
    case 'RAIL': return 'R'
    default: return '🚶'
  }
}

// Tarif plat : 50 DZD par mode de transport en commun emprunté
export const FARE_PER_MODE_DZD = 50

export function computeFare(legs: OtpLeg[]): number {
  const modes = new Set(legs.filter((l) => l.mode !== 'WALK').map((l) => l.mode))
  return modes.size * FARE_PER_MODE_DZD
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

// ─── Mock itinerary (used when OTP is unavailable) ───────────────────────────
// Correspondance entre Métro L1 et Tramway L1
// M07 "Les Fusillés" (36.74232, 3.08214) ↔ T02 "Les Fusillés (Tram)" (36.74599, 3.08681)
// Distance: ~52m à pied, plus rapide et plus direct que Ruisseau
const TRANSFER_METRO_ID = 'M07' // Les Fusillés (Métro L1)
const TRANSFER_TRAM_ID  = 'T02' // Les Fusillés (Tram L1)

export function mockPlanTrip(from: Coordinate, to: Coordinate): OtpPlanResponse {
  // Heures de service : 05h00–23h00
  const SERVICE_START_H = 5
  const SERVICE_END_H   = 23
  const nowDate = new Date()
  const totalMinutes = nowDate.getHours() * 60 + nowDate.getMinutes()
  const inService = totalMinutes >= SERVICE_START_H * 60 && totalMinutes < SERVICE_END_H * 60

  let baseTime: number
  if (inService) {
    baseTime = Date.now()
  } else {
    // Prochain départ = 05h00 (aujourd'hui si avant minuit+5h, sinon demain)
    const next = new Date(nowDate)
    if (totalMinutes >= SERVICE_END_H * 60) {
      next.setDate(next.getDate() + 1)
    }
    next.setHours(SERVICE_START_H, 0, 0, 0)
    baseTime = next.getTime()
  }

  const metroLine = allStations.filter((s) => s.type === 'metro')
  const tramLine  = allStations.filter((s) => s.type === 'tram')

  const nearestOfType = (coord: Coordinate, type: 'metro' | 'tram'): Station => {
    const pool = type === 'metro' ? metroLine : tramLine
    return pool.reduce((best, s) => {
      const d = Math.hypot(s.lat - coord.lat, s.lon - coord.lon)
      return d < best.d ? { s, d } : best
    }, { s: pool[0], d: Infinity }).s
  }

  const stationAt = (coord: Coordinate, type: 'metro' | 'tram'): Station =>
    (type === 'metro' ? metroLine : tramLine)
      .find((s) => Math.hypot(s.lat - coord.lat, s.lon - coord.lon) < 0.002)
    ?? nearestOfType(coord, type)

  const closestTo = (coord: Coordinate) =>
    allStations.reduce((best, s) => {
      const d = Math.hypot(s.lat - coord.lat, s.lon - coord.lon)
      return d < best.d ? { s, d } : best
    }, { s: allStations[0], d: Infinity }).s

  const fromType = closestTo(from).type
  const toType   = closestTo(to).type

  function makeWalkLeg(
    fromC: { name?: string; lat: number; lon: number },
    toC:   { name?: string; lat: number; lon: number },
    startMs: number,
    dist = 120,
  ): OtpLeg {
    const dur = Math.round(dist / 1.33)
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
    const line = mode === 'SUBWAY' ? metroLine : tramLine
    const fi = line.findIndex((s) => s.id === fromS.id)
    const ti = line.findIndex((s) => s.id === toS.id)
    const [si, ei] = fi <= ti ? [fi, ti] : [ti, fi]
    const stops = line.slice(si, ei + 1)
    if (fi > ti) stops.reverse()
    const dur = Math.max(120, stops.length * 120)
    const coords: [number, number][] = stops.map((s) => [s.lon, s.lat])
    if (coords.length < 2) coords.push([toS.lon, toS.lat])
    return {
      mode,
      startTime: startMs,
      endTime: startMs + dur * 1000,
      duration: dur,
      distance: stops.length * 800,
      from: { name: fromS.name, lat: fromS.lat, lon: fromS.lon },
      to:   { name: toS.name,   lat: toS.lat,   lon: toS.lon   },
      legGeometry: { points: encodePolyline(coords) },
      routeShortName: mode === 'SUBWAY' ? 'M1' : 'T1',
      routeLongName: mode === 'SUBWAY' ? 'Métro Ligne 1' : 'Tramway Ligne 1',
      headsign: toS.name,
      // Arrêts traversés : la navigation en a besoin pour les pastilles et le
      // décompte « N arrêts restants ».
      intermediateStops: stops.slice(1, -1).map((s) => ({ name: s.name, lat: s.lat, lon: s.lon })),
    }
  }

  let legs: OtpLeg[]
  let t = baseTime

  if (fromType === toType) {
    // ── Trajet mono-ligne ───────────────────────────────────────────────────
    const mode: 'SUBWAY' | 'TRAM' = fromType === 'metro' ? 'SUBWAY' : 'TRAM'
    const fromS = stationAt(from, fromType)
    const toS   = stationAt(to,   toType)
    const wl1 = makeWalkLeg(from, fromS, t); t += wl1.duration * 1000
    const tl  = makeTransitLeg(mode, fromS, toS, t); t += tl.duration * 1000
    const wl2 = makeWalkLeg(toS, to, t)
    legs = [wl1, tl, wl2]
  } else {
    // ── Trajet inter-lignes (correspondance M07 ↔ T01) ─────────────────────
    const txMetro = allStations.find((s) => s.id === TRANSFER_METRO_ID)!
    const txTram  = allStations.find((s) => s.id === TRANSFER_TRAM_ID)!

    if (fromType === 'metro') {
      const fromS = stationAt(from, 'metro')
      const toS   = stationAt(to,   'tram')
      const wl1  = makeWalkLeg(from, fromS, t);              t += wl1.duration  * 1000
      const ml   = makeTransitLeg('SUBWAY', fromS, txMetro, t); t += ml.duration  * 1000
      const xfer = makeWalkLeg(txMetro, txTram, t, 52);      t += xfer.duration * 1000
      const tl   = makeTransitLeg('TRAM', txTram, toS, t);   t += tl.duration   * 1000
      const wl2  = makeWalkLeg(toS, to, t)
      legs = [wl1, ml, xfer, tl, wl2]
    } else {
      const fromS = stationAt(from, 'tram')
      const toS   = stationAt(to,   'metro')
      const wl1  = makeWalkLeg(from, fromS, t);             t += wl1.duration  * 1000
      const tl   = makeTransitLeg('TRAM', fromS, txTram, t); t += tl.duration   * 1000
      const xfer = makeWalkLeg(txTram, txMetro, t, 52);     t += xfer.duration * 1000
      const ml   = makeTransitLeg('SUBWAY', txMetro, toS, t); t += ml.duration  * 1000
      const wl2  = makeWalkLeg(toS, to, t)
      legs = [wl1, tl, xfer, ml, wl2]
    }
  }

  const totalDur    = Math.round((legs[legs.length - 1].endTime - legs[0].startTime) / 1000)
  const walkTime    = legs.filter((l) => l.mode === 'WALK').reduce((s, l) => s + l.duration, 0)
  const transitTime = legs.filter((l) => l.mode !== 'WALK').reduce((s, l) => s + l.duration, 0)
  const walkDist    = legs.filter((l) => l.mode === 'WALK').reduce((s, l) => s + l.distance, 0)

  // Générer 1 itinéraire avec le prochain départ arrondi au multiple de 5 min
  const firstStartTime = legs[0].startTime
  const minutesToNextDeparture = (5 - Math.floor((firstStartTime / 1000 / 60) % 5)) % 5
  const roundedStartTime = firstStartTime + minutesToNextDeparture * 60 * 1000

  const startTime = roundedStartTime
  const endTime = startTime + totalDur * 1000
  const itineraries: OtpItinerary[] = [
    {
      duration: totalDur,
      startTime,
      endTime,
      walkTime,
      transitTime,
      waitingTime: 60,
      walkDistance: walkDist,
      transfers: legs.filter((l) => l.mode !== 'WALK').length - 1,
      legs: legs.map((leg) => ({
        ...leg,
        startTime: leg.startTime + (startTime - firstStartTime),
        endTime: leg.endTime + (startTime - firstStartTime),
      })),
    },
  ]

  return {
    plan: {
      itineraries,
    },
  }
}

// Source unique des lignes de transport, tous modes confondus.
// Métro/tram : construits depuis stations.ts (données curées, noms arabes).
// Bus : importés de generated-lines.json (généré depuis le GTFS —
//       ne PAS éditer à la main).
import type { Locale } from './i18n'
import {
  metroStations,
  tramStations,
  METRO_COLOR,
  TRAM_COLOR,
  getStationName,
  type Station,
} from './stations'
import generatedBusLines from './generated-lines.json'

export type LineMode = 'metro' | 'tram' | 'bus'

export interface LineStop {
  name: string
  nameAr?: string
  lat: number
  lon: number
}

export interface LineDirection {
  headsign: string
  /**
   * Provenance du tracé. « deduit » = routé sur la voirie OSM entre les
   * arrêts, pas relevé sur le terrain : l'app l'annonce à l'usager.
   * Absent = relevé OSM.
   */
  shapeSource?: 'deduit'
  stops: LineStop[]
  shape: number[][] // [[lon, lat], ...]
}

export interface TransitLine {
  id: string
  mode: LineMode
  shortName: string // 'M1', 'T1', '100'
  longName: string
  color: string
  fare?: string // '50 DZD'
  hours?: { first: string; last: string }
  directions: LineDirection[]
}

// Métro et tram tournent en fréquence de 05:00 à 23:00 (frequencies.txt),
// tarif unique 50 DA (fare_attributes.txt metro_flat / tram_flat).
const RAIL_HOURS = { first: '05:00', last: '23:00' }
const RAIL_FARE = '50 DZD'

function railLine(
  stations: Station[],
  id: string,
  shortName: string,
  longName: string,
  color: string,
  mode: LineMode,
): TransitLine {
  const stops: LineStop[] = stations.map((s) => ({
    name: s.name,
    nameAr: s.nameAr,
    lat: s.lat,
    lon: s.lon,
  }))
  const shape = stations.map((s) => [s.lon, s.lat])
  const first = stops[0]?.name ?? ''
  const last = stops[stops.length - 1]?.name ?? ''
  return {
    id,
    mode,
    shortName,
    longName,
    color,
    fare: RAIL_FARE,
    hours: RAIL_HOURS,
    directions: [
      { headsign: last, stops, shape },
      { headsign: first, stops: [...stops].reverse(), shape: [...shape].reverse() },
    ],
  }
}

export const metroLine = railLine(
  metroStations, 'L1-metro', 'M1', 'Métro Ligne 1 · Tafourah ↔ Aïn Naâdja', METRO_COLOR, 'metro',
)

export const tramLine = railLine(
  tramStations, 'L1-tram', 'T1', 'Tramway Ligne 1 · Ruisseau ↔ Dergana', TRAM_COLOR, 'tram',
)

/**
 * Vrai si le tronçon bus (ligne + destination) roule sur un tracé DÉDUIT.
 * Le headsign d'OTP vient du même champ GTFS que celui des directions : la
 * correspondance est exacte. Si aucune direction ne matche (renommage,
 * variante), on répond vrai dès qu'UNE direction de la ligne est déduite —
 * mieux vaut annoncer une estimation de trop que de la taire.
 */
export function isDeducedShape(routeShortName?: string, headsign?: string): boolean {
  if (!routeShortName) return false
  const line = busLines.find((l) => l.shortName === routeShortName)
  if (!line) return false
  const match = headsign
    ? line.directions.find((d) => d.headsign === headsign)
    : undefined
  if (match) return match.shapeSource === 'deduit'
  return line.directions.some((d) => d.shapeSource === 'deduit')
}

/** « ~ toutes les N min » — libellé de fréquence, jamais un temps d'attente. */
export function nextPassLabel(headwayMin: number, locale: Locale): string {
  if (locale === 'ar') return `كل ${headwayMin} د تقريباً`
  if (locale === 'en') return `every ~${headwayMin} min`
  return `~ toutes les ${headwayMin} min`
}

export const busLines: TransitLine[] = (generatedBusLines as TransitLine[]).map((l) => ({
  ...l,
  hours: l.hours ?? undefined,
}))

// Ordre du catalogue : métro, tram, puis bus (par numéro croissant).
export const allLines: TransitLine[] = [metroLine, tramLine, ...busLines]

export const linesByMode: Record<LineMode, TransitLine[]> = {
  metro: allLines.filter((l) => l.mode === 'metro'),
  tram: allLines.filter((l) => l.mode === 'tram'),
  bus: allLines.filter((l) => l.mode === 'bus'),
}

// « Métro Ligne 1 · Tafourah ↔ Aïn Naâdja » → « Tafourah ↔ Aïn Naâdja »,
// « Bus 10 Place 1er mai ↔ … » → « Place 1er mai ↔ … »
// (le badge porte déjà le numéro, le nom reste pur — planche 1c/1j).
export function lineDisplayName(line: TransitLine): string {
  const afterDot = line.longName.split('·').slice(1).join('·').trim()
  if (afterDot) return afterDot
  return line.longName.replace(/^(Métro|Tramway|Bus)\s+\S+\s+/i, '')
}

export function lineModeLabel(mode: LineMode, locale: Locale = 'fr'): string {
  const labels: Record<LineMode, Record<string, string>> = {
    metro: { fr: 'Métro', ar: 'مترو', en: 'Metro' },
    tram: { fr: 'Tramway', ar: 'ترامواي', en: 'Tram' },
    bus: { fr: 'Bus', ar: 'حافلة', en: 'Bus' },
  }
  return labels[mode][locale] ?? labels[mode].fr
}

// Badge court affiché sur la carte et dans les listes (M1, T1, 100…).
export function lineBadge(line: TransitLine): string {
  return line.shortName
}

const R = 6371000
function haversine(aLat: number, aLon: number, bLat: number, bLon: number): number {
  const toRad = (d: number) => (d * Math.PI) / 180
  const dLat = toRad(bLat - aLat)
  const dLon = toRad(bLon - aLon)
  const lat1 = toRad(aLat)
  const lat2 = toRad(bLat)
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(h))
}

export interface NearbyLine {
  line: TransitLine
  direction: LineDirection
  stop: LineStop
  distanceM: number
}

// Lignes dont un arrêt est à moins de `radiusM` de (lat, lon), triées par distance.
// Une seule entrée par (ligne, direction) : l'arrêt le plus proche.
export function nearbyLines(lat: number, lon: number, radiusM = 800): NearbyLine[] {
  const found: NearbyLine[] = []
  for (const line of allLines) {
    for (const direction of line.directions) {
      let best: { stop: LineStop; d: number } | null = null
      for (const stop of direction.stops) {
        const d = haversine(lat, lon, stop.lat, stop.lon)
        if (!best || d < best.d) best = { stop, d }
      }
      if (best && best.d <= radiusM) {
        found.push({ line, direction, stop: best.stop, distanceM: Math.round(best.d) })
      }
    }
  }
  return found.sort((a, b) => a.distanceM - b.distanceM)
}

export function lineStopName(stop: LineStop, locale: Locale = 'fr'): string {
  return locale === 'ar' && stop.nameAr ? stop.nameAr : stop.name
}

// ── État de service (calculé depuis les amplitudes officielles — honnête,
//    aucun temps réel n'existe à Alger) ────────────────────────────────────

export function isInService(line: TransitLine, now: Date = new Date()): boolean {
  if (!line.hours) return true
  const mins = now.getHours() * 60 + now.getMinutes()
  const [fh, fm] = line.hours.first.split(':').map(Number)
  const [lh, lm] = line.hours.last.split(':').map(Number)
  const first = fh * 60 + fm
  let last = lh * 60 + lm
  if (last <= first) last += 24 * 60 // dernier départ après minuit (ex. 00:10)
  return (mins >= first && mins <= last) || mins + 24 * 60 <= last
}

// Intervalle estimé entre deux passages. Chiffres sourcés uniquement :
// métro/tram 5 min pointe / 10 min creux ; navettes aéroport 100/178 = 60 min ;
// ligne 12 ≈ 10 min ; autres bus = 30 min (nominal officiel).
export function estimatedHeadwayMin(line: TransitLine, now: Date = new Date()): number {
  const h = now.getHours()
  const isPeak = (h >= 7 && h < 9) || (h >= 17 && h < 21)
  if (line.mode === 'metro' || line.mode === 'tram') return isPeak ? 5 : 10
  if (line.shortName === '100' || line.shortName === '178') return 60
  if (line.shortName === '12') return 10
  return 30
}

export { getStationName }

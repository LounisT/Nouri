// Logique de l'onglet Lignes et du bloc « Lignes à proximité » : état de
// service, correspondances, recherche, lignes proches. Fonctions pures (pas de
// React) pour être testées sous plusieurs fuseaux (web/scripts/cat/).
//
// Tout est calculé à l'heure d'Alger depuis les départs du GTFS (lines.ts) :
// aucun temps réel n'existe à Alger. On n'affiche que des fréquences « ~ »,
// des premiers / derniers départs relevés et des passages estimés « ~ » —
// jamais de compte à rebours ni de « prochain passage ».
import {
  allLines,
  directionsServingStop,
  headwayAt,
  isDirectionInService,
  isInService,
  lineModeLabel,
  nearbyLines,
  searchLines,
  stopPassWindow,
  type LineDirection,
  type LineMode,
  type LineSearchHit,
  type LineStop,
  type TransitLine,
  normalizeSearchTerm,
} from './lines'
import { METRO_BADGE_COLOR, TRAM_BADGE_COLOR } from './stations'
import type { Locale } from './i18n'

// ── Pastilles ───────────────────────────────────────────────────────────────

/**
 * Couleurs d'une pastille de ligne avec un texte de 11 à 13 px lisible
 * (WCAG AA 4,5:1) : blanc sur bleu métro (10,4:1), blanc sur vert tram foncé
 * (5,5:1 ; le vert du tracé, #059669, ne fait que 3,8:1), texte de la ligne
 * (noir) sur l'ambre bus (6,6:1 ; blanc : 3,2:1). Les tracés et pastilles
 * d'arrêt gardent la couleur officielle de la ligne.
 */
export function lineBadgeColors(line: TransitLine): { background: string; color: string } {
  if (line.mode === 'metro') return { background: METRO_BADGE_COLOR, color: '#FFFFFF' }
  if (line.mode === 'tram') return { background: TRAM_BADGE_COLOR, color: '#FFFFFF' }
  return { background: line.color, color: line.textColor ?? '#111827' }
}

// ── État de service ─────────────────────────────────────────────────────────

/**
 * - 'open'    : entre le premier et le dernier départ du terminus d'origine ;
 * - 'ending'  : dernier départ passé, mais le dernier véhicule n'est pas
 *               encore arrivé au bout (passages ESTIMÉS « ~ » en aval) — à
 *               23:05, une rame partie à 23:00 passe encore à Haï El Badr ;
 * - 'closed'  : aucun véhicule sur la ligne.
 */
export type ServiceKind = 'open' | 'ending' | 'closed'

export interface ServiceState {
  kind: ServiceKind
  /** 'open' : dernier départ du terminus d'origine (« HH:MM », relevé). */
  lastDeparture?: string
  /** 'ending' : dernier passage ESTIMÉ au terminus d'arrivée (« HH:MM », à afficher avec « ~ »). */
  lastPass?: string
  /** 'closed' : premier départ (« HH:MM », relevé). */
  firstDeparture?: string
}

function lastOffsetIndex(direction: LineDirection): number {
  const offsets = direction.offsetsMin
  if (!offsets?.length) return -1
  let best = 0
  for (let i = 1; i < offsets.length; i++) if (offsets[i] >= offsets[best]) best = i
  return best
}

/** État d'un sens, vu de son terminus d'origine (à l'heure d'Alger). */
export function directionServiceState(line: TransitLine, direction: LineDirection, now: Date = new Date()): ServiceState {
  const open = isDirectionInService(direction, now, 0)
  if (open === null) {
    // Sens sans départs détaillés : amplitude de la ligne.
    return isInService(line, now)
      ? { kind: 'open', lastDeparture: line.hours?.last }
      : { kind: 'closed', firstDeparture: line.hours?.first }
  }
  if (open) return { kind: 'open', lastDeparture: direction.lastDeparture }
  const lastIndex = lastOffsetIndex(direction)
  const maxOffset = lastIndex >= 0 ? direction.offsetsMin![lastIndex] : 0
  // Fenêtre décalée du temps de parcours : hors [premier, dernier départ]
  // mais dedans une fois décalée = après le dernier départ, véhicule en route.
  if (maxOffset > 0 && isDirectionInService(direction, now, maxOffset)) {
    return { kind: 'ending', lastPass: stopPassWindow(direction, lastIndex)?.last }
  }
  return { kind: 'closed', firstDeparture: direction.firstDeparture ?? line.hours?.first }
}

/**
 * État d'une ligne pour le catalogue : ouverte si un de ses sens l'est, « fin
 * de service » si un véhicule roule encore, sinon fermée (avec la première
 * ouverture de la ligne).
 */
export function lineServiceState(line: TransitLine, now: Date = new Date()): ServiceState {
  const states = line.directions.map((d) => directionServiceState(line, d, now))
  if (!states.length) {
    return isInService(line, now) ? { kind: 'open', lastDeparture: line.hours?.last } : { kind: 'closed', firstDeparture: line.hours?.first }
  }
  const open = states.find((s) => s.kind === 'open')
  if (open) return { kind: 'open', lastDeparture: line.hours?.last ?? open.lastDeparture }
  const ending = states.filter((s) => s.kind === 'ending')
  if (ending.length) {
    // Le plus tardif des derniers passages estimés (passage de minuit compris).
    const late = (hhmm?: string) => {
      if (!hhmm) return -1
      const [h, m] = hhmm.split(':').map(Number)
      const v = h * 60 + m
      return v < 4 * 60 ? v + 24 * 60 : v
    }
    const last = ending.reduce((a, b) => (late(b.lastPass) > late(a.lastPass) ? b : a))
    return { kind: 'ending', lastPass: last.lastPass }
  }
  return { kind: 'closed', firstDeparture: line.hours?.first ?? states[0].firstDeparture }
}

// ── Fréquence à un arrêt ────────────────────────────────────────────────────

/**
 * ~ Intervalle entre deux passages À CET ARRÊT, dans le sens le mieux
 * desservi, ou null hors service. Les sens d'un même côté (même direction_id)
 * se cumulent : à Tafourah, les rames vers El Harrach Centre (~20 min) et
 * vers Aïn Naâdja (~20 min) alternent, soit ~10 min sur le tronc ; à Aïn
 * Naâdja, ~20 min. Sans arrêt identifiable, intervalle de la ligne.
 */
export function stopHeadway(line: TransitLine, stop: LineStop, now: Date = new Date()): number | null {
  const serving = directionsServingStop(line, stop)
  if (!serving.length) return headwayAt(line, now)
  const perSide = new Map<number, number>()
  for (const index of serving) {
    const h = headwayAt(line, now, index)
    if (h === null || h <= 0) continue
    const side = line.directions[index].directionId ?? index
    perSide.set(side, (perSide.get(side) ?? 0) + 1 / h)
  }
  if (!perSide.size) return null
  let best = 0
  perSide.forEach((rate) => { if (rate > best) best = rate })
  return Math.max(1, Math.round(1 / best))
}

// ── Correspondances à un arrêt ──────────────────────────────────────────────

/** Rayon d'une correspondance « à pied » entre deux arrêts. */
export const CONNECTION_RADIUS_M = 150

export interface StopConnections {
  /** Métro / tram (pastilles). */
  rail: TransitLine[]
  /** Bus, dans l'ordre du catalogue (numéro croissant). */
  bus: TransitLine[]
}

function metersBetween(aLat: number, aLon: number, bLat: number, bLon: number): number {
  const dLat = (aLat - bLat) * 111320
  const dLon = (aLon - bLon) * 111320 * Math.cos((aLat * Math.PI) / 180)
  return Math.hypot(dLat, dLon)
}

/**
 * Autres lignes passant à moins de `radiusM` de chaque arrêt, TOUS sens
 * confondus (une ligne dont seul le retour passe ici reste une
 * correspondance), sans troncature : l'affichage décide quoi abréger et le
 * dit (« +N »).
 */
export function stopConnections(line: TransitLine, stops: LineStop[], radiusM = CONNECTION_RADIUS_M): StopConnections[] {
  return stops.map((stop) => {
    const rail: TransitLine[] = []
    const bus: TransitLine[] = []
    for (const other of allLines) {
      if (other.id === line.id) continue
      const near = other.directions.some((d) =>
        d.stops.some((s) => metersBetween(stop.lat, stop.lon, s.lat, s.lon) < radiusM))
      if (!near) continue
      if (other.mode === 'bus') bus.push(other)
      else rail.push(other)
    }
    return { rail, bus }
  })
}

// ── Recherche dans le catalogue ─────────────────────────────────────────────

const MODES: LineMode[] = ['metro', 'tram', 'bus']
const LOCALES: Locale[] = ['fr', 'ar', 'en']

/**
 * searchLines (numéro, nom, arrêt — FR/AR) complété du mode : « métro »,
 * « tram », « ترامواي » ou « bus » trouvent les lignes de ce mode (le nom
 * affiché d'une ligne ne contient pas son mode : « Place des Martyrs ↔ … »).
 */
export function catalogSearch(query: string, locale: Locale = 'fr'): LineSearchHit[] {
  const hits = searchLines(query, locale)
  const q = normalizeSearchTerm(query)
  if (q.length < 3) return hits
  const seen = new Set(hits.map((h) => h.line.id))
  for (const mode of MODES) {
    const labels = LOCALES.map((l) => normalizeSearchTerm(lineModeLabel(mode, l)))
    if (!labels.some((label) => label.startsWith(q))) continue
    for (const line of allLines) {
      if (line.mode !== mode || seen.has(line.id)) continue
      hits.push({ line, rank: 2 })
      seen.add(line.id)
    }
  }
  // Tri stable : pertinence, puis ordre du catalogue.
  const order = new Map(allLines.map((l, i) => [l.id, i]))
  return hits.sort((a, b) => a.rank - b.rank || (order.get(a.line.id)! - order.get(b.line.id)!))
}

/** La saisie contient des lettres arabes (les arrêts de bus n'ont pas tous un nom arabe relevé). */
export function hasArabicLetters(value: string): boolean {
  return /[؀-ۿ]/.test(value)
}

// ── Lignes à proximité ──────────────────────────────────────────────────────

/** Rayon du bloc « Lignes à proximité » (= texte de noNearbyLinesExplain : 1,5 km). */
export const NEARBY_RADIUS_M = 1500
// Marche : vitesse 1,33 m/s (4,8 km/h) et détour de 30 % sur la distance à
// vol d'oiseau (les rues ne vont pas en ligne droite). Estimation « ~ ».
const WALK_SPEED_MS = 1.33
const WALK_DETOUR = 1.3

export interface NearbyLineEntry {
  line: TransitLine
  direction: LineDirection
  directionIndex: number
  /** Arrêt le plus proche de cette ligne (tous sens confondus). */
  stop: LineStop
  /** Distance à vol d'oiseau, arrondie à 10 m. */
  distanceM: number
  /** ~ minutes de marche (estimation). */
  walkMin: number
}

/** ~ minutes de marche pour une distance à vol d'oiseau. */
export function walkMinutes(distanceM: number): number {
  return Math.max(1, Math.round((distanceM * WALK_DETOUR) / WALK_SPEED_MS / 60))
}

/**
 * Lignes (tous modes) dont un arrêt est à moins de `radiusM`, une entrée par
 * ligne (son arrêt le plus proche), triées par distance. `others` : lignes
 * trouvées au-delà des `max` affichées — à dire, jamais à taire.
 */
export function nearbyLineEntries(
  lat: number,
  lon: number,
  { radiusM = NEARBY_RADIUS_M, max = 5 }: { radiusM?: number; max?: number } = {},
): { entries: NearbyLineEntry[]; others: number } {
  const seen = new Set<string>()
  const all: NearbyLineEntry[] = []
  for (const hit of nearbyLines(lat, lon, radiusM)) {
    if (seen.has(hit.line.id)) continue
    seen.add(hit.line.id)
    all.push({
      line: hit.line,
      direction: hit.direction,
      directionIndex: hit.line.directions.indexOf(hit.direction),
      stop: hit.stop,
      distanceM: Math.max(10, Math.round(hit.distanceM / 10) * 10),
      walkMin: walkMinutes(hit.distanceM),
    })
  }
  return { entries: all.slice(0, max), others: Math.max(0, all.length - max) }
}

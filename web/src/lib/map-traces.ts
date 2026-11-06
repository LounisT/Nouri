// Géométrie des tracés affichés sur la carte — fonctions pures, sans MapLibre,
// testables hors navigateur (web/scripts/map/check-traces.ts).
//
// Tout se calcule en MÈTRES : un découpage en degrés bruts (Math.hypot sur
// lon/lat) ignore cos(lat) ≈ 0,80 à Alger et plaçait la coupure grise de la
// navigation jusqu'à 300 m de la position réelle.

import type { Feature, FeatureCollection, LineString } from 'geojson'
import type { TransitLine } from './lines'
import type { LineShapes } from './line-shapes'

export type LonLat = [number, number]

export function metersBetween(a: LonLat, b: LonLat): number {
  const toRad = (v: number) => (v * Math.PI) / 180
  const dLat = toRad(b[1] - a[1])
  const dLon = toRad(b[0] - a[0])
  const h = Math.sin(dLat / 2) ** 2
    + Math.cos(toRad(a[1])) * Math.cos(toRad(b[1])) * Math.sin(dLon / 2) ** 2
  return 2 * 6371000 * Math.asin(Math.sqrt(h))
}

/** Distance cumulée (m) depuis le premier point, pour chaque point. */
export function cumulativeMeters(coords: LonLat[]): number[] {
  const out: number[] = [0]
  for (let i = 1; i < coords.length; i += 1) out.push(out[i - 1] + metersBetween(coords[i - 1], coords[i]))
  return out
}

/** Cap (degrés, 0 = nord) du segment a → b, en repère local. */
function bearing(a: LonLat, b: LonLat): number {
  const dx = (b[0] - a[0]) * Math.cos((a[1] * Math.PI) / 180)
  const dy = b[1] - a[1]
  return (Math.atan2(dx, dy) * 180) / Math.PI
}

function turnAngle(a: number, b: number): number {
  const d = Math.abs(a - b) % 360
  return d > 180 ? 360 - d : d
}

// Seuils du contrôle d'artefact (constat K29) : une voie relevée est découpée
// tous les 50 à 150 m ; un segment de plus de 300 m qui fait demi-tour ou qui
// revient sur ses pas est un raccord fabriqué par l'assemblage du tracé, pas
// une rue. La longueur seule ne suffit PAS : les voies rapides (101, 604, 19…)
// ont des segments droits légitimes de 400 m.
// Virage : 120° (quasi demi-tour), pas 80° — mesuré sur les tracés OSM
// reconstruits, une longue avenue droite qui finit à angle droit sur une
// rue (10, 19, 66, 72, 606) est une vraie voie. Les six raccords fabriqués
// des anciens tracés (16/88, 50, 82, 105, 606) restent tous détectés.
const ARTIFACT_MIN_SEGMENT_M = 300
const ARTIFACT_TURN_DEG = 120
const ARTIFACT_RETURN_M = 150

/**
 * Indices i des segments [i-1, i] qui sont des artefacts d'assemblage :
 * plus de 300 m ET (virage de plus de 120° avec un voisin OU retour à moins
 * de 150 m d'un point déjà parcouru).
 */
export function findArtifactSegments(coords: LonLat[]): number[] {
  const out: number[] = []
  if (coords.length < 3) return out
  const cumulative = cumulativeMeters(coords)
  // Segment voisin non dégénéré : un point dupliqué (longueur nulle) n'a pas
  // de cap et passerait pour un demi-tour (faux positif mesuré sur la 604).
  const segLength = (k: number) => cumulative[k] - cumulative[k - 1]
  const neighbour = (from: number, step: 1 | -1): number | null => {
    for (let k = from; k >= 1 && k < coords.length; k += step) if (segLength(k) > 1) return k
    return null
  }
  for (let i = 1; i < coords.length; i += 1) {
    const length = segLength(i)
    if (length <= ARTIFACT_MIN_SEGMENT_M) continue
    const here = bearing(coords[i - 1], coords[i])
    const prev = neighbour(i - 1, -1)
    const next = neighbour(i + 1, 1)
    const sharpBefore = prev !== null && turnAngle(bearing(coords[prev - 1], coords[prev]), here) > ARTIFACT_TURN_DEG
    const sharpAfter = next !== null && turnAngle(here, bearing(coords[next - 1], coords[next])) > ARTIFACT_TURN_DEG
    let returns = false
    if (!sharpBefore && !sharpAfter) {
      // Retour sur un point déjà parcouru, assez loin en arrière pour ne pas
      // être le voisin immédiat.
      for (let j = 0; j < i - 1 && !returns; j += 1) {
        if (cumulative[i - 1] - cumulative[j] < ARTIFACT_MIN_SEGMENT_M) break
        if (metersBetween(coords[j], coords[i]) < ARTIFACT_RETURN_M) returns = true
      }
    }
    if (sharpBefore || sharpAfter || returns) out.push(i)
  }
  return out
}

/** Découpe un tracé aux segments artefacts : le saut n'est pas dessiné. */
export function splitAtArtifacts(coords: LonLat[]): { parts: LonLat[][]; cut: number } {
  const artifacts = new Set(findArtifactSegments(coords))
  if (artifacts.size === 0) return { parts: coords.length >= 2 ? [coords] : [], cut: 0 }
  const parts: LonLat[][] = []
  let run: LonLat[] = [coords[0]]
  for (let i = 1; i < coords.length; i += 1) {
    if (artifacts.has(i)) {
      if (run.length >= 2) parts.push(run)
      run = [coords[i]]
    } else {
      run.push(coords[i])
    }
  }
  if (run.length >= 2) parts.push(run)
  return { parts, cut: artifacts.size }
}

/**
 * Coupe une polyligne à `along` mètres de son début (interpolation en mètres
 * sur les distances cumulées). `done` = portion parcourue, `todo` = le reste.
 */
export function splitAtAlong(coords: LonLat[], cumulative: number[], along: number): { done: LonLat[]; todo: LonLat[] } {
  if (coords.length < 2 || along <= 0) return { done: [], todo: coords }
  const total = cumulative[cumulative.length - 1] ?? 0
  if (along >= total) return { done: coords, todo: [] }
  let i = 1
  while (i < cumulative.length && cumulative[i] < along) i += 1
  const span = cumulative[i] - cumulative[i - 1]
  const ratio = span <= 0 ? 0 : (along - cumulative[i - 1]) / span
  const a = coords[i - 1]
  const b = coords[i]
  const cut: LonLat = [a[0] + (b[0] - a[0]) * ratio, a[1] + (b[1] - a[1]) * ratio]
  return { done: [...coords.slice(0, i), cut], todo: [cut, ...coords.slice(i)] }
}

/** Projection d'un point sur le segment [a, b] en repère local métrique. */
function projectOnSegment(p: LonLat, a: LonLat, b: LonLat): { distance: number; t: number } {
  const scaleLon = 111320 * Math.cos((a[1] * Math.PI) / 180)
  const bx = (b[0] - a[0]) * scaleLon
  const by = (b[1] - a[1]) * 111320
  const px = (p[0] - a[0]) * scaleLon
  const py = (p[1] - a[1]) * 111320
  const lengthSq = bx * bx + by * by
  if (lengthSq === 0) return { distance: Math.hypot(px, py), t: 0 }
  const t = Math.max(0, Math.min(1, (px * bx + py * by) / lengthSq))
  return { distance: Math.hypot(px - t * bx, py - t * by), t }
}

/**
 * Position (m le long du tracé) de chaque arrêt, cherchée de façon MONOTONE :
 * chaque arrêt est projeté à partir de la position du précédent. Une ligne qui
 * repasse au même endroit (boucle) ne fait donc pas « reculer » un arrêt sur
 * le premier passage. Repli : projection libre si rien n'est trouvé devant.
 */
export function projectStopsAlong(coords: LonLat[], cumulative: number[], stops: LonLat[], maxOffset = 150): number[] {
  const out: number[] = []
  let fromSegment = 1
  for (const stop of stops) {
    let best: { along: number; distance: number; segment: number } | null = null
    for (let i = fromSegment; i < coords.length; i += 1) {
      const { distance, t } = projectOnSegment(stop, coords[i - 1], coords[i])
      if (best === null || distance < best.distance) {
        best = { along: cumulative[i - 1] + (cumulative[i] - cumulative[i - 1]) * t, distance, segment: i }
      }
      // Premier passage suffisamment proche : on s'y arrête (jamais le point
      // le plus proche dans l'absolu, qui peut être un passage ultérieur).
      if (best.distance <= maxOffset && distance > best.distance + maxOffset) break
    }
    if (!best) {
      out.push(out[out.length - 1] ?? 0)
      continue
    }
    out.push(best.along)
    fromSegment = best.segment
  }
  return out
}

// ── Réseau bus ───────────────────────────────────────────────────────────────

export interface BusLineProps {
  color: string
  /** Numéro court (« 88 ») : repli de filtre quand la direction est inconnue. */
  name: string
  /** `${line.id}|${directionIndex}` — clé stable d'une direction. */
  key: string
  /** `${shortName}|${headsign}` — même clé que les tronçons OTP. */
  hkey: string
  lineId: string
  dir: number
  /** Tracé déduit de la voirie (non relevé) : dessiné en tirets. */
  deduced: boolean
}

/** Provenance du tracé telle que la donnée la déclare (champ facultatif). */
export function directionShapeStatus(direction: { shapeSource?: string }, shape: number[][] | undefined): 'surveyed' | 'deduced' | 'unmapped' {
  const source = (direction.shapeSource ?? '').toLowerCase()
  if (!shape || shape.length < 2) return 'unmapped'
  // Valeurs « pas de tracé » que la couche données pourrait déclarer : on
  // n'approxime pas, on ne dessine rien.
  if (['none', 'absent', 'unmapped', 'stops', 'arrets', 'schematic', 'schematique'].includes(source)) return 'unmapped'
  if (['deduit', 'deduced', 'estimated', 'estime'].includes(source)) return 'deduced'
  return 'surveyed'
}

export interface BusNetworkGeoJSON {
  data: FeatureCollection<LineString, BusLineProps>
  /** Directions sans tracé exploitable : aucun trait dessiné. */
  unmapped: Set<string>
  /** Directions dont une portion douteuse n'est pas dessinée. */
  truncated: Set<string>
}

/**
 * Une LineString par DIRECTION (et par portion continue). Aucune géométrie
 * n'est inventée : une direction sans tracé n'a AUCUN trait — avant, les
 * arrêts étaient reliés en ligne droite jusqu'à 400 m, ce qui dessinait des
 * rues qui n'existent pas.
 */
export function buildBusNetwork(lines: TransitLine[], shapes: LineShapes): BusNetworkGeoJSON {
  const features: Feature<LineString, BusLineProps>[] = []
  const unmapped = new Set<string>()
  const truncated = new Set<string>()
  for (const line of lines) {
    const lineShapes = shapes[line.id] ?? []
    line.directions.forEach((direction, dir) => {
      const key = `${line.id}|${dir}`
      const shape = lineShapes[dir] as LonLat[] | undefined
      const status = directionShapeStatus(direction, shape)
      if (status === 'unmapped' || !shape) {
        unmapped.add(key)
        return
      }
      const { parts, cut } = splitAtArtifacts(shape)
      if (cut > 0) truncated.add(key)
      for (const part of parts) {
        features.push({
          type: 'Feature',
          geometry: { type: 'LineString', coordinates: part },
          properties: {
            color: line.color || '#D97706',
            name: line.shortName,
            key,
            hkey: `${line.shortName}|${direction.headsign}`,
            lineId: line.id,
            dir,
            deduced: status === 'deduced',
          },
        })
      }
    })
  }
  return { data: { type: 'FeatureCollection', features }, unmapped, truncated }
}

/** Emprise [ouest, sud, est, nord] d'un ensemble de points. */
export function boundsOf(coords: LonLat[]): [number, number, number, number] | null {
  if (coords.length === 0) return null
  let w = Infinity
  let s = Infinity
  let e = -Infinity
  let n = -Infinity
  for (const [lon, lat] of coords) {
    if (lon < w) w = lon
    if (lon > e) e = lon
    if (lat < s) s = lat
    if (lat > n) n = lat
  }
  return [w, s, e, n]
}

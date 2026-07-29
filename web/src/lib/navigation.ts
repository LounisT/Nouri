// Progression de navigation fondée sur la POSITION réelle.
//
// La progression était auparavant purement chronométrique : elle avançait avec
// l'horloge, quel que soit l'endroit où se trouvait l'usager. Un bus en retard,
// un feu rouge, et l'app annonçait une descente qui n'avait pas eu lieu.
// Ici, on projette la position GPS sur le tracé du trajet pour savoir où l'on
// est réellement — et l'horloge ne sert plus que de repli quand la position
// est indisponible (http non sécurisé, permission refusée, signal perdu).

import { legCoordinates, type OtpItinerary, type OtpLeg } from './otp'

export interface LegGeometryCache {
  coords: [number, number][]
  /** Distance cumulée (m) depuis le début du tronçon, pour chaque point. */
  cumulative: number[]
  length: number
}

export interface NavProgress {
  legIndex: number
  /** Fraction parcourue du tronçon courant, 0 → 1. */
  legProgress: number
  /** Mètres restants sur le tronçon courant. */
  remainingMeters: number
  /** Secondes restantes estimées jusqu'à la fin du trajet. */
  remainingSeconds: number
  /** Arrêts encore à parcourir avant la descente (tronçon transport). */
  stopsLeft: number | null
  /** D'où vient la mesure — l'app doit pouvoir le dire honnêtement. */
  source: 'gps' | 'time'
  /** Écart entre la position et le tracé (m), seulement en source 'gps'. */
  offRouteMeters?: number
}

export function metersBetween(a: [number, number], b: [number, number]): number {
  const dLat = (a[1] - b[1]) * 111320
  const dLon = (a[0] - b[0]) * 111320 * Math.cos((a[1] * Math.PI) / 180)
  return Math.hypot(dLat, dLon)
}

/** Géométrie décodée + distances cumulées, calculée une fois par trajet. */
export function buildLegGeometries(itinerary: OtpItinerary): LegGeometryCache[] {
  return itinerary.legs.map((leg) => {
    // Même géométrie que la carte (raccordée aux arrêts) : deux polylignes
    // différentes feraient diverger la position projetée du trait affiché.
    const coords = legCoordinates(leg)
    const cumulative: number[] = [0]
    let total = 0
    for (let i = 1; i < coords.length; i += 1) {
      total += metersBetween(coords[i - 1], coords[i])
      cumulative.push(total)
    }
    return { coords, cumulative, length: total }
  })
}

/** Point du segment [a,b] le plus proche de p, et sa position sur le segment. */
function projectOnSegment(
  p: [number, number],
  a: [number, number],
  b: [number, number],
): { distance: number; t: number } {
  // Repère local en mètres : à l'échelle d'un segment, l'approximation plane
  // est exacte à moins d'un centimètre près.
  const scaleLon = 111320 * Math.cos((a[1] * Math.PI) / 180)
  const ax = 0
  const ay = 0
  const bx = (b[0] - a[0]) * scaleLon
  const by = (b[1] - a[1]) * 111320
  const px = (p[0] - a[0]) * scaleLon
  const py = (p[1] - a[1]) * 111320

  const dx = bx - ax
  const dy = by - ay
  const lengthSq = dx * dx + dy * dy
  if (lengthSq === 0) return { distance: Math.hypot(px, py), t: 0 }

  let t = (px * dx + py * dy) / lengthSq
  t = Math.max(0, Math.min(1, t))
  const distance = Math.hypot(px - t * dx, py - t * dy)
  return { distance, t }
}

interface Projection {
  legIndex: number
  /** Distance parcourue le long du tronçon (m). */
  along: number
  /** Distance de la position au tracé (m). */
  offRoute: number
}

/**
 * Projette la position sur l'ensemble du trajet et retient le point le plus
 * proche. `minLegIndex` empêche de revenir en arrière sur un trajet qui repasse
 * au même endroit (boucle, aller-retour) : on ne considère que les tronçons
 * déjà atteints ou suivants.
 */
function projectOnItinerary(
  position: [number, number],
  geometries: LegGeometryCache[],
  minLegIndex: number,
): Projection | null {
  let best: Projection | null = null

  for (let legIndex = minLegIndex; legIndex < geometries.length; legIndex += 1) {
    const { coords, cumulative } = geometries[legIndex]
    for (let i = 1; i < coords.length; i += 1) {
      const { distance, t } = projectOnSegment(position, coords[i - 1], coords[i])
      if (best === null || distance < best.offRoute) {
        const segmentLength = cumulative[i] - cumulative[i - 1]
        best = {
          legIndex,
          along: cumulative[i - 1] + segmentLength * t,
          offRoute: distance,
        }
      }
    }
  }

  return best
}

/** Repli chronométrique : la progression suit les durées prévues. */
export function progressFromElapsed(itinerary: OtpItinerary, elapsedMs: number): NavProgress {
  const cumulative: number[] = []
  itinerary.legs.reduce((acc, leg) => {
    const end = acc + leg.duration * 1000
    cumulative.push(end)
    return end
  }, 0)

  const raw = cumulative.findIndex((end) => end > elapsedMs)
  const legIndex = raw === -1 ? itinerary.legs.length - 1 : raw
  const leg = itinerary.legs[legIndex]
  const legStart = cumulative[legIndex] - leg.duration * 1000
  const legProgress = Math.min(1, Math.max(0,
    (elapsedMs - legStart) / Math.max(1, leg.duration * 1000),
  ))
  const totalMs = cumulative[cumulative.length - 1] ?? 0

  return {
    legIndex,
    legProgress,
    remainingMeters: Math.max(0, leg.distance * (1 - legProgress)),
    remainingSeconds: Math.max(0, Math.round((totalMs - elapsedMs) / 1000)),
    stopsLeft: stopsLeftFor(leg, legProgress),
    source: 'time',
  }
}

/** Arrêts restants avant la descente, au prorata de l'avancement du tronçon. */
function stopsLeftFor(leg: OtpLeg, legProgress: number): number | null {
  if (leg.mode === 'WALK') return null
  const total = (leg.intermediateStops?.length ?? 0) + 1
  return Math.max(1, Math.ceil((1 - legProgress) * total))
}

/**
 * Progression réelle depuis la position GPS. Retourne `null` si la position est
 * trop éloignée du trajet pour être exploitable — l'appelant retombe alors sur
 * l'horloge plutôt que d'afficher une avancée fantaisiste.
 */
export function progressFromPosition(
  itinerary: OtpItinerary,
  geometries: LegGeometryCache[],
  position: [number, number],
  minLegIndex = 0,
  maxOffRouteMeters = 250,
): NavProgress | null {
  const projection = projectOnItinerary(position, geometries, minLegIndex)
  if (!projection || projection.offRoute > maxOffRouteMeters) return null

  const { legIndex, along, offRoute } = projection
  const geometry = geometries[legIndex]
  const leg = itinerary.legs[legIndex]
  const legProgress = geometry.length > 0 ? Math.min(1, Math.max(0, along / geometry.length)) : 0

  // Temps restant : la part non parcourue du tronçon courant, plus les
  // tronçons suivants dans leur intégralité.
  let remainingSeconds = leg.duration * (1 - legProgress)
  for (let i = legIndex + 1; i < itinerary.legs.length; i += 1) {
    remainingSeconds += itinerary.legs[i].duration
  }

  return {
    legIndex,
    legProgress,
    remainingMeters: Math.max(0, geometry.length - along),
    remainingSeconds: Math.max(0, Math.round(remainingSeconds)),
    stopsLeft: stopsLeftForPosition(leg, geometry, along),
    source: 'gps',
    offRouteMeters: offRoute,
  }
}

/**
 * Arrêts restants comptés géographiquement : ceux dont la projection sur le
 * tracé est encore devant l'usager. Bien plus juste qu'un prorata de durée
 * quand le bus prend du retard.
 */
function stopsLeftForPosition(
  leg: OtpLeg,
  geometry: LegGeometryCache,
  along: number,
): number | null {
  if (leg.mode === 'WALK') return null
  const stops = leg.intermediateStops ?? []
  if (stops.length === 0) return 1 // seul l'arrêt de descente reste

  let ahead = 0
  for (const stop of stops) {
    const projection = projectPointAlong([stop.lon, stop.lat], geometry)
    if (projection > along) ahead += 1
  }
  return ahead + 1 // + l'arrêt de descente
}

/** Distance le long du tracé du point du tracé le plus proche de `point`. */
function projectPointAlong(point: [number, number], geometry: LegGeometryCache): number {
  const { coords, cumulative } = geometry
  let bestDistance = Infinity
  let bestAlong = 0
  for (let i = 1; i < coords.length; i += 1) {
    const { distance, t } = projectOnSegment(point, coords[i - 1], coords[i])
    if (distance < bestDistance) {
      bestDistance = distance
      bestAlong = cumulative[i - 1] + (cumulative[i] - cumulative[i - 1]) * t
    }
  }
  return bestAlong
}

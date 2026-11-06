// Navigation pas à pas : machine à états PURE, rejouable hors navigateur
// (banc d'essai : web/scripts/nav).
//
//   advance(state, événement, itinéraire, géométries) → nouvel état
//   navView(state, itinéraire, géométries, maintenant) → ce qu'on affiche
//
// Pourquoi une machine à états. L'ancienne version projetait chaque position
// sur TOUT le trajet et gardait le point le plus proche, avec un cliquet qui
// interdisait de revenir en arrière. Or la marche vers l'arrêt longe souvent
// la rue du bus : la projection sautait sur le bus 200 m avant l'arrêt, le
// cliquet verrouillait, et l'app disait « Descendez à… » à un piéton (K1).
// Ici, chaque position n'est projetée que sur une FENÊTRE du tronçon courant,
// et le passage au tronçon suivant obéit à des règles explicites :
//   - fin de marche à l'arrêt → « Attendez le bus » (jamais « Descendez »),
//   - montée à bord seulement si l'on s'éloigne de l'arrêt À VITESSE DE
//     VÉHICULE, ou si l'usager le dit (« Je suis à bord »),
//   - recalage après une coupure (métro souterrain) sur deux positions
//     concordantes, jamais sur une seule.
//
// Honnêteté. L'état ne contient que ce qui a été CONSTATÉ (GPS ou usager).
// L'horloge ne sert qu'à une estimation affichée à part (« ~ », « estimé
// d'après la durée prévue ») et ne fait jamais avancer l'état constaté.
// Aucune attente n'est décomptée : à Alger, pas de temps réel.

import { isSchematicLeg, legCoordinates, type OtpItinerary, type OtpLeg } from './otp'
import { simplifyWalkSteps } from './walk-steps'

// ─── Réglages (mesurés sur le banc d'essai, voir web/scripts/nav) ──────────

/** Au-delà, une position ne sert pas au suivi (réseau cellulaire, Wi-Fi). */
export const MAX_USABLE_ACCURACY_M = 100
/** Une position plus vieille que ça n'est plus « actuelle ». */
export const FRESH_FIX_MS = 30_000
/** Vitesse maximale plausible (métro ~ 80 km/h) : borne la fenêtre avant. */
const MAX_SPEED_MS = 25
/** Fenêtre avant minimale en véhicule (une seconde à 25 m/s, et de la marge). */
const MIN_FORWARD_RIDE_M = 150
/** À pied : 40 m + 4 m/s (pas de course) — une rue qui revient sur elle-même
 * 60 m plus loin ne doit pas « aspirer » la position vers la fin du tronçon. */
const WALK_FORWARD_BASE_M = 40
const WALK_MAX_SPEED = 4
/** Une marche intermédiaire reste affichée au moins ce temps (jamais sautée). */
const MIN_WALK_DISPLAY_MS = 8_000
/** Portion du tronçon suivant considérée pour un passage anticipé. */
const NEXT_WINDOW_M = 250
/** Le tronçon suivant doit coller mieux d'au moins ça… */
const NEXT_MARGIN_M = 25
/** … sur autant de positions consécutives. */
const NEXT_CONFIRM = 3
/** Montée à bord : distance minimale parcourue depuis l'arrêt. */
const BOARD_MIN_ALONG_M = 100
/** Vitesse de véhicule : GPS (Doppler) / estimée sur le déplacement. */
const BOARD_GPS_SPEED = 3
const BOARD_TRACK_SPEED = 3.5
/** Bus pris dans un embouteillage : loin de l'arrêt, plus vite qu'un piéton. */
const BOARD_FAR_ALONG_M = 200
const BOARD_FAR_SPEED = 2.2
const BOARD_CONFIRM = 2
/** Un recul n'est admis que s'il dépasse ça sur 3 positions. */
const BACK_CONFIRM_M = 60
/** Positions hors fenêtre consécutives avant de chercher sur tout le trajet. */
const LOST_FIXES = 3
/** Positions hors trajet consécutives avant de le dire à l'usager. */
const OFF_ROUTE_FIXES = 3
/** Un arrêt est dépassé quand on l'a passé d'au moins ça. */
const STOP_PASSED_M = 15
/** Un segment plus long n'est pas un tracé relevé mais une droite entre arrêts. */
const APPROX_SEGMENT_M = 400
/**
 * Positions consécutives constatées à bord avant « Descendez au prochain
 * arrêt » : autant que pour passer à la marche suivante (NEXT_CONFIRM), pour
 * que l'usager déjà sorti dans la rue soit reconnu à pied AVANT l'alerte.
 */
const APPROACH_CONFIRM = 3
/** Recalage en fin de tronçon de transport : la marche suivante est-elle déjà en cours ? */
const EXIT_END_MARGIN_M = 100
const EXIT_WALK_START_M = 150
/**
 * Marche perdue « à la station » : la coupure a commencé à moins de ça de
 * son bout (escalier d'une station souterraine : 40 à 100 m du point GTFS).
 */
const LOST_NEAR_STOP_M = 150
/** … et au plus ce délai après la dernière position constatée sur la marche. */
const LOST_NEAR_STOP_MS = 60_000

// ─── Géométrie ──────────────────────────────────────────────────────────────

export interface LegGeometryCache {
  coords: [number, number][]
  /** Distance cumulée (m) depuis le début du tronçon, pour chaque point. */
  cumulative: number[]
  length: number
  /**
   * Abscisse (m) de chaque arrêt intermédiaire, CROISSANTE : chaque arrêt est
   * cherché après le précédent, pour qu'une ligne qui repasse près d'elle-même
   * ne place pas un arrêt sur le mauvais passage.
   */
  stopAlongs: number[]
  /** Abscisse de chaque consigne de marche (simplifyWalkSteps), croissante. */
  stepAlongs: number[]
  /**
   * Tracé approximatif : des droites entre arrêts (métro, tram, lignes sans
   * shape). L'écart au trait n'y signifie rien : ni détection de sortie
   * d'itinéraire, ni tolérance serrée.
   */
  approximate: boolean
}

export function metersBetween(a: [number, number], b: [number, number]): number {
  const dLat = (a[1] - b[1]) * 111320
  const dLon = (a[0] - b[0]) * 111320 * Math.cos((a[1] * Math.PI) / 180)
  return Math.hypot(dLat, dLon)
}

/** Géométrie décodée + abscisses, calculée une fois par trajet. */
export function buildLegGeometries(itinerary: OtpItinerary): LegGeometryCache[] {
  return itinerary.legs.map((leg) => {
    // Même géométrie que la carte : deux polylignes différentes feraient
    // diverger la position projetée du trait affiché.
    let coords = legCoordinates(leg)
    // Géométrie absente ou réduite à un point : on ne peut que relier les
    // deux extrémités pour les calculs (jamais affiché comme un tracé).
    const degenerate = coords.length < 2
    if (degenerate) coords = [[leg.from.lon, leg.from.lat], [leg.to.lon, leg.to.lat]]
    const cumulative: number[] = [0]
    let total = 0
    let longest = 0
    for (let i = 1; i < coords.length; i += 1) {
      const d = metersBetween(coords[i - 1], coords[i])
      total += d
      longest = Math.max(longest, d)
      cumulative.push(total)
    }
    const geometry: LegGeometryCache = {
      coords,
      cumulative,
      length: total,
      stopAlongs: [],
      stepAlongs: [],
      // Droites entre arrêts : segment démesuré, ou tracé reconnu comme
      // schématique par otp.ts (bus sans shape relié arrêt à arrêt).
      approximate: degenerate || (leg.mode !== 'WALK' && (longest > APPROX_SEGMENT_M || isSchematicLeg(leg))),
    }
    geometry.stopAlongs = orderedAlongs(
      (leg.intermediateStops ?? []).map((s) => [s.lon, s.lat] as [number, number]),
      geometry,
    )
    geometry.stepAlongs = leg.mode === 'WALK'
      ? orderedAlongs(simplifyWalkSteps(leg).map((s) => [s.lon, s.lat] as [number, number]), geometry)
      : []
    return geometry
  })
}

/** Point du tracé à une abscisse donnée (m). */
export function pointAtAlong(g: LegGeometryCache, along: number): [number, number] {
  const a = Math.max(0, Math.min(g.length, along))
  for (let i = 1; i < g.coords.length; i += 1) {
    if (g.cumulative[i] >= a) {
      const seg = g.cumulative[i] - g.cumulative[i - 1]
      const r = seg > 0 ? (a - g.cumulative[i - 1]) / seg : 0
      const p0 = g.coords[i - 1]
      const p1 = g.coords[i]
      return [p0[0] + (p1[0] - p0[0]) * r, p0[1] + (p1[1] - p0[1]) * r]
    }
  }
  return g.coords[g.coords.length - 1]
}

/**
 * Coupe un tracé à une abscisse EN MÈTRES (partie parcourue / restante), pour
 * que la carte grise exactement ce que le bandeau compte (constat K5 : la
 * coupe en degrés bruts tombait jusqu'à 311 m à côté de la position).
 */
export function splitAtAlong(g: LegGeometryCache, along: number): { done: [number, number][]; rest: [number, number][] } {
  const a = Math.max(0, Math.min(g.length, along))
  const done: [number, number][] = [g.coords[0]]
  let i = 1
  while (i < g.coords.length && g.cumulative[i] < a) {
    done.push(g.coords[i])
    i += 1
  }
  const cut = pointAtAlong(g, a)
  done.push(cut)
  return { done, rest: [cut, ...g.coords.slice(i)] }
}

/** Point du segment [a,b] le plus proche de p, borné à t ∈ [tMin, tMax]. */
function projectOnSegment(
  p: [number, number],
  a: [number, number],
  b: [number, number],
  tMin = 0,
  tMax = 1,
): { distance: number; t: number } {
  // Repère local en mètres : à l'échelle d'un segment, l'approximation plane
  // est exacte à moins d'un centimètre près.
  const scaleLon = 111320 * Math.cos((a[1] * Math.PI) / 180)
  const bx = (b[0] - a[0]) * scaleLon
  const by = (b[1] - a[1]) * 111320
  const px = (p[0] - a[0]) * scaleLon
  const py = (p[1] - a[1]) * 111320
  const lengthSq = bx * bx + by * by
  let t = lengthSq === 0 ? 0 : (px * bx + py * by) / lengthSq
  t = Math.max(tMin, Math.min(tMax, t))
  return { distance: Math.hypot(px - t * bx, py - t * by), t }
}

interface RangeProjection {
  along: number
  dist: number
}

/** Projection de p sur la portion [lo, hi] (m) d'un tronçon. */
function projectRange(p: [number, number], g: LegGeometryCache, lo: number, hi: number): RangeProjection {
  const { coords, cumulative } = g
  let best: RangeProjection = { along: Math.max(0, Math.min(lo, g.length)), dist: Infinity }
  for (let i = 1; i < coords.length; i += 1) {
    const c0 = cumulative[i - 1]
    const c1 = cumulative[i]
    if (c1 < lo || c0 > hi) continue
    const len = c1 - c0
    const tMin = len > 0 ? Math.max(0, (lo - c0) / len) : 0
    const tMax = len > 0 ? Math.min(1, (hi - c0) / len) : 1
    if (tMin > tMax) continue
    const { distance, t } = projectOnSegment(p, coords[i - 1], coords[i], tMin, tMax)
    if (distance < best.dist) best = { along: c0 + len * t, dist: distance }
  }
  if (best.dist === Infinity && coords.length > 0) {
    best = { along: 0, dist: metersBetween(p, coords[0]) }
  }
  return best
}

/**
 * Abscisses d'une suite ordonnée de points (arrêts, consignes) : chacun est
 * cherché APRÈS le précédent, au premier passage proche (minimum local), pas
 * au point le plus proche de tout le tracé.
 */
function orderedAlongs(points: [number, number][], g: LegGeometryCache): number[] {
  const out: number[] = []
  let from = 0
  for (const p of points) {
    const candidates: RangeProjection[] = []
    let bestDist = Infinity
    for (let i = 1; i < g.coords.length; i += 1) {
      const c0 = g.cumulative[i - 1]
      const c1 = g.cumulative[i]
      if (c1 < from) continue
      const len = c1 - c0
      const tMin = len > 0 ? Math.max(0, (from - c0) / len) : 0
      const { distance, t } = projectOnSegment(p, g.coords[i - 1], g.coords[i], tMin, 1)
      candidates.push({ along: c0 + len * t, dist: distance })
      bestDist = Math.min(bestDist, distance)
    }
    let along = from
    if (candidates.length > 0) {
      const tolerance = bestDist + Math.max(25, bestDist * 0.5)
      let k = candidates.findIndex((c) => c.dist <= tolerance)
      // Descendre jusqu'au minimum local de ce premier passage.
      while (k + 1 < candidates.length && candidates[k + 1].dist <= candidates[k].dist) k += 1
      along = candidates[Math.max(0, k)].along
    }
    along = Math.min(g.length, Math.max(from, along))
    out.push(along)
    from = along
  }
  return out
}

/**
 * Premier tronçon (dans l'ordre du trajet) qui explique la position, avec une
 * tolérance serrée. Le plus proche de tous ne convient pas : quand la marche
 * longe la rue du bus, le tracé du bus est souvent plus près du point que le
 * trottoir — et l'on sauterait à bord d'un bus jamais pris.
 */
function projectEarliest(
  p: [number, number],
  geometries: LegGeometryCache[],
  fromLeg: number,
  accuracy: number,
): { legIndex: number; along: number; dist: number }[] {
  // Tous les tronçons qui l'expliquent, dans l'ordre du trajet : le premier
  // est retenu, sauf s'il s'agit d'un tracé approximatif de transport que le
  // recalage refuse (voir applyFix).
  const out: { legIndex: number; along: number; dist: number }[] = []
  for (let legIndex = fromLeg; legIndex < geometries.length; legIndex += 1) {
    const g = geometries[legIndex]
    const r = projectRange(p, g, 0, g.length)
    const tolerance = g.approximate ? onRouteTolerance(g, accuracy) : Math.max(40, 1.5 * accuracy)
    if (r.dist <= tolerance) out.push({ legIndex, along: r.along, dist: r.dist })
  }
  return out
}

/**
 * Distance (m) de la position au trajet restant. Un tracé approximatif la
 * « retient » (0) dans sa marge, mais seulement si l'on est dessus ou si l'on
 * roule : un métro sous la ville ou un bus sans tracé à venir ne prouve pas
 * qu'un PIÉTON est sur son chemin.
 */
function routeDistance(
  p: [number, number],
  geometries: LegGeometryCache[],
  fromLeg: number,
  currentLeg: number,
  accuracy: number,
  moving: boolean,
): number {
  let nearest = Infinity
  for (let legIndex = fromLeg; legIndex < geometries.length; legIndex += 1) {
    const g = geometries[legIndex]
    if (g.approximate && legIndex !== currentLeg && !moving) continue
    const d = projectRange(p, g, 0, g.length).dist
    if (g.approximate) {
      if (d <= onRouteTolerance(g, accuracy)) return 0
    } else {
      nearest = Math.min(nearest, d)
    }
  }
  return nearest
}

/** Arrêts restants avant la descente, arrêt de descente compris (≥ 1). */
export function stopsLeftAt(g: LegGeometryCache, along: number): number {
  let ahead = 0
  for (const a of g.stopAlongs) if (a > along - STOP_PASSED_M) ahead += 1
  return ahead + 1
}

/** Index du prochain arrêt intermédiaire, ou -1 si c'est l'arrêt de descente. */
export function nextStopIndexAt(g: LegGeometryCache, along: number): number {
  return g.stopAlongs.findIndex((a) => a > along - STOP_PASSED_M)
}

/**
 * Distance maximale au tracé pour qu'une position compte « sur » ce tronçon.
 * Sur un tracé approximatif (droites entre arrêts), le véhicule peut rouler à
 * plusieurs centaines de mètres du trait : très large à bord, plus serré
 * ailleurs pour ne pas absorber un piéton qui s'est trompé de rue.
 */
function onRouteTolerance(g: LegGeometryCache, accuracy: number, riding = false): number {
  if (g.approximate) return Math.max(riding ? 1500 : 500, 2 * accuracy)
  return Math.max(75, 2 * accuracy)
}

function offRouteTolerance(accuracy: number): number {
  return Math.max(100, 2 * accuracy)
}

/** Rayon d'arrivée en bout de tronçon (jamais plus de la moitié d'un tronçon court). */
function endRadius(g: LegGeometryCache, accuracy: number): number {
  return Math.min(25 + Math.min(accuracy, 35), Math.max(12, g.length / 2))
}

const isTransit = (leg: OtpLeg | undefined) => Boolean(leg) && leg!.mode !== 'WALK'

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.floor(sorted.length / 2)]
}

// ─── État ───────────────────────────────────────────────────────────────────

export type NavPhase = 'walk' | 'wait' | 'ride' | 'arrived'
export type NavSource = 'gps' | 'stale' | 'time'

export interface NavFix {
  lon: number
  lat: number
  /** Rayon de précision (m). */
  accuracy: number
  /** Horloge du téléphone à la réception (pos.timestamp n'est pas fiable partout). */
  receivedAt: number
  /** Vitesse GPS (m/s) quand le téléphone la fournit. */
  speed?: number | null
}

export interface NavState {
  version: 1
  startedAt: number
  /** Dernier instant traité (position ou tic d'horloge). */
  now: number
  legIndex: number
  phase: NavPhase
  /** Abscisse CONSTATÉE (m) sur le tronçon courant ; ne recule que sur preuve. */
  along: number
  /** Arrêts restants constatés ; ne remonte jamais sans recul prouvé. */
  stopsLeft: number | null
  /** Instant où (tronçon, phase, abscisse) a été constaté pour la dernière fois. */
  anchorAt: number
  legEnteredAt: number
  /** Arrivée à l'arrêt : sert au plafond d'attente dans l'heure d'arrivée. */
  waitStartedAt: number | null
  boardedBy: 'gps' | 'user' | null
  /** Dernière position UTILISABLE (précise) traitée. */
  lastFixAt: number | null
  lastFixAccuracy: number | null
  /** Dernière position reçue, même imprécise. */
  lastSeenAt: number | null
  lastSeenAccuracy: number | null
  /** Positions acceptées récentes [instant, lon, lat, précision]. */
  track: [number, number, number, number][]
  /** Dernière fois que l'usager a été vu à l'arrêt (attente). */
  stopSeenAt: number | null
  /** Positions consécutives physiquement impossibles (saut Wi-Fi, réseau). */
  implausible: number
  /** Dernières projections brutes sur le tronçon : on avance sur leur médiane. */
  recentAlongs: number[]
  nextHits: number
  boardHits: number
  missCount: number
  backCount: number
  offCount: number
  offRoute: { meters: number; since: number } | null
  candidate: { legIndex: number; along: number; at: number } | null
  arrivedAt: number | null
  /**
   * Positions fraîches constatées SUR le tronçon courant depuis qu'on y est
   * entré à bord. L'alerte « Descendez au prochain arrêt » en exige trois : la
   * seule position d'un recalage (projetée sur un tracé approximatif) ne
   * distingue pas la rue devant la station de la ligne elle-même.
   * (Absent d'une session enregistrée avant ce champ : compté comme 0.)
   */
  rideConfirmedFixes?: number
  /**
   * Dernière position utilisable reçue AVANT la plus récente coupure de plus
   * de FRESH_FIX_MS (métro, poche, tunnel). Sert à reconnaître une marche
   * perdue juste avant l'arrêt : voir walkLostNearStop.
   */
  gapAt?: number | null
}

export type NavEvent =
  | { type: 'fix'; fix: NavFix }
  | { type: 'tick'; now: number }
  /** L'usager confirme être monté (indispensable sans GPS, et sous terre). */
  | { type: 'boarded'; now: number; legIndex: number }

export function createNavState(
  itinerary: OtpItinerary,
  geometries: LegGeometryCache[],
  now: number,
): NavState {
  const first = itinerary.legs[0]
  const transit = isTransit(first)
  return {
    version: 1,
    startedAt: now,
    now,
    legIndex: 0,
    phase: transit ? 'wait' : 'walk',
    along: 0,
    stopsLeft: transit ? stopsLeftAt(geometries[0], 0) : null,
    anchorAt: now,
    legEnteredAt: now,
    waitStartedAt: transit ? now : null,
    boardedBy: null,
    lastFixAt: null,
    lastFixAccuracy: null,
    lastSeenAt: null,
    lastSeenAccuracy: null,
    track: [],
    stopSeenAt: transit ? now : null,
    implausible: 0,
    recentAlongs: [],
    nextHits: 0,
    boardHits: 0,
    missCount: 0,
    backCount: 0,
    offCount: 0,
    offRoute: null,
    candidate: null,
    arrivedAt: null,
    rideConfirmedFixes: 0,
    gapAt: null,
  }
}

function enterLeg(
  s: NavState,
  itinerary: OtpItinerary,
  geometries: LegGeometryCache[],
  legIndex: number,
  along: number,
  now: number,
  boardedBy: 'gps' | 'user' | null,
): NavState {
  const leg = itinerary.legs[legIndex]
  const transit = isTransit(leg)
  const phase: NavPhase = !transit ? 'walk' : boardedBy ? 'ride' : 'wait'
  return {
    ...s,
    legIndex,
    phase,
    along: Math.max(0, Math.min(along, geometries[legIndex].length)),
    stopsLeft: transit ? stopsLeftAt(geometries[legIndex], phase === 'ride' ? along : 0) : null,
    anchorAt: now,
    legEnteredAt: now,
    waitStartedAt: phase === 'wait' ? now : null,
    boardedBy: phase === 'ride' ? boardedBy : null,
    stopSeenAt: phase === 'wait' ? now : null,
    recentAlongs: [],
    nextHits: 0,
    boardHits: 0,
    missCount: 0,
    backCount: 0,
    candidate: null,
    rideConfirmedFixes: 0,
  }
}

function arrive(s: NavState, geometries: LegGeometryCache[], now: number): NavState {
  const last = geometries.length - 1
  return {
    ...s,
    legIndex: last,
    phase: 'arrived',
    along: geometries[last].length,
    stopsLeft: s.stopsLeft === null ? null : 1,
    anchorAt: now,
    arrivedAt: now,
    offRoute: null,
    candidate: null,
  }
}

/** Vitesse sur le terrain (m/s) entre la position actuelle et celle d'il y a 6 à 20 s. */
function groundSpeed(track: NavState['track']): number | null {
  if (track.length < 2) return null
  const [tNow, lonNow, latNow] = track[track.length - 1]
  let ref: NavState['track'][number] | null = null
  for (const entry of track) {
    const dt = (tNow - entry[0]) / 1000
    if (dt <= 20 && dt >= 6) { ref = entry; break }
  }
  if (!ref) return null
  return metersBetween([lonNow, latNow], [ref[1], ref[2]]) / ((tNow - ref[0]) / 1000)
}

/**
 * Preuve de mouvement EN VÉHICULE le long du tronçon de transport : assez
 * loin de l'arrêt, et à une vitesse qu'un piéton ne tient pas. Une vitesse
 * physiquement impossible (> 25 m/s) n'est pas une preuve mais une position
 * aberrante.
 */
function vehicleEvidence(
  s: NavState,
  fix: NavFix,
  alongOnTransit: number,
  now: number,
  walkedToStop = false,
): boolean {
  if (alongOnTransit < BOARD_MIN_ALONG_M) return false
  const plausible = (v: number | null) => v !== null && v <= MAX_SPEED_MS
  const gpsSpeed = typeof fix.speed === 'number' && Number.isFinite(fix.speed) && fix.speed >= 0 ? fix.speed : null
  const speed = groundSpeed(s.track)
  if (plausible(gpsSpeed) && gpsSpeed! > BOARD_GPS_SPEED && (speed === null || (plausible(speed) && speed > 1.5))) return true
  if (gpsSpeed === null && plausible(speed) && speed! > BOARD_TRACK_SPEED) return true
  // Bus au pas dans un embouteillage, ou position retrouvée après une
  // coupure : loin de l'arrêt, et plus vite qu'un piéton EN MOYENNE depuis
  // la dernière fois qu'on l'y a vu. Quand la position s'est perdue AVANT
  // l'arrêt (escalier d'une station souterraine, à 40-100 m du point GTFS),
  // on ne l'y a jamais vu : la référence est alors la dernière position
  // constatée sur la marche qui y menait (`walkedToStop`, recalage seulement).
  // Partie de plus loin que l'arrêt, la moyenne n'en est que sous-estimée :
  // un piéton ne la dépasse pas.
  const seenAt = s.stopSeenAt ?? (walkedToStop ? s.anchorAt : null)
  if (alongOnTransit >= BOARD_FAR_ALONG_M && seenAt !== null) {
    const avg = alongOnTransit / Math.max(1, (now - seenAt) / 1000)
    if (avg > BOARD_FAR_SPEED && avg <= MAX_SPEED_MS) return true
  }
  return false
}

// ─── Transition ─────────────────────────────────────────────────────────────

export function advance(
  state: NavState,
  event: NavEvent,
  itinerary: OtpItinerary,
  geometries: LegGeometryCache[],
): NavState {
  if (event.type === 'tick') {
    return event.now > state.now ? { ...state, now: event.now } : state
  }
  if (event.type === 'boarded') {
    const leg = itinerary.legs[event.legIndex]
    if (state.phase === 'arrived' || event.legIndex < state.legIndex || !isTransit(leg)) return state
    if (event.legIndex === state.legIndex && state.phase === 'ride') return state
    const along = event.legIndex === state.legIndex ? state.along : 0
    return { ...enterLeg(state, itinerary, geometries, event.legIndex, along, event.now, 'user'), now: Math.max(state.now, event.now) }
  }
  return applyFix(state, event.fix, itinerary, geometries)
}

function applyFix(
  prev: NavState,
  fix: NavFix,
  itinerary: OtpItinerary,
  geometries: LegGeometryCache[],
): NavState {
  const now = fix.receivedAt
  // Doublon ou position arrivée dans le désordre : ignorée.
  if (prev.lastSeenAt !== null && now <= prev.lastSeenAt) return prev
  let s: NavState = {
    ...prev,
    now: Math.max(prev.now, now),
    lastSeenAt: now,
    lastSeenAccuracy: fix.accuracy,
  }
  if (s.phase === 'arrived') return s
  // Position trop imprécise : vue, mais elle ne fait rien avancer.
  if (!(fix.accuracy <= MAX_USABLE_ACCURACY_M)) return s

  const legs = itinerary.legs
  const p: [number, number] = [fix.lon, fix.lat]
  const dt = Math.max(1, (now - (s.lastFixAt ?? s.startedAt)) / 1000)
  const acc = fix.accuracy

  // Saut physiquement impossible depuis la dernière position acceptée
  // (position Wi-Fi ou cellulaire aberrante, précision annoncée mensongère) :
  // ignoré une fois. Deux de suite, c'est qu'on s'est vraiment déplacé.
  const last = s.track[s.track.length - 1]
  if (last && s.implausible < 1) {
    const jump = metersBetween([last[1], last[2]], p)
    const allowed = MAX_SPEED_MS * dt + 20 + Math.min(last[3], 50) + Math.min(acc, 50)
    if (jump > allowed) return { ...s, implausible: s.implausible + 1 }
  }

  // Coupure : on retient l'instant de la dernière position qui la précède.
  const gapAt = s.lastFixAt !== null && now - s.lastFixAt > FRESH_FIX_MS ? s.lastFixAt : s.gapAt ?? null
  const track = [
    ...s.track.filter(([at]) => now - at <= 30_000),
    [now, fix.lon, fix.lat, acc] as [number, number, number, number],
  ]
  s = { ...s, lastFixAt: now, lastFixAccuracy: acc, track, implausible: 0, gapAt }

  const i = s.legIndex
  const g = geometries[i]
  const leg = legs[i]
  const accC = Math.min(acc, 50)
  const back = 30 + accC
  const forward = isTransit(leg)
    ? Math.max(MIN_FORWARD_RIDE_M, MAX_SPEED_MS * dt) + accC
    : WALK_FORWARD_BASE_M + WALK_MAX_SPEED * dt + accC
  const lo = Math.max(0, s.along - back)
  const hi = Math.min(g.length, s.along + forward)
  const w = projectRange(p, g, lo, hi)
  let fitsCur = w.dist <= onRouteTolerance(g, acc, s.phase === 'ride')

  // Première position après une coupure, au bout d'un tronçon de transport
  // et déjà sur la marche qui suit : l'usager est sorti (métro). La compter
  // « à bord » afficherait « Attendez le métro » puis « Descendez au prochain
  // arrêt » à quelqu'un qui marche dans la rue (R9). On la traite comme une
  // position hors fenêtre : le recalage la confirme sur la suivante (deux
  // positions concordantes, jamais une seule) et passe à la marche.
  if (fitsCur && isTransit(leg) && dt * 1000 > FRESH_FIX_MS
    && exitedToNextWalk(fix, itinerary, geometries, i, projectRange(p, g, 0, g.length).along) !== null) {
    fitsCur = false
    s = { ...s, missCount: Math.max(s.missCount, LOST_FIXES - 1) }
  }

  // ── Passage anticipé au tronçon suivant (règle b) ──
  // Jamais depuis l'attente : on n'a pas encore quitté l'arrêt.
  if (s.phase !== 'wait' && i + 1 < legs.length) {
    const gn = geometries[i + 1]
    const n = projectRange(p, gn, 0, Math.min(gn.length, NEXT_WINDOW_M + MAX_SPEED_MS * dt))
    // Comparer à un tracé approximatif n'a pas de sens : en fin de tronçon,
    // il suffit que le suivant, relevé, colle bien et qu'on s'y soit engagé…
    // à pied (la marche peut repartir le long de la ligne qu'on vient de
    // quitter : à vitesse de véhicule, on est encore à bord).
    const walking = (fix.speed ?? groundSpeed(s.track) ?? 0) < 2.5
    const fromApprox = g.approximate && !gn.approximate && g.length - s.along <= 150 && walking
    const better = n.dist <= onRouteTolerance(gn, acc)
      && (n.dist + NEXT_MARGIN_M < w.dist || (fromApprox && n.along >= 15))
    s = { ...s, nextHits: better ? s.nextHits + 1 : 0 }
    if (s.nextHits >= NEXT_CONFIRM) {
      const next = legs[i + 1]
      if (!isTransit(next)) {
        return enterLeg(s, itinerary, geometries, i + 1, n.along, now, null)
      }
      // Monter dans un véhicule exige une preuve de véhicule.
      if (vehicleEvidence(s, fix, n.along, now)) {
        return enterLeg(s, itinerary, geometries, i + 1, n.along, now, 'gps')
      }
    }
  }

  if (fitsCur) {
    // Médiane des trois dernières projections : un maximum courant sur des
    // positions bruitées avancerait de deux écarts-types devant l'usager.
    // Après une coupure, les projections d'avant ne disent plus rien d'ici.
    const recentAlongs = dt > 5 ? [w.along] : [...s.recentAlongs.slice(-2), w.along]
    const smooth = median(recentAlongs)
    s = { ...s, missCount: 0, offCount: 0, offRoute: null, candidate: null, recentAlongs }
    let along = s.along
    let backed = false
    if (smooth >= s.along) {
      along = smooth
      s.backCount = 0
    } else if (s.along - w.along > BACK_CONFIRM_M) {
      s.backCount += 1
      if (s.backCount >= 3) {
        along = w.along
        backed = true
        s.backCount = 0
      }
    } else {
      s.backCount = 0
    }
    s.along = along
    s.anchorAt = now

    if (s.phase === 'wait') {
      // Vu à l'arrêt : sert à distinguer plus tard un bus lent d'un piéton.
      if (w.along <= endRadius(g, acc) + 15) s.stopSeenAt = now
      const evidence = vehicleEvidence(s, fix, w.along, now)
      s.boardHits = evidence ? s.boardHits + 1 : 0
      if (s.boardHits >= BOARD_CONFIRM) {
        return enterLeg(s, itinerary, geometries, i, along, now, 'gps')
      }
      return s
    }

    if (isTransit(leg)) {
      const fresh = stopsLeftAt(g, along)
      s.stopsLeft = backed || s.stopsLeft === null ? fresh : Math.min(s.stopsLeft, fresh)
      // Première position après une coupure (sortie du métro, téléphone
      // ressorti de la poche) : elle peut venir de la rue devant la station,
      // projetée sur la ligne droite du tracé. Elle ne compte pas.
      s.rideConfirmedFixes = dt * 1000 > FRESH_FIX_MS ? 0 : (s.rideConfirmedFixes ?? 0) + 1
    }

    // ── Fin du tronçon (règle a) ──
    if (g.length - s.along <= endRadius(g, acc)) {
      if (i === legs.length - 1) return arrive(s, geometries, now)
      // Une correspondance à pied, même courte, s'affiche toujours un moment.
      if (!isTransit(leg) && now - s.legEnteredAt < MIN_WALK_DISPLAY_MS) return s
      return enterLeg(s, itinerary, geometries, i + 1, 0, now, null)
    }
    return s
  }

  // ── Position hors de la fenêtre ──
  s = { ...s, missCount: s.missCount + 1 }
  // Depuis l'attente, on peut être reparti à pied vers l'arrêt : le tronçon
  // de marche précédent reste candidat.
  const fromLeg = s.phase === 'wait' && i > 0 && !isTransit(legs[i - 1]) ? i - 1 : i

  // Sortie d'itinéraire : loin de tout tronçon restant. À bord d'un tracé
  // approximatif, l'écart au trait ne veut rien dire : on ne conclut pas.
  if (!(g.approximate && s.phase !== 'walk')) {
    const speed = groundSpeed(s.track)
    const gpsSpeed = typeof fix.speed === 'number' && Number.isFinite(fix.speed) ? fix.speed : null
    const moving = (gpsSpeed ?? speed ?? 0) > BOARD_TRACK_SPEED && (speed ?? 0) <= MAX_SPEED_MS
    const d = routeDistance(p, geometries, fromLeg, i, acc, moving)
    const enter = offRouteTolerance(acc)
    if (s.offRoute) {
      // Hystérésis : on ne ressort qu'une fois nettement revenu, sinon le
      // message clignote autour du seuil.
      s = d <= enter - 25 || !Number.isFinite(d)
        ? { ...s, offCount: 0, offRoute: null }
        // Distance affichée arrondie : on ne la change qu'au-delà de 40 m
        // d'écart, sinon « ~100 m / ~150 m » alterne à chaque position.
        : { ...s, offRoute: { meters: Math.abs(d - s.offRoute.meters) >= 40 ? d : s.offRoute.meters, since: s.offRoute.since } }
    } else if (Number.isFinite(d) && d > enter) {
      const offCount = s.offCount + 1
      s = { ...s, offCount, offRoute: offCount >= OFF_ROUTE_FIXES ? { meters: d, since: now } : null }
    } else {
      s = { ...s, offCount: 0 }
    }
  }

  const matches = s.missCount >= LOST_FIXES ? projectEarliest(p, geometries, fromLeg, acc) : []
  // Un tracé approximatif de transport (droites entre stations, 500 m de
  // marge) « explique » aussi la rue devant la station d'arrivée. S'il est
  // devant nous et que le recalage n'y entrerait pas (pas de preuve de
  // véhicule, pas à l'arrêt), on cherche plus loin : sinon la marche finale
  // n'est jamais reconnue et la consigne périmée reste affichée (constat R7).
  // Seul un tronçon RELEVÉ (tolérance serrée) peut alors être retenu.
  let found: (typeof matches)[number] | null = null
  let skipped = false
  for (const m of matches) {
    const approxTransitAhead = m.legIndex > s.legIndex && isTransit(legs[m.legIndex]) && geometries[m.legIndex].approximate
    if (approxTransitAhead && recalage(s, fix, itinerary, geometries, m.legIndex, m.along, now) === null) {
      skipped = true
      continue
    }
    if (skipped && geometries[m.legIndex].approximate) break
    found = m
    break
  }
  if (found) {
    const c = s.candidate
    const sinceCandidate = c ? Math.max(1, (now - c.at) / 1000) : 0
    if (c && c.legIndex === found.legIndex && Math.abs(c.along - found.along) <= 100 + MAX_SPEED_MS * sinceCandidate) {
      const recalled = recalage(s, fix, itinerary, geometries, found.legIndex, found.along, now)
      if (recalled) return recalled
    }
    s = { ...s, candidate: { legIndex: found.legIndex, along: found.along, at: now } }
  }
  return s
}

/**
 * Position perdue sur la marche qui mène à l'arrêt du tronçon `target`, tout
 * près de cet arrêt (escalier d'une station souterraine), et seulement par
 * une COUPURE : pas un usager qui s'écarte en continuant d'émettre des
 * positions. Alors « retrouvé loin sur la ligne, plus vite qu'un piéton
 * depuis la dernière position sur la marche » prouve le trajet en véhicule.
 */
function walkLostNearStop(s: NavState, geometries: LegGeometryCache[], target: number): boolean {
  if (s.phase !== 'walk' || s.legIndex !== target - 1) return false
  const gapAt = s.gapAt ?? null
  if (gapAt === null || gapAt < s.anchorAt || gapAt - s.anchorAt > LOST_NEAR_STOP_MS) return false
  return geometries[s.legIndex].length - s.along <= LOST_NEAR_STOP_M
}

/**
 * Abscisse sur la marche qui suit le tronçon de transport `target`, si la
 * position y est déjà : projetée près du bout du tronçon (rayon d'arrivée +
 * 100 m), à moins de 150 m du début de cette marche relevée, et collant à son
 * tracé. Sinon null.
 */
function exitedToNextWalk(
  fix: NavFix,
  itinerary: OtpItinerary,
  geometries: LegGeometryCache[],
  target: number,
  along: number,
): number | null {
  const g = geometries[target]
  const gw = geometries[target + 1]
  const walk = itinerary.legs[target + 1]
  if (!walk || isTransit(walk) || !gw || gw.approximate) return null
  if (along < g.length / 2 || g.length - along > endRadius(g, fix.accuracy) + EXIT_END_MARGIN_M) return null
  const p: [number, number] = [fix.lon, fix.lat]
  if (metersBetween(p, gw.coords[0]) > EXIT_WALK_START_M) return null
  const r = projectRange(p, gw, 0, gw.length)
  return r.dist <= onRouteTolerance(gw, fix.accuracy) ? r.along : null
}

/**
 * Recalage après une coupure ou un écart : la position est retrouvée ailleurs
 * sur le trajet, confirmée par deux positions concordantes. Les règles de
 * montée restent les mêmes : pas de « Descendez » sans preuve de véhicule.
 */
function recalage(
  s: NavState,
  fix: NavFix,
  itinerary: OtpItinerary,
  geometries: LegGeometryCache[],
  target: number,
  along: number,
  now: number,
): NavState | null {
  const legs = itinerary.legs
  const leg = legs[target]
  const g = geometries[target]
  const reset = { missCount: 0, offCount: 0, offRoute: null, candidate: null }

  // Position projetée en bout de tracé approximatif (métro, tram) alors
  // qu'elle est déjà sur la marche qui suit : l'usager est sorti. Entrer à
  // bord ici afficherait « Attendez » ou « Descendez au prochain arrêt » (et
  // ferait vibrer) à quelqu'un qui marche dans la rue (constat R9).
  if (isTransit(leg)) {
    const exited = exitedToNextWalk(fix, itinerary, geometries, target, along)
    if (exited !== null) return recalage(s, fix, itinerary, geometries, target + 1, exited, now)
  }

  if (target === s.legIndex) {
    if (s.phase === 'walk') return { ...s, ...reset, along, anchorAt: now, backCount: 0 }
    if (s.phase === 'ride' && along > s.along) {
      // La seule position de recalage ne lève jamais l'alerte d'approche.
      return { ...s, ...reset, along, anchorAt: now, stopsLeft: Math.min(s.stopsLeft ?? Infinity, stopsLeftAt(g, along)), rideConfirmedFixes: 0 }
    }
    if (s.phase === 'wait' && vehicleEvidence(s, fix, along, now)) {
      return { ...enterLeg(s, itinerary, geometries, target, Math.max(along, s.along), now, 'gps'), ...reset }
    }
    return null
  }

  if (target < s.legIndex) {
    // Retour de l'arrêt vers la marche : seulement franchement loin de l'arrêt.
    if (!isTransit(leg) && g.length - along > 2 * endRadius(g, fix.accuracy)) {
      return { ...enterLeg(s, itinerary, geometries, target, along, now, null), ...reset }
    }
    return null
  }

  if (!isTransit(leg)) {
    if (target === legs.length - 1 && g.length - along <= endRadius(g, fix.accuracy)) {
      return arrive({ ...s, ...reset }, geometries, now)
    }
    return { ...enterLeg(s, itinerary, geometries, target, along, now, null), ...reset }
  }
  if (vehicleEvidence(s, fix, along, now, walkLostNearStop(s, geometries, target))) {
    return { ...enterLeg(s, itinerary, geometries, target, along, now, 'gps'), ...reset }
  }
  // Physiquement à l'arrêt d'un tronçon de transport : on attend le véhicule.
  // (La projection seule ne suffit pas : sur un tracé approximatif, un point
  // à 80 m de la ligne droite peut être à 500 m de l'arrêt.)
  const stop: [number, number] = [leg.from.lon, leg.from.lat]
  if (along <= endRadius(g, fix.accuracy) + 30 && metersBetween([fix.lon, fix.lat], stop) <= endRadius(g, fix.accuracy) + 40) {
    return { ...enterLeg(s, itinerary, geometries, target, 0, now, null), ...reset }
  }
  return null
}

// ─── Ce qu'on affiche ───────────────────────────────────────────────────────

export interface NavView {
  legIndex: number
  phase: NavPhase
  along: number
  legLength: number
  /** Fraction parcourue du tronçon courant, 0 → 1. */
  legProgress: number
  remainingMeters: number
  /** Arrêts restants, arrêt de descente compris (null à pied). */
  stopsLeft: number | null
  /** Index du prochain arrêt intermédiaire, -1 = arrêt de descente. */
  nextStopIndex: number | null
  /** Index de la prochaine consigne de marche (simplifyWalkSteps), sinon null. */
  nextStepIndex: number | null
  metersToNextStep: number | null
  source: NavSource
  /** Vrai si l'avancement affiché vient de l'horloge (à préfixer de « ~ »). */
  estimated: boolean
  /** Heure d'arrivée estimée (epoch ms), attentes prévues comprises. */
  etaMs: number
  /** Le prochain arrêt est celui où descendre (constaté, pas estimé). */
  approach: boolean
  offRoute: { meters: number } | null
  /** Instant de la dernière position utilisable (pour « depuis N min »). */
  lastFixAt: number | null
  /** Positions reçues mais trop imprécises pour suivre l'avancement. */
  coarseAccuracy: number | null
  arrived: boolean
  /** Mode horloge : la durée prévue est écoulée, rien ne confirme l'arrivée. */
  timeElapsed: boolean
  waitStartedAt: number | null
}

interface DisplayState {
  legIndex: number
  phase: NavPhase
  along: number
  waitStartedAt: number | null
  estimated: boolean
  timeElapsed: boolean
}

/**
 * Estimation à l'horloge depuis le dernier état constaté, à la vitesse prévue
 * de chaque tronçon. Ne quitte JAMAIS une attente (le véhicule peut ne pas
 * passer) ; ne franchit pas de correspondance quand `crossLegs` est faux.
 */
function estimateDisplay(
  s: NavState,
  itinerary: OtpItinerary,
  geometries: LegGeometryCache[],
  now: number,
  crossLegs: boolean,
): DisplayState {
  const legs = itinerary.legs
  let legIndex = s.legIndex
  let along = s.along
  let phase = s.phase
  let waitStartedAt = s.waitStartedAt
  let budget = Math.max(0, (now - s.anchorAt) / 1000)
  let at = s.anchorAt
  let timeElapsed = false
  while (phase === 'walk' || phase === 'ride') {
    const g = geometries[legIndex]
    const leg = legs[legIndex]
    const speed = g.length / Math.max(1, leg.duration)
    const remaining = speed > 0 ? (g.length - along) / speed : 0
    if (budget < remaining) {
      along += budget * speed
      break
    }
    budget -= remaining
    at += remaining * 1000
    along = g.length
    if (!crossLegs) break
    if (legIndex === legs.length - 1) {
      timeElapsed = true
      break
    }
    legIndex += 1
    along = 0
    if (isTransit(legs[legIndex])) {
      phase = 'wait'
      waitStartedAt = at
    } else {
      phase = 'walk'
    }
  }
  return { legIndex, phase, along, waitStartedAt, estimated: true, timeElapsed }
}

/** Secondes restantes jusqu'à l'arrivée, attentes prévues par OTP comprises. */
function remainingSeconds(
  itinerary: OtpItinerary,
  geometries: LegGeometryCache[],
  d: DisplayState,
  at: number,
): number {
  const legs = itinerary.legs
  const leg = legs[d.legIndex]
  const g = geometries[d.legIndex]
  // Ce qui suit le tronçon courant, tel qu'OTP l'a planifié : attentes aux
  // arrêts (pire cas d'une ligne en fréquence) et tronçons suivants. C'est le
  // même modèle que l'écran détail : les deux heures d'arrivée concordent.
  const after = Math.max(0, (itinerary.endTime - leg.endTime) / 1000)
  if (d.phase === 'arrived') return 0
  if (d.phase === 'wait') {
    const prevEnd = d.legIndex > 0 ? legs[d.legIndex - 1].endTime : itinerary.startTime
    const plannedGap = Math.max(0, (leg.startTime - prevEnd) / 1000)
    const waited = d.waitStartedAt !== null ? Math.max(0, (at - d.waitStartedAt) / 1000) : 0
    // L'attente déjà faite est décomptée du pire cas prévu, sans descendre
    // sous zéro : au-delà, l'heure d'arrivée glisse avec l'horloge.
    return Math.max(0, plannedGap - waited) + leg.duration + after
  }
  const fraction = g.length > 0 ? Math.min(1, d.along / g.length) : 1
  return leg.duration * (1 - fraction) + after
}

export function navView(
  s: NavState,
  itinerary: OtpItinerary,
  geometries: LegGeometryCache[],
  now: number = s.now,
): NavView {
  const fresh = s.lastFixAt !== null && now - s.lastFixAt <= FRESH_FIX_MS
  const source: NavSource = s.lastFixAt === null ? 'time' : fresh ? 'gps' : 'stale'
  const confirmed: DisplayState = {
    legIndex: s.legIndex,
    phase: s.phase,
    along: s.along,
    waitStartedAt: s.waitStartedAt,
    estimated: false,
    timeElapsed: false,
  }

  let d = confirmed
  let etaBase = now
  if (s.phase !== 'arrived' && !s.offRoute) {
    if (source === 'time') {
      d = estimateDisplay(s, itinerary, geometries, now, true)
    } else if (source === 'stale') {
      if (s.phase === 'ride') {
        // Sous terre ou téléphone en poche dans le véhicule : on estime les
        // arrêts à la vitesse prévue, sans franchir la descente.
        d = estimateDisplay(s, itinerary, geometries, now, false)
      } else {
        // À pied ou à l'arrêt : on ne sait pas où l'on est. Tout est figé à
        // la dernière position, heure d'arrivée comprise.
        etaBase = s.anchorAt
      }
    }
  }

  const leg = itinerary.legs[d.legIndex]
  const g = geometries[d.legIndex]
  const transit = isTransit(leg)
  let stopsLeft: number | null = null
  let nextStopIndex: number | null = null
  if (transit) {
    if (d.phase === 'wait') {
      stopsLeft = stopsLeftAt(g, 0)
      nextStopIndex = g.stopAlongs.length > 0 ? 0 : -1
    } else {
      const computed = stopsLeftAt(g, d.along)
      stopsLeft = !d.estimated && d.legIndex === s.legIndex && s.stopsLeft !== null
        ? Math.min(s.stopsLeft, computed)
        : computed
      nextStopIndex = d.phase === 'arrived' ? -1 : nextStopIndexAt(g, d.along)
    }
  }

  let nextStepIndex: number | null = null
  let metersToNextStep: number | null = null
  if (!transit && d.phase === 'walk') {
    const k = g.stepAlongs.findIndex((a, idx) => idx > 0 && a > d.along + 5)
    if (k > 0) {
      nextStepIndex = k
      metersToNextStep = g.stepAlongs[k] - d.along
    }
  }

  return {
    legIndex: d.legIndex,
    phase: d.phase,
    along: d.along,
    legLength: g.length,
    legProgress: g.length > 0 ? Math.min(1, Math.max(0, d.along / g.length)) : d.phase === 'arrived' ? 1 : 0,
    remainingMeters: Math.max(0, g.length - d.along),
    stopsLeft,
    nextStopIndex,
    nextStepIndex,
    metersToNextStep,
    source,
    estimated: d.estimated,
    etaMs: etaBase + remainingSeconds(itinerary, geometries, d, etaBase) * 1000,
    // Constaté sur plusieurs positions à bord, jamais sur la seule position
    // d'un recalage ni sur la première après une coupure (constat R9).
    approach: !d.estimated && source === 'gps' && d.phase === 'ride' && stopsLeft === 1
      && d.legIndex === s.legIndex && (s.rideConfirmedFixes ?? 0) >= APPROACH_CONFIRM,
    offRoute: s.offRoute ? { meters: s.offRoute.meters } : null,
    lastFixAt: s.lastFixAt,
    coarseAccuracy: s.lastSeenAt !== null && now - s.lastSeenAt <= FRESH_FIX_MS && !fresh
      ? s.lastSeenAccuracy
      : null,
    arrived: s.phase === 'arrived',
    timeElapsed: d.timeElapsed,
    waitStartedAt: d.waitStartedAt,
  }
}

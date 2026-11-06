// Intervalle d'un tronçon OTP : une seule règle pour la liste des résultats,
// le détail (legWait) et la navigation (« Attendez le 88 · passe ~ toutes les
// N min »).
//
// Pourquoi : depuis que le GTFS développe les fréquences en départs explicites
// (data/scripts/build_bus.py, build_rail.py), OTP ne renvoie plus `headway`
// ni `isNonExactFrequency`. Sans repli, le détail et la navigation auraient
// perdu toute indication de fréquence au prochain graphe — alors que les
// mêmes intervalles, déduits des mêmes départs du GTFS, sont dans le
// catalogue des lignes (lines.ts, headwayAt, heure d'Alger). Bus : fréquence
// MODÉLISÉE, toujours affichée avec « ~ ».
//
// Ne dépend que de lines.ts (et des types d'otp.ts) : otp.ts peut l'importer
// sans cycle.

import type { OtpLeg } from './otp'
import { allLines, directionIndexByTripId, findDirectionIndex, headwayAt, type TransitLine } from './lines'

const lineById = new Map(allLines.map((line) => [line.id, line]))

/** Ligne du catalogue d'un tronçon OTP (route_id d'abord, nom court ensuite). */
export function lineForLeg(leg: Pick<OtpLeg, 'routeId' | 'routeShortName'>): TransitLine | undefined {
  const routeId = leg.routeId?.split(':').pop()
  return (routeId ? lineById.get(routeId) : undefined)
    ?? (leg.routeShortName ? allLines.find((line) => line.shortName === leg.routeShortName) : undefined)
}

/**
 * Sens d'un tronçon : par trip_id (bus « ETUSA-45-dir1-0610 », rail
 * « M1-AIN-0-0520 » → motif M1-AIN-0), sinon par girouette et arrêt de
 * montée. Le trip_id ne dépend pas de la langue de la réponse d'OTP.
 */
export function directionIndexForLeg(line: TransitLine, leg: OtpLeg): number {
  const byTrip = directionIndexByTripId(line, leg.tripId)
  if (byTrip >= 0) return byTrip
  const tripTail = leg.tripId?.split(':').pop()
  if (tripTail) {
    const pattern = tripTail.replace(/-\d{4}$/, '')
    const index = line.directions.findIndex((d) => d.patternId === pattern)
    if (index >= 0) return index
  }
  return findDirectionIndex(line, leg.headsign, { id: leg.from.stopId?.split(':').pop(), name: leg.from.name })
}

const stopKey = (stopId?: string) => stopId?.split(':').pop()

/**
 * Rail : intervalle cumulé des sens qui desservent la montée PUIS la descente
 * du tronçon (même côté, même direction_id). Sur le tronc commun du M1, une
 * rame de chaque branche convient : ~10 min, pas l'intervalle d'une branche
 * (~20 min) — comme l'onglet Lignes (line-catalog, stopHeadway). Vers une
 * station d'une seule branche, seul ce sens compte. null si les arrêts ne
 * sont pas identifiés (l'appelant garde l'intervalle du sens).
 */
function railCombinedHeadway(line: TransitLine, leg: OtpLeg, index: number, when: Date): number | null {
  const board = stopKey(leg.from.stopId)
  const alight = stopKey(leg.to.stopId)
  if (!board || !alight) return null
  const own = line.directions[index]
  if (!own) return null
  let rate = 0
  let matched = 0
  line.directions.forEach((direction, i) => {
    const sameSide = own.directionId !== undefined ? direction.directionId === own.directionId : i === index
    if (!sameSide) return
    const a = direction.stops.findIndex((s) => s.id === board)
    const b = direction.stops.findIndex((s) => s.id === alight)
    if (a < 0 || b <= a) return
    const h = headwayAt(line, when, i)
    if (!h) return
    rate += 1 / h
    matched += 1
  })
  if (!matched || rate <= 0) return null
  return Math.max(1, Math.round(1 / rate))
}

/**
 * Intervalle (min) de la ligne d'un tronçon, à l'heure de la montée : celui
 * qu'OTP a utilisé s'il le donne (graphe à fréquences), sinon celui des
 * départs du GTFS pour ce sens (rail : tous les sens qui desservent montée et
 * descente). null hors service, à pied ou sans donnée.
 */
export function legHeadwayMin(leg: OtpLeg): number | null {
  if (leg.mode === 'WALK') return null
  if (leg.isNonExactFrequency && leg.headway && leg.headway > 0) return Math.round(leg.headway / 60)
  const line = lineForLeg(leg)
  if (!line) return null
  const index = directionIndexForLeg(line, leg)
  const when = new Date(leg.startTime)
  if (index >= 0 && leg.mode !== 'BUS') {
    const combined = railCombinedHeadway(line, leg, index, when)
    if (combined !== null) return combined
  }
  return headwayAt(line, when, index >= 0 ? index : undefined)
}

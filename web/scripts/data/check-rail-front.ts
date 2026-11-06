// Contrôle du rail côté front (stations.ts, lines.ts, line-catalog.ts, line-shapes.ts).
// Usage (depuis web/) : npx sucrase-node scripts/data/check-rail-front.ts
// À lancer aussi sous un autre fuseau : TZ=America/Montreal npx sucrase-node …
// (les états de service doivent rester ceux de l'heure d'Alger).
//
// Le GTFS et generated-rail.json sont contrôlés contre OSM par
// data/scripts/check_rail.py ; ici on vérifie ce que le front en fait.
import {
  allStations, metroStations, tramStations, railRoutes, railStationsBetween, railRoutesAtStation,
  metroLineGeoJSON, tramLineGeoJSON, getStation,
} from '../../src/lib/stations'
import {
  metroLine, tramLine, lineDisplayName, directionOriginLabel, directionsServingStop,
  headwayAt, isInService, stopPassWindow, railSpecialPeriodNotice, nextPassLabel,
  findDirectionIndex,
} from '../../src/lib/lines'
import { lineServiceState } from '../../src/lib/line-catalog'
import { loadLineShapes } from '../../src/lib/line-shapes'
import { installPublicFetch } from './public-fetch'

let failures = 0
function check(label: string, cond: boolean, detail = '') {
  console.log(`${cond ? 'OK   ' : 'ÉCHEC'} ${label}${detail ? ` — ${detail}` : ''}`)
  if (!cond) failures += 1
}

function meters(a: number[], b: number[]): number {
  const toRad = (v: number) => (v * Math.PI) / 180
  const dLat = toRad(b[1] - a[1])
  const dLon = toRad(b[0] - a[0])
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a[1])) * Math.cos(toRad(b[1])) * Math.sin(dLon / 2) ** 2
  return 2 * 6371000 * Math.asin(Math.sqrt(h))
}

function distToLine(p: number[], line: number[][]): number {
  const kx = 111320 * Math.cos((p[1] * Math.PI) / 180)
  const ky = 110574
  let best = Infinity
  for (let i = 0; i < line.length - 1; i += 1) {
    const ax = (line[i][0] - p[0]) * kx, ay = (line[i][1] - p[1]) * ky
    const bx = (line[i + 1][0] - p[0]) * kx, by = (line[i + 1][1] - p[1]) * ky
    const dx = bx - ax, dy = by - ay
    const l2 = dx * dx + dy * dy
    const t = l2 === 0 ? 0 : Math.max(0, Math.min(1, -(ax * dx + ay * dy) / l2))
    best = Math.min(best, Math.hypot(ax + t * dx, ay + t * dy))
  }
  return best
}

// Instant donné à l'heure d'Alger (UTC+1), indépendant du fuseau de la machine.
const at = (hhmm: string, day = '2026-11-09') => new Date(`${day}T${hhmm}:00+01:00`)

// ── Stations ──────────────────────────────────────────────────────────────
check('19 stations de métro, 37 arrêts de tram', metroStations.length === 19 && tramStations.length === 37,
  `${metroStations.length} / ${tramStations.length}`)
check('identifiants uniques', new Set(allStations.map((s) => s.id)).size === allStations.length)
check('aucune station inventée ni « future »',
  !allStations.some((s) => ['Mohamed Belouizdad', 'El Magharia'].includes(s.name)))
check('chaque station a un nom arabe et un nœud OSM', allStations.every((s) => s.nameAr && s.osmNode))
check('Place des Martyrs, Ali Boumendjel, Aïn Naâdja, Université de Bab Ezzouar présentes',
  ['Place des Martyrs', 'Ali Boumendjel', 'Aïn Naâdja', 'Université de Bab Ezzouar'].every((n) => allStations.some((s) => s.name === n)))
check('M07 et T02 (correspondance Les Fusillés) existent', Boolean(getStation('M07') && getStation('T02')))

// ── Sens et tracés ────────────────────────────────────────────────────────
check('M1 : 4 sens, T1 : 2 sens', metroLine.directions.length === 4 && tramLine.directions.length === 2)
check('titre M1 conforme aux terminus', lineDisplayName(metroLine) === 'Place des Martyrs ↔ El Harrach Centre / Aïn Naâdja',
  lineDisplayName(metroLine))
check('titre M1 en arabe', lineDisplayName(metroLine, 'ar') === 'ساحة الشهداء ↔ الحراش وسط / عين النعجة', lineDisplayName(metroLine, 'ar'))
check('titre T1', lineDisplayName(tramLine) === 'Ruisseau ↔ Dergana Centre', lineDisplayName(tramLine))
for (const line of [metroLine, tramLine]) {
  line.directions.forEach((d, i) => {
    // Les sens n'embarquent plus de tracé (line-shapes.json) : celui du motif rail.
    const shape = railRoutes.find((r) => r.id === d.patternId)?.shape ?? []
    const worst = Math.max(...d.stops.map((s) => distToLine([s.lon, s.lat], shape)))
    const ends = meters(shape[0], [d.stops[0].lon, d.stops[0].lat]) + meters(shape[shape.length - 1], [d.stops[d.stops.length - 1].lon, d.stops[d.stops.length - 1].lat])
    let longest = 0
    for (let k = 1; k < shape.length; k += 1) longest = Math.max(longest, meters(shape[k - 1], shape[k]))
    check(`${line.shortName} sens ${i} (${d.headsign}) : arrêts à < 30 m de la voie, tracé borné aux terminus`,
      shape.length > 50 && worst < 30 && ends < 60,
      `${d.stops.length} arrêts, ${shape.length} pts, écart max ${worst.toFixed(1)} m, segment max ${longest.toFixed(0)} m`)
    const offs = d.offsetsMin ?? []
    check(`${line.shortName} sens ${i} : temps estimés croissants`, offs.length === d.stops.length && offs.every((v, k) => k === 0 || v >= offs[k - 1]))
  })
}
check('onglets M1 distinguables', directionOriginLabel(metroLine, 1, 'fr') === 'depuis El Harrach Centre'
  && directionOriginLabel(metroLine, 3, 'fr') === 'depuis Aïn Naâdja' && directionOriginLabel(metroLine, 0, 'fr') === null
  && directionOriginLabel(metroLine, 3, 'ar') === 'من عين النعجة',
  `${directionOriginLabel(metroLine, 1, 'fr')} / ${directionOriginLabel(metroLine, 3, 'ar')}`)
check('métro : fond de carte en MultiLineString (tronc + branche)',
  metroLineGeoJSON.geometry.type === 'MultiLineString' && metroLineGeoJSON.geometry.coordinates.length === 2)
check('tram : fond de carte LineString sur la voie', tramLineGeoJSON.geometry.type === 'LineString'
  && tramLineGeoJSON.geometry.coordinates.length > 200)

// ── Parcours ──────────────────────────────────────────────────────────────
const fus = railStationsBetween('M07', 'M15')
check('Les Fusillés → El Harrach Gare : 5 stations intermédiaires', fus?.stations.length === 7,
  fus?.stations.map((s) => s.name).join(', '))
const ain = railStationsBetween('M30', 'M01')
check('Aïn Naâdja → Tafourah : direct, sens M1-AIN-1', ain?.route.id === 'M1-AIN-1', `${ain?.route.id}, ~${Math.round((ain?.offsetSec ?? 0) / 60)} min`)
check('Les Ateliers → El Harrach Gare : pas de rame directe', railStationsBetween('M28', 'M15') === null)
check('Gué de Constantine : seulement les sens de la branche',
  JSON.stringify(directionsServingStop(metroLine, { id: 'M29', name: 'Gué de Constantine' })) === '[2,3]'
  && railRoutesAtStation('M29').every((r) => r.id.startsWith('M1-AIN')))
check('Place des Martyrs : sens aller des deux branches',
  JSON.stringify(directionsServingStop(metroLine, { id: 'M26', name: 'Place des Martyrs' })) === '[0,2]')
check('6 sens rail', railRoutes.length === 6)
check('tronçon OTP → sens (headsign + arrêt de montée)',
  findDirectionIndex(metroLine, 'Place des Martyrs', { id: 'M30', name: 'Aïn Naâdja' }) === 3
  && findDirectionIndex(metroLine, 'Place des Martyrs', { id: 'M16', name: 'El Harrach Centre' }) === 1
  && findDirectionIndex(metroLine, 'Aïn Naâdja') === 2 && findDirectionIndex(tramLine, 'Ruisseau') === 1)

// ── Heure d'Alger, intervalles, service ───────────────────────────────────
check('M1 tronc 07:30 : ~5 min ; branche : ~10 min', headwayAt(metroLine, at('07:30')) === 5
  && headwayAt(metroLine, at('07:30'), 2) === 10)
check('M1 tronc 10:00 : ~10 min ; branche : ~20 min', headwayAt(metroLine, at('10:00')) === 10 && headwayAt(metroLine, at('10:00'), 3) === 20)
check('T1 18:00 : ~5 min', headwayAt(tramLine, at('18:00')) === 5)
check('hors service : headwayAt null', headwayAt(metroLine, at('23:30')) === null && headwayAt(metroLine, at('04:30')) === null)
check('isInService 22:59 vrai, 23:30 faux, 04:59 faux', isInService(metroLine, at('22:59')) && !isInService(metroLine, at('23:30')) && !isInService(metroLine, at('04:59')))
check('isInService avec temps depuis le terminus (23:20, +30 min)', isInService(metroLine, at('23:20'), 30))
check('Lignes à proximité (line-catalog) : 08:00 ouvert ~5 min, 04:00 fermé, 23:00 dernier départ',
  lineServiceState(metroLine, at('08:00')).kind === 'open' && headwayAt(metroLine, at('08:00')) === 5
  && lineServiceState(metroLine, at('04:00')).kind === 'closed' && lineServiceState(metroLine, at('23:00')).kind === 'open')
check('libellés avec « ~ »', nextPassLabel(5, 'fr') === '~ toutes les 5 min' && nextPassLabel(10, 'en') === 'every ~10 min'
  && nextPassLabel(10, 'ar').includes('تقريباً') && nextPassLabel(20, 'fr') === '~ toutes les 20 min')
const passes = stopPassWindow(metroLine.directions[2], metroLine.directions[2].stops.length - 1)
check('Aïn Naâdja (arrivée) : 1er et dernier passage estimés', Boolean(passes), JSON.stringify(passes))
check('Ramadan 1448 : avertissement ; novembre 2026 : rien',
  railSpecialPeriodNotice(at('21:00', '2027-02-20')) === 'data_ramadanRailNotice' && railSpecialPeriodNotice(at('21:00')) === null)

// loadLineShapes() lit /data/line-shapes.json par fetch : servi ici depuis public/.
installPublicFetch()
loadLineShapes().then((shapes) => {
  check('loadLineShapes : 4 tracés M1 et 2 tracés T1 non vides',
    shapes['L1-metro']?.length === 4 && shapes['L1-tram']?.length === 2
    && [...shapes['L1-metro'], ...shapes['L1-tram']].every((s) => s.length > 50))
  console.log(failures ? `\n${failures} échec(s)` : '\nRail front OK')
  process.exit(failures ? 1 : 0)
})

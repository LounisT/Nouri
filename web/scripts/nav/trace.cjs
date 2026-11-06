// Trace détaillée d'un rejeu du banc, pour comprendre un écart :
//   node scripts/nav/trace.cjs <fixture> <itinéraire> <scénario> <graine> [t0] [t1]
//   ALL=1 → toutes les positions, sinon seulement les changements d'état.
require('./ts-require.cjs')
const fs = require('fs')
const path = require('path')
const nav = require('../../src/lib/navigation.ts')
const { makeRng, truthTimeline, makeDetour, buildFixes } = require('./sim.cjs')

const [file, idx = '0', scenario = 'noise8', seed = '1', fromT, toT] = process.argv.slice(2)
const data = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', `${file}.json`), 'utf8'))
const it = data.itineraries[Number(idx)]
const geoms = nav.buildLegGeometries(it)
it.legs.forEach((l, i) => console.log(`${i}: ${l.mode} ${l.routeShortName ?? ''} longueur=${Math.round(geoms[i].length)} m approx=${geoms[i].approximate} arrêts=${geoms[i].stopAlongs.map(Math.round).join(',')}`))
const truth = truthTimeline(it, geoms, scenario === 'offroute' ? makeDetour(geoms) : null, scenario === 'jam')
console.log('départs véhicules (s) :', JSON.stringify(truth.departures))
const built = buildFixes(it, geoms, truth, scenario, makeRng(Number(seed) * 7919 + Number(idx)))
const T0 = 1_800_000_000_000
let s = nav.createNavState(it, geoms, T0)
const r = (x) => (typeof x === 'number' ? Math.round(x) : x)
for (const { t, truth: tr, fix } of built.fixes) {
  const now = T0 + Math.round(t * 1000)
  const before = s
  s = nav.advance(s, { type: 'fix', fix: { ...fix, receivedAt: now } }, it, geoms)
  const v = nav.navView(s, it, geoms, now)
  const inRange = (fromT === undefined || t >= Number(fromT)) && (toT === undefined || t <= Number(toT))
  const changed = before.legIndex !== s.legIndex || before.phase !== s.phase || s.along < before.along || Boolean(v.offRoute) !== Boolean(before.offRoute)
  if (inRange && (changed || process.env.ALL)) {
    console.log(`t=${t} vrai=${tr.legIndex}/${tr.phase}/${r(tr.along)} écart=${r(tr.offMeters || 0)} préc=${fix.accuracy} v=${fix.speed == null ? '-' : fix.speed.toFixed(1)}`
      + ` | état=${s.legIndex}/${s.phase}/${s.along.toFixed(1)} (avant ${before.legIndex}/${before.phase}/${before.along.toFixed(1)})`
      + ` arrêts=${s.stopsLeft} miss=${s.missCount} next=${s.nextHits} board=${s.boardHits} hors=${v.offRoute ? r(v.offRoute.meters) : '-'}`
      + ` cand=${s.candidate ? `${s.candidate.legIndex}@${r(s.candidate.along)}` : '-'}`)
  }
}

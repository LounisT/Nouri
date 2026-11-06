// Banc « station souterraine » (constats R7 et R9) : le GPS se perd dès
// l'escalier d'accès, 40 à 120 m AVANT le point GTFS de la station, et ne
// revient qu'une minute après la sortie (ou à mi-parcours, variante midRide).
// Rejoue de VRAIS itinéraires OTP (fixtures/) avec la vraie machine à états
// et le vrai bandeau (buildBanner), seconde par seconde.
//
//   node scripts/nav/bench-underground.cjs            # résumé
//   node scripts/nav/bench-underground.cjs --verbose  # chaque écart
//
// Critères, pour chaque coupure (40, 60, 120 m), chaque graine, et un usager
// qui touche « Je suis à bord » au départ du métro comme un usager qui ne le
// touche jamais :
//   - le bouton « Je suis à bord » est proposé avant le départ du métro, et
//     l'appui est accepté (montée à bord du métro) ;
//   - jamais « à bord » avant le départ réel ;
//   - après la sortie, la consigne d'avant le métro ne reste pas affichée
//     (≤ 15 s après la première position retrouvée) ;
//   - ni « Descendez au prochain arrêt » ni vibration une fois sorti ;
//   - l'arrivée est constatée ;
//   - midRide : position retrouvée en cours de trajet → à bord du métro
//     constaté (GPS) en quelques positions.
const path = require('path')
const fs = require('fs')
require('./ts-require.cjs')

const nav = require('../../src/lib/navigation.ts')
const { buildBanner, boardTargetLeg } = require('../../src/hooks/useNavigationSession.ts')
const { translations } = require('../../src/lib/i18n.ts')
const { makeRng, truthTimeline, buildFixes } = require('./sim.cjs')

const args = Object.fromEntries(process.argv.slice(2).map((a) => {
  const [k, v] = a.replace(/^--/, '').split('=')
  return [k, v ?? true]
}))
const VERBOSE = Boolean(args.verbose)
const FIX_DIR = path.join(__dirname, 'fixtures')
const CUTS = [40, 60, 120]
const SEEDS = [1, 2, 3, 4, 5, 6]
const STUCK_MAX_S = 15
const MID_RIDE_MAX_FIXES = 10
const T0 = 1_800_000_000_000
const t = (key) => translations.fr[key] ?? key

function run(it, cut, seed, idx, user, resume) {
  const geoms = nav.buildLegGeometries(it)
  const truth = truthTimeline(it, geoms)
  const sub = it.legs.findIndex((l) => l.mode === 'SUBWAY')
  const built = buildFixes(it, geoms, truth, 'undergroundEarly', makeRng(seed * 7919 + idx), { cutMeters: cut, resume })
  const byTime = new Map(built.fixes.map((f) => [Math.round(f.t), f]))
  const departure = truth.departures[sub]
  const r = { offered: false, pressAccepted: null, earlyRide: 0, stuckS: 0, alertAfterExit: 0, arrived: false, midRideFixes: null }
  let state = nav.createNavState(it, geoms, T0)
  let firstFixAfterExit = null
  let fixesAfterResume = 0
  for (const tr of truth.timeline) {
    const now = T0 + tr.t * 1000
    const f = byTime.get(tr.t)
    if (user === 'press' && tr.t === departure) {
      const v = nav.navView(state, it, geoms, now)
      const target = boardTargetLeg(v, it)
      r.pressAccepted = target === sub
      if (target !== null) state = nav.advance(state, { type: 'boarded', now, legIndex: target }, it, geoms)
    }
    if (f) state = nav.advance(state, { type: 'fix', fix: { ...f.fix, receivedAt: now } }, it, geoms)
    else state = nav.advance(state, { type: 'tick', now }, it, geoms)
    const v = nav.navView(state, it, geoms, now)
    const b = buildBanner({ session: { itinerary: it, meta: {}, geometries: geoms, state }, view: v, t, locale: 'fr', now, positionError: null, outsideArea: false, notice: null })

    if (tr.t < departure && b.showBoardButton && boardTargetLeg(v, it) === sub) r.offered = true
    if (tr.t < departure && ((v.legIndex === sub && v.phase === 'ride') || v.legIndex > sub)) r.earlyRide += 1
    if (tr.legIndex > sub) {
      if (f && firstFixAfterExit === null) firstFixAfterExit = tr.t
      if (firstFixAfterExit !== null && v.legIndex <= sub && !v.arrived) r.stuckS = Math.max(r.stuckS, tr.t - firstFixAfterExit + 1)
      // (Une alerte sur un tronçon SUIVANT, tram par exemple, est légitime.)
      if (v.legIndex === sub && (b.approach || b.title === t('nav_alightNext'))) r.alertAfterExit += 1
    }
    if (resume === 'midRide' && tr.legIndex === sub && tr.phase === 'ride' && f && r.midRideFixes === null) {
      fixesAfterResume += 1
      if (state.legIndex === sub && state.phase === 'ride') r.midRideFixes = fixesAfterResume
    }
    if (v.arrived) r.arrived = true
  }
  return r
}

const failures = []
let runs = 0
const files = fs.readdirSync(FIX_DIR).filter((f) => f.endsWith('.json')).filter((f) => !args.only || f.startsWith(args.only))
for (const file of files) {
  const data = JSON.parse(fs.readFileSync(path.join(FIX_DIR, file), 'utf8'))
  data.itineraries.forEach((it, idx) => {
    const sub = it.legs.findIndex((l) => l.mode === 'SUBWAY')
    // Il faut une marche vers la station pour que l'escalier coupe le GPS.
    if (sub < 1 || it.legs[sub - 1].mode !== 'WALK') return
    const sig = it.legs.map((l) => l.routeShortName ?? 'W').join('>')
    for (const cut of CUTS) {
      for (const seed of SEEDS) {
        for (const [user, resume] of [['press', 'exit'], ['never', 'exit'], ['never', 'midRide']]) {
          runs += 1
          const label = `${file.replace('.json', '')}#${idx} ${sig} coupure ${cut} m seed=${seed} ${user}/${resume}`
          const r = run(it, cut, seed, idx, user, resume)
          if (!r.offered && !(resume === 'midRide')) failures.push(`${label} : « Je suis à bord » jamais proposé avant le départ`)
          if (r.pressAccepted === false) failures.push(`${label} : appui sur « Je suis à bord » refusé`)
          if (r.earlyRide > 0) failures.push(`${label} : à bord avant le départ (${r.earlyRide} s)`)
          if (r.stuckS > STUCK_MAX_S) failures.push(`${label} : consigne d'avant le métro encore ${r.stuckS} s après la sortie`)
          if (r.alertAfterExit > 0) failures.push(`${label} : « Descendez au prochain arrêt » après la sortie (${r.alertAfterExit} s)`)
          if (!r.arrived) failures.push(`${label} : arrivée jamais constatée`)
          if (resume === 'midRide' && (r.midRideFixes === null || r.midRideFixes > MID_RIDE_MAX_FIXES)) {
            failures.push(`${label} : montée non constatée après la reprise du GPS (${r.midRideFixes ?? 'jamais'})`)
          }
        }
      }
    }
  })
}

console.log(`Banc station souterraine — ${runs} rejeux (coupures ${CUTS.join(', ')} m avant la station, ${SEEDS.length} graines)`)
if (failures.length) {
  console.log(`${failures.length} écart(s) :`)
  for (const f of (VERBOSE ? failures : failures.slice(0, 25))) console.log('  - ' + f)
  if (!VERBOSE && failures.length > 25) console.log('  … (--verbose pour tout voir)')
  process.exitCode = 1
} else {
  console.log('Aucun écart sur les critères.')
}

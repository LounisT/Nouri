// Banc d'essai de la navigation pas à pas — rejoue des traces GPS simulées
// sur de VRAIS itinéraires OTP (fixtures/, voir fetch-fixtures.mjs).
//
//   node scripts/nav/bench.cjs            # résumé avant / après
//   node scripts/nav/bench.cjs --verbose  # détail des échecs
//   node scripts/nav/bench.cjs --only=hydra_harrach --scenario=gap5
//
// L'usager simulé suit exactement chaque tronçon (marche à 1,3 m/s ; attente
// de 3 min à l'arrêt ; véhicule à la vitesse prévue par OTP avec 15 s d'arrêt
// à chaque station), une position par seconde. Scénarios :
//   clean      sans bruit, vitesse GPS fournie
//   noise8     bruit gaussien σ = 8 m par axe, vitesse GPS bruitée
//   noise8ios  bruit σ = 8 m, SANS vitesse GPS (Safari iOS en donne peu)
//   jam        bruit + véhicule au pas (2,4 m/s) sur ses 400 premiers mètres
//   outliers   bruit + 2 positions aberrantes pendant l'attente (300 m, Wi-Fi)
//   gap5       bruit + coupure de 5 min en plein tronçon de transport (métro)
//   underground bruit + aucune position du quai jusqu'à 1 min après la sortie
//   offroute   bruit + écart de 300 m perpendiculaire pendant la 1re marche
//   noGps      aucune position : mode horloge + « Je suis à bord » au départ
//
// Critères (nouvelle machine à états) :
//   - aucune bascule avant le départ réel du véhicule (pas de « ride », donc
//     pas de « Descendez », tant que le véhicule n'a pas quitté l'arrêt) ;
//   - abscisse constatée monotone sur un tronçon (hors recul prouvé) ;
//   - arrêts restants non croissants ;
//   - recalage après coupure en quelques positions ;
//   - sortie d'itinéraire signalée, et jamais à tort.
const path = require('path')
const fs = require('fs')
require('./ts-require.cjs')

const nav = require('../../src/lib/navigation.ts')
const legacy = require('./legacy/navigation-legacy.cjs')

const args = Object.fromEntries(process.argv.slice(2).map((a) => {
  const [k, v] = a.replace(/^--/, '').split('=')
  return [k, v ?? true]
}))
const VERBOSE = Boolean(args.verbose)
const TRACE = Boolean(args.trace)
const FIX_DIR = path.join(__dirname, 'fixtures')

const { makeRng, truthTimeline, makeDetour, buildFixes } = require('./sim.cjs')

// ─── Rejeu : nouvelle machine à états ───────────────────────────────────────
function runNew(it, scenario, truth, built) {
  const geoms = nav.buildLegGeometries(it)
  const T0 = 1_800_000_000_000
  let state = nav.createNavState(it, geoms, T0)
  const r = { earlyRide: 0, earlyRideMeters: 0, earlyWaitMeters: 0, alongBack: 0, stopsUp: 0, falseOff: 0, offDetectFix: null, missedBoard: 0, rideLagS: [], recalFixes: null, arrived: false, staleSeenInGap: null, etaStartErrS: null }
  const etaStart = nav.navView(state, it, geoms, T0).etaMs
  r.etaStartErrS = Math.round((etaStart - (T0 + (it.endTime - it.startTime))) / 1000)
  const boardedSeen = {}
  let prevLeg = -1, prevAlong = 0, prevStops = null
  let offTrueSince = null
  let gapResumed = false, gapFixes = 0
  const transitLegs = it.legs.map((l, i) => (l.mode !== 'WALK' ? i : -1)).filter((i) => i >= 0)

  if (scenario === 'noGps') {
    // Pas de GPS : l'horloge estime, l'usager confirme la montée au départ réel.
    let violations = 0
    for (const s of truth.timeline) {
      const now = T0 + s.t * 1000
      if (truth.departures[s.legIndex] === s.t) state = nav.advance(state, { type: 'boarded', now, legIndex: s.legIndex }, it, geoms)
      state = nav.advance(state, { type: 'tick', now }, it, geoms)
      const v = nav.navView(state, it, geoms, now)
      if (v.phase === 'ride' && !(v.legIndex in boardedSeen) && state.boardedBy !== 'user') violations += 1
      if (state.boardedBy === 'user') boardedSeen[state.legIndex] = true
      if (v.source !== 'time' || !v.estimated) violations += 1
    }
    const end = nav.navView(state, it, geoms, T0 + (truth.end + 600) * 1000)
    r.earlyRide = violations
    r.arrived = end.timeElapsed
    return r
  }

  for (const { t, truth: tr, fix } of built.fixes) {
    const now = T0 + Math.round(t * 1000)
    if (scenario === 'gap5' && !gapResumed && t >= built.gapStart + 300) {
      gapResumed = true
      const before = nav.navView(state, it, geoms, now - 1000)
      r.staleSeenInGap = before.source === 'stale' && before.estimated
    }
    state = nav.advance(state, { type: 'fix', fix: { ...fix, receivedAt: now } }, it, geoms)
    const v = nav.navView(state, it, geoms, now)

    // Bascule avant le départ réel du véhicule.
    for (const j of transitLegs) {
      const departed = t >= truth.departures[j]
      const showsRide = (v.legIndex === j && v.phase === 'ride') || v.legIndex > j
      if (showsRide && !departed && !(scenario === 'offroute' && tr.offMeters > 0)) {
        r.earlyRide += 1
      }
    }
    // Attente annoncée trop tôt : « Attendez le bus » alors qu'on marche encore.
    // (Pendant un écart, l'abscisse « vraie » est figée : la mesure n'a pas de sens.)
    if (tr.phase === 'walk' && !tr.pos && v.phase === 'wait' && v.legIndex === tr.legIndex + 1) {
      const early = geoms[tr.legIndex].length - tr.along
      if (early > r.earlyWaitMeters) { r.earlyWaitMeters = early; r.earlyWaitAt = t }
    }
    if (tr.phase === 'ride' && v.legIndex === tr.legIndex && v.phase === 'ride' && !boardedSeen[tr.legIndex]) {
      boardedSeen[tr.legIndex] = true
      r.rideLagS.push(t - truth.departures[tr.legIndex])
    }
    // Monotonie (abscisse constatée et arrêts restants) sur un même tronçon.
    if (state.legIndex === prevLeg && state.phase !== 'arrived') {
      if (state.along < prevAlong - 0.01 && scenario !== 'offroute') r.alongBack += 1
      if (prevStops !== null && state.stopsLeft !== null && state.stopsLeft > prevStops) r.stopsUp += 1
    }
    prevLeg = state.legIndex; prevAlong = state.along; prevStops = state.stopsLeft
    // Sortie d'itinéraire.
    if (tr.offMeters > 130 && offTrueSince === null) offTrueSince = 0
    if (offTrueSince !== null && tr.offMeters > 130) {
      offTrueSince += 1
      if (v.offRoute && r.offDetectFix === null) r.offDetectFix = offTrueSince
    }
    if (tr.offMeters > 130) r.offPossible = true
    if (v.offRoute && tr.offMeters < 60) r.falseOff += 1
    // Recalage après la coupure.
    if (gapResumed && r.recalFixes === null) {
      gapFixes += 1
      const ok = state.legIndex === tr.legIndex && (tr.phase !== 'ride' || (state.phase === 'ride' && Math.abs(state.along - tr.along) < 200))
      if (ok) r.recalFixes = gapFixes
    }
    if (scenario === 'underground' && r.recalFixes === null && tr.legIndex > it.legs.findIndex((l) => l.mode === 'SUBWAY')) {
      gapFixes += 1
      if (state.legIndex === tr.legIndex) r.recalFixes = gapFixes
    }
    if (v.arrived) r.arrived = true
  }
  if (scenario !== 'underground' && scenario !== 'offroute') {
    for (const j of transitLegs) if (!boardedSeen[j] && !(scenario === 'gap5' && j === built.gapLeg)) r.missedBoard += 1
  }
  return r
}

// ─── Rejeu : ancienne logique (page.tsx + navigation.ts d'avant) ────────────
function runLegacy(it, scenario, truth, built) {
  const geoms = legacy.buildLegGeometries(it)
  const r = { earlyRide: 0, earlyRideMeters: 0, alongBack: 0, stopsUp: 0, offDetectFix: null, falseOff: 0, recalFixes: null, etaStartErrS: null }
  const transitLegs = it.legs.map((l, i) => (l.mode !== 'WALK' ? i : -1)).filter((i) => i >= 0)
  let reached = 0
  let lastPos = null
  let prevLeg = -1, prevAlong = 0, prevStops = null
  const start = legacy.progressFromElapsed(it, 0)
  r.etaStartErrS = Math.round(start.remainingSeconds - (it.endTime - it.startTime) / 1000)
  let gapResumed = false, gapFixes = 0
  const step = (t, tr) => {
    const navNow = Math.floor(t / 30) * 30 * 1000 // l'horloge de page.tsx tournait toutes les 30 s
    let prog = lastPos ? legacy.progressFromPosition(it, geoms, lastPos, reached) : null
    if (!prog) prog = legacy.progressFromElapsed(it, navNow)
    if (prog.legIndex > reached) reached = prog.legIndex
    return prog
  }
  if (scenario === 'noGps') {
    for (const s of truth.timeline) {
      const prog = step(s.t, s)
      for (const j of transitLegs) if ((prog.legIndex >= j) && s.t < truth.departures[j]) { r.earlyRide += 1; break }
    }
    return r
  }
  for (const { t, truth: tr, fix } of built.fixes) {
    if (scenario === 'gap5' && !gapResumed && t >= built.gapStart + 300) gapResumed = true
    if (fix.accuracy <= 1000) lastPos = [fix.lon, fix.lat] // l'ancienne version prenait toute position
    const prog = step(t, tr)
    for (const j of transitLegs) {
      if (prog.legIndex >= j && t < truth.departures[j] && !(scenario === 'offroute' && tr.offMeters > 0)) { r.earlyRide += 1; break }
    }
    const along = prog.legProgress * geoms[prog.legIndex].length
    if (prog.legIndex === prevLeg && scenario !== 'offroute') {
      if (along < prevAlong - 0.01) r.alongBack += 1
      if (prevStops !== null && prog.stopsLeft !== null && prog.stopsLeft > prevStops) r.stopsUp += 1
    }
    prevLeg = prog.legIndex; prevAlong = along; prevStops = prog.stopsLeft
    if (gapResumed && r.recalFixes === null) {
      gapFixes += 1
      if (prog.legIndex === tr.legIndex && prog.source === 'gps' && Math.abs(along - tr.along) < 200) r.recalFixes = gapFixes
    }
    if (scenario === 'underground' && r.recalFixes === null && tr.legIndex > it.legs.findIndex((l) => l.mode === 'SUBWAY')) {
      gapFixes += 1
      if (prog.legIndex === tr.legIndex && prog.source === 'gps') r.recalFixes = gapFixes
    }
    // L'ancienne version n'avait pas de détection de sortie d'itinéraire.
  }
  return r
}

// ─── Exécution ──────────────────────────────────────────────────────────────
const SCENARIOS = ['clean', 'noise8', 'noise8ios', 'jam', 'outliers', 'gap5', 'underground', 'offroute', 'noGps']
const SEEDS = [1, 2, 3, 4, 5, 6]
const files = fs.readdirSync(FIX_DIR).filter((f) => f.endsWith('.json')).filter((f) => !args.only || f.startsWith(args.only))
const scenarios = args.scenario ? [args.scenario] : SCENARIOS

const summary = {}
const failures = []
for (const scenario of scenarios) {
  const agg = {
    runs: 0,
    new: { earlyRideRuns: 0, earlyRide: 0, maxEarlyWaitM: 0, alongBackRuns: 0, stopsUpRuns: 0, missedBoard: 0, lagMax: 0, lagSum: 0, lagN: 0, recalMax: null, recalFail: 0, offDetected: 0, offRuns: 0, offMaxFix: 0, falseOffRuns: 0, arrivedRuns: 0, staleOk: 0, etaErrMax: 0 },
    old: { earlyRideRuns: 0, earlyRide: 0, alongBackRuns: 0, stopsUpRuns: 0, recalMax: null, recalFail: 0, offDetected: 0, etaErrMax: 0 },
  }
  for (const file of files) {
    const data = JSON.parse(fs.readFileSync(path.join(FIX_DIR, file), 'utf8'))
    data.itineraries.forEach((it, idx) => {
      const geomsTruth = nav.buildLegGeometries(it)
      const truth = truthTimeline(it, geomsTruth, scenario === 'offroute' ? makeDetour(geomsTruth) : null, scenario === 'jam')
      const hasSubway = it.legs.some((l) => l.mode === 'SUBWAY')
      if (scenario === 'underground' && !hasSubway) return
      const seeds = scenario === 'clean' || scenario === 'noGps' ? [1] : SEEDS.slice(0, Number(args.seeds ?? SEEDS.length))
      for (const seed of seeds) {
        const rng = makeRng(seed * 7919 + idx)
        const built = buildFixes(it, geomsTruth, truth, scenario, rng)
        const a = runNew(it, scenario, truth, built)
        // --new-only : itérations rapides (l'ancienne projection est lente).
        const b = args['new-only'] ? { earlyRide: 0, alongBack: 0, stopsUp: 0, recalFixes: null, etaStartErrS: 0 } : runLegacy(it, scenario, truth, built)
        const label = `${file.replace('.json', '')}#${idx} ${it.legs.map((l) => l.routeShortName ?? 'W').join('>')} seed=${seed}`
        agg.runs += 1
        const n = agg.new, o = agg.old
        if (TRACE) console.log(JSON.stringify({ label, ...a }))
        if (a.earlyRide > 0) { n.earlyRideRuns += 1; n.earlyRide += a.earlyRide; failures.push(`[${scenario}] ${label} : bascule avant le départ (${a.earlyRide} positions)`) }
        n.maxEarlyWaitM = Math.max(n.maxEarlyWaitM, a.earlyWaitMeters || 0)
        if (a.alongBack > 0) { n.alongBackRuns += 1; failures.push(`[${scenario}] ${label} : abscisse en recul ×${a.alongBack}`) }
        if (a.stopsUp > 0) { n.stopsUpRuns += 1; failures.push(`[${scenario}] ${label} : arrêts restants en hausse ×${a.stopsUp}`) }
        if (a.missedBoard > 0) { n.missedBoard += a.missedBoard; failures.push(`[${scenario}] ${label} : montée jamais détectée (${a.missedBoard})`) }
        for (const lag of a.rideLagS) { n.lagMax = Math.max(n.lagMax, lag); n.lagSum += lag; n.lagN += 1 }
        if (scenario === 'gap5' || scenario === 'underground') {
          if (a.recalFixes === null) { n.recalFail += 1; failures.push(`[${scenario}] ${label} : pas de recalage`) } else n.recalMax = Math.max(n.recalMax ?? 0, a.recalFixes)
          if (b.recalFixes === null) o.recalFail += 1; else o.recalMax = Math.max(o.recalMax ?? 0, b.recalFixes)
          if (scenario === 'gap5' && a.staleSeenInGap) n.staleOk += 1
        }
        if (scenario === 'offroute' && a.offPossible) {
          n.offRuns += 1
          if (a.offDetectFix !== null) { n.offDetected += 1; n.offMaxFix = Math.max(n.offMaxFix, a.offDetectFix) } else failures.push(`[${scenario}] ${label} : sortie non détectée`)
        }
        if (a.falseOff > 0) { n.falseOffRuns += 1; failures.push(`[${scenario}] ${label} : sortie d'itinéraire à tort ×${a.falseOff}`) }
        if (a.arrived) n.arrivedRuns += 1
        n.etaErrMax = Math.max(n.etaErrMax, Math.abs(a.etaStartErrS))
        if (b.earlyRide > 0) { o.earlyRideRuns += 1; o.earlyRide += b.earlyRide }
        if (b.alongBack > 0) o.alongBackRuns += 1
        if (b.stopsUp > 0) o.stopsUpRuns += 1
        o.etaErrMax = Math.max(o.etaErrMax, Math.abs(b.etaStartErrS))
      }
    })
  }
  summary[scenario] = agg
}

const pad = (s, n) => String(s).padEnd(n)
console.log(`\nBanc navigation — ${files.length} fixtures OTP, ${new Set(files).size} trajets\n`)
for (const [scenario, { runs, new: n, old: o }] of Object.entries(summary)) {
  console.log(`■ ${scenario}  (${runs} rejeux)`)
  console.log(`  ${pad('critère', 46)}${pad('AVANT', 14)}APRÈS`)
  const row = (label, before, after) => console.log(`  ${pad(label, 46)}${pad(before, 14)}${after}`)
  row('rejeux avec bascule avant départ du véhicule', `${o.earlyRideRuns}/${runs}`, `${n.earlyRideRuns}/${runs}`)
  if (scenario !== 'noGps') {
    row('rejeux avec abscisse qui recule', `${o.alongBackRuns}/${runs}`, `${n.alongBackRuns}/${runs}`)
    row('rejeux avec arrêts restants en hausse', `${o.stopsUpRuns}/${runs}`, `${n.stopsUpRuns}/${runs}`)
    row('« Attendez » annoncé avant l\'arrêt (max, m)', '—', Math.round(n.maxEarlyWaitM))
    row('montées non détectées (GPS)', '—', n.missedBoard)
    if (n.lagN) row('délai de détection de la montée (moy/max, s)', '—', `${Math.round(n.lagSum / n.lagN)} / ${n.lagMax}`)
  }
  if (scenario === 'gap5' || scenario === 'underground') {
    row('recalage : échecs', `${o.recalFail}/${runs}`, `${n.recalFail}/${runs}`)
    row('recalage : positions nécessaires (max)', o.recalMax ?? '—', n.recalMax ?? '—')
    if (scenario === 'gap5') row('coupure annoncée (source « stale » + estimation)', '0 (jamais)', `${n.staleOk}/${runs}`)
  }
  if (scenario === 'offroute') {
    row('sortie d\'itinéraire signalée', `0/${runs}`, `${n.offDetected}/${n.offRuns}`)
    row('délai de signalement (positions après 130 m)', '—', n.offMaxFix)
  }
  row('sortie d\'itinéraire signalée à tort (rejeux)', '—', n.falseOffRuns)
  row('écart heure d\'arrivée initiale vs OTP (max, s)', o.etaErrMax, n.etaErrMax)
  console.log('')
}
if (failures.length) {
  console.log(`${failures.length} écart(s) :`)
  for (const f of (VERBOSE ? failures : failures.slice(0, 20))) console.log('  - ' + f)
  if (!VERBOSE && failures.length > 20) console.log(`  … (--verbose pour tout voir)`)
  process.exitCode = 1
} else {
  console.log('Aucun écart sur les critères.')
}

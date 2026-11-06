// Simulateur du banc d'essai : vérité terrain (où est l'usager, seconde par
// seconde) et trace GPS reçue par l'app selon le scénario. Voir bench.cjs.
// ─── Aléa reproductible ─────────────────────────────────────────────────────
function makeRng(seed) {
  let s = seed >>> 0
  const rnd = () => { s = (Math.imul(s, 1103515245) + 12345) >>> 0; return (s >>> 1) / 0x7fffffff }
  const gauss = () => {
    let u = 0, v = 0
    while (u === 0) u = rnd()
    while (v === 0) v = rnd()
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v)
  }
  return { rnd, gauss }
}

const M_LAT = 111320
const offsetPoint = (p, dx, dy) => [p[0] + dx / (M_LAT * Math.cos(p[1] * Math.PI / 180)), p[1] + dy / M_LAT]

function pointAt(g, along) {
  const a = Math.max(0, Math.min(g.length, along))
  for (let i = 1; i < g.coords.length; i += 1) {
    if (g.cumulative[i] >= a) {
      const seg = g.cumulative[i] - g.cumulative[i - 1]
      const t = seg > 0 ? (a - g.cumulative[i - 1]) / seg : 0
      const p0 = g.coords[i - 1], p1 = g.coords[i]
      return [p0[0] + (p1[0] - p0[0]) * t, p0[1] + (p1[1] - p0[1]) * t]
    }
  }
  return g.coords[g.coords.length - 1]
}

/** Distance (m) d'un point au trajet, tracés approximatifs exclus. */
function distToItinerary(p, geoms) {
  let best = Infinity
  for (const g of geoms) {
    if (g.approximate) continue
    for (let i = 1; i < g.coords.length; i += 1) {
      const a = g.coords[i - 1], b = g.coords[i]
      const sx = M_LAT * Math.cos(a[1] * Math.PI / 180)
      const bx = (b[0] - a[0]) * sx, by = (b[1] - a[1]) * M_LAT
      const px = (p[0] - a[0]) * sx, py = (p[1] - a[1]) * M_LAT
      const l2 = bx * bx + by * by
      const t = l2 ? Math.max(0, Math.min(1, (px * bx + py * by) / l2)) : 0
      best = Math.min(best, Math.hypot(px - t * bx, py - t * by))
    }
  }
  return best
}

// ─── Vérité terrain : où est l'usager, seconde par seconde ─────────────────
const WALK_SPEED = 1.3
const WAIT_S = 180
const DWELL_S = 15

function truthTimeline(it, geoms, detour = null, jam = false) {
  const out = [] // { t, legIndex, along, phase, speed, pos?, offMeters? }
  const departures = {}
  let t = 0
  it.legs.forEach((leg, li) => {
    const g = geoms[li]
    if (leg.mode === 'WALK') {
      const n = Math.max(1, Math.ceil(g.length / WALK_SPEED))
      for (let k = 0; k <= n; k += 1) {
        const along = Math.min(g.length, k * WALK_SPEED)
        out.push({ t, legIndex: li, along, phase: 'walk', speed: WALK_SPEED })
        t += 1
        // Écart : l'usager quitte le trajet perpendiculairement, attend, puis
        // revient au même point avant de reprendre sa marche (le temps passe).
        if (detour && detour.leg === li && k === Math.round(detour.along / WALK_SPEED)) {
          const total = 2 * detour.out + detour.stay
          for (let c = 0; c < total; c += 1) {
            const dist = c < detour.out ? c * WALK_SPEED
              : c < detour.out + detour.stay ? detour.out * WALK_SPEED
                : (total - c) * WALK_SPEED
            const pos = offsetPoint(detour.base, detour.ux * dist, detour.uy * dist)
            out.push({ t, legIndex: li, along, phase: 'walk', speed: c >= detour.out && c < detour.out + detour.stay ? 0 : WALK_SPEED, pos, offMeters: distToItinerary(pos, geoms) })
            t += 1
          }
        }
      }
      return
    }
    for (let k = 0; k < WAIT_S; k += 1) out.push({ t: t + k, legIndex: li, along: 0, phase: 'wait', speed: 0 })
    t += WAIT_S
    departures[li] = t
    const speed = Math.max(4, g.length / Math.max(1, leg.duration))
    const stops = new Set(g.stopAlongs.map((a) => Math.round(a)))
    let along = 0
    let dwell = 0
    while (along < g.length) {
      if (dwell > 0) { dwell -= 1; out.push({ t, legIndex: li, along, phase: 'ride', speed: 0 }); t += 1; continue }
      // Embouteillage : le véhicule avance au pas (2,4 m/s) sur ses 400 premiers mètres.
      const v = jam && along < 400 ? 2.4 : speed
      const nextAlong = Math.min(g.length, along + v)
      for (const s of stops) if (s > along && s <= nextAlong) { dwell = DWELL_S; stops.delete(s) }
      along = nextAlong
      out.push({ t, legIndex: li, along, phase: 'ride', speed: v })
      t += 1
    }
    out.push({ t, legIndex: li, along: g.length, phase: 'ride', speed: 0 })
    t += 1
  })
  return { timeline: out, departures, end: t }
}

/**
 * Écart pour le scénario « offroute » : perpendiculaire à 40 % de la première
 * marche, du côté qui s'éloigne le plus du trajet (l'autre côté peut longer
 * la rue suivante du trajet).
 */
function makeDetour(geoms) {
  const g0 = geoms[0]
  const along = Math.round((g0.length * 0.4) / WALK_SPEED) * WALK_SPEED
  const base = pointAt(g0, along)
  const ahead = pointAt(g0, Math.min(g0.length, along + 10))
  const dx = (ahead[0] - base[0]) * M_LAT * Math.cos(base[1] * Math.PI / 180)
  const dy = (ahead[1] - base[1]) * M_LAT
  const n = Math.hypot(dx, dy) || 1
  const sides = [1, -1].map((side) => {
    const far = offsetPoint(base, side * (-dy / n) * 300, side * (dx / n) * 300)
    return { side, d: distToItinerary(far, geoms) }
  })
  const side = sides[0].d >= sides[1].d ? 1 : -1
  return { leg: 0, along, out: 230, stay: 60, base, ux: side * (-dy / n), uy: side * (dx / n) }
}

// ─── Scénarios : la trace GPS que reçoit l'app ──────────────────────────────
/**
 * @param opts.cutMeters  undergroundEarly : distance (m) avant le point GTFS de
 *   la station où le GPS se perd (escalier d'accès : 40 à 120 m en pratique).
 * @param opts.resume     undergroundEarly : 'exit' (défaut) = GPS retrouvé 1 min
 *   après la sortie ; 'midRide' = retrouvé à mi-parcours du métro (tronçon
 *   aérien, ou tram/bus qui ressort d'un tunnel).
 */
function buildFixes(it, geoms, truth, scenario, rng, opts = {}) {
  const sigma = scenario === 'clean' ? 0 : 8
  const withSpeed = scenario !== 'noise8ios'
  const transitIdx = it.legs.map((l, i) => (l.mode !== 'WALK' ? i : -1)).filter((i) => i >= 0)
  const subway = it.legs.findIndex((l) => l.mode === 'SUBWAY')
  const gapLeg = subway >= 0 ? subway : transitIdx.reduce((best, i) => (geoms[i].length > geoms[best].length ? i : best), transitIdx[0])
  const gapStart = truth.departures[gapLeg] + 60
  const fixes = []
  for (const s of truth.timeline) {
    if (scenario === 'noGps') break
    if (scenario === 'gap5' && s.t >= gapStart && s.t < gapStart + 300) continue
    if (scenario === 'underground' && subway >= 0) {
      const enter = s.legIndex === subway - 1 && s.along >= geoms[subway - 1].length - 5
      const inside = s.legIndex === subway || (s.legIndex === subway + 1 && s.along < 60 * WALK_SPEED)
      if (enter || inside) continue
    }
    // GPS perdu dès l'escalier, bien avant le point de la station (R7) : la
    // marche ne peut pas être constatée jusqu'au quai.
    if (scenario === 'undergroundEarly' && subway >= 0) {
      const cut = opts.cutMeters ?? 60
      const enter = s.legIndex === subway - 1 && s.along >= geoms[subway - 1].length - cut
      const inside = opts.resume === 'midRide'
        ? s.legIndex === subway && (s.phase === 'wait' || s.along < geoms[subway].length / 2)
        : s.legIndex === subway || (s.legIndex === subway + 1 && s.along < 60 * WALK_SPEED)
      if (enter || inside) continue
    }
    const p = s.pos ?? pointAt(geoms[s.legIndex], s.along)
    const fix = noisy(p, sigma, withSpeed ? s.speed : null, rng)
    fixes.push({ t: s.t, truth: { ...s, offMeters: s.offMeters ?? 0 }, fix })
    if (scenario === 'outliers' && s.phase === 'wait' && (s.t - (truth.departures[s.legIndex] - WAIT_S) === 60)) {
      // Fix Wi-Fi/cellulaire aberrant : 300 m, précision annoncée mensongère.
      fixes.push({ t: s.t + 0.3, truth: { ...s, offMeters: 0 }, fix: { ...noisy(offsetPoint(p, 300, 40), 0, null, rng), accuracy: 25 } })
      fixes.push({ t: s.t + 0.6, truth: { ...s, offMeters: 0 }, fix: { ...noisy(offsetPoint(p, -250, 200), 0, null, rng), accuracy: 400 } })
    }
  }
  return { fixes, gapLeg, gapStart }
}

function noisy(p, sigma, speed, rng) {
  const q = sigma > 0 ? offsetPoint(p, rng.gauss() * sigma, rng.gauss() * sigma) : p
  return {
    lon: q[0],
    lat: q[1],
    accuracy: sigma > 0 ? 12 : 5,
    speed: speed === null ? null : Math.max(0, speed + (sigma > 0 ? rng.gauss() * 0.4 : 0)),
  }
}


module.exports = { makeRng, truthTimeline, makeDetour, buildFixes, pointAt, offsetPoint, distToItinerary, WALK_SPEED, WAIT_S }

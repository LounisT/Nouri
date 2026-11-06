// Enregistre de VRAIS itinéraires OTP (production) comme fixtures du banc
// d'essai de navigation. Rien n'est fabriqué : on garde la réponse d'OTP,
// allégée des champs que la navigation n'utilise pas.
//
//   node scripts/nav/fetch-fixtures.mjs [date=2026-11-09] [time=09:00]
//
// Les fichiers vont dans scripts/nav/fixtures/<nom>.json. À relancer quand le
// GTFS change (les tracés et les arrêts évoluent avec lui).
import { writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const BASE = process.env.OTP_URL ?? 'https://nouri.lounis.dev/api/otp/routers/default/plan'
const date = process.argv[2] ?? '2026-11-09' // un lundi
const time = process.argv[3] ?? '09:00'
const outDir = join(dirname(fileURLToPath(import.meta.url)), 'fixtures')
mkdirSync(outDir, { recursive: true })

// Couples départ → arrivée repris des constats d'audit (K1, K2, K3, K4) et
// complétés pour couvrir bus, métro, tram et correspondances.
const PAIRS = [
  ['benaknoun_poste', [36.7600, 3.0080], [36.7724, 3.0587]], // BUS 50 (K1)
  ['hydra_harrach', [36.7466, 3.0272], [36.7206, 3.1336]], // BUS 88 + M1 (K2, K3, K4)
  ['cnr_harrach', [36.7550, 3.0450], [36.7160, 3.1370]], // BUS 10 + M1 (K1)
  ['usthb_martyrs', [36.7125, 3.1806], [36.7853, 3.0608]],
  ['trip0_bus6', [36.7262, 3.0832], [36.7724, 3.0587]],
  ['trip2', [36.7290, 3.0910], [36.7700, 3.0550]],
  ['trip4_m1', [36.7380, 3.1050], [36.7660, 3.0420]],
  ['trip5_tram', [36.7180, 3.1550], [36.7470, 3.0850]],
  ['trip6_bus98', [36.7800, 3.0570], [36.7350, 3.1150]],
  ['trip7_bus72', [36.7520, 3.0620], [36.7090, 3.1750]],
  ['trip8', [36.7650, 3.0300], [36.7400, 3.0950]],
  ['od4', [36.7200, 3.1800], [36.7650, 3.0550]],
  ['od6', [36.7300, 3.0400], [36.7840, 3.0590]],
  ['od9', [36.7660, 3.0250], [36.7350, 3.1300]],
]

const KEEP_LEG = [
  'mode', 'startTime', 'endTime', 'duration', 'distance', 'routeShortName', 'routeLongName',
  'routeId', 'headsign', 'headway', 'isNonExactFrequency', 'legGeometry', 'intermediateStops', 'steps',
]
const KEEP_PLACE = ['name', 'stopId', 'lat', 'lon']
const pick = (o, keys) => Object.fromEntries(keys.filter((k) => o[k] !== undefined).map((k) => [k, o[k]]))

for (const [name, from, to] of PAIRS) {
  const params = new URLSearchParams({
    fromPlace: from.join(','), toPlace: to.join(','), date, time,
    mode: 'TRANSIT,WALK', numItineraries: '8', walkSpeed: '1.2', walkReluctance: '4',
    searchWindow: '7200', showIntermediateStops: 'true', arriveBy: 'false', locale: 'fr',
  })
  const res = await fetch(`${BASE}?${params}`, { headers: { Accept: 'application/json' } })
  if (!res.ok) { console.error(name, res.status); continue }
  const data = await res.json()
  const seen = new Set()
  const itineraries = []
  for (const it of data.plan?.itineraries ?? []) {
    if (!it.legs.some((l) => l.mode !== 'WALK')) continue
    const sig = it.legs.map((l) => `${l.mode}:${l.routeShortName ?? ''}`).join('>')
    if (seen.has(sig)) continue
    seen.add(sig)
    itineraries.push({
      ...pick(it, ['duration', 'startTime', 'endTime', 'walkTime', 'transitTime', 'waitingTime', 'walkDistance', 'transfers', 'fare']),
      legs: it.legs.map((l) => ({
        ...pick(l, KEEP_LEG),
        from: pick(l.from, KEEP_PLACE),
        to: pick(l.to, KEEP_PLACE),
        ...(l.intermediateStops ? { intermediateStops: l.intermediateStops.map((s) => pick(s, KEEP_PLACE)) } : {}),
      })),
    })
  }
  const file = join(outDir, `${name}.json`)
  writeFileSync(file, JSON.stringify({ source: BASE, date, time, from, to, itineraries }))
  console.log(name, itineraries.map((it) => it.legs.map((l) => l.routeShortName ?? 'W').join('>')).join(' | '))
}

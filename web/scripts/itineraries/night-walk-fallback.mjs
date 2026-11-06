// Banc des replis de searchItineraries (lib/otp.ts), sans build ni navigateur.
//
// 1) Cascade avec un OTP SIMULÉ (fetch remplacé) : chaque cas décrit ce que
//    renvoie OTP selon l'heure, le mode et la fenêtre demandés.
//    - nuit, marche ≤ 60 min faisable tout de suite : elle est LA réponse, à
//      l'heure demandée (constat R11) ;
//    - nuit, marche trop longue : premiers départs du matin, sans marche décalée ;
//    - 19:30 sans rien jusqu'à minuit : demain matin (R12) ;
//    - 15:00, rien sur 2 h mais un départ à 18:00 : plus tard aujourd'hui ;
//    - « arriver avant 22:30 » : dernières arrivées possibles ;
//    - « arriver avant 06:00 » : premières arrivées après 06:00 ;
//    - aucune ligne (sens unique) : erreur noRoute en 2 requêtes ;
//    - repli en panne : échec réessayable, jamais « aucun trajet » ;
//    - TOO_CLOSE pour 1,3 km de marche : « à pied uniquement » (R30) ;
//    - M1 ↔ M1 à quai : un seul ticket (R14) ; tronc du M1 : une rangée,
//      ~10 min (R29) ;
//    - sonde de santé limitée (429) : pas de « ne répond pas » (R27/R41) ;
//    - proxy : coordonnées à 15 décimales, pageCursor, fenêtre (R28/R39/R40).
// 2) Optionnel, contre un OTP RÉEL (OTP=http://127.0.0.1:8090) : Grande Poste
//    → Place des Martyrs le 2026-11-06 à 01:00.
//
// Usage (depuis web/) : node scripts/itineraries/night-walk-fallback.mjs
//                       OTP=http://127.0.0.1:8090 node scripts/itineraries/night-walk-fallback.mjs
import { createRequire } from 'module'
import path from 'path'
import { fileURLToPath } from 'url'

const require = createRequire(import.meta.url)
const HERE = path.dirname(fileURLToPath(import.meta.url))
require(path.join(HERE, '..', 'nav', 'ts-require.cjs'))

const LIVE_OTP = process.env.OTP
process.env.OTP_INTERNAL_URL = 'http://mock-otp'
delete process.env.NEXT_PUBLIC_DEMO
const otp = require(path.join(HERE, '..', '..', 'src', 'lib', 'otp.ts'))
const { algiersToEpoch, formatAlgiersTime } = require(path.join(HERE, '..', '..', 'src', 'lib', 'algiers-time.ts'))
const { legHeadwayMin } = require(path.join(HERE, '..', '..', 'src', 'lib', 'leg-headway.ts'))

let failed = 0
const check = (cond, msg) => { console.log(`${cond ? 'OK  ' : 'FAIL'} ${msg}`); if (!cond) failed++ }

// ── OTP simulé ────────────────────────────────────────────────────────────────
const at = (date, hhmm) => algiersToEpoch(date, hhmm)
const P = (name, lat, lon, stopId) => ({ name, lat, lon, ...(stopId ? { stopId } : {}) })
const A = P('Grande Poste', 36.7724, 3.0594)
const B = P('Place des Martyrs', 36.7856, 3.0607)

function leg(mode, start, end, extra = {}) {
  return {
    mode, startTime: start, endTime: end, duration: (end - start) / 1000, distance: extra.distance ?? 1000,
    from: extra.from ?? A, to: extra.to ?? B, legGeometry: { points: '' }, ...extra,
  }
}
function itin(legs) {
  const walk = legs.filter((l) => l.mode === 'WALK')
  const transit = legs.filter((l) => l.mode !== 'WALK')
  return {
    duration: (legs[legs.length - 1].endTime - legs[0].startTime) / 1000,
    startTime: legs[0].startTime, endTime: legs[legs.length - 1].endTime,
    walkTime: walk.reduce((s, l) => s + l.duration, 0), transitTime: transit.reduce((s, l) => s + l.duration, 0),
    waitingTime: 0, walkDistance: walk.reduce((s, l) => s + l.distance, 0),
    transfers: Math.max(0, transit.length - 1), legs,
  }
}
const walkIt = (start, min, metres) => itin([leg('WALK', start, start + min * 60_000, { distance: metres })])
const bus50 = (start, min = 40) => itin([
  leg('WALK', start - 5 * 60_000, start, { distance: 300, to: P('Arrêt', 36.77, 3.05, 'alger:B1') }),
  leg('BUS', start, start + min * 60_000, {
    routeShortName: '50', routeId: 'alger:ETUSA-50', tripId: `alger:ETUSA-50-dir1-${formatAlgiersTime(start).replace(':', '')}`,
    headsign: 'Place des Martyrs', from: P('Arrêt', 36.77, 3.05, 'alger:B1'),
  }),
])
const NOT_FOUND = { error: { id: 404, msg: 'No trip found', message: 'PATH_NOT_FOUND' } }

const realFetch = globalThis.fetch
let calls = []
let handler = () => ({ plan: { itineraries: [] } })
globalThis.fetch = async (url) => {
  const u = new URL(url)
  const q = Object.fromEntries(u.searchParams)
  q.epoch = at(q.date, q.time)
  q.arriveBy = q.arriveBy === 'true'
  q.window = Number(q.searchWindow)
  calls.push(q)
  const out = handler(q)
  if (out === 503) return new Response('{"error":"OTP unavailable"}', { status: 503 })
  return new Response(JSON.stringify(out), { status: 200, headers: { 'Content-Type': 'application/json' } })
}
const run = async (h, when, arriveBy = false) => {
  calls = []
  handler = h
  return otp.searchItineraries(A, B, { when, arriveBy })
}
const hm = (ms) => formatAlgiersTime(ms)

// 1. 01:00, marche de 22 min : la marche à l'heure demandée, une seule requête.
let o = await run((q) => (q.time === '01:00'
  ? { ...NOT_FOUND, plan: { itineraries: [walkIt(q.epoch, 22, 1731)] } }
  : { plan: { itineraries: [walkIt(q.epoch, 22, 1731), bus50(q.epoch + 20 * 60_000)] } }),
{ date: '2026-11-06', time: '01:00' })
check(o.status === 'ok' && o.notice === 'walkOnly' && o.itineraries.length === 1 && o.itineraries[0].walkOnly
  && hm(o.itineraries[0].startTime) === '01:00' && calls.length === 1,
`01:00 marche 22 min → ${o.status}/${o.notice}, ${o.itineraries?.map((it) => `${hm(it.startTime)}→${hm(it.endTime)}`).join(' ')}, ${calls.length} requête(s)`)

// 2. 23:30, marche de 90 min : premiers départs du matin, sans marche décalée.
o = await run((q) => (q.date === '2026-11-09'
  ? { ...NOT_FOUND, plan: { itineraries: [walkIt(q.epoch, 90, 6500)] } }
  : { plan: { itineraries: [walkIt(q.epoch, 50, 3500), bus50(at(q.date, '05:50'))] } }),
{ date: '2026-11-09', time: '23:30' })
check(o.status === 'nextService' && o.fallback === 'morning' && o.dayOffset === 1 && o.itineraries.every((it) => !it.walkOnly),
  `23:30 marche 90 min → ${o.status}/${o.fallback}/j+${o.dayOffset}, marche seule : ${o.itineraries?.some((it) => it.walkOnly)}`)

// 3. 19:30 : le 50 a fini à 18:30 → rien jusqu'à minuit → demain matin.
o = await run((q) => (q.date === '2026-11-10' ? { plan: { itineraries: [bus50(at(q.date, '05:50'))] } } : NOT_FOUND),
  { date: '2026-11-09', time: '19:30' })
check(o.status === 'nextService' && o.fallback === 'morning' && o.dayOffset === 1 && o.serviceQuery.date === '2026-11-10',
  `19:30 → ${o.status}/${o.fallback}/j+${o.dayOffset} (${calls.map((c) => `${c.date} ${c.time}/${c.window}`).join(', ')})`)

// 4. 15:00 : rien sur 2 h, un départ à 18:00 → plus tard aujourd'hui.
o = await run((q) => {
  const dep = at('2026-11-09', '18:00')
  if (q.date === '2026-11-10') return { plan: { itineraries: [bus50(at(q.date, '05:50'))] } }
  if (!q.arriveBy && q.epoch <= dep && dep <= q.epoch + q.window * 1000) return { plan: { itineraries: [bus50(dep)] } }
  return NOT_FOUND
}, { date: '2026-11-09', time: '15:00' })
check(o.status === 'nextService' && o.fallback === 'laterToday' && o.dayOffset === 0 && hm(o.itineraries[0].legs[1].startTime) === '18:00',
  `15:00 → ${o.status}/${o.fallback}, bus à ${o.itineraries ? hm(o.itineraries[0].legs[1].startTime) : '-'}`)

// 5. « Arriver avant 22:30 » : 18:00 → 19:09 trouvé sur une fenêtre élargie.
o = await run((q) => {
  if (q.arriveBy && q.window > 7200) return { plan: { itineraries: [bus50(at('2026-11-05', '18:29'), 40)] } }
  if (q.date === '2026-11-06') return { plan: { itineraries: [bus50(at(q.date, '05:50'))] } }
  return NOT_FOUND
}, { date: '2026-11-05', time: '22:30' }, true)
check(o.status === 'nextService' && o.fallback === 'latestArrival' && o.itineraries.every((it) => it.endTime <= at('2026-11-05', '22:30')),
  `arriver avant 22:30 → ${o.status}/${o.fallback}, arrivée ${o.itineraries ? hm(o.itineraries[0].endTime) : '-'}`)

// 6. « Arriver avant 06:00 » : premier tram 05:50 → 06:14 → premières arrivées.
o = await run((q) => {
  if (q.arriveBy) return NOT_FOUND
  if (q.date === '2026-11-09' && q.time === '04:30') return { plan: { itineraries: [bus50(at(q.date, '05:50'), 24)] } }
  if (q.date === '2026-11-10') return { plan: { itineraries: [bus50(at(q.date, '05:50'), 24)] } }
  return NOT_FOUND
}, { date: '2026-11-09', time: '06:00' }, true)
check(o.status === 'nextService' && o.fallback === 'firstArrival' && o.dayOffset === 0 && hm(o.itineraries[0].endTime) === '06:14',
  `arriver avant 06:00 → ${o.status}/${o.fallback}/j+${o.dayOffset}, arrivée ${o.itineraries ? hm(o.itineraries[0].endTime) : '-'}`)

// 7. Aucune ligne (sens unique, Birtouta) : noRoute, 2 requêtes seulement.
o = await run(() => NOT_FOUND, { date: '2026-11-09', time: '09:00' })
check(o.status === 'error' && o.error.reason === 'noRoute' && calls.length === 2,
  `aucun trajet → ${o.status}/${o.error?.reason}, ${calls.length} requêtes`)
check(otp.describePlanError(o.error, 'fr').includes('nos données') && !otp.describePlanError(o.error, 'fr').includes('heure'),
  `message noRoute : « ${otp.describePlanError(o.error, 'fr')} »`)

// 8. Repli en panne : échec réessayable, pas « aucun trajet ».
o = await run((q) => (q.time === '09:00' ? NOT_FOUND : 503), { date: '2026-11-09', time: '09:00' })
check(o.status === 'error' && o.error.kind === 'otpUnavailable' && otp.isRetryablePlanError(o.error),
  `repli injoignable → ${o.status}/${o.error?.kind}`)

// 9. TOO_CLOSE : 1 268 m / 18 min → walkOnly ; 300 m / 4 min → tooClose.
const TOO_CLOSE = { error: { id: 409, msg: 'Origin is within a trivial distance of the destination.', message: 'TOO_CLOSE' } }
o = await run((q) => ({ ...TOO_CLOSE, plan: { itineraries: [walkIt(q.epoch, 18, 1268)] } }), { date: '2026-11-09', time: '10:00' })
check(o.status === 'ok' && o.notice === 'walkOnly', `TOO_CLOSE 1 268 m → ${o.status}/${o.notice}`)
o = await run((q) => ({ ...TOO_CLOSE, plan: { itineraries: [walkIt(q.epoch, 4, 300)] } }), { date: '2026-11-09', time: '10:00' })
check(o.status === 'ok' && o.notice === 'tooClose', `TOO_CLOSE 300 m → ${o.status}/${o.notice}`)

// 10. M1 ↔ M1 à Haï El Badr : un seul ticket (50 DZD), même avec deux legProducts.
const t0 = at('2026-11-09', '09:12')
const m1 = (from, to, start, end, trip, headsign) => leg('SUBWAY', start, end, {
  routeShortName: 'M1', routeId: 'alger:L1-metro', tripId: `alger:${trip}`, headsign, from, to,
})
const GUE = P('Gué de Constantine', 36.709584, 3.090223, 'alger:M29')
const BADR = P('Haï El Badr', 36.72, 3.10, 'alger:M12')
const GARE = P('El Harrach Gare', 36.72, 3.13, 'alger:M15')
const cross = itin([m1(GUE, BADR, t0, t0 + 8 * 60_000, 'M1-AIN-1-0911', 'Place des Martyrs'), m1(BADR, GARE, t0 + 10 * 60_000, t0 + 30 * 60_000, 'M1-HAR-0-0920', 'El Harrach Centre')])
cross.fare = { legProducts: [
  { legIndices: [0], products: [{ id: 'alger:metro_flat', amount: { cents: 5000, currency: { defaultFractionDigits: 2 } } }] },
  { legIndices: [1], products: [{ id: 'alger:metro_flat', amount: { cents: 5000, currency: { defaultFractionDigits: 2 } } }] },
] }
o = await run(() => ({ plan: { itineraries: [cross] } }), { date: '2026-11-09', time: '09:00' })
check(o.status === 'ok' && o.itineraries[0].fareDzd === 50, `M1 ↔ M1 à quai → ${o.itineraries?.[0]?.fareDzd} DZD`)

// 11. Tronc commun du M1 : deux rames de branches différentes = une rangée, ~10 min.
const TAF = P('Tafourah - Grande Poste', 36.7724, 3.0594, 'alger:M01')
const FUS = P('Les Fusillés', 36.74, 3.09, 'alger:M07')
const t1 = at('2026-11-09', '10:03')
const trunk = (start, trip, headsign) => itin([m1(TAF, FUS, start, start + 8 * 60_000, trip, headsign)])
o = await run(() => ({ plan: { itineraries: [trunk(t1, 'M1-HAR-0-1000', 'El Harrach Centre'), trunk(t1 + 10 * 60_000, 'M1-AIN-0-1010', 'Aïn Naâdja')] } }),
  { date: '2026-11-09', time: '10:00' })
const trunkHeadway = o.itineraries ? legHeadwayMin(o.itineraries[0].legs[0]) : null
check(o.status === 'ok' && o.itineraries.length === 1 && trunkHeadway === 10,
  `Tafourah → Les Fusillés : ${o.itineraries?.length} rangée(s), ~${trunkHeadway} min`)
const branch = m1(TAF, P('Aïn Naâdja', 36.69, 3.09, 'alger:M30'), t1, t1 + 30 * 60_000, 'M1-AIN-0-1010', 'Aïn Naâdja')
check(legHeadwayMin(branch) === 20, `Tafourah → Aïn Naâdja : ~${legHeadwayMin(branch)} min (une branche)`)

// 12. Santé : un 429 du proxy (CGNAT) n'est pas une panne — onChange n'est pas
//     appelé (le bandeau « ne répond pas » ne s'affiche pas).
globalThis.fetch = async () => new Response('{"error":"Too many requests"}', { status: 429, headers: { 'Retry-After': '7' } })
const info = await otp.fetchOtpInfo()
check(info.ok === false && info.rateLimited === true && info.retryAfterMs === 7000, `sonde 429 → rateLimited, réessai ${info.retryAfterMs} ms`)
let changes = 0
const stop = otp.watchOtpHealth(() => { changes += 1 })
await new Promise((r) => setTimeout(r, 200))
stop()
check(changes === 0, `sonde 429 : aucun changement d'état annoncé (${changes})`)

// 13. Proxy /api/otp : coordonnées de l'ancien client (15 décimales) acceptées et
//     arrondies, pageCursor jamais relayé, fenêtre plafonnée à 6 h, sonde de
//     santé tolérante (CGNAT).
const upstream = []
globalThis.fetch = async (url) => {
  upstream.push(String(url))
  return new Response(String(url).includes('/plan') ? '{"plan":{"itineraries":[]}}' : '{"routerId":"default"}', { status: 200 })
}
const { NextRequest } = require(path.join(HERE, '..', '..', 'node_modules', 'next', 'server.js'))
const route = require(path.join(HERE, '..', '..', 'src', 'app', 'api', 'otp', '[...path]', 'route.ts'))
const call = (p, qs, ip = '203.0.113.50') => route.GET(
  new NextRequest(`http://localhost/api/otp/${p}${qs ? `?${qs}` : ''}`, { headers: { 'x-forwarded-for': ip } }),
  { params: { path: p.split('/') } })
let r = await call('routers/default/plan', 'fromPlace=36.75382416534177,3.0587926292419434&toPlace=36.77241666666667,3.05941666666667&date=2026-11-09&time=09:00&searchWindow=86400&pageCursor=MXxORVhUX1BBR0V8MjAyNi0xMS0wNlQwNjowMDowMFp8fDQ4aA')
const sent = new URL(upstream[upstream.length - 1])
check(r.status === 200 && sent.searchParams.get('fromPlace') === '36.753824,3.058793' && sent.searchParams.get('toPlace') === '36.772417,3.059417',
  `coordonnées à 15 décimales → ${r.status}, relayées ${sent.searchParams.get('fromPlace')}`)
check(!sent.searchParams.has('pageCursor') && sent.searchParams.get('searchWindow') === '21600',
  `pageCursor ignoré, searchWindow 86400 → ${sent.searchParams.get('searchWindow')}`)
r = await call('routers/default/plan', `fromPlace=${'3'.repeat(70)}&toPlace=36.7,3.1`)
check(r.status === 400, `coordonnée démesurée → ${r.status}`)
const probes = []
for (let i = 0; i < 121; i++) probes.push((await call('routers/default', '', '198.51.100.77')).status)
check(probes.slice(0, 120).every((x) => x === 200) && probes[120] === 429, `sonde de santé : 120 en rafale depuis une IP, puis 429`)

// ── OTP réel (facultatif) ─────────────────────────────────────────────────────
if (LIVE_OTP && realFetch) {
  globalThis.fetch = realFetch
  process.env.OTP_INTERNAL_URL = LIVE_OTP
  delete require.cache[require.resolve(path.join(HERE, '..', '..', 'src', 'lib', 'otp.ts'))]
  const live = require(path.join(HERE, '..', '..', 'src', 'lib', 'otp.ts'))
  o = await live.searchItineraries(A, B, { when: { date: '2026-11-06', time: '01:00' } })
  check(o.status === 'ok' && o.notice === 'walkOnly' && o.itineraries.length === 1 && hm(o.itineraries[0].startTime) === '01:00'
    && !o.itineraries.some((it) => hm(it.startTime) === '04:30'),
  `OTP réel 01:00 Grande Poste → Place des Martyrs : ${o.status}/${o.notice ?? o.fallback ?? ''} ${o.itineraries?.map((it) => `${hm(it.startTime)}→${hm(it.endTime)}${it.walkOnly ? ' à pied' : ''}`).join(', ')}`)
  const far = await live.searchItineraries(P('El Harrach', 36.722002, 3.137163), P('Ben Aknoun', 36.752715, 3.005665), { when: { date: '2026-11-09', time: '23:30' } })
  check(far.status === 'nextService' && far.itineraries.every((it) => !it.walkOnly),
    `OTP réel 23:30 El Harrach → Ben Aknoun : ${far.status}/${far.fallback ?? far.error?.reason}, sans marche seule`)
  const by = await live.searchItineraries(P('El Harrach', 36.722002, 3.137163), P('Ben Aknoun', 36.752715, 3.005665), { when: { date: '2026-11-05', time: '22:30' }, arriveBy: true })
  check(by.status === 'nextService' && by.fallback === 'latestArrival',
    `OTP réel arriver avant 22:30 El Harrach → Ben Aknoun : ${by.status}/${by.fallback ?? by.error?.reason} ${by.itineraries?.map((it) => `${hm(it.startTime)}→${hm(it.endTime)}`).join(', ') ?? ''}`)
}
process.exitCode = failed ? 1 : 0

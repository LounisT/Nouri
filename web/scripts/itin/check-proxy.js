// Proxy /api/otp : liste blanche de paramètres, bornes, hors zone, cache,
// limitation de débit. Le handler est appelé directement (pas de serveur Next).
process.env.OTP_INTERNAL_URL = process.env.OTP
const { NextRequest } = require('next/server')
const route = require(`${process.env.BUILD}/app/api/otp/[...path]/route.js`)

let failed = 0
const check = (cond, msg) => { console.log(`${cond ? 'OK  ' : 'FAIL'} ${msg}`); if (!cond) failed++ }
const call = (path, qs, ip = '203.0.113.7') => route.GET(
  new NextRequest(`http://localhost/api/otp/${path}${qs ? `?${qs}` : ''}`, { headers: { 'x-forwarded-for': ip } }),
  { params: { path: path.split('/') } })
const base = 'fromPlace=36.7731,3.0595&toPlace=36.7130,3.1800&mode=TRANSIT,WALK&showIntermediateStops=true&locale=fr'

;(async () => {
  let r = await call('routers/default/plan', `${base}&time=09:00&numItineraries=200&searchWindow=86400&_=1`)
  let j = await r.json()
  check(r.status === 200 && j.plan.itineraries.length <= 8 && j.metadata.searchWindowUsed <= 21600, `bornes (fenêtre plafonnée à 6 h, repli de nuit) : ${j.plan?.itineraries.length} itinéraires, fenêtre ${j.metadata?.searchWindowUsed} s`)
  check(r.headers.get('cache-control') === 'private, max-age=30', `Cache-Control plan = ${r.headers.get('cache-control')}`)
  const places = 'fromPlace=36.7731,3.0595&toPlace=36.7130,3.1800'
  for (const bad of ['mode=CAR', 'mode=TRANSIT,BICYCLE', 'time=25:00', 'date=2026-02-30', 'arriveBy=yes', 'fromPlace=abc']) {
    r = await call('routers/default/plan', bad.startsWith('fromPlace') ? `${bad}&toPlace=36.7,3.1` : `${places}&${bad}`)
    check(r.status === 400 && r.headers.get('cache-control') === 'no-store', `${bad} → ${r.status}`)
  }
  r = await call('routers/default/plan', `${base}&time=${encodeURIComponent('09:00 PM')}`)
  j = await r.json()
  check(j.requestParameters?.time === '21:00', `« 09:00 PM » (espace fine) → OTP reçoit ${j.requestParameters?.time}`)
  r = await call('routers/default/plan', 'fromPlace=36.7731,3.0595&toPlace=36.59,2.44&time=09:00')
  j = await r.json()
  check(j.error?.message === 'OUTSIDE_SERVICE_AREA' && j.error.missing.join() === 'TO_PLACE', 'Tipaza → OUTSIDE_SERVICE_AREA / TO_PLACE')
  r = await call('routers/default', '')
  j = await r.json()
  check(r.status === 200 && r.headers.get('cache-control') === 'no-store' && j.transitServiceEnds && !j.polygon, 'sonde de santé : no-store, champs réduits')
  check((await call('routers/default/index/stops', '')).status === 404, 'chemin hors liste blanche → 404')
  const burst = await Promise.all(Array.from({ length: 40 }, () =>
    call('routers/default/plan', 'fromPlace=36.7731,3.0595&toPlace=36.76,3.0566&time=10:00&numItineraries=1&searchWindow=600', '198.51.100.9')))
  const n429 = burst.filter((x) => x.status === 429).length
  check(n429 === 10 && burst.find((x) => x.status === 429).headers.get('retry-after'), `40 requêtes simultanées d'une IP → ${n429} × 429 avec Retry-After`)
  process.exitCode = failed ? 1 : 0
})()

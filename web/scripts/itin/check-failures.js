// Pannes simulées : délai, corps qui stagne, annulation, 429/503/504, refus de
// connexion. Aucun trajet fabriqué, une erreur typée à chaque fois.
const http = require('http')

let failed = 0
const check = (cond, msg) => { console.log(`${cond ? 'OK  ' : 'FAIL'} ${msg}`); if (!cond) failed++ }
const mode = { v: 'hang' }
const server = http.createServer((req, res) => {
  const send = (status, body, headers = {}) => { res.writeHead(status, { 'Content-Type': 'application/json', ...headers }); res.end(body) }
  if (mode.v === 'hang') return
  if (mode.v === 'slowbody') { res.writeHead(200); res.write('{"plan":'); return }
  if (mode.v === '429') return send(429, '{"error":"Too many requests"}', { 'Retry-After': '7' })
  if (mode.v === '504') return send(504, '{"error":"OTP timeout"}')
  if (mode.v === 'busy') return send(503, '{"error":"OTP busy"}')
  if (mode.v === '503') return send(503, '{"error":"OTP unavailable"}')
})

server.listen(0, async () => {
  process.env.OTP_INTERNAL_URL = `http://127.0.0.1:${server.address().port}`
  delete process.env.NEXT_PUBLIC_DEMO
  const otp = require(`${process.env.BUILD}/lib/otp.js`)
  const A = { lat: 36.77, lon: 3.06 }, B = { lat: 36.71, lon: 3.18 }

  let o = await otp.searchItineraries(A, B, { timeoutMs: 1000 })
  check(o.status === 'error' && o.error.kind === 'timeout' && otp.isRetryablePlanError(o.error), `pas de réponse → ${o.error?.kind}`)
  mode.v = 'slowbody'
  o = await otp.searchItineraries(A, B, { timeoutMs: 1000 })
  check(o.status === 'error' && o.error.kind === 'timeout', `corps qui stagne → ${o.error?.kind}`)
  mode.v = 'hang'
  const ctrl = new AbortController(); setTimeout(() => ctrl.abort(), 50)
  o = await otp.searchItineraries(A, B, { signal: ctrl.signal })
  check(o.status === 'error' && o.error.kind === 'aborted' && otp.describePlanError(o.error) === '', `annulation → ${o.error?.kind}, aucun message`)
  for (const [m, kind] of [['429', 'busy'], ['busy', 'busy'], ['504', 'timeout'], ['503', 'otpUnavailable']]) {
    mode.v = m
    o = await otp.searchItineraries(A, B, {})
    check(o.status === 'error' && o.error.kind === kind, `HTTP ${m} → ${o.error?.kind}`)
  }
  server.close()
  process.env.OTP_INTERNAL_URL = 'http://127.0.0.1:9'
  delete require.cache[require.resolve(`${process.env.BUILD}/lib/otp.js`)]
  const otp2 = require(`${process.env.BUILD}/lib/otp.js`)
  o = await otp2.searchItineraries(A, B, {})
  check(o.status === 'error' && o.error.kind === 'otpUnavailable', `connexion refusée → ${o.error?.kind}, jamais de trajet simulé`)
  process.exitCode = failed ? 1 : 0
})

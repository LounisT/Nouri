// Géocodage contre l'API publique Photon : nommage des lieux, échangeurs
// écartés, grandes emprises recalées sur un arrêt, arabe, temporisation.
const geo = require(`${process.env.BUILD}/lib/geocoding.js`)

let failed = 0
const check = (cond, msg) => { console.log(`${cond ? 'OK  ' : 'FAIL'} ${msg}`); if (!cond) failed++ }
let photonCalls = 0
const realFetch = global.fetch
global.fetch = (...args) => { if (String(args[0]).includes('photon')) photonCalls++; return realFetch(...args) }
const q = (text, locale = 'fr') => geo.searchPlacesDetailed(text, { locale, debounceMs: 0 })

;(async () => {
  let s = await q('aeroport')
  check(!s.results.some((r) => /Eucalyptus/.test(r.name)), 'aucun échangeur autoroutier')
  const airport = s.results.find((r) => /Houari Boum/.test(r.name) && r.kind === 'address')
  check(airport && / — /.test(airport.fullName), `aérodrome : ${airport?.fullName}`)
  s = await q('hopital mustapha')
  check(/Mustapha/.test(s.results[0]?.name ?? ''), `« hopital mustapha » → ${s.results[0]?.name} (pas « Rue Nouvelle »)`)
  s = await q('باب الزوار', 'ar')
  check(s.results.some((r) => /[؀-ۿ]/.test(r.name) && !/[ⴰ-⵿]/.test(r.name)), `arabe : ${s.results[0]?.name}`)
  // Valeurs OSM multiples « Alger-Centre;الجزائر الوسطى » : jamais affichées brutes.
  for (const [text, locale] of [['البريد المركزي', 'ar'], ['Grande Poste', 'ar'], ['Grande Poste', 'en']]) {
    s = await q(text, locale)
    const raw = s.results.find((r) => /;/.test(r.fullName) || /[ⴰ-⵿]/.test(r.fullName))
    check(!raw, `${locale} « ${text} » : aucune valeur OSM brute (${raw?.fullName ?? 'ok'})`)
  }
  s = await q('xqzwvk')
  check(s.results.length === 0 && geo.placeSearchMessage(s, 'fr') !== null, `aucun résultat → « ${geo.placeSearchMessage(s, 'fr')} »`)
  check(geo.searchLocal('حراش', 'ar').length > 0, 'recherche locale arabe normalisée (sans article)')
  const slow = await geo.searchAddresses('tafourah centre', { timeoutMs: 1 })
  check(slow.status === 'slow', `délai dépassé → ${slow.status}`)

  photonCalls = 0
  const ctrls = []
  await Promise.all(['b', 'ba', 'bab', 'bab e', 'bab ez'].map((text, i) => new Promise((resolve) => setTimeout(() => {
    ctrls.forEach((c) => c.abort())
    const c = new AbortController()
    ctrls.push(c)
    geo.searchPlaces(text, c.signal, 'fr').then(resolve)
  }, i * 80))))
  check(photonCalls === 1, `5 frappes rapprochées → ${photonCalls} requête Photon`)
  process.exitCode = failed ? 1 : 0
})()

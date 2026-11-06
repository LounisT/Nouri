// Contrôles de searchItineraries / planTrip contre un OTP réel (voir check.sh).
// Dates : le lundi suivant (heure d'Alger), pour rester dans le calendrier GTFS.
process.env.OTP_INTERNAL_URL = process.env.OTP
const otp = require(`${process.env.BUILD}/lib/otp.js`)
const at = require(`${process.env.BUILD}/lib/algiers-time.js`)

let failed = 0
const check = (cond, msg) => { console.log(`${cond ? 'OK  ' : 'FAIL'} ${msg}`); if (!cond) failed++ }
const P = (s) => { const [lat, lon] = s.split(',').map(Number); return { lat, lon } }
const hm = (ms) => at.formatAlgiersTime(ms)

const today = at.algiersParts()
const MONDAY = at.addAlgiersDays(at.algiersOtpDateTime().date, ((8 - today.weekday) % 7) || 7)
const GP = P('36.7731,3.0595'), USTHB = P('36.7130,3.1800')

;(async () => {
  // Heure d'Alger quel que soit le fuseau du téléphone
  const now = otp.resolvePlanQuery('now')
  check(now.time === new Date(Date.now() + 3600e3).toISOString().slice(11, 16), `« maintenant » = heure d'Alger (${now.time}, TZ=${process.env.TZ})`)
  check(otp.formatTime(Date.UTC(2026, 10, 9, 15, 30)) === '16:30', 'formatTime affiche l\'heure d\'Alger')

  // Classement par arrivée, badges honnêtes
  let o = await otp.searchItineraries(GP, USTHB, { when: { date: MONDAY, time: '05:00' } })
  check(o.status === 'ok', `GP→USTHB 05:00 : ${o.status}`)
  if (o.status === 'ok') {
    const ends = o.itineraries.map((it) => it.endTime)
    check(ends[0] === Math.min(...ends), `rangée 1 = arrivée la plus tôt (${hm(ends[0])})`)
    check(o.itineraries.length <= 4, `${o.itineraries.length} rangées (≤ 4)`)
    check(o.itineraries.every((it) => typeof it.fareDzd === 'number'), `tarifs : ${o.itineraries.map((it) => it.fareDzd).join(', ')} DZD`)
  }

  // Nuit : premiers départs du matin (seconde requête OTP). Le 72 (GTFS :
  // départs jusqu'à 23:50) passe encore vers 23:49 à la Grande Poste : à 23:45
  // le trajet du soir est gardé, à 23:55 on bascule sur le lendemain.
  o = await otp.searchItineraries(GP, USTHB, { when: { date: MONDAY, time: '23:45' } })
  check(o.status === 'ok' && o.itineraries.some((it) => !it.walkOnly), `23:45 → ${o.status} (dernier 72, pas de bascule prématurée)`)
  o = await otp.searchItineraries(GP, USTHB, { when: { date: MONDAY, time: '23:55' } })
  check(o.status === 'nextService' && o.dayOffset === 1, `23:55 → ${o.status}${o.status === 'nextService' ? `, 1er départ ${hm(o.itineraries[0].startTime)} le ${o.serviceQuery.date}` : ''}`)
  o = await otp.searchItineraries(GP, USTHB, { when: { date: MONDAY, time: '01:00' } })
  check(o.status === 'nextService' && o.dayOffset === 0, `01:00 → ${o.status} (ce matin)`)

  // Erreurs typées
  o = await otp.searchItineraries(P('36.7435,3.1032'), P('36.6858,3.0088'), { when: { date: MONDAY, time: '09:00' } })
  check(o.status === 'error' && o.error.reason === 'tooFar' && o.error.side === 'to' && !o.error.walkFallback, `destination sans arrêt → ${o.error?.kind}/${o.error?.reason}/${o.error?.side}, pas de marche de 4 h`)
  o = await otp.searchItineraries(GP, USTHB, { when: { date: '2030-01-07', time: '09:00' } })
  check(o.status === 'error' && o.error.reason === 'noTransitTimes', `date hors calendrier → ${o.error?.reason}`)
  // Birtouta : seul le 101 dessert l'arrêt, et dans un seul sens (R15).
  o = await otp.searchItineraries(P('36.641030,3.000862'), GP, { when: { date: MONDAY, time: '09:00' } })
  check(o.status === 'error' && o.error.reason === 'noRoute' && (o.error.oneDirectionLineIds ?? []).includes('ETUSA-101'),
    `pas de chemin de jour → ${o.error?.reason} ${JSON.stringify(o.error?.oneDirectionLineIds)} (pas de relance « matin »)`)
  // TOO_CLOSE d'OTP (R30) : « presque au même endroit » seulement < 400 m ou
  // < 6 min de marche ; au-delà « à pied uniquement ».
  o = await otp.searchItineraries(GP, P('36.7735,3.0597'), { when: { date: MONDAY, time: '09:00' } })
  check(o.status === 'ok' && o.notice === 'tooClose', `trop proche (≈ 180 m) → ${o.status}/${o.notice}`)
  o = await otp.searchItineraries(GP, P('36.7755,3.0597'), { when: { date: MONDAY, time: '09:00' } })
  check(o.status === 'ok' && o.notice === 'walkOnly', `marche de ≈ 550 m / 8 min → ${o.status}/${o.notice} (pas « presque au même endroit »)`)

  // Marche plus rapide : gardée
  // (à 13:00 la marche arrive vers 13:30, le premier bus vers 13:32 ; à 09:00
  // le 88 arrive avant la marche, qui est alors masquée)
  o = await otp.searchItineraries(P('36.7525,3.0420'), P('36.7600,3.0566'), { when: { date: MONDAY, time: '13:00' } })
  check(o.status === 'ok' && o.itineraries.some((it) => it.walkOnly), 'marche seule gardée quand elle arrive au plus tard en même temps')
  o = await otp.searchItineraries(P('36.7525,3.0420'), P('36.7600,3.0566'), { when: { date: MONDAY, time: '09:00' } })
  check(o.status === 'ok' && !o.itineraries.some((it) => it.walkOnly), 'marche seule masquée quand un bus arrive strictement avant')

  // Noms arabes (métro) et compat planTrip. L'app interroge OTP en « fr »
  // (page.tsx) : name/headsign restent les clés françaises du GTFS, l'arabe
  // sourcé est ajouté à part (nameAr/headsignAr) et choisi au rendu.
  o = await otp.searchItineraries(P('36.7865,3.0623'), P('36.7602,3.0566'), { when: { date: MONDAY, time: '13:00' } })
  const m1 = o.status === 'ok' && o.itineraries.flatMap((it) => it.legs).find((l) => l.mode === 'SUBWAY')
  check(Boolean(m1 && m1.from.nameAr && m1.headsignAr && !/[\u0600-\u06FF]/.test(m1.headsign)), `M1 en arabe : ${m1 ? `${otp.placeName(m1.from, 'ar')} → ${otp.legHeadsign(m1, 'ar')}` : '-'}`)
  const r = await otp.planTrip(P('36.7435,3.1032'), P('36.6858,3.0088'), { date: MONDAY, time: '09:00' })
  check((r.plan?.itineraries.length ?? 0) === 0, 'planTrip (compat) ne renvoie plus de marche de 4 h comme plan')
  check(otp.mockPlanTrip(GP, USTHB).plan.itineraries.length === 0 || process.env.NEXT_PUBLIC_DEMO === '1', 'mockPlanTrip inactif hors NEXT_PUBLIC_DEMO=1')

  process.exitCode = failed ? 1 : 0
})()

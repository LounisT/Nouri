// Contrôle de l'écran Résultats (results-format.ts) contre un OTP RÉEL, via la
// même fonction que page.tsx (searchItineraries) : en-tête, rangées, tarifs,
// « ~ », libellés vocaux, annonces, erreurs typées, trajet de nuit.
//
// Usage (depuis web/) :
//   OTP_INTERNAL_URL=http://172.18.0.2:8080 npx sucrase-node scripts/page/check-results.ts
//   (IP du conteneur alger-otp : sudo docker inspect -f '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}' alger-otp)
// À lancer aussi sous d'autres fuseaux : TZ=America/Montreal …, TZ=Asia/Tokyo …
// (heures et libellés doivent rester ceux de l'heure d'Alger).
import {
  searchItineraries,
  resolvePlanQuery,
  describePlanError,
  itineraryBadges,
  ITINERARY_BADGE_KEY,
  type PlanOutcome,
} from '../../src/lib/otp'
import {
  queryLabel,
  rowSummary,
  resultsAnnouncement,
  errorTitleKey,
  legHeadwayMin,
  type SearchState,
  isExactStart,
} from '../../src/lib/results-format'
import { translate, type Locale } from '../../src/lib/i18n'
import { algiersOtpDateTime, addAlgiersDays, formatAlgiersTime, deviceShowsAlgiersTime } from '../../src/lib/algiers-time'

let failures = 0
function check(label: string, cond: boolean, detail = '') {
  console.log(`${cond ? 'OK   ' : 'ÉCHEC'} ${label}${detail ? ` — ${detail}` : ''}`)
  if (!cond) failures += 1
}

const GRANDE_POSTE = { lat: 36.7724, lon: 3.0594, name: 'Grande Poste' }
const EL_HARRACH = { lat: 36.7176, lon: 3.1386, name: 'El Harrach' }
const BEN_AKNOUN = { lat: 36.7600, lon: 3.0080, name: 'Ben Aknoun' }
const USTHB = { lat: 36.7128, lon: 3.1806, name: 'USTHB' }
const TIPAZA = { lat: 36.5894, lon: 2.4475, name: 'Tipaza' }

function toState(out: PlanOutcome): SearchState {
  if (out.status === 'error') {
    return { status: 'error', query: out.query, error: out.error, itineraries: out.error.walkFallback ? [out.error.walkFallback] : [] }
  }
  if (out.status === 'nextService') return { status: 'nextService', query: out.query, itineraries: out.itineraries, dayOffset: out.dayOffset }
  return { status: 'ok', query: out.query, itineraries: out.itineraries, notice: out.notice, demo: out.demo }
}

function printRows(state: SearchState, locale: Locale) {
  if (state.status !== 'ok' && state.status !== 'nextService' && state.status !== 'error') return
  const badges = state.status === 'error' ? state.itineraries.map(() => null) : itineraryBadges(state.itineraries, state.query.arriveBy)
  state.itineraries.forEach((it, i) => {
    const qualifier = badges[i] ? translate(locale, ITINERARY_BADGE_KEY[badges[i]!]) : null
    const row = rowSummary(it, { locale, query: state.query, qualifier })
    const legs = row.transitLegs.map((l) => l.routeShortName).join('>') || '(marche)'
    console.log(`      [${locale}] ${legs} | ${row.day ? `${row.day} · ` : ''}${row.start} → ${row.end} | ${row.duration} | ${row.fare ?? '-'} | ${row.thirdInfo} | ${qualifier ?? ''}`)
    console.log(`           aria: ${row.aria}`)
  })
}

const TILDE = /~/

async function main() {
  const tz = process.env.TZ ?? '(système)'
  console.log(`# TZ=${tz} · téléphone à l'heure d'Alger : ${deviceShowsAlgiersTime()}`)

  // ── En-tête ────────────────────────────────────────────────────────────────
  const nowQuery = resolvePlanQuery('now')
  const label = queryLabel(nowQuery, 'fr')
  check('en-tête « maintenant » = heure d’Alger de l’envoi', label.startsWith(`Départ maintenant · ${formatAlgiersTime(nowQuery.epoch)}`), label)
  check('en-tête : « heure d’Alger » seulement hors fuseau d’Alger',
    label.includes('heure d’Alger') === !deviceShowsAlgiersTime(), label)
  const today = algiersOtpDateTime().date
  const tomorrow = addAlgiersDays(today, 1)
  const arrive = queryLabel(resolvePlanQuery({ date: tomorrow, time: '09:00' }, true), 'fr')
  check('en-tête « arriver avant » demain', arrive.startsWith('Arrivée avant 09:00 · demain'), arrive)
  const departAr = queryLabel(resolvePlanQuery({ date: today, time: '23:59' }, false), 'ar')
  check('en-tête arabe « الانطلاق 23:59 »', departAr.startsWith('الانطلاق 23:59'), departAr)

  // ── Jour, transport : Grande Poste → El Harrach demain 09:00 ───────────────
  const day = await searchItineraries(GRANDE_POSTE, EL_HARRACH, { when: { date: tomorrow, time: '09:00' }, locale: 'fr' })
  const dayState = toState(day)
  check('jour : statut ok', day.status === 'ok', day.status)
  if (day.status === 'ok') {
    check('jour : 4 rangées au plus', day.itineraries.length >= 1 && day.itineraries.length <= 4, String(day.itineraries.length))
    for (const locale of ['fr', 'ar', 'en'] as const) printRows(dayState, locale)
    for (const it of day.itineraries) {
      const row = rowSummary(it, { locale: 'fr', query: day.query })
      check('rangée : arrivée toujours « ~ »', row.end.startsWith('~'), row.end)
      // Départ à pied à l'heure demandée = un fait (sans « ~ ») ; toute autre
      // heure de départ d'un trajet en transport est estimée (« ~ »).
      if (row.transitLegs.length) {
        const exact = isExactStart(it, day.query?.epoch)
        check(`rangée : départ en transport ${exact ? 'à pied à l’heure demandée, sans « ~ »' : '« ~ »'}`,
          exact ? !row.start.startsWith('~') && it.legs[0].mode === 'WALK' : row.start.startsWith('~'), row.start)
      }
      check('rangée : libellé vocal sans « ~ »', !TILDE.test(row.aria), row.aria)
      check('rangée : durée « ~ » dès qu’un véhicule est emprunté', !row.transitLegs.length || row.duration.startsWith('~'), row.duration)
      check('rangée : libellé vocal nomme les modes et la durée',
        row.transitLegs.every((l) => row.aria.includes(l.routeShortName ?? '§')) && row.aria.includes(row.duration.replace('~', '')), row.aria)
      check('rangée : tarif = it.fareDzd (source unique)',
        (row.fare === null && typeof it.fareDzd !== 'number') || row.fare === `${it.fareDzd} DZD`, `${row.fare} / ${it.fareDzd}`)
      if (row.direct && it.transfers === 0 && row.transitLegs[0]) {
        const h = legHeadwayMin(row.transitLegs[0])
        check('ligne directe : fréquence des départs du GTFS (jamais 30 codé en dur)',
          h === null ? row.thirdInfo.startsWith('départ ~') : row.thirdInfo === `~ toutes les ${h} min`, `${row.thirdInfo} (h=${h})`)
      }
    }
    const announce = resultsAnnouncement(dayState, 'ar')
    check('annonce vocale arabe (pluriel accordé)', /مسار|مساران/.test(announce), announce)
  }

  // ── Bus direct : Ben Aknoun → Grande Poste, demain 10:00 ───────────────────
  const bus = await searchItineraries(BEN_AKNOUN, GRANDE_POSTE, { when: { date: tomorrow, time: '10:00' }, locale: 'fr' })
  if (bus.status === 'ok') {
    printRows(toState(bus), 'fr')
    const busRow = bus.itineraries.find((it) => it.legs.some((l) => l.mode === 'BUS'))
    check('bus : au moins une rangée en bus', Boolean(busRow))
  } else {
    check('bus : statut ok', false, bus.status)
  }

  // ── Nuit : 23:30 → premiers départs du matin (seconde requête OTP) ─────────
  const night = await searchItineraries(GRANDE_POSTE, USTHB, { when: { date: today, time: '23:30' }, locale: 'fr' })
  const nightState = toState(night)
  console.log(`   nuit : statut ${night.status}`)
  if (night.status === 'nextService') {
    printRows(nightState, 'fr')
    const row = rowSummary(night.itineraries[0], { locale: 'fr', query: night.query })
    check('nuit : chaque rangée porte le jour (demain)', row.day !== null, String(row.day))
    console.log(`      annonce : ${resultsAnnouncement(nightState, 'fr')}`)
  } else if (night.status === 'ok') {
    // Le dernier bus peut encore passer à 23:30 : la rangée doit alors dire « ~ ».
    printRows(nightState, 'fr')
    check('nuit : trajet trouvé (service tardif), heures « ~ »', rowSummary(night.itineraries[0], { locale: 'fr', query: night.query }).end.startsWith('~'))
  } else {
    console.log(`      erreur : ${describePlanError(night.error, 'fr')}`)
    check('nuit : jamais d’erreur réseau', night.error.kind === 'noPath', night.error.kind)
  }

  // ── Hors zone : Tipaza ─────────────────────────────────────────────────────
  const outside = await searchItineraries(GRANDE_POSTE, TIPAZA, { locale: 'fr' })
  if (outside.status === 'error') {
    const msg = describePlanError(outside.error, 'fr')
    check('hors zone : message factuel, jamais le code brut', !/OUTSIDE|BOUNDS|NOT_|_/.test(msg), msg)
    check('hors zone : titre « Aucun itinéraire trouvé » (OTP a répondu)', errorTitleKey(outside.error) === 'noRoutesAvailable')
    console.log(`      annonce : ${resultsAnnouncement(toState(outside), 'en', describePlanError(outside.error, 'en'))}`)
  } else {
    check('hors zone : erreur', false, outside.status)
  }

  // ── Date hors calendrier : 2031 ─────────────────────────────────────────────
  const future = await searchItineraries(GRANDE_POSTE, EL_HARRACH, { when: { date: '2031-06-10', time: '09:00' }, locale: 'fr' })
  if (future.status === 'error') {
    check('2031 : « les horaires ne couvrent pas cette date »', future.error.reason === 'noTransitTimes', `${future.error.kind}/${future.error.reason}`)
    check('2031 : aucune marche > 60 min proposée',
      !future.error.walkFallback || future.error.walkFallback.duration <= 3600)
  } else {
    check('2031 : erreur noTransitTimes', false, future.status)
  }

  // ── Calculateur injoignable : jamais de trajet simulé ──────────────────────
  // (module rechargé avec une URL fermée)
  const { execFileSync } = await import('child_process')
  const probe = execFileSync(process.execPath, [
    ...process.execArgv,
    '-e',
    `require('sucrase/register');
     const otp = require('${__dirname}/../../src/lib/otp.ts');
     const fmt = require('${__dirname}/../../src/lib/results-format.ts');
     otp.searchItineraries({lat:36.77,lon:3.06,name:'A'},{lat:36.72,lon:3.14,name:'B'},{timeoutMs:3000}).then((out) => {
       const title = out.status === 'error' ? fmt.errorTitleKey(out.error) : '-';
       console.log(JSON.stringify({ status: out.status, kind: out.error && out.error.kind, title, n: (out.itineraries||[]).length }));
     });`,
  ], { env: { ...process.env, OTP_INTERNAL_URL: 'http://127.0.0.1:9' }, encoding: 'utf8' })
  const down = JSON.parse(probe.trim().split('\n').pop() ?? '{}')
  check('OTP injoignable : erreur typée, aucun itinéraire', down.status === 'error' && down.kind === 'otpUnavailable' && !down.n, probe.trim())
  check('OTP injoignable : titre « Recherche impossible », pas « aucun itinéraire »', down.title === 'page_searchFailed', down.title)

  console.log(failures ? `\n${failures} échec(s)` : '\nRésultats : tout est conforme')
  process.exit(failures ? 1 : 0)
}

void main()

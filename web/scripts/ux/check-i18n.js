// Contrôles i18n / UX sur les modules transpilés (voir check.sh).
const vm = require('vm')
const B = process.env.BUILD
const i18n = require(`${B}/lib/i18n.js`)
const { buildLocaleScript } = require(`${B}/lib/locale-script.js`)
const report = require(`${B}/lib/report.js`)
const area = require(`${B}/lib/service-area.js`)
const recents = require(`${B}/hooks/useRecentSearches.js`)

let failed = 0
const check = (cond, msg) => { console.log(`${cond ? 'OK  ' : 'FAIL'} ${msg}`); if (!cond) failed++ }

// ── Mêmes clés dans les trois langues ──────────────────────────────────────
const { translations } = i18n
const keys = (l) => Object.keys(translations[l]).sort()
for (const l of ['ar', 'en']) {
  const missing = keys('fr').filter((k) => !(k in translations[l]))
  const extra = keys(l).filter((k) => !(k in translations.fr))
  check(missing.length === 0 && extra.length === 0, `${l} : mêmes clés que fr (manque ${missing.join(',') || '0'}, en trop ${extra.join(',') || '0'})`)
}
const emptyVals = ['fr', 'ar', 'en'].flatMap((l) => Object.entries(translations[l]).filter(([, v]) => typeof v !== 'string' || !v.trim()).map(([k]) => `${l}.${k}`))
check(emptyVals.length === 0, `aucune traduction vide (${emptyVals.join(', ') || '0'})`)

// ── Rien qui suggère du temps réel ─────────────────────────────────────────
const realtime = /^(À quai|On platform)$|Dans \{count\}|Prochain passage|Reprend à 05|In \{count\}|خلال \{count\}/
const rt = ['fr', 'ar', 'en'].flatMap((l) => Object.entries(translations[l]).filter(([, v]) => realtime.test(v)).map(([k]) => `${l}.${k}`))
check(rt.length === 0, `aucune chaîne « temps réel » (${rt.join(', ') || '0'})`)
const deadRealtime = ['atPlatform', 'platformNow', 'inMinutes', 'nextDeparture', 'estimatedNextPass', 'resumes'].filter((k) => k in translations.fr)
check(deadRealtime.length === 0, `clés « À quai / Dans N min / Prochain passage » supprimées (${deadRealtime.join(',') || '0'})`)
check(!/officiel|official|الرسمية/.test(translations.fr.estimatedNote + translations.en.estimatedNote + translations.ar.estimatedNote), 'estimatedNote ne revendique plus de fréquences « officielles »')
check(!/bus/.test(translations.fr.routeNotMapped) && !/bus/.test(translations.en.routeNotMapped), 'routeNotMapped neutre (tram compris)')
check(!/injoignable|unreachable/.test(translations.fr.demoNote + translations.en.demoNote), 'demoNote ne prétend plus que le calculateur est injoignable')

// ── Pluriels ───────────────────────────────────────────────────────────────
const P = (l, base, n) => i18n.pluralize(l, base, n)
check(P('fr', 'ux_stopsLeft', 1) === '1 arrêt restant', `fr 1 → « ${P('fr', 'ux_stopsLeft', 1)} »`)
check(P('fr', 'ux_stopsLeft', 3) === '3 arrêts restants', `fr 3 → « ${P('fr', 'ux_stopsLeft', 3)} »`)
check(P('en', 'ux_stopsLeft', 1) === '1 stop left' && P('en', 'ux_stopsLeft', 4) === '4 stops left', `en 1/4 → « ${P('en', 'ux_stopsLeft', 1)} » / « ${P('en', 'ux_stopsLeft', 4)} »`)
const arCases = [[1, 'محطة واحدة متبقية'], [2, 'محطتان متبقيتان'], [3, '3 محطات متبقية'], [10, '10 محطات متبقية'], [11, '11 محطة متبقية'], [99, '99 محطة متبقية'], [100, '100 محطة متبقية']]
for (const [n, want] of arCases) check(P('ar', 'ux_stopsLeft', n) === want, `ar ${n} → « ${P('ar', 'ux_stopsLeft', n)} »`)
check(P('ar', 'ux_transfers', 2) === 'تحويلتان', `ar transfers 2 → « ${P('ar', 'ux_transfers', 2)} »`)
check(P('ar', 'ux_routesFound', 12) === '12 مسارًا', `ar routesFound 12 → « ${P('ar', 'ux_routesFound', 12)} »`)
// Toutes les familles plurielles complètes dans les trois langues.
const bases = keys('fr').filter((k) => k.endsWith('_other')).map((k) => k.slice(0, -6))
const forms = ['one', 'two', 'few', 'many', 'other']
const incomplete = bases.filter((b) => ['fr', 'ar', 'en'].some((l) => forms.some((f) => !translations[l][`${b}_${f}`])))
check(incomplete.length === 0, `${bases.length} familles plurielles complètes (${incomplete.join(',') || 'ok'})`)
check(i18n.translate('fr', 'ux_myLocationOutside', { n: 1340 }).includes('~1340 km'), 'variables {n} remplacées')

// ── Détection de langue : detectLocale ET script inline d'accord ──────────
function runScript({ saved, languages, throwStorage = false }) {
  const attrs = {}
  const documentElement = {
    lang: 'fr', dir: 'ltr',
    setAttribute: (k, v) => { attrs[k] = v },
    removeAttribute: (k) => { delete attrs[k] },
  }
  const ctx = {
    window: {
      get localStorage() {
        if (throwStorage) throw new Error('SecurityError')
        return { getItem: () => (saved === undefined ? null : saved) }
      },
    },
    document: { documentElement, title: 'x' },
    navigator: { languages, language: languages[0] },
    setTimeout: () => 0,
    String,
  }
  vm.runInNewContext(buildLocaleScript(), ctx)
  return { lang: documentElement.lang, dir: documentElement.dir, pending: 'data-i18n-pending' in attrs, title: ctx.document.title }
}
const langCases = [
  [['ar-DZ', 'fr-FR'], 'ar'], [['fr-DZ'], 'fr'], [['kab-DZ', 'fr'], 'fr'], [['de-DE', 'en-US'], 'en'],
  [['de'], 'fr'], [['en-GB', 'ar'], 'en'], [[], 'fr'],
]
for (const [langs, want] of langCases) {
  const got = i18n.detectLocale(langs)
  const s = runScript({ languages: langs })
  check(got === want && s.lang === want, `langues ${JSON.stringify(langs)} → detectLocale ${got}, script ${s.lang} (attendu ${want})`)
}
let s = runScript({ saved: 'en', languages: ['ar-DZ'] })
check(s.lang === 'en' && s.dir === 'ltr' && s.pending, 'choix enregistré (en) prioritaire sur le téléphone (ar), page masquée le temps du rendu')
s = runScript({ languages: ['ar-DZ'], throwStorage: true })
check(s.lang === 'ar' && s.dir === 'rtl' && s.title === translations.ar.ux_appTitle, 'stockage bloqué (SecurityError) : pas de plantage, arabe RTL + titre arabe')
s = runScript({ saved: 'fr', languages: ['ar'] })
check(s.lang === 'fr' && !s.pending, 'français : page jamais masquée')

// ── Récents : « Ma position » sans coordonnées, migration des anciennes entrées
const legacy = [
  { id: '1', fromCoord: { lat: 36.72, lon: 3.18 }, toCoord: { lat: 36.77, lon: 3.06 }, fromLabel: 'Ma position', toLabel: 'Grande Poste', timestamp: 1 },
  { id: '2', fromCoord: { lat: 36.7, lon: 3.1 }, toCoord: { lat: 36.75, lon: 3.04 }, fromLabel: 'موقعي', toLabel: 'المنزل', timestamp: 2 },
  { id: '3', fromCoord: null, toCoord: { lat: 1, lon: 2 }, fromLabel: 'X', toLabel: 'Y', timestamp: 3 },
]
const migrated = recents.normalizeRecentEntries(legacy)
check(migrated.length === 2, `migration : 2 entrées valides sur 3 (${migrated.length})`)
check(migrated[0].from.kind === 'myLocation' && !('lat' in migrated[0].from), 'ancien « Ma position » → {kind:myLocation}, coordonnées supprimées')
check(migrated[1].from.kind === 'myLocation' && migrated[1].to.kind === 'saved' && migrated[1].to.key === 'home', 'ancien « موقعي → المنزل » → myLocation → saved:home')
check(!JSON.stringify(migrated).includes('36.72'), 'la position d\'hier ne reste pas dans le stockage')
const ep = recents.endpointFromCoordinate({ lat: 36.7, lon: 3.1, name: 'Ma position', nouriKind: 'myLocation' })
check(ep.kind === 'myLocation' && !('lat' in ep), 'coordonnée marquée myLocation → aucune coordonnée enregistrée')

// ── Signaler une erreur ────────────────────────────────────────────────────
const mail = report.reportMailto({ kind: 'line', line: '88', mode: 'bus', direction: 'Ben Aknoun', stop: { name: 'Chevalley', lat: 36.7712, lon: 3.0321 } }, 'ar')
const subject = decodeURIComponent(mail.match(/subject=([^&]*)/)[1])
const body = decodeURIComponent(mail.match(/body=(.*)$/)[1])
check(subject === '[Nouri] خطأ – الخط 88', `objet arabe : « ${subject} »`)
check(/line: 88 \(bus\)/.test(body) && /direction: Ben Aknoun/.test(body) && /stop: Chevalley @ 36\.77120,3\.03210/.test(body) && /lang: ar/.test(body), 'corps : ligne, sens, arrêt et coordonnées pré-remplis')
const trip = report.reportMailto({ kind: 'itinerary', from: { name: 'Grande Poste', lat: 36.7731, lon: 3.0595 }, to: { name: 'USTHB', lat: 36.713, lon: 3.18 }, requested: '2026-11-09 08:30', legs: ['SUBWAY M1 Tafourah → Haï El Badr 08:31–08:45'] }, 'fr', 'Le métro ne passe pas')
check(trip.length < 2000, `mailto itinéraire < 2000 caractères (${trip.length})`)
check(decodeURIComponent(trip).includes('Le métro ne passe pas') && decodeURIComponent(trip).includes('requested: 2026-11-09 08:30'), 'message de l\'usager + heure demandée')

// ── Zone desservie ─────────────────────────────────────────────────────────
check(area.isInServiceAreaPoint(36.7731, 3.0595), 'Grande Poste dans la zone')
check(!area.isInServiceAreaPoint(48.8566, 2.3522), 'Paris hors zone')
const km = Math.round(area.kmFromServiceArea(48.8566, 2.3522))
check(km > 1300 && km < 1400, `Paris à ~${km} km de la zone`)
check(area.kmFromServiceArea(36.47, 2.83) > 10 && area.kmFromServiceArea(36.47, 2.83) < 20, `Blida à ~${Math.round(area.kmFromServiceArea(36.47, 2.83))} km`)

console.log(failed ? `${failed} échec(s)` : 'tout est vert')
process.exitCode = failed ? 1 : 0

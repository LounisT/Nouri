// Rejoue un trajet réel et affiche les consignes du bandeau à chaque
// changement, dans une langue : vérifie le texte, les pluriels et l'ordre des
// étapes (« Rejoignez », « Attendez », « Prochain arrêt », « Descendez »…).
//   node scripts/nav/banner-demo.cjs [fixture=hydra_harrach] [locale=fr] [scénario=noise8]
require('./ts-require.cjs')
const fs = require('fs')
const path = require('path')
const nav = require('../../src/lib/navigation.ts')
const { buildBanner } = require('../../src/hooks/useNavigationSession.ts')
const { translations } = require('../../src/lib/i18n.ts')
const { makeRng, truthTimeline, makeDetour, buildFixes } = require('./sim.cjs')

const [file = 'hydra_harrach', locale = 'fr', scenario = 'noise8'] = process.argv.slice(2)
const data = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', `${file}.json`), 'utf8'))
const it = data.itineraries[0]
const geometries = nav.buildLegGeometries(it)
const truth = truthTimeline(it, geometries, scenario === 'offroute' ? makeDetour(geometries) : null)
const { fixes } = buildFixes(it, geometries, truth, scenario, makeRng(7))
const t = (key) => translations[locale][key] ?? translations.fr[key] ?? key
const T0 = 1_800_000_000_000
const strip = (s) => (s ?? '').replace(/[⁨⁩]/g, '')
let state = nav.createNavState(it, geometries, T0)
let last = ''
const show = (now, label) => {
  const view = nav.navView(state, it, geometries, now)
  const b = buildBanner({ session: { itinerary: it, meta: { toName: 'Destination' }, geometries, state }, view, t, locale, now, positionError: null, outsideArea: false, notice: null })
  // On n'imprime qu'aux changements d'étape (pas à chaque mètre parcouru).
  const key = [b.context, b.title, b.next, b.note, b.offRoute, b.showBoardButton, b.approach].join('|')
  if (key === last) return
  last = key
  const line = [b.context, b.title, b.detail, b.hint, b.eta, b.next && `${t('nextLabel')} : ${b.next}`, b.note, b.offRoute, b.showBoardButton && `[${t('nav_onBoard')}]`, b.approach && '(vibration)'].filter(Boolean).map(strip).join(' | ')
  console.log(`${label.padEnd(9)} ${line}`)
}
// Une seconde après l'autre : les positions quand il y en a, sinon un tic
// d'horloge (c'est ce qui fait apparaître « position non mise à jour »).
const byTime = new Map(fixes.map((f) => [Math.round(f.t), f]))
for (const tr of truth.timeline) {
  const now = T0 + tr.t * 1000
  const f = scenario === 'noGps' ? null : byTime.get(tr.t)
  if (f) state = nav.advance(state, { type: 'fix', fix: { ...f.fix, receivedAt: now } }, it, geometries)
  else {
    if (scenario === 'noGps' && truth.departures[tr.legIndex] === tr.t) {
      state = nav.advance(state, { type: 'boarded', now, legIndex: tr.legIndex }, it, geometries)
    }
    state = nav.advance(state, { type: 'tick', now }, it, geometries)
  }
  show(now, `t=${tr.t}s`)
}
const all = truth.timeline
// Après la dernière position : 2 minutes sans signal.
show(T0 + (all[all.length - 1].t + 120) * 1000, '+2 min')

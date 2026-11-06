// Contrôle de la logique du catalogue de lignes (lib/line-catalog.ts) et des
// chaînes cat_*. Usage (depuis web/) :
//   npx sucrase-node scripts/cat/check-catalog.ts
// À lancer aussi sous d'autres fuseaux (diaspora) — les états doivent rester
// ceux de l'heure d'Alger :
//   for tz in Europe/Paris America/Montreal Asia/Tokyo; do TZ=$tz npx sucrase-node scripts/cat/check-catalog.ts; done
import {
  allLines, busLines, metroLine, tramLine, headwayAt, stopPassWindow, nextPassLabel, type TransitLine,
} from '../../src/lib/lines'
import {
  lineServiceState, directionServiceState, stopConnections, catalogSearch, hasArabicLetters,
  nearbyLineEntries, lineBadgeColors, walkMinutes, stopHeadway,
} from '../../src/lib/line-catalog'
import { contrastRatio } from '../../src/lib/map-badges'
import { algiersToEpoch } from '../../src/lib/algiers-time'
import { translations } from '../../src/lib/i18n'
import { catStrings } from '../../src/lib/strings/cat'

let failures = 0
function check(label: string, cond: boolean, detail = '') {
  console.log(`${cond ? 'OK   ' : 'ÉCHEC'} ${label}${detail ? ` — ${detail}` : ''}`)
  if (!cond) failures += 1
}

const at = (hhmm: string, day = '2026-11-09') => new Date(algiersToEpoch(day, hhmm))
const bus = (short: string): TransitLine => {
  const line = busLines.find((l) => l.shortName === short)
  if (!line) throw new Error(`ligne ${short} absente`)
  return line
}
const dirIndex = (line: TransitLine, patternOrHeadsign: string) =>
  line.directions.findIndex((d) => d.patternId === patternOrHeadsign || d.headsign === patternOrHeadsign)

console.log(`TZ=${process.env.TZ ?? '(défaut)'} — décalage du système ${-new Date().getTimezoneOffset()} min`)

// ── État de service : heure d'Alger, dernier départ, fin de service ─────────
{
  const m = metroLine
  check('M1 fermé à 04:59', lineServiceState(m, at('04:59')).kind === 'closed')
  check('M1 fermé à 04:59 : ouvre 05:00', lineServiceState(m, at('04:59')).firstDeparture === '05:00')
  check('M1 ouvert à 05:00', lineServiceState(m, at('05:00')).kind === 'open')
  check('M1 ouvert à 23:00 (dernier départ inclus)', lineServiceState(m, at('23:00')).kind === 'open')
  const late = lineServiceState(m, at('23:05'))
  check('M1 « derniers passages » à 23:05 (rames parties à 23:00 encore en route)', late.kind === 'ending', late.lastPass)
  check('M1 fermé à 23:45', lineServiceState(m, at('23:45')).kind === 'closed')
  check('M1 : pas de fréquence hors service (23:05)', headwayAt(m, at('23:05')) === null)
  check('M1 : ~10 min à 10:00 sur le tronc', headwayAt(m, at('10:00')) === 10)
  check('M1 : ~5 min à 08:00 sur le tronc', headwayAt(m, at('08:00')) === 5)

  // K80 : à 23:05, à Haï El Badr, une rame partie de Place des Martyrs à 23:00 passe encore.
  const har0 = dirIndex(m, 'M1-HAR-0')
  const d = m.directions[har0]
  const badr = d.stops.findIndex((s) => s.id === 'M12')
  const pass = stopPassWindow(d, badr)
  check('M1 vers El Harrach : dernier passage estimé à Haï El Badr après 23:00', Boolean(pass && pass.last > '23:00'), JSON.stringify(pass))
  const st = directionServiceState(m, d, at('23:05'))
  check('Sens vers El Harrach Centre « derniers passages » à 23:05', st.kind === 'ending', st.lastPass)
  check('Sens vers El Harrach Centre ouvert à 22:59 avec dernier départ 23:00', directionServiceState(m, d, at('22:59')).lastDeparture === '23:00')
  const ain0 = dirIndex(m, 'M1-AIN-0')
  check('Branche Aïn Naâdja : ~20 min à 10:00 (une rame sur deux)', headwayAt(m, at('10:00'), ain0) === 20)
  check('Branche Aïn Naâdja : dernier départ propre au sens (22:50)', directionServiceState(m, m.directions[ain0], at('22:00')).lastDeparture === '22:50')

  // Bus : départs après minuit, fin de service, fermé.
  const b18 = bus('18')
  check('Bus 18 ouvert à 00:10 (dernier départ 00:20)', lineServiceState(b18, at('00:10')).kind === 'open')
  const e18 = lineServiceState(b18, at('00:30'))
  check('Bus 18 « derniers passages » à 00:30', e18.kind === 'ending', e18.lastPass)
  check('Bus 18 fermé à 02:00', lineServiceState(b18, at('02:00')).kind === 'closed')
  const b3 = bus('3')
  check('Bus 3 : ~20 min à 08:00', headwayAt(b3, at('08:00')) === 20)
  check('Bus 3 : ~40 min à 12:00', headwayAt(b3, at('12:00')) === 40)
  check('Bus 3 : aucune fréquence à 20:00', headwayAt(b3, at('20:00')) === null)
  check('Bus 3 fermé à 21:30, ouvre 06:00', (() => {
    const s = lineServiceState(b3, at('21:30'))
    return s.kind === 'closed' && s.firstDeparture === '06:00'
  })())
  check('Bus 701 : ~60 min à 12:00 (plus de « ~30 » générique)', headwayAt(bus('701'), at('12:00')) === 60)
  check('Bus 643 : fermé (ou fin) à 18:30, dernier départ 18:00', lineServiceState(bus('643'), at('18:30')).kind !== 'open')
}

// ── Correspondances : tous les sens, rien de tronqué, terminus compris ─────
{
  const m = metroLine
  const har0 = m.directions[dirIndex(m, 'M1-HAR-0')]
  const conns = stopConnections(m, har0.stops)
  const nameAt = (id: string) => har0.stops.findIndex((s) => s.id === id)
  const busAt = (id: string) => conns[nameAt(id)].bus.map((l) => l.shortName)
  const premierMai = busAt('M03')
  check('M1 à 1er Mai : la 19 apparaît (seul son retour y passe)', premierMai.includes('19'), premierMai.join(' '))
  check('M1 à 1er Mai : plus de 3 bus, liste complète', premierMai.length > 3, `${premierMai.length} lignes`)
  check("M1 au Jardin d'Essai : la 6 apparaît", busAt('M06').includes('6'), busAt('M06').join(' '))
  const fus = conns[nameAt('M07')]
  check('M1 aux Fusillés : T1 en correspondance', fus.rail.some((l) => l.id === tramLine.id))
  // T1 vers Ruisseau : correspondance M1 au terminus d'arrivée.
  const t1 = tramLine.directions.find((d) => d.headsign === 'Ruisseau')!
  const tc = stopConnections(tramLine, t1.stops)
  check('T1 vers Ruisseau : M1 affiché au terminus', tc[tc.length - 1].rail.some((l) => l.id === metroLine.id))
}

// ── Recherche : numéro, nom, arrêt, mode, FR/AR ─────────────────────────────
{
  const shorts = (q: string, locale: 'fr' | 'ar' | 'en' = 'fr') => catalogSearch(q, locale).map((h) => h.line.shortName)
  const one = shorts('1')
  check('« 1 » : préfixe de numéro, jamais « contient » (pas la 31, ni M1)', !one.includes('31') && !one.includes('M1') && one.includes('12'), one.join(' '))
  check('« 100 » : la 100 en premier', shorts('100')[0] === '100')
  check('« m1 » : le métro', shorts('m1')[0] === 'M1')
  const aero = shorts('aeroport')
  check('« aeroport » : 100 et 178', aero.includes('100') && aero.includes('178'), aero.join(' '))
  const audin = catalogSearch('audin', 'fr')
  check('« audin » : 31 et 54', ['31', '54'].every((s) => audin.some((h) => h.line.shortName === s)))
  const viaStop = catalogSearch('fusilles', 'fr').find((h) => h.line.shortName === 'M1')
  check('« fusilles » : M1 trouvé par son arrêt, avec le nom exact de l’arrêt', viaStop?.rank === 3 && viaStop.stop?.name === 'Les Fusillés', viaStop?.stop?.name)
  check('« métro » : M1 trouvé par le mode', shorts('métro').includes('M1'))
  check('« tram » : T1 trouvé par le mode', shorts('tram').includes('T1'))
  check('« مترو » : M1 trouvé en arabe', shorts('مترو', 'ar').includes('M1'))
  check('« الحراش » : M1 trouvé par un arrêt arabe', shorts('الحراش', 'ar').includes('M1'))
  check('« ساحة الشهداء » : lignes de bus trouvées par le nom arabe des arrêts', shorts('ساحة الشهداء', 'ar').length > 3)
  check('Saisie arabe détectée', hasArabicLetters('قصبة') && !hasArabicLetters('Kasbah'))
  check('Saisie sans correspondance : liste vide', catalogSearch('zzzz', 'fr').length === 0)
}

// ── Lignes à proximité ──────────────────────────────────────────────────────
{
  // Grande Poste : métro + bus dans le rayon, une rangée par ligne.
  const center = nearbyLineEntries(36.7725, 3.0590)
  const ids = center.entries.map((e) => e.line.id)
  check('Grande Poste : 5 lignes au plus, sans doublon', center.entries.length === 5 && new Set(ids).size === ids.length, ids.join(' '))
  check('Grande Poste : autres lignes comptées (pas tues)', center.others > 0, String(center.others))
  check('Grande Poste : bus inclus', center.entries.some((e) => e.line.mode === 'bus'))
  check('Grande Poste : triées par distance', center.entries.every((e, i, a) => i === 0 || a[i - 1].distanceM <= e.distanceM))
  check('Distances ≤ 1,5 km', center.entries.every((e) => e.distanceM <= 1500))
  // Zéralda : plus de « station proche » à 20 km.
  const zeralda = nearbyLineEntries(36.7545, 2.8435)
  check('Zéralda : aucune station de métro/tram « proche »', zeralda.entries.every((e) => e.line.mode === 'bus'), zeralda.entries.map((e) => `${e.line.shortName}@${e.distanceM}m`).join(' '))
  // Banlieue (terminus de la 701 à Zéralda) : des bus, pas de métro/tram.
  const zTerm = nearbyLineEntries(36.7215, 2.8440)
  check('Zéralda (Complexe Touristique) : la 701 à proximité', zTerm.entries.some((e) => e.line.shortName === '701'), zTerm.entries.map((e) => `${e.line.shortName}@${e.distanceM}m`).join(' '))
  check('Zéralda (Complexe Touristique) : ni métro ni tram', zTerm.entries.every((e) => e.line.mode === 'bus'))
  // Fréquence à l'arrêt : le tronc du M1 cumule les deux branches.
  const tafourah = metroLine.directions[0].stops.find((s) => s.id === 'M01')!
  const ainNaadja = metroLine.directions.find((d) => d.patternId === 'M1-AIN-1')!.stops[0]
  check('Tafourah à 10:00 : ~10 min (deux branches alternées)', stopHeadway(metroLine, tafourah, at('10:00')) === 10, String(stopHeadway(metroLine, tafourah, at('10:00'))))
  check('Aïn Naâdja à 10:00 : ~20 min (une rame sur deux)', stopHeadway(metroLine, ainNaadja, at('10:00')) === 20, String(stopHeadway(metroLine, ainNaadja, at('10:00'))))
  check('Tafourah à 08:00 : ~5 min', stopHeadway(metroLine, tafourah, at('08:00')) === 5)
  check('Tafourah à 23:30 : aucune fréquence', stopHeadway(metroLine, tafourah, at('23:30')) === null)
  const t1 = tramLine.directions[0].stops[5]
  check('T1 à 10:00 : ~10 min', stopHeadway(tramLine, t1, at('10:00')) === 10)
  const b3stop = bus('3').directions[0].stops[3]
  check('Bus 3 à un arrêt, 12:00 : ~40 min', stopHeadway(bus('3'), b3stop, at('12:00')) === 40)
  const far = nearbyLineEntries(36.2, 3.9)
  check('Hors réseau : liste vide', far.entries.length === 0 && far.others === 0)
  check('Marche : 1 km à vol d’oiseau ≈ 16 min (détour 30 %, 4,8 km/h)', walkMinutes(1000) === 16, String(walkMinutes(1000)))
}

// ── Pastilles : contraste du texte (WCAG AA, 4,5:1) ─────────────────────────
for (const line of [metroLine, tramLine, bus('3')]) {
  const { background, color } = lineBadgeColors(line)
  const ratio = contrastRatio(background, color)
  check(`Pastille ${line.shortName} : contraste ${ratio.toFixed(2)}:1 ≥ 4,5`, ratio >= 4.5)
}
check('Toutes les lignes ont une pastille lisible', allLines.every((l) => {
  const { background, color } = lineBadgeColors(l)
  return contrastRatio(background, color) >= 4.5
}))

// ── Chaînes : trois langues, jamais « officielles », toujours « ~ » ─────────
{
  const keys = Object.keys(catStrings.fr) as (keyof typeof catStrings.fr)[]
  for (const locale of ['fr', 'ar', 'en'] as const) {
    const dict = catStrings[locale] as Record<string, string>
    check(`cat_* ${locale} : ${keys.length} clés présentes et non vides`, keys.every((k) => typeof dict[k] === 'string' && dict[k].trim().length > 0))
    const vars = (s: string) => (s.match(/\{\w+\}/g) ?? []).sort().join(',')
    check(`cat_* ${locale} : mêmes variables qu'en français`, keys.every((k) => vars(dict[k]) === vars((catStrings.fr as Record<string, string>)[k])))
    check(`cat_* ${locale} : aucune « fréquence officielle »`, keys.every((k) => !/officiel|official|رسمي/i.test(dict[k])))
    check(`translations.${locale} contient les clés cat_*`, keys.every((k) => (translations[locale] as Record<string, string>)[k] === dict[k]))
  }
  check('Arabe : textes en lettres arabes', keys.every((k) => /[؀-ۿ]/.test((catStrings.ar as Record<string, string>)[k])))
  for (const locale of ['fr', 'ar', 'en'] as const) {
    const label = nextPassLabel(20, locale)
    check(`Fréquence ${locale} : estimation signalée (« ~ » ou « تقريباً »)`, /~|تقريب/.test(label), label)
  }
}

if (failures) {
  console.error(`\n${failures} échec(s)`)
  process.exit(1)
}
console.log('\nCatalogue OK')

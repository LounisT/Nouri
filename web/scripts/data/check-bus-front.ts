// Contrôle des bus côté front (lines.ts, line-shapes.ts, generated-lines.json).
// Usage (depuis web/) : npx sucrase-node scripts/data/check-bus-front.ts
// À lancer aussi sous un autre fuseau : TZ=America/Montreal npx sucrase-node …
// (états de service et intervalles = heure d'Alger, quel que soit le téléphone).
//
// La cohérence generated-lines.json ↔ GTFS est vérifiée par
// data/scripts/validate_gtfs.py ; ici on vérifie ce que le front en fait.
import {
  busLines, allLines, headwayAt, isInService, isDirectionInService, stopPassWindow,
  oneDirectionNotice, isDeducedShape, isUnmappedShape, directionIndexByTripId, stopById, lineFareLabel,
  searchLines, legHeadsignLabel, findDirectionIndex, specialPeriodNotice, shapeSourceNotice, type TransitLine,
} from '../../src/lib/lines'
import { algiersToEpoch } from '../../src/lib/algiers-time'
import { loadLineShapes } from '../../src/lib/line-shapes'
import { installPublicFetch } from './public-fetch'

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

// ── Données ──────────────────────────────────────────────────────────────────
check('37 lignes de bus, la 37 écartée', busLines.length === 37 && !busLines.some((l) => l.shortName === '37'), String(busLines.length))
check('aucun tracé embarqué dans le bundle', allLines.every((l) => l.directions.every((d) => !d.shape)))
check('toutes les lignes de bus : temps estimés, source, couleur de texte AA',
  busLines.every((l) => l.timesEstimated && l.source && l.textColor === '#000000'))
const l100 = bus('100')
check('100 : vers l\'aéroport depuis Es-Safir', l100.directions[0].headsign === "Aéroport d'Alger"
  && l100.directions[0].stops[0].name === 'Hôtel Es-Safir'
  && l100.directions[0].stops[1].name === 'Aéroport Terminal International',
  l100.directions.map((d) => `${d.headsign}: ${d.stops.map((s) => s.name).join(' → ')}`).join(' | '))
check('100 : retour depuis l\'aéroport', l100.directions[1].stops[0].name === 'Aéroport Terminal International')
check('girouettes en français, arabe à part', busLines.every((l) => l.directions.every((d) => /[A-Za-z]/.test(d.headsign) && !d.headsign.includes('=>'))))
check('girouette arabe 100', legHeadsignLabel('100', "Aéroport d'Alger", 'ar') === 'المطار' && legHeadsignLabel('100', "Aéroport d'Alger", 'fr') === "Aéroport d'Alger")

// ── Intervalles et service à l'heure d'Alger ────────────────────────────────
const l3 = bus('3')
check('3 à 08:00 : ~20 min', headwayAt(l3, at('08:00')) === 20, String(headwayAt(l3, at('08:00'))))
check('3 à 12:00 : ~40 min', headwayAt(l3, at('12:00')) === 40, String(headwayAt(l3, at('12:00'))))
check('3 à 20:00 : fermé, aucun intervalle', headwayAt(l3, at('20:00')) === null && !isInService(l3, at('20:00')))
check('3 : dernier départ 19:20 encore en service', isInService(l3, at('19:20')) && !isInService(l3, at('19:21')))
check('604 à 10:00 : ~60 min (plus de 30 min codé en dur)', headwayAt(bus('604'), at('10:00')) === 60,
  String(headwayAt(bus('604'), at('10:00'))))
check('12 à 10:00 : ~10 min', headwayAt(bus('12'), at('10:00')) === 10)
const l18 = bus('18')
check('18 : dernier départ 00:20 (après minuit)', l18.hours?.last === '00:20'
  && isInService(l18, at('00:10', '2026-11-10')) && !isInService(l18, at('00:30', '2026-11-10')))
check('18 à 00:10 : intervalle de la dernière plage', headwayAt(l18, at('00:10', '2026-11-10')) === 40,
  String(headwayAt(l18, at('00:10', '2026-11-10'))))
check('100 à 23:30 : ~60 min ; 00:30 : fermé', headwayAt(l100, at('23:30')) === 60 && headwayAt(l100, at('00:30', '2026-11-10')) === null)
check('sens : en service selon ses propres départs', isDirectionInService(l3.directions[0], at('06:00')) === true
  && isDirectionInService(l3.directions[0], at('05:59')) === false)

// ── Arrêts : passages estimés ───────────────────────────────────────────────
const d3 = l3.directions[0]
const mid = Math.floor(d3.stops.length / 2)
const pass = stopPassWindow(d3, mid)
check('3 : premier/dernier passage estimés à un arrêt intermédiaire', Boolean(pass && pass.first > '06:00' && pass.last > '19:20'),
  `${d3.stops[mid].name} : ${pass?.first} – ${pass?.last}`)
check('temps estimés croissants partout', busLines.every((l) => l.directions.every((d) =>
  (d.offsetsMin ?? []).length === d.stops.length && (d.offsetsMin ?? []).every((v, k, a) => k === 0 || v >= a[k - 1]))))

// ── Sens uniques et tracés ──────────────────────────────────────────────────
const one = busLines.filter((l) => l.oneDirection).map((l) => l.shortName)
check('lignes à un seul sens signalées', one.join(',') === '18,99,101,105,178,604,606,707', one.join(','))
check('phrase « seul le sens … »', (oneDirectionNotice(bus('101'), 'fr') ?? '').includes('Birtouta') && oneDirectionNotice(l3) === null,
  oneDirectionNotice(bus('101'), 'fr') ?? '')
check('731 vers Sidi Abdellah : sans tracé', isUnmappedShape('731', 'Sidi Abdellah') === true && shapeSourceNotice(bus('731').directions[1]) === 'data_shapeAbsent')
check('sens inconnu : undefined (garder le test géométrique)', isUnmappedShape('731', 'Inconnu') === undefined)
check('101 : tracé déduit annoncé', isDeducedShape('101', 'Birtouta'))
check('sens par trip_id OTP', directionIndexByTripId(bus('45'), 'alger:ETUSA-45-dir1-0610') === 1
  && isDeducedShape('45', 'girouette changée', 'alger:ETUSA-45-dir1-0610') === (bus('45').directions[1].shapeSource === 'deduit'))
check('findDirectionIndex bus', findDirectionIndex(bus('45'), 'Bouzaréah') === 1)

// ── Noms, tarifs, recherche ──────────────────────────────────────────────────
check('stopById accepte « alger:B… »', stopById('alger:B5130875391')?.nameAr === 'المطار المحطة الدولية')
check('tarif localisé', lineFareLabel(l100, 'ar') === '50 دج' && lineFareLabel(l100, 'fr') === '50 DA')
const air = searchLines('aeroport').map((h) => h.line.shortName)
check('recherche « aeroport » : 100 et 178', air.includes('100') && air.includes('178'), air.join(','))
const one1 = searchLines('100')
check('recherche « 100 » : la 100 en premier', one1[0]?.line.shortName === '100' && one1[0].rank === 0)
const ghermoul = searchLines('ghermoul')
check('recherche par arrêt : nom exact de l\'arrêt trouvé', ghermoul.length > 0 && ghermoul.every((h) => h.rank === 3 && h.stop && /Ghermoul/i.test(h.stop.name)),
  ghermoul.map((h) => `${h.line.shortName}@${h.stop?.name}`).join(', '))
check('recherche en arabe (nom de station)', searchLines('الحراش').length > 0)

// ── Périodes spéciales ───────────────────────────────────────────────────────
check('Ramadan 2027 : avertissement bus', specialPeriodNotice(l3, at('12:00', '2027-02-20')) === 'data_ramadanBusNotice'
  && specialPeriodNotice(l3, at('12:00')) === null)

// ── Tracés à la demande ──────────────────────────────────────────────────────
installPublicFetch()
loadLineShapes().then((shapes) => {
  const bad: string[] = []
  for (const line of allLines) {
    const dirs = shapes[line.id]
    if (!dirs || dirs.length !== line.directions.length) {
      bad.push(`${line.id} : ${dirs?.length} tracés pour ${line.directions.length} sens`)
      continue
    }
    line.directions.forEach((d, i) => {
      const n = dirs[i].length
      if ((d.shapeSource === 'absent') !== (n === 0)) bad.push(`${line.id} sens ${i} : ${d.shapeSource}, ${n} points`)
    })
  }
  check('line-shapes.json : un tracé par sens, vide si et seulement si « absent »', bad.length === 0, bad.slice(0, 5).join(' ; '))
  console.log(failures ? `\n${failures} échec(s)` : '\nBus front OK')
  process.exit(failures ? 1 : 0)
}, (e: unknown) => {
  check('loadLineShapes', false, String(e))
  process.exit(1)
})

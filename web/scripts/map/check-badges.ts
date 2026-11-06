// Contrôle des pastilles d'arrêt et des rangées de la fiche.
// Usage (depuis web/) : npx sucrase-node scripts/map/check-badges.ts
//
// - destination affichée = terminus de la direction qui passe réellement à
//   l'arrêt (cas réels du constat K71 : Dar Diaf / 701, Chevalley / 731) ;
// - aucune rangée « vers <direction 0> » pour un arrêt desservi seulement par
//   la direction 1 ;
// - arrêts homonymes à moins de 40 m regroupés ; recouvrements à z15.
import { getStopBadges, badgeDirectionRows, layoutBadges, readableTextColor, contrastRatio, directionDestination } from '../../src/lib/map-badges'
import { busLines } from '../../src/lib/lines'

let failures = 0
const fail = (msg: string) => { failures += 1; console.error('ÉCHEC ' + msg) }

const badges = getStopBadges('fr')
const bus = badges.filter((b) => b.mode === 'bus')
const near = (lat: number, lon: number) => bus
  .map((b) => ({ b, d: Math.hypot((b.lat - lat) * 111320, (b.lon - lon) * 111320 * 0.8) }))
  .sort((x, y) => x.d - y.d)[0]

// Destination attendue en motif : le libellé exact suit la donnée (girouette
// GTFS), seul le SENS compte ici.
const expect = (name: string, lat: number, lon: number, line: string, towards: RegExp, notTowards: RegExp) => {
  const { b, d } = near(lat, lon)
  const rows = badgeDirectionRows(b, 'fr').filter((r) => r.line === line)
  const labels = rows.map((r) => r.towards ?? 'terminus')
  if (!labels.some((l) => towards.test(l)) || labels.some((l) => notTowards.test(l))) {
    fail(`${name} (${Math.round(d)} m, « ${b.name} ») ligne ${line} : ${JSON.stringify(labels)}, attendu ${towards}`)
  } else console.log(`OK ${name} : ${line} → ${labels.join(' / ')}`)
}
expect('Dar Diaf', 36.7721, 2.9651, '701', /Z[ée]ralda/i, /Chevalley/i)
expect('Chevalley', 36.7695, 3.0069, '731', /Sidi Abd/i, /Chevalley/i)

// Rangée par rangée : le terminus annoncé doit être celui d'une direction qui
// passe par un arrêt physique du badge, sans y finir.
let rowsTotal = 0
for (const b of bus) {
  for (const r of badgeDirectionRows(b, 'fr')) {
    rowsTotal += 1
    if (r.towards === null) continue
    const line = busLines.find((l) => l.id === r.lineId)!
    const d = line.directions[r.dir]
    const passes = d.stops.slice(0, -1).some((s) => b.members.some((m) => Math.hypot((m.lat - s.lat) * 111320, (m.lon - s.lon) * 111320 * 0.8) < 13))
    if (!passes) fail(`${b.name} ${r.line} vers ${r.towards} : la direction ${r.dir} ne passe pas ici`)
    if (r.towards !== directionDestination(line, r.dir, 'fr')) fail(`${b.name} ${r.line} : destination incohérente`)
    if (/[؀-ۿ]/.test(r.towards)) fail(`${b.name} ${r.line} : terminus en arabe dans l'interface FR (${r.towards})`)
  }
}
console.log(`${rowsTotal} rangées vérifiées sur ${bus.length} pastilles bus`)

// Regroupement : combien de pastilles homonymes restent à moins de 40 m ?
let dupes = 0
for (let i = 0; i < bus.length; i += 1) for (let j = i + 1; j < bus.length; j += 1) {
  const a = bus[i]
  const c = bus[j]
  if (a.name.toLowerCase() !== c.name.toLowerCase()) continue
  if (Math.hypot((a.lat - c.lat) * 111320, (a.lon - c.lon) * 111320 * 0.8) < 40) dupes += 1
}
console.log(`Pastilles homonymes encore à moins de 40 m : ${dupes}`)
if (dupes > 0) fail('regroupement incomplet')

// Recouvrements à z15 avec la projection Web Mercator (tuiles 512 px MapLibre).
const project = (zoom: number) => (lon: number, lat: number) => {
  const scale = 512 * 2 ** zoom
  const x = ((lon + 180) / 360) * scale
  const s = Math.sin((lat * Math.PI) / 180)
  const y = (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * scale
  return { x, y }
}
const world = { west: -180, south: -85, east: 180, north: 85 }
const z15 = layoutBadges(badges, world, 15, { project: project(15) }, 100000)
const z15raw = layoutBadges(badges, world, 15, {}, 100000)
console.log(`z15 : ${z15raw.visible.length} pastilles éligibles, ${z15.visible.length} affichées, ${z15.hiddenByCollision} écartées pour chevauchement`)
// Vérifie qu'aucune pastille affichée n'en chevauche une autre.
const p15 = project(15)
const rects = z15.visible.map((b) => { const { x, y } = p15(b.lon, b.lat); const w = Math.max(20, 16 + 6.2 * b.label.length); return { x0: x - w / 2, x1: x + w / 2, y0: y - 9, y1: y + 9 } })
let overlaps = 0
for (let i = 0; i < rects.length; i += 1) for (let j = i + 1; j < rects.length; j += 1) {
  const a = rects[i]; const c = rects[j]
  if (a.x0 < c.x1 && a.x1 > c.x0 && a.y0 < c.y1 && a.y1 > c.y0) overlaps += 1
}
console.log(`Chevauchements restants à z15 : ${overlaps}`)
if (overlaps) fail('chevauchements')

// Contraste du texte des pastilles.
for (const color of Array.from(new Set(badges.map((b) => b.color)))) {
  const ratio = contrastRatio(color, readableTextColor(color))
  if (ratio < 4.5) fail(`contraste ${color} : ${ratio.toFixed(2)}:1`)
  else console.log(`Contraste ${color} / ${readableTextColor(color)} : ${ratio.toFixed(2)}:1`)
}

if (failures) process.exit(1)
console.log('OK')

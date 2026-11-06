// Contrôle des tracés bus tels que la carte les dessine.
// Usage (depuis web/) : npx sucrase-node scripts/map/check-traces.ts [chemin/line-shapes.json]
// (par défaut public/data/line-shapes.json, le fichier que charge la carte)
//
// - liste les directions dont un segment est un artefact d'assemblage
//   (> 300 m ET demi-tour ou retour sur un point déjà parcouru) : la carte
//   n'en dessine pas le saut ;
// - liste les directions sans tracé (aucun trait dessiné) ;
// - vérifie que la coupure en mètres (splitAtAlong) tombe à moins d'un mètre
//   de la distance demandée.
import fs from 'fs'
import path from 'path'
import { findArtifactSegments, cumulativeMeters, splitAtAlong, metersBetween, directionShapeStatus, type LonLat } from '../../src/lib/map-traces'

type Dir = { headsign: string; shapeSource?: string; shape?: number[][]; stops: { lat: number; lon: number; name: string }[] }
type Line = { id: string; shortName: string; directions: Dir[] }

const root = path.resolve(__dirname, '../..')
const lines: Line[] = JSON.parse(fs.readFileSync(path.join(root, 'src/lib/generated-lines.json'), 'utf8'))
const defaultShapes = path.join(root, 'public/data/line-shapes.json')
const shapesFile = process.argv[2] ?? (fs.existsSync(defaultShapes) ? defaultShapes : null)
const external: Record<string, number[][][]> | null = shapesFile ? JSON.parse(fs.readFileSync(shapesFile, 'utf8')) : null
console.log(`Tracés lus dans ${shapesFile ?? 'generated-lines.json (champ shape)'}`)

let failures = 0
const flagged: string[] = []
const unmapped: string[] = []
for (const line of lines) {
  line.directions.forEach((d, i) => {
    const shape = (external ? external[line.id]?.[i] : d.shape) as LonLat[] | undefined
    if (directionShapeStatus(d, shape) === 'unmapped' || !shape) {
      unmapped.push(`${line.shortName} dir${i}`)
      return
    }
    const arts = findArtifactSegments(shape)
    if (arts.length) {
      const cum = cumulativeMeters(shape)
      flagged.push(`${line.shortName} dir${i}: ` + arts.map((k) => `#${k} ${Math.round(cum[k] - cum[k - 1])} m`).join(', '))
    }
    // Coupure en mètres : la portion « faite » mesure exactement `along`.
    const cum = cumulativeMeters(shape)
    const total = cum[cum.length - 1]
    for (const f of [0.17, 0.5, 0.83]) {
      const along = total * f
      const { done } = splitAtAlong(shape, cum, along)
      let len = 0
      for (let k = 1; k < done.length; k += 1) len += metersBetween(done[k - 1], done[k])
      if (Math.abs(len - along) > 1) {
        failures += 1
        console.error(`coupure fausse ${line.shortName} dir${i} f=${f}: ${len.toFixed(1)} m au lieu de ${along.toFixed(1)} m`)
      }
    }
  })
}
console.log(`Directions avec artefact (saut non dessiné) : ${flagged.length}`)
flagged.forEach((f) => console.log('  ' + f))
console.log(`Directions sans tracé (aucun trait) : ${unmapped.join(', ') || 'aucune'}`)
if (failures) {
  console.error(`${failures} coupure(s) fausse(s)`)
  process.exit(1)
}
console.log('Coupures en mètres : OK')

// Tracés des lignes, chargés à la demande (hors du bundle initial).
//
// CONTRAT (partagé entre la carte et la couche données) :
//   shapes[line.id][directionIndex] = [[lon, lat], ...]
// directionIndex suit l'ordre de line.directions. Un tableau vide = aucun
// tracé relevé pour ce sens (shapeSource 'absent') : ne rien dessiner plutôt
// qu'une approximation.
//
// Source : /data/line-shapes.json (web/public/data), écrit par
// data/scripts/build_front_data.py depuis shapes.txt du GTFS — les mêmes
// tracés que ceux d'OTP, simplifiés à 1 m près.
//   - Bus : voies des relations OpenStreetMap des lignes ETUSA (build_bus.py),
//     coupées au premier et au dernier arrêt ; trous éventuels comblés par
//     les rues (shapeSource 'deduit').
//   - Métro/tram : voies OSM des relations de ligne (build_rail.py). Le M1 a
//     quatre sens (deux par branche), le T1 deux.
// Environ 45 Ko gzip, mis en cache par le service worker après la première
// visite (disponible hors connexion ensuite).
export type LineShapes = Record<string, number[][][]>

export const LINE_SHAPES_URL = '/data/line-shapes.json'

let cache: Promise<LineShapes> | null = null

function isLineShapes(value: unknown): value is LineShapes {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  return Object.values(value as Record<string, unknown>).every((dirs) => Array.isArray(dirs))
}

/**
 * Tracés de toutes les lignes, mémoïsés. En cas d'échec (hors connexion à la
 * première visite, réponse invalide), la promesse est REJETÉE et le cache
 * vidé : l'appelant affiche un message et peut réessayer.
 */
export function loadLineShapes(): Promise<LineShapes> {
  if (!cache) {
    cache = fetch(LINE_SHAPES_URL, { credentials: 'same-origin' })
      .then((res) => {
        if (!res.ok) throw new Error(`line-shapes: HTTP ${res.status}`)
        return res.json() as Promise<unknown>
      })
      .then((data) => {
        if (!isLineShapes(data)) throw new Error('line-shapes: format inattendu')
        return data
      })
      .catch((error: unknown) => {
        cache = null
        throw error instanceof Error ? error : new Error(String(error))
      })
  }
  return cache
}

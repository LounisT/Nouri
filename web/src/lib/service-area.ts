// Zone desservie par Nouri (Grand Alger), sans dépendance à MapLibre : le
// formulaire d'itinéraire s'en sert pour refuser « Ma position » quand
// l'usager est à l'étranger ou hors d'Alger (diaspora qui prépare un voyage).
// Mêmes bornes que SERVICE_BBOX de map-style.ts (emprise des arrêts GTFS,
// 36,641-36,817 N ; 2,841-3,381 E, plus ~3 km).

export const SERVICE_AREA_BBOX: [number, number, number, number] = [2.80, 36.60, 3.42, 36.85]

export function isInServiceAreaPoint(lat: number, lon: number): boolean {
  const [w, s, e, n] = SERVICE_AREA_BBOX
  return lon >= w && lon <= e && lat >= s && lat <= n
}

/** Distance (km) entre un point et le bord le plus proche de la zone ; 0 dedans. */
export function kmFromServiceArea(lat: number, lon: number): number {
  const [w, s, e, n] = SERVICE_AREA_BBOX
  const clampedLat = Math.min(n, Math.max(s, lat))
  const clampedLon = Math.min(e, Math.max(w, lon))
  const R = 6371
  const toRad = (d: number) => (d * Math.PI) / 180
  const dLat = toRad(lat - clampedLat)
  const dLon = toRad(lon - clampedLon)
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(toRad(lat)) * Math.cos(toRad(clampedLat)) * Math.sin(dLon / 2) ** 2
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)))
}

// Stations et tracés du métro M1 et du tramway T1.
//
// Source : OpenStreetMap (© contributeurs OpenStreetMap, ODbL). Tout vient de
// generated-rail.json, écrit par data/scripts/build_rail.py en même temps que
// le GTFS d'OTP : mêmes identifiants, mêmes noms, mêmes coordonnées (contrôlé
// par data/scripts/check_rail.py). Ne rien saisir ici à la main : une station
// corrigée ici et pas dans le GTFS ferait diverger la carte et le calculateur.
//
// Le M1 a deux branches après Haï El Badr (El Harrach Centre, Aïn Naâdja) :
// ce n'est PAS une liste d'arrêts unique. Pour un parcours, utiliser
// railRoutes / railStationsBetween, jamais un découpage de metroStations.
import type { Feature, LineString, MultiLineString } from 'geojson'
import type { Locale } from './i18n'
import railData from './generated-rail.json'

export type TransitMode = 'metro' | 'tram'

export interface Station {
  id: string
  name: string
  nameAr?: string
  lat: number
  lon: number
  type: TransitMode
  /** Nœud OpenStreetMap d'origine (traçabilité, licence ODbL). */
  osmNode?: number
}

export const METRO_COLOR = '#1E3A8A'
export const TRAM_COLOR = '#059669'
// Fonds de badge sous texte blanc 12 px : contraste ≥ 4,5:1 (WCAG AA).
// TRAM_COLOR (3,77:1 sur blanc) reste la couleur des tracés et des légendes.
export const METRO_BADGE_COLOR = '#1E3A8A' // 10,4:1
export const TRAM_BADGE_COLOR = '#047857' // 5,5:1

/** Intervalle d'un sens sur une plage horaire (heure d'Alger, fin exclue). */
export interface RailHeadway {
  start: string
  end: string
  min: number
}

/**
 * Un sens exploité, identique à un motif du GTFS. Le M1 en a quatre
 * (aller et retour de chaque branche), le T1 deux.
 */
export interface RailRoute {
  /** = shape_id du GTFS : 'M1-HAR-0', 'M1-AIN-1', 'T1-0'… */
  id: string
  /** = route_id du GTFS : 'L1-metro' ou 'L1-tram'. */
  lineId: string
  mode: TransitMode
  /** 0 = depuis Place des Martyrs / Ruisseau, 1 = vers eux. */
  directionId: number
  /** = trip_headsign du GTFS = nom du terminus d'arrivée. */
  headsign: string
  stations: Station[]
  /**
   * ~ Temps depuis le terminus d'origine, en secondes, un par station.
   * ESTIMATION (longueur de voie OSM ÷ vitesse commerciale, voir
   * build_rail.py) : à afficher avec « ~ », jamais comme un horaire.
   */
  offsetsSec: number[]
  /** Premier et dernier départ du terminus d'origine, « HH:MM » heure d'Alger. */
  firstDeparture: string
  lastDeparture: string
  /** Intervalle de CE sens par plage (une branche du M1 : une rame sur deux). */
  headways: RailHeadway[]
  /** Voie OSM, [[lon, lat], …], du terminus d'origine au terminus d'arrivée. */
  shape: number[][]
}

/** Amplitude d'une ligne (premier / dernier départ des terminus) et intervalles du tronçon le plus desservi. */
export interface RailLineService {
  first: string
  last: string
  trunkHeadways: RailHeadway[]
  /** Provenance de l'amplitude (OSM, SETRAM…). */
  source?: string
}

interface RailDataFile {
  service: RailLineService & { headwaysSource?: string; byLine?: Record<string, RailLineService> }
  stations: Station[]
  lines: {
    id: string
    patterns: {
      id: string
      directionId: number
      headsign: string
      stopIds: string[]
      offsetsSec: number[]
      firstDeparture: string
      lastDeparture: string
      headways: RailHeadway[]
      shape: number[][]
    }[]
    network: number[][][]
  }[]
}

const data = railData as unknown as RailDataFile

/**
 * Amplitude et intervalles du MÉTRO (05:00-23:00, OSM ; ~5 min de 7 à 9 h et
 * de 17 à 21 h, ~10 min sinon, intervalles estimés non publiés).
 * trunkHeadways vaut pour le tronc commun ; chaque branche a le double.
 * Le tram a sa propre amplitude : railServiceForLine('L1-tram').
 */
export const RAIL_SERVICE: RailLineService = data.service

/**
 * Amplitude sourcée d'une ligne ferrée : métro 05:00-23:00 (OSM), tram
 * 05:30-22:20 (SETRAM : 22:20 depuis Ruisseau, 22:00 depuis Dergana — chaque
 * sens porte ses propres premier et dernier départs, RailRoute). Repli sur
 * RAIL_SERVICE pour d'anciennes données sans détail par ligne.
 */
export function railServiceForLine(lineId: string): RailLineService {
  return data.service.byLine?.[lineId] ?? RAIL_SERVICE
}

const stationById = new Map<string, Station>(data.stations.map((s) => [s.id, s]))

export function getStation(id: string): Station | undefined {
  return stationById.get(id)
}

/**
 * Les 19 stations du métro : tronc et branche El Harrach (Place des Martyrs →
 * El Harrach Centre), puis les trois stations de la branche Aïn Naâdja.
 * Pour la recherche et la proximité seulement — pas un ordre de parcours.
 */
export const metroStations: Station[] = data.stations.filter((s) => s.type === 'metro')

/** Les 37 arrêts du tram, dans l'ordre de la ligne (Ruisseau → Dergana Centre). */
export const tramStations: Station[] = data.stations.filter((s) => s.type === 'tram')

export const allStations: Station[] = [...metroStations, ...tramStations]

/** Sens exploités, dans l'ordre : M1 vers El Harrach Centre, retour, vers Aïn Naâdja, retour ; T1 aller, retour. */
export const railRoutes: RailRoute[] = data.lines.flatMap((line) =>
  line.patterns.map((p) => ({
    id: p.id,
    lineId: line.id,
    mode: (line.id === 'L1-metro' ? 'metro' : 'tram') as TransitMode,
    directionId: p.directionId,
    headsign: p.headsign,
    stations: p.stopIds.map((id) => stationById.get(id)).filter((s): s is Station => Boolean(s)),
    offsetsSec: p.offsetsSec,
    firstDeparture: p.firstDeparture,
    lastDeparture: p.lastDeparture,
    headways: p.headways,
    shape: p.shape,
  })),
)

export function railRoutesForLine(lineId: string): RailRoute[] {
  return railRoutes.filter((r) => r.lineId === lineId)
}

/** Sens qui permettent de MONTER à cette station (terminus d'arrivée exclu). */
export function railRoutesAtStation(stationId: string): RailRoute[] {
  return railRoutes.filter((r) => {
    const i = r.stations.findIndex((s) => s.id === stationId)
    return i >= 0 && i < r.stations.length - 1
  })
}

/**
 * Parcours direct entre deux stations du même mode : le sens exploité qui
 * dessert `fromId` puis `toId`, et les stations traversées (bornes incluses).
 * null s'il n'existe pas de rame directe — en particulier entre les deux
 * branches du M1 (Les Ateliers → El Harrach Gare) : il faut alors changer à
 * Haï El Badr (RAIL_JUNCTION_ID), ce que l'appelant doit dire.
 */
export function railStationsBetween(
  fromId: string,
  toId: string,
): { route: RailRoute; stations: Station[]; offsetSec: number } | null {
  if (fromId === toId) return null
  for (const route of railRoutes) {
    const i = route.stations.findIndex((s) => s.id === fromId)
    const j = route.stations.findIndex((s) => s.id === toId)
    if (i >= 0 && j > i) {
      return {
        route,
        stations: route.stations.slice(i, j + 1),
        offsetSec: route.offsetsSec[j] - route.offsetsSec[i],
      }
    }
  }
  return null
}

/** Station où se séparent les branches du M1. */
export const RAIL_JUNCTION_ID = 'M12' // Haï El Badr

export function getStationName(station: Station, locale: Locale = 'fr'): string {
  return locale === 'ar' ? (station.nameAr ?? station.name) : station.name
}

function networkFeature(lineId: string, mode: TransitMode, color: string): Feature<LineString | MultiLineString> {
  const parts = data.lines.find((l) => l.id === lineId)?.network ?? []
  return {
    type: 'Feature',
    // Une seule portion (tram) : LineString ; tronc + branche (métro) :
    // MultiLineString, pour ne jamais relier El Harrach Centre aux Ateliers.
    geometry: parts.length === 1
      ? { type: 'LineString', coordinates: parts[0] }
      : { type: 'MultiLineString', coordinates: parts },
    properties: { mode, color },
  }
}

/** Fond de carte du M1 : voies OSM du tronc et des deux branches. */
export const metroLineGeoJSON = networkFeature('L1-metro', 'metro', METRO_COLOR)

/** Fond de carte du T1 : voie OSM, sens aller. */
export const tramLineGeoJSON = networkFeature('L1-tram', 'tram', TRAM_COLOR)

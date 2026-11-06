// Source unique des lignes de transport, tous modes confondus.
// Métro/tram : construits depuis stations.ts (generated-rail.json, écrit par
//              data/scripts/build_rail.py depuis OpenStreetMap, comme le GTFS).
// Bus : importés de generated-lines.json, écrit par
//       data/scripts/build_front_data.py depuis le GTFS chargé dans OTP
//       (lui-même produit par build_bus.py) — ne PAS éditer à la main.
// Aucun tracé ici : ils sont chargés à la demande (line-shapes.ts).
import { translations, type Locale } from './i18n'
import { algiersParts } from './algiers-time'
import {
  railRoutesForLine,
  METRO_COLOR,
  TRAM_COLOR,
  railServiceForLine,
  getStationName,
  type RailHeadway,
  type RailRoute,
} from './stations'
import generatedBusLines from './generated-lines.json'

export type LineMode = 'metro' | 'tram' | 'bus'

export interface LineStop {
  name: string
  nameAr?: string
  lat: number
  lon: number
  /**
   * stop_id du GTFS (rail : Station.id ; bus : « B » + nœud OSM), pour
   * rapprocher sans passer par le nom (OTP : « alger:<id> »).
   */
  id?: string
}

/** Intervalle sur une plage horaire (heure d'Alger, fin exclue ; fin ≤ début = après minuit). */
export type HeadwayWindow = RailHeadway

/**
 * Provenance du tracé d'un sens :
 * - 'osm'    : voies de la relation de ligne OpenStreetMap (relevé) ;
 * - 'deduit' : relation OSM incomplète, trous comblés par les rues entre
 *              les arrêts — à annoncer (data_shapeDeduced, trait en tirets) ;
 * - 'absent' : aucun tracé assez sûr pour être dessiné — ne rien dessiner,
 *              le dire (data_shapeAbsent) ; OTP relie alors les arrêts en
 *              droites, à présenter comme schématique.
 * Champ absent (anciennes données) = relevé.
 */
export type ShapeSource = 'osm' | 'deduit' | 'absent'

export interface LineDirection {
  /** Girouette en français, = trip_headsign du GTFS (= leg.headsign d'OTP). */
  headsign: string
  /** Girouette en arabe quand une source existe (sinon afficher headsign). */
  headsignAr?: string
  /** direction_id du GTFS (0 / 1). */
  directionId?: number
  shapeSource?: ShapeSource
  stops: LineStop[]
  /**
   * @deprecated Plus rempli : les tracés sont dans /data/line-shapes.json,
   * chargés par loadLineShapes() (line-shapes.ts), hors du bundle initial.
   */
  shape?: number[][] // [[lon, lat], ...]
  /** Rail : identifiant du sens dans le GTFS (shape_id), p. ex. 'M1-AIN-0'. */
  patternId?: string
  /**
   * ~ minutes depuis le terminus d'origine, une valeur par arrêt.
   * ESTIMATION (longueur du tracé ÷ vitesse commerciale) : toujours avec « ~ ».
   */
  offsetsMin?: number[]
  /** Premier / dernier départ du terminus d'origine (« HH:MM », heure d'Alger ; dernier ≤ premier = après minuit). */
  firstDeparture?: string
  lastDeparture?: string
  /**
   * Intervalle de ce sens par plage, déduit des départs du GTFS (ce que
   * calcule OTP). Rail : branche du M1 = une rame sur deux. Bus : fréquences
   * MODÉLISÉES (l'ETUSA n'en publie pas) — jamais « officielles ».
   */
  headways?: HeadwayWindow[]
}

export interface TransitLine {
  id: string
  mode: LineMode
  shortName: string // 'M1', 'T1', '100'
  longName: string
  /** Nom en arabe (rail : construit depuis les noms de stations sourcés). */
  longNameAr?: string
  color: string
  /** Texte sur `color` conforme WCAG AA (bus : noir sur ambre, 6,6:1). */
  textColor?: string
  fare?: string // '50 DZD'
  /** Tarif en dinars (fare_attributes.txt). */
  fareDzd?: number
  /** Premier départ / dernier départ de la ligne (heure d'Alger ; last ≤ first = après minuit). */
  hours?: { first: string; last: string }
  /** Intervalle sur le tronçon le plus desservi (tronc commun du M1, tout le T1, sens 0 d'un bus). */
  headways?: HeadwayWindow[]
  /** Provenance de l'amplitude et du tarif (bus : « ETUSA (… relevé 2024) »). */
  source?: string
  /**
   * Temps de parcours et heures de passage ESTIMÉS (vitesse commerciale ×
   * longueur du tracé) : toujours avec « ~ » et la note data_busEstimateNote
   * (bus) ou data_railEstimateNote (rail).
   */
  timesEstimated?: boolean
  /**
   * Un seul sens relevé dans les données (le retour n'est pas dans le GTFS) :
   * l'annoncer (data_oneDirection), ne jamais écrire « A → B » dans le titre.
   */
  oneDirection?: boolean
  directions: LineDirection[]
}

// Amplitude et intervalles : ceux du GTFS, PAR LIGNE (railServiceForLine,
// même source que les départs chargés dans OTP) — le tram ferme à 22:20, pas
// à 23:00 comme le métro. Tarif unique 50 DA (fare_attributes.txt
// metro_flat / tram_flat).
const RAIL_FARE = '50 DZD'

function railDirection(route: RailRoute): LineDirection {
  const terminus = route.stations[route.stations.length - 1]
  return {
    headsign: route.headsign,
    headsignAr: terminus?.nameAr,
    directionId: route.directionId,
    shapeSource: 'osm',
    patternId: route.id,
    stops: route.stations.map((s) => ({ id: s.id, name: s.name, nameAr: s.nameAr, lat: s.lat, lon: s.lon })),
    offsetsMin: route.offsetsSec.map((sec) => Math.round(sec / 60)),
    firstDeparture: route.firstDeparture,
    lastDeparture: route.lastDeparture,
    headways: route.headways,
  }
}

function railLine(
  id: string,
  shortName: string,
  longName: string,
  longNameAr: string,
  color: string,
  mode: LineMode,
): TransitLine {
  return {
    id,
    mode,
    shortName,
    longName,
    longNameAr,
    color,
    fare: RAIL_FARE,
    fareDzd: 50,
    hours: { first: railServiceForLine(id).first, last: railServiceForLine(id).last },
    headways: railServiceForLine(id).trunkHeadways,
    source: railServiceForLine(id).source,
    timesEstimated: true,
    // Ordre des sens = ordre du GTFS : M1 vers El Harrach Centre, retour,
    // vers Aïn Naâdja, retour ; T1 vers Dergana Centre, retour.
    directions: railRoutesForLine(id).map(railDirection),
  }
}

function railTerminus(lineId: string, index: number, locale: Locale): string {
  const route = railRoutesForLine(lineId)[index]
  const station = route?.stations[route.stations.length - 1]
  return station ? getStationName(station, locale) : ''
}

// Libellés construits sur les terminus réels (plus de « Tafourah ↔ Aïn
// Naâdja », qui annonçait un terminus que la liste d'arrêts ne desservait pas).
export const metroLine = railLine(
  'L1-metro', 'M1',
  `Métro Ligne 1 · ${railTerminus('L1-metro', 1, 'fr')} ↔ ${railTerminus('L1-metro', 0, 'fr')} / ${railTerminus('L1-metro', 2, 'fr')}`,
  `مترو الخط 1 · ${railTerminus('L1-metro', 1, 'ar')} ↔ ${railTerminus('L1-metro', 0, 'ar')} / ${railTerminus('L1-metro', 2, 'ar')}`,
  METRO_COLOR, 'metro',
)

export const tramLine = railLine(
  'L1-tram', 'T1',
  `Tramway Ligne 1 · ${railTerminus('L1-tram', 1, 'fr')} ↔ ${railTerminus('L1-tram', 0, 'fr')}`,
  `ترامواي الخط 1 · ${railTerminus('L1-tram', 1, 'ar')} ↔ ${railTerminus('L1-tram', 0, 'ar')}`,
  TRAM_COLOR, 'tram',
)

/**
 * Sens d'une ligne d'après le trip_id d'OTP (« alger:ETUSA-45-dir1-0610 » →
 * direction_id 1), plus sûr que la girouette, qui peut changer de libellé ou
 * de langue. -1 si le trip_id ne suit pas ce format (rail, anciennes données).
 */
export function directionIndexByTripId(line: TransitLine, tripId?: string): number {
  const m = tripId ? /-dir(\d+)-\d{4}$/.exec(tripId) : null
  if (!m) return -1
  return line.directions.findIndex((d) => d.directionId === Number(m[1]))
}

function busDirectionFor(
  routeShortName?: string,
  headsign?: string,
  tripId?: string,
): { line: TransitLine; direction?: LineDirection } | null {
  if (!routeShortName) return null
  const line = busLines.find((l) => l.shortName === routeShortName)
  if (!line) return null
  const byTrip = directionIndexByTripId(line, tripId)
  if (byTrip >= 0) return { line, direction: line.directions[byTrip] }
  return { line, direction: headsign ? line.directions.find((d) => d.headsign === headsign) : undefined }
}

/**
 * Vrai si le tronçon bus (ligne + destination) roule sur un tracé DÉDUIT.
 * Le headsign d'OTP vient du même champ GTFS que celui des directions : la
 * correspondance est exacte. Si aucune direction ne matche (renommage,
 * variante, graphe OTP pas encore reconstruit), on répond vrai dès qu'UNE
 * direction de la ligne est déduite — mieux vaut annoncer une estimation de
 * trop que de la taire.
 */
export function isDeducedShape(routeShortName?: string, headsign?: string, tripId?: string): boolean {
  const hit = busDirectionFor(routeShortName, headsign, tripId)
  if (!hit) return false
  if (hit.direction) return hit.direction.shapeSource === 'deduit'
  return hit.line.directions.some((d) => d.shapeSource === 'deduit')
}

/**
 * Tronçon bus sur un sens SANS tracé relevé (shapeSource 'absent') : OTP
 * relie alors les arrêts en lignes droites, à présenter comme schématique
 * (« tracé non relevé »), quel que soit l'écart entre arrêts. undefined si
 * la ligne ou le sens est inconnu (garder alors le test géométrique).
 */
export function isUnmappedShape(routeShortName?: string, headsign?: string, tripId?: string): boolean | undefined {
  const hit = busDirectionFor(routeShortName, headsign, tripId)
  if (!hit?.direction) return undefined
  return hit.direction.shapeSource === 'absent'
}

/** Girouette dans la langue de l'interface (arabe seulement s'il est sourcé). */
export function directionHeadsign(direction: LineDirection, locale: Locale = 'fr'): string {
  return locale === 'ar' && direction.headsignAr ? direction.headsignAr : direction.headsign
}

/**
 * Girouette d'un tronçon OTP (routeShortName + headsign français du GTFS)
 * dans la langue de l'interface ; le headsign tel quel si rien ne correspond.
 */
export function legHeadsignLabel(routeShortName: string | undefined, headsign: string | undefined, locale: Locale = 'fr'): string {
  if (!headsign) return ''
  if (locale !== 'ar' || !routeShortName) return headsign
  const line = allLines.find((l) => l.shortName === routeShortName)
  const direction = line?.directions.find((d) => d.headsign === headsign)
  return direction ? directionHeadsign(direction, locale) : headsign
}

/** « ~ toutes les N min » — libellé de fréquence, jamais un temps d'attente. */
export function nextPassLabel(headwayMin: number, locale: Locale): string {
  return translations[locale].data_everyMin.replace('{n}', String(headwayMin))
}

export const busLines: TransitLine[] = (generatedBusLines as unknown as TransitLine[]).map((l) => ({
  ...l,
  hours: l.hours ?? undefined,
}))

// Ordre du catalogue : métro, tram, puis bus (par numéro croissant).
export const allLines: TransitLine[] = [metroLine, tramLine, ...busLines]

export const linesByMode: Record<LineMode, TransitLine[]> = {
  metro: allLines.filter((l) => l.mode === 'metro'),
  tram: allLines.filter((l) => l.mode === 'tram'),
  bus: allLines.filter((l) => l.mode === 'bus'),
}

// « Métro Ligne 1 · Place des Martyrs ↔ … » → « Place des Martyrs ↔ … »,
// « Bus 10 Place 1er mai ↔ … » → « Place 1er mai ↔ … »
// (le badge porte déjà le numéro, le nom reste pur — planche 1c/1j).
// En arabe, le nom arabe quand il existe (rail), sinon le nom d'origine.
export function lineDisplayName(line: TransitLine, locale: Locale = 'fr'): string {
  const longName = locale === 'ar' && line.longNameAr ? line.longNameAr : line.longName
  const afterDot = longName.split('·').slice(1).join('·').trim()
  if (afterDot) return afterDot
  return longName.replace(/^(Métro|Tramway|Bus)\s+\S+\s+/i, '')
}

export function lineModeLabel(mode: LineMode, locale: Locale = 'fr'): string {
  const labels: Record<LineMode, Record<string, string>> = {
    metro: { fr: 'Métro', ar: 'مترو', en: 'Metro' },
    tram: { fr: 'Tramway', ar: 'ترامواي', en: 'Tram' },
    bus: { fr: 'Bus', ar: 'حافلة', en: 'Bus' },
  }
  return labels[mode][locale] ?? labels[mode].fr
}

/**
 * Libellé d'onglet d'un sens : « vers X », complété de « depuis Y » quand un
 * autre sens de la ligne a le même terminus (M1 : deux sens vers Place des
 * Martyrs, depuis El Harrach Centre ou depuis Aïn Naâdja).
 */
export function directionOriginLabel(line: TransitLine, index: number, locale: Locale = 'fr'): string | null {
  const direction = line.directions[index]
  if (!direction) return null
  const twins = line.directions.filter((d) => d.headsign === direction.headsign)
  if (twins.length < 2) return null
  const origin = direction.stops[0]
  if (!origin) return null
  return translations[locale].data_fromStop.replace('{name}', lineStopName(origin, locale))
}

const R = 6371000
function haversine(aLat: number, aLon: number, bLat: number, bLon: number): number {
  const toRad = (d: number) => (d * Math.PI) / 180
  const dLat = toRad(bLat - aLat)
  const dLon = toRad(bLon - aLon)
  const lat1 = toRad(aLat)
  const lat2 = toRad(bLat)
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(h))
}

export interface NearbyLine {
  line: TransitLine
  direction: LineDirection
  stop: LineStop
  distanceM: number
}

// Lignes dont un arrêt est à moins de `radiusM` de (lat, lon), triées par distance.
// Une seule entrée par (ligne, direction) : l'arrêt le plus proche.
export function nearbyLines(lat: number, lon: number, radiusM = 800): NearbyLine[] {
  const found: NearbyLine[] = []
  for (const line of allLines) {
    for (const direction of line.directions) {
      let best: { stop: LineStop; d: number } | null = null
      for (const stop of direction.stops) {
        const d = haversine(lat, lon, stop.lat, stop.lon)
        if (!best || d < best.d) best = { stop, d }
      }
      if (best && best.d <= radiusM) {
        found.push({ line, direction, stop: best.stop, distanceM: Math.round(best.d) })
      }
    }
  }
  return found.sort((a, b) => a.distanceM - b.distanceM)
}

export function lineStopName(stop: LineStop, locale: Locale = 'fr'): string {
  return locale === 'ar' && stop.nameAr ? stop.nameAr : stop.name
}

let stopsById: Map<string, LineStop> | null = null

/**
 * Arrêt (bus ou rail) par stop_id du GTFS — accepte « alger:B123 » tel
 * qu'OTP le renvoie. Sert à localiser les noms des tronçons OTP (interrogé
 * en français) : nom arabe seulement s'il est sourcé (OSM name:ar).
 */
export function stopById(stopId?: string): LineStop | undefined {
  if (!stopId) return undefined
  if (!stopsById) {
    stopsById = new Map()
    for (const line of allLines) {
      for (const direction of line.directions) {
        for (const stop of direction.stops) if (stop.id && !stopsById.has(stop.id)) stopsById.set(stop.id, stop)
      }
    }
  }
  return stopsById.get(stopId.includes(':') ? stopId.slice(stopId.lastIndexOf(':') + 1) : stopId)
}

/** Tarif affiché (« 30 DA », « 30 دج », « 30 DZD ») ; '' si inconnu. */
export function lineFareLabel(line: TransitLine, locale: Locale = 'fr'): string {
  const n = line.fareDzd ?? (line.fare ? parseInt(line.fare, 10) : NaN)
  if (!Number.isFinite(n)) return ''
  return translations[locale].data_fare.replace('{n}', String(n))
}

// ── Recherche dans le catalogue (numéro, nom de ligne, arrêt — FR/AR) ──────

/** Minuscules, sans accents ni diacritiques arabes, espaces normalisés. */
export function normalizeSearchTerm(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[\u064b-\u065f\u0670]/g, '') // tachkil
    .replace(/[أإآ]/g, 'ا')
    .replace(/[’'`-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

export interface LineSearchHit {
  line: TransitLine
  /** 0 numéro exact, 1 début de numéro, 2 nom de ligne, 3 arrêt desservi. */
  rank: 0 | 1 | 2 | 3
  /** Arrêt trouvé (rang 3) : afficher SON nom (« passe à … »), jamais la saisie. */
  stop?: LineStop
}

/**
 * Lignes correspondant à une saisie, triées par pertinence puis dans l'ordre
 * du catalogue. Numéro : égalité ou préfixe (« 1 » ne trouve pas la 12 par
 * « contient »). Arrêts : tous les sens, nom français et arabe. Les arrêts
 * de bus n'ont un nom arabe que s'il est relevé dans OSM : une recherche en
 * arabe sans résultat ne prouve pas qu'aucune ligne ne passe.
 */
export function searchLines(query: string, locale: Locale = 'fr'): LineSearchHit[] {
  const q = normalizeSearchTerm(query)
  if (!q) return []
  const hits: LineSearchHit[] = []
  for (const line of allLines) {
    const num = normalizeSearchTerm(line.shortName)
    if (num === q) {
      hits.push({ line, rank: 0 })
      continue
    }
    if (/^[0-9a-z]{1,4}$/.test(q) && num.startsWith(q)) {
      hits.push({ line, rank: 1 })
      continue
    }
    const names = [lineDisplayName(line, 'fr'), lineDisplayName(line, locale), line.longNameAr ?? '']
    if (q.length >= 2 && names.some((n) => n && normalizeSearchTerm(n).includes(q))) {
      hits.push({ line, rank: 2 })
      continue
    }
    if (q.length < 2) continue
    let found: LineStop | undefined
    for (const direction of line.directions) {
      found = direction.stops.find((st) =>
        [st.name, st.nameAr].some((n) => n && normalizeSearchTerm(n).includes(q)))
      if (found) break
    }
    if (found) hits.push({ line, rank: 3, stop: found })
  }
  return hits.sort((a, b) => a.rank - b.rank)
}

/**
 * Indices des sens où l'on peut MONTER à cet arrêt (terminus d'arrivée
 * exclu). Rapprochement par identifiant de station (rail), à défaut par nom.
 * Sert aux fiches de station : à Gué de Constantine, il n'y a pas de rame
 * « vers El Harrach Centre ».
 */
export function directionsServingStop(line: TransitLine, stop: { id?: string; name: string }): number[] {
  const out: number[] = []
  line.directions.forEach((direction, index) => {
    const i = direction.stops.findIndex((s) => (stop.id && s.id ? s.id === stop.id : s.name === stop.name))
    if (i >= 0 && i < direction.stops.length - 1) out.push(index)
  })
  return out
}

/**
 * Sens correspondant à un tronçon OTP (headsign = terminus d'arrivée du
 * GTFS). Avec `fromStop`, départage les deux sens M1 « Place des Martyrs »
 * (depuis El Harrach Centre ou depuis Aïn Naâdja). -1 si aucun ne convient.
 */
export function findDirectionIndex(
  line: TransitLine,
  headsign: string | undefined,
  fromStop?: { id?: string; name: string },
): number {
  if (!headsign) return -1
  const candidates = line.directions
    .map((direction, index) => ({ direction, index }))
    .filter(({ direction }) => direction.headsign === headsign)
  if (!fromStop || candidates.length < 2) return candidates[0]?.index ?? -1
  const serving = directionsServingStop(line, fromStop)
  return candidates.find(({ index }) => serving.includes(index))?.index ?? candidates[0].index
}

// ── État de service (calculé depuis les amplitudes du réseau, à l'heure
//    d'Alger quel que soit le fuseau du téléphone — aucun temps réel
//    n'existe à Alger) ────────────────────────────────────────────────────

function minutesOf(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number)
  return h * 60 + m
}

function inRange(mins: number, first: number, last: number): boolean {
  // Plage qui passe minuit (dernier départ 00:20) : `last` déjà > 24 h.
  return (mins >= first && mins <= last) || (mins + 24 * 60 >= first && mins + 24 * 60 <= last)
}

/**
 * Ligne en service à cet instant (heure d'Alger, quel que soit le fuseau du
 * téléphone ; passage de minuit géré). `offsetMin` : temps estimé depuis le
 * terminus d'origine, pour un arrêt intermédiaire (le dernier passage y est
 * plus tardif que le dernier départ).
 */
export function isInService(line: TransitLine, now: Date = new Date(), offsetMin = 0): boolean {
  if (!line.hours) return true
  const mins = algiersParts(now.getTime()).minutesOfDay
  const first = minutesOf(line.hours.first)
  let last = minutesOf(line.hours.last)
  if (last <= first) last += 24 * 60 // dernier départ après minuit (ex. 00:10)
  return inRange(mins, first, last + offsetMin)
}

/**
 * Un sens est en service à cet instant (heure d'Alger) : entre son premier
 * et son dernier départ du terminus, décalés du temps estimé jusqu'à l'arrêt.
 */
export function isDirectionInService(direction: LineDirection, now: Date = new Date(), offsetMin = 0): boolean | null {
  if (!direction.firstDeparture || !direction.lastDeparture) return null
  const mins = algiersParts(now.getTime()).minutesOfDay
  const first = minutesOf(direction.firstDeparture) + offsetMin
  let last = minutesOf(direction.lastDeparture)
  if (last < minutesOf(direction.firstDeparture)) last += 24 * 60
  return inRange(mins, first, last + offsetMin)
}

function headwayInWindows(windows: HeadwayWindow[] | undefined, mins: number): number | null {
  if (!windows?.length) return null
  for (const t of [mins, mins + 24 * 60]) {
    const hit = windows.find((w) => {
      const start = minutesOf(w.start)
      let end = minutesOf(w.end)
      if (end <= start) end += 24 * 60 // plage qui passe minuit
      return t >= start && t < end
    })
    if (hit) return hit.min
  }
  return null
}

/**
 * Intervalle estimé (min) entre deux passages, ou null hors service / sans
 * donnée. Tous modes : intervalles déduits des départs du GTFS — les mêmes
 * que ceux du calculateur —, à l'heure d'Alger ; avec `directionIndex`,
 * celui de ce sens (une branche du M1 : une rame sur deux). Bus : fréquence
 * MODÉLISÉE, à présenter avec « ~ » et data_busEstimateNote.
 */
export function headwayAt(line: TransitLine, now: Date = new Date(), directionIndex?: number): number | null {
  const mins = algiersParts(now.getTime()).minutesOfDay
  const windows = directionIndex !== undefined
    ? line.directions[directionIndex]?.headways ?? line.headways
    : line.headways
  return headwayInWindows(windows, mins)
}

/**
 * Premier et dernier passage ESTIMÉS à un arrêt d'un sens (« HH:MM », heure
 * d'Alger) : départs du terminus + temps estimé. À afficher avec « ~ »
 * (clé data_stopPasses) ; null si l'arrêt ou les départs sont inconnus.
 */
export function stopPassWindow(direction: LineDirection, stopIndex: number): { first: string; last: string } | null {
  const offset = direction.offsetsMin?.[stopIndex]
  if (offset === undefined || !direction.firstDeparture || !direction.lastDeparture) return null
  const fmt = (m: number) => {
    const t = ((m % 1440) + 1440) % 1440
    return `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`
  }
  return {
    first: fmt(minutesOf(direction.firstDeparture) + offset),
    last: fmt(minutesOf(direction.lastDeparture) + offset),
  }
}

// ── Périodes spéciales ──────────────────────────────────────────────────────
// Pendant le Ramadan, métro et tram roulent plus tard le soir (dernier départ
// 01:00 puis 01:30 en 2026, d'après algerie360 ; « de 7 h à 1 h » en 2022,
// d'après algerie-eco), jusqu'au 2e jour de l'Aïd El Fitr. Ces horaires ne
// sont PAS dans le GTFS : l'app doit le dire. Fenêtres = estimation
// astronomique du mois, élargie d'un jour avant et jusqu'au 2e jour de l'Aïd
// (les dates officielles dépendent de l'observation du croissant).
const RAMADAN_WINDOWS: { from: string; to: string }[] = [
  { from: '2027-02-06', to: '2027-03-12' }, // 1448 H
  { from: '2028-01-26', to: '2028-03-01' }, // 1449 H
  { from: '2029-01-14', to: '2029-02-18' }, // 1450 H
]

function inRamadanWindow(now: Date): boolean {
  const p = algiersParts(now.getTime())
  const today = `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`
  return RAMADAN_WINDOWS.some((w) => today >= w.from && today <= w.to)
}

/**
 * Clé de l'avertissement à afficher près des horaires métro/tram pendant une
 * période spéciale non intégrée au GTFS, sinon null.
 */
export function railSpecialPeriodNotice(now: Date = new Date()): 'data_ramadanRailNotice' | null {
  return inRamadanWindow(now) ? 'data_ramadanRailNotice' : null
}

/**
 * Avertissement de période spéciale pour une ligne de n'importe quel mode
 * (Ramadan : horaires non intégrés ; aucun horaire n'est inventé), sinon null.
 */
export function specialPeriodNotice(
  line: TransitLine,
  now: Date = new Date(),
): 'data_ramadanRailNotice' | 'data_ramadanBusNotice' | null {
  if (!inRamadanWindow(now)) return null
  return line.mode === 'bus' ? 'data_ramadanBusNotice' : 'data_ramadanRailNotice'
}

/**
 * Phrase « Seul le sens A → B est relevé… » pour une ligne à sens unique
 * dans les données (oneDirection), avec les noms d'arrêts localisés ; null
 * sinon. Ne jamais la construire avec la girouette.
 */
export function oneDirectionNotice(line: TransitLine, locale: Locale = 'fr'): string | null {
  if (!line.oneDirection) return null
  const stops = line.directions[0]?.stops ?? []
  if (stops.length < 2) return null
  return translations[locale].data_oneDirection
    .replace('{from}', lineStopName(stops[0], locale))
    .replace('{to}', lineStopName(stops[stops.length - 1], locale))
}

/** Clé de la note de provenance du tracé d'un sens, null s'il est relevé. */
export function shapeSourceNotice(direction: LineDirection): 'data_shapeAbsent' | 'data_shapeDeduced' | null {
  if (direction.shapeSource === 'absent') return 'data_shapeAbsent'
  if (direction.shapeSource === 'deduit') return 'data_shapeDeduced'
  return null
}

/** Clé de la note d'estimation à afficher sous les horaires d'une ligne. */
export function lineEstimateNoteKey(line: TransitLine): 'data_busEstimateNote' | 'data_railEstimateNote' {
  return line.mode === 'bus' ? 'data_busEstimateNote' : 'data_railEstimateNote'
}

export { getStationName }

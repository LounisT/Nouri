// Badges de ligne posés sur la carte (spec carte v2).
//
// Un arrêt n'est plus un point anonyme : c'est le badge de sa ligne. On ne peut
// donc jamais confondre un arrêt avec la position de l'usager, qui reste le seul
// disque bleu plein de la carte.

import { allStations, railRoutes, METRO_COLOR, TRAM_COLOR, getStationName } from './stations'
import { busLines, metroLine, tramLine, type TransitLine } from './lines'
import type { Locale } from './i18n'

export type BadgeMode = 'metro' | 'tram' | 'bus'

/** Une direction d'une ligne qui dessert réellement l'arrêt. */
export interface BadgeServe {
  lineId: string
  /** Numéro court (« 88 », « M1 »). */
  line: string
  /** Indice dans line.directions. */
  dir: number
  /** L'arrêt est le dernier de cette direction : on y descend, on n'y monte pas. */
  isLast: boolean
  /** Arrêt physique du groupe (indice dans `members`) où passe cette direction. */
  member: number
}

export interface StopBadge {
  id: string
  lon: number
  lat: number
  /** Texte du badge : « M1 », « T1 », « 12 », « 15 · 16 », « 15 · 16 +2 ». */
  label: string
  color: string
  /** Couleur du texte, choisie pour le contraste (WCAG) sur `color`. */
  textColor: string
  mode: BadgeMode
  /** Nom de l'arrêt, pour la feuille basse et l'aria-label (dans la langue demandée). */
  name: string
  /**
   * Nom arabe sourcé par la donnée (generated-lines.json), arrêts de bus
   * seulement. Absent = aucun nom arabe connu : on garde le nom latin plutôt
   * que d'en inventer un.
   */
  nameAr?: string
  /** Lignes desservant l'arrêt (numéros courts). */
  lines: string[]
  /** Terminus ou correspondance : reste visible quand on dézoome. */
  major: boolean
  /**
   * Identifiant de la station métro/tram sous-jacente. La feuille basse
   * recherche la station par cet id : le `id` du badge, lui, doit rester unique
   * par marqueur et ne peut donc pas servir de clé métier.
   */
  stationId?: string
  /** Directions réellement desservies (une rangée de fiche par direction). */
  serves: BadgeServe[]
  /**
   * Arrêts physiques regroupés sous ce badge (même nom, moins de 40 m : les
   * deux côtés d'une rue). Le badge est posé sur le premier, jamais sur un
   * barycentre — aucune position inventée.
   */
  members: { lat: number; lon: number }[]
}

const BUS_COLOR = '#D97706'

// Regroupement des arrêts homonymes : la médiane observée entre les deux côtés
// d'une rue est de 32 m. Au-delà de 40 m on ne fusionne jamais (les pôles comme
// 1er Mai gardent leurs arrêts distincts). En deçà de 12 m, c'est le même
// poteau, quel que soit le nom saisi par ligne.
const SAME_NAME_RADIUS_M = 40
const SAME_POINT_RADIUS_M = 12

function metersBetween(aLat: number, aLon: number, bLat: number, bLon: number): number {
  const dLat = (bLat - aLat) * 111320
  const dLon = (bLon - aLon) * 111320 * Math.cos((aLat * Math.PI) / 180)
  return Math.hypot(dLat, dLon)
}

/** Nom normalisé : sans accents, ponctuation ni casse (« Hôpital Mustapha. » = « hopital mustapha »). */
export function normalizeStopName(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^0-9a-z\u0600-\u06ff]+/g, ' ')
    .trim()
}

// ── Contraste ────────────────────────────────────────────────────────────────

function luminance(hex: string): number {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim())
  if (!m) return 0
  const n = parseInt(m[1], 16)
  const channel = (c: number) => {
    const v = c / 255
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * channel((n >> 16) & 255) + 0.7152 * channel((n >> 8) & 255) + 0.0722 * channel(n & 255)
}

export function contrastRatio(a: string, b: string): number {
  const la = luminance(a)
  const lb = luminance(b)
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05)
}

/**
 * Texte lisible sur un fond de ligne. Blanc sur l'ambre bus #D97706 = 3,2:1,
 * insuffisant pour un texte de 10 à 13 px ; encre #111827 = 5,6:1. Les
 * couleurs officielles des fonds ne changent pas.
 */
export function readableTextColor(background: string): string {
  return contrastRatio(background, '#FFFFFF') >= contrastRatio(background, '#111827') ? '#FFFFFF' : '#111827'
}

// ── Construction ────────────────────────────────────────────────────────────

interface Group {
  badge: StopBadge
  norm: string
}

function badgeLabel(lines: string[]): string {
  const shown = lines.slice(0, 2).join(' · ')
  // Le nombre de lignes masquées est dit, jamais tu : « 15 · 16 +2 ».
  return lines.length > 2 ? `${shown} +${lines.length - 2}` : shown
}

/** Regroupe les arrêts de bus par position et par nom (un badge, N lignes). */
function buildBusBadges(): StopBadge[] {
  const groups: Group[] = []
  // Grille ~110 m : on ne compare un arrêt qu'aux groupes des cellules voisines.
  const grid = new Map<string, Group[]>()
  const cell = (lat: number, lon: number) => `${Math.floor(lat * 1000)}:${Math.floor(lon * 1000)}`
  const neighbours = (lat: number, lon: number): Group[] => {
    const out: Group[] = []
    const cy = Math.floor(lat * 1000)
    const cx = Math.floor(lon * 1000)
    for (let dy = -1; dy <= 1; dy += 1) {
      for (let dx = -1; dx <= 1; dx += 1) out.push(...(grid.get(`${cy + dy}:${cx + dx}`) ?? []))
    }
    return out
  }

  for (const line of busLines) {
    line.directions.forEach((direction, dir) => {
      direction.stops.forEach((stop, stopIndex) => {
        const norm = normalizeStopName(stop.name)
        const isLast = stopIndex === direction.stops.length - 1
        const isTerminus = stopIndex === 0 || isLast

        let target: Group | null = null
        let targetDistance = Infinity
        for (const g of neighbours(stop.lat, stop.lon)) {
          const d = metersBetween(g.badge.lat, g.badge.lon, stop.lat, stop.lon)
          const ok = d <= SAME_POINT_RADIUS_M || (g.norm === norm && d <= SAME_NAME_RADIUS_M)
          if (ok && d < targetDistance) {
            target = g
            targetDistance = d
          }
        }

        if (!target) {
          const key = `${stop.lat.toFixed(5)},${stop.lon.toFixed(5)}`
          target = {
            norm,
            badge: {
              id: `bus-${key}`,
              lon: stop.lon,
              lat: stop.lat,
              label: line.shortName,
              color: line.color || BUS_COLOR,
              textColor: '#111827',
              mode: 'bus',
              name: stop.name,
              nameAr: stop.nameAr,
              lines: [],
              major: false,
              serves: [],
              members: [{ lat: stop.lat, lon: stop.lon }],
            },
          }
          groups.push(target)
          const k = cell(stop.lat, stop.lon)
          grid.set(k, [...(grid.get(k) ?? []), target])
        }

        const badge = target.badge
        // Nom arabe : seulement d'un arrêt qui porte le même nom latin que le
        // badge. Un poteau partagé sous un autre nom (rayon de 12 m) donnerait
        // une traduction d'un autre nom.
        if (!badge.nameAr && stop.nameAr && norm === target.norm) badge.nameAr = stop.nameAr
        // Arrêt physique du groupe : le membre existant à moins de 12 m, sinon
        // un nouveau membre (l'autre côté de la rue).
        let member = badge.members.findIndex((m) => metersBetween(m.lat, m.lon, stop.lat, stop.lon) <= SAME_POINT_RADIUS_M)
        if (member < 0) {
          badge.members.push({ lat: stop.lat, lon: stop.lon })
          member = badge.members.length - 1
        }
        if (!badge.lines.includes(line.shortName)) badge.lines.push(line.shortName)
        badge.major = badge.major || isTerminus
        const existing = badge.serves.find((s) => s.lineId === line.id && s.dir === dir)
        // Une boucle peut passer deux fois au même arrêt : il n'est « dernier »
        // que si aucun des passages n'est un passage où l'on monte.
        if (existing) existing.isLast = existing.isLast && isLast
        else badge.serves.push({ lineId: line.id, line: line.shortName, dir, isLast, member })
      })
    })
  }

  const badges = groups.map((g) => g.badge)
  badges.forEach((badge) => {
    badge.lines.sort((a, b) => a.localeCompare(b, 'fr', { numeric: true }))
    badge.label = badgeLabel(badge.lines)
    badge.major = badge.major || badge.lines.length >= 3
    badge.textColor = readableTextColor(badge.color)
  })
  return badges
}

/** Directions d'une ligne ferrée qui passent par la station (à 30 m près). */
function railServes(line: TransitLine, lat: number, lon: number): BadgeServe[] {
  const serves: BadgeServe[] = []
  line.directions.forEach((direction, dir) => {
    const index = direction.stops.findIndex((s) => metersBetween(s.lat, s.lon, lat, lon) <= 30)
    if (index < 0) return
    serves.push({ lineId: line.id, line: line.shortName, dir, isLast: index === direction.stops.length - 1, member: 0 })
  })
  return serves
}

let busCache: StopBadge[] | null = null
let cache: { locale: Locale; badges: StopBadge[] } | null = null

/** Tous les badges du réseau (métro, tram, bus), mémoïsés par langue. */
export function getStopBadges(locale: Locale): StopBadge[] {
  if (cache && cache.locale === locale) return cache.badges

  // Terminus de chaque sens exploité : repères qui survivent au dézoom. Pas
  // « premier / dernier de la liste » : le M1 a deux branches, et la liste des
  // stations finit par Aïn Naâdja — El Harrach Centre n'était plus un repère.
  const railTermini = new Set(railRoutes.flatMap((r) => [r.stations[0]?.id, r.stations[r.stations.length - 1]?.id]))
  const railBadges: StopBadge[] = allStations.map((station, index) => {
    const isMetro = station.type === 'metro'
    const line = isMetro ? metroLine : tramLine
    const color = isMetro ? METRO_COLOR : TRAM_COLOR
    return {
      id: `rail-${station.id}-${index}`,
      lon: station.lon,
      lat: station.lat,
      label: line.shortName,
      color,
      textColor: readableTextColor(color),
      mode: isMetro ? 'metro' : 'tram',
      name: getStationName(station, locale),
      lines: [line.shortName],
      major: railTermini.has(station.id),
      stationId: station.id,
      serves: railServes(line, station.lat, station.lon),
      members: [{ lat: station.lat, lon: station.lon }],
    }
  })

  if (!busCache) busCache = buildBusBadges()
  // Le regroupement ne dépend pas de la langue : seul le nom affiché change.
  // Les id restent identiques, la sélection survit au changement de langue.
  const busBadges = locale === 'ar' ? busCache.map((b) => (b.nameAr ? { ...b, name: b.nameAr } : b)) : busCache
  const badges = [...railBadges, ...busBadges]
  cache = { locale, badges }
  return badges
}

// ── Rangées de la fiche d'arrêt ──────────────────────────────────────────────

export interface BadgeDirectionRow {
  lineId: string
  line: string
  dir: number
  color: string
  textColor: string
  /**
   * Terminus de la direction qui passe RÉELLEMENT ici (dernier arrêt, dans la
   * langue demandée) ; null = la ligne ne fait qu'arriver à cet arrêt.
   */
  towards: string | null
  /** Arrêt physique du groupe (indice dans badge.members). */
  member: number
}

function findLine(lineId: string): TransitLine | undefined {
  if (lineId === metroLine.id) return metroLine
  if (lineId === tramLine.id) return tramLine
  return busLines.find((l) => l.id === lineId)
}

function stopLabel(stop: { name: string; nameAr?: string }, locale: Locale): string {
  return locale === 'ar' && stop.nameAr ? stop.nameAr : stop.name
}

/**
 * Destination d'une direction, telle que l'usager la cherche : la girouette
 * (headsign GTFS) quand elle est exploitable, sinon le nom du dernier arrêt.
 * Repli sur le dernier arrêt quand le headsign est vide, mal formé (« 1er Mai
 * => Bouzareah ») ou en arabe dans le champ français (12, 45, 58, 99, 100…) :
 * le même fait est alors affiché dans les trois langues.
 */
export function directionDestination(line: TransitLine, dir: number, locale: Locale): string {
  const direction = line.directions[dir]
  if (!direction) return ''
  const terminus = direction.stops[direction.stops.length - 1]
  const terminusName = terminus ? stopLabel(terminus, locale) : ''
  // Girouette arabe sourcée par la donnée : prioritaire en arabe.
  if (locale === 'ar' && direction.headsignAr) return direction.headsignAr
  if (line.mode !== 'bus') return terminusName || direction.headsign
  const headsign = (direction.headsign ?? '').trim()
  if (!headsign || /=>|->|→/.test(headsign) || /[؀-ۿ]/.test(headsign)) return terminusName || headsign
  return headsign
}

/**
 * Une rangée par direction RÉELLEMENT desservie à cet arrêt. Avant, la fiche
 * affichait toujours la destination de la direction 0 (« 701 vers
 * Chevalley » à un arrêt où seul le sens Zéralda passe : 347 rangées fausses).
 * Deux directions qui aboutissent à la même destination ne donnent qu'une
 * rangée. Une ligne qui ne fait qu'ARRIVER ici garde une rangée « terminus » :
 * la taire laisserait croire qu'elle ne passe pas.
 */
export function badgeDirectionRows(badge: StopBadge, locale: Locale): BadgeDirectionRow[] {
  const rows: BadgeDirectionRow[] = []
  const seen = new Set<string>()
  const boardingLines = new Set<string>()
  for (const serve of badge.serves) {
    if (serve.isLast) continue
    const line = findLine(serve.lineId)
    if (!line) continue
    const towards = directionDestination(line, serve.dir, locale)
    if (!towards) continue
    const key = `${line.id}|${normalizeStopName(towards)}`
    if (seen.has(key)) continue
    seen.add(key)
    boardingLines.add(line.id)
    rows.push({ lineId: line.id, line: line.shortName, dir: serve.dir, color: line.color || BUS_COLOR, textColor: readableTextColor(line.color || BUS_COLOR), towards, member: serve.member })
  }
  for (const serve of badge.serves) {
    if (!serve.isLast || boardingLines.has(serve.lineId) || seen.has(`${serve.lineId}|arrival`)) continue
    const line = findLine(serve.lineId)
    if (!line) continue
    seen.add(`${serve.lineId}|arrival`)
    rows.push({ lineId: line.id, line: line.shortName, dir: serve.dir, color: line.color || BUS_COLOR, textColor: readableTextColor(line.color || BUS_COLOR), towards: null, member: serve.member })
  }
  return rows.sort((a, b) => a.line.localeCompare(b.line, 'fr', { numeric: true }) || a.dir - b.dir)
}

// ── Sélection et collisions ──────────────────────────────────────────────────

export interface BadgeLayoutOptions {
  /** Projection écran (map.project) : active l'anti-chevauchement. */
  project?: (lon: number, lat: number) => { x: number; y: number }
  /** Badge sélectionné : toujours affiché, prioritaire. */
  selectedId?: string | null
  /** Centre de la vue : à priorité égale, le plus proche l'emporte. */
  center?: { lon: number; lat: number }
  /** Filtre métier supplémentaire (bascules de mode, ligne consultée…). */
  filter?: (badge: StopBadge) => boolean
  /** Ignore la hiérarchie par zoom (ligne consultée : tous ses arrêts). */
  allZooms?: boolean
  /** En deçà, aucune pastille hormis la sélectionnée (trajet consulté). */
  minZoom?: number
}

export interface BadgeLayout {
  visible: StopBadge[]
  /** Arrêts de bus dans la vue, réservés à un zoom plus serré. */
  hiddenByZoom: number
  /** Badges écartés parce qu'ils en chevaucheraient un autre. */
  hiddenByCollision: number
}

/** Largeur estimée d'une pastille (Inter 600 10 px ≈ 6,2 px par caractère). */
function badgeBox(badge: StopBadge, selected: boolean): { w: number; h: number; dy: number } {
  const w = Math.max(selected ? 24 : 20, 16 + 6.2 * badge.label.length * (selected ? 1.2 : 1))
  // L'épingle sélectionnée est ancrée en bas (pointe sur la coordonnée).
  return selected ? { w, h: 32, dy: -16 } : { w, h: 18, dy: 0 }
}

/**
 * Badges à afficher pour une vue donnée. La hiérarchie par zoom évite
 * l'empilement : au niveau quartier on montre tout, en dézoomant on ne garde
 * que la structure du réseau — jamais de clusters chiffrés. Avec `project`,
 * un badge qui en chevaucherait un plus prioritaire est écarté (sélectionné,
 * puis rail, puis pôles, puis arrêts, puis proximité du centre).
 */
export function layoutBadges(
  badges: StopBadge[],
  bounds: { west: number; south: number; east: number; north: number },
  zoom: number,
  options: BadgeLayoutOptions = {},
  limit = 90,
): BadgeLayout {
  const { project, selectedId, center, filter, allZooms, minZoom } = options
  const inView = badges.filter((b) =>
    (b.id === selectedId) || (
      b.lon >= bounds.west && b.lon <= bounds.east &&
      b.lat >= bounds.south && b.lat <= bounds.north &&
      (!filter || filter(b))
    ),
  )

  let hiddenByZoom = 0
  const eligible = inView.filter((b) => {
    if (b.id === selectedId) return true
    if (minZoom !== undefined && zoom < minZoom) return false
    if (allZooms || b.mode !== 'bus') return true
    const ok = zoom >= 15 || (zoom >= 13 && b.major)
    if (!ok) hiddenByZoom += 1
    return ok
  })

  const priority = (b: StopBadge) => (b.id === selectedId ? 0 : b.mode !== 'bus' ? 1 : b.major ? 2 : 3)
  const distance = (b: StopBadge) => (center ? (b.lon - center.lon) ** 2 + (b.lat - center.lat) ** 2 : 0)
  const sorted = [...eligible].sort((a, b) => priority(a) - priority(b) || distance(a) - distance(b))

  if (!project) return { visible: sorted.slice(0, limit), hiddenByZoom, hiddenByCollision: 0 }

  const placed: { x0: number; y0: number; x1: number; y1: number }[] = []
  const visible: StopBadge[] = []
  let hiddenByCollision = 0
  const MARGIN = 2
  for (const badge of sorted) {
    if (visible.length >= limit) break
    const selected = badge.id === selectedId
    const { x, y } = project(badge.lon, badge.lat)
    const { w, h, dy } = badgeBox(badge, selected)
    const rect = { x0: x - w / 2 - MARGIN, y0: y + dy - h / 2 - MARGIN, x1: x + w / 2 + MARGIN, y1: y + dy + h / 2 + MARGIN }
    const overlaps = placed.some((r) => rect.x0 < r.x1 && rect.x1 > r.x0 && rect.y0 < r.y1 && rect.y1 > r.y0)
    if (overlaps && !selected) {
      hiddenByCollision += 1
      continue
    }
    placed.push(rect)
    visible.push(badge)
  }
  return { visible, hiddenByZoom, hiddenByCollision }
}

// ── Élément DOM ──────────────────────────────────────────────────────────────

/** Libellé accessible, dans la langue de l'interface. */
export function badgeAriaLabel(badge: StopBadge, locale: Locale): string {
  return `${badge.name} — ${badgeModeLabel(badge.mode, locale)} ${badge.lines.join(', ')}`
}

/** Élément DOM du badge — état normal ou épingle sélectionnée. */
export function createBadgeElement(badge: StopBadge, selected: boolean, locale: Locale = 'fr', dark = false): HTMLElement {
  const wrapper = document.createElement('div')
  // Surtout PAS de position:relative ici : le style en ligne écrasait le
  // position:absolute de .maplibregl-marker, et chaque pastille restait dans
  // le flux — décalée vers le bas de la hauteur cumulée des précédentes
  // (18 px par pastille déjà posée). L'absolu de MapLibre sert aussi de
  // référence à la zone tactile.
  wrapper.style.cssText = 'display:flex;flex-direction:column;align-items:center;cursor:pointer'

  const pill = document.createElement('div')
  const height = selected ? 22 : 18
  const fontSize = selected ? 12 : 10
  const paddingX = selected ? 7 : 6
  pill.textContent = badge.label
  pill.dir = 'ltr'
  pill.style.cssText = [
    `min-width:${selected ? 24 : 20}px`,
    `height:${height}px`,
    `padding:0 ${paddingX}px`,
    'border-radius:6px',
    `background:${badge.color}`,
    // Liseré de la couleur du fond de carte : la pastille se détache du plan
    // en clair comme en sombre.
    `border:2px solid ${dark ? '#0F141B' : '#fff'}`,
    `font:600 ${fontSize}px Inter,system-ui,sans-serif`,
    `color:${badge.textColor}`,
    'display:inline-flex',
    'align-items:center',
    'justify-content:center',
    'white-space:nowrap',
    'box-sizing:border-box',
    selected ? 'box-shadow:0 1px 2px rgba(16,24,40,.05),0 4px 14px rgba(16,24,40,.07)' : '',
  ].filter(Boolean).join(';')

  // Cible tactile de 44 px centrée sur la pastille, invisible : le badge ne
  // mesure que 18 px de haut. L'élément est hors flux (position absolue),
  // donc la taille du wrapper — sur laquelle MapLibre calcule l'ancrage du
  // marqueur — reste rigoureusement identique.
  const hitArea = document.createElement('div')
  hitArea.style.cssText = [
    'position:absolute',
    `top:${height / 2}px`,
    'left:50%',
    'width:44px',
    'height:44px',
    'transform:translate(-50%,-50%)',
    'background:transparent',
  ].join(';')
  wrapper.appendChild(hitArea)

  wrapper.appendChild(pill)

  // Sélection : pointe triangulaire vers la coordonnée exacte (pas de halo,
  // qui serait confondu avec la position de l'usager).
  if (selected) {
    const tip = document.createElement('div')
    tip.style.cssText = [
      'width:0',
      'height:0',
      'border-left:5px solid transparent',
      'border-right:5px solid transparent',
      `border-top:8px solid ${badge.color}`,
      'margin-top:-1px',
      'filter:drop-shadow(0 2px 2px rgba(16,24,40,.10))',
    ].join(';')
    wrapper.appendChild(tip)
  }

  wrapper.setAttribute('role', 'button')
  wrapper.setAttribute('tabindex', '0')
  // L'information passe aussi par le libellé accessible, jamais par la seule
  // couleur. Conservé en dataset : MapLibre écrase aria-label au moment du
  // addTo, et l'appelant le repose depuis cette copie.
  const label = badgeAriaLabel(badge, locale)
  wrapper.dataset.label = label
  wrapper.dataset.locale = locale
  wrapper.dataset.theme = dark ? 'dark' : 'light'
  wrapper.setAttribute('aria-label', label)
  if (selected) wrapper.setAttribute('aria-pressed', 'true')

  return wrapper
}

/** Nom d'un mode, pour les libellés accessibles et la feuille basse. */
export function badgeModeLabel(mode: BadgeMode, locale: Locale): string {
  const labels: Record<BadgeMode, Record<string, string>> = {
    metro: { fr: 'Station de métro', ar: 'محطة مترو', en: 'Metro station' },
    tram: { fr: 'Station de tramway', ar: 'محطة ترامواي', en: 'Tram stop' },
    bus: { fr: 'Arrêt de bus', ar: 'محطة حافلات', en: 'Bus stop' },
  }
  return labels[mode][locale] ?? labels[mode].fr
}

export type { TransitLine }

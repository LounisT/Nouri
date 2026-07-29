// Badges de ligne posés sur la carte (spec carte v2).
//
// Un arrêt n'est plus un point anonyme : c'est le badge de sa ligne. On ne peut
// donc jamais confondre un arrêt avec la position de l'usager, qui reste le seul
// disque bleu plein de la carte.

import { allStations, METRO_COLOR, TRAM_COLOR, getStationName } from './stations'
import { busLines, type TransitLine } from './lines'
import type { Locale } from './i18n'

export type BadgeMode = 'metro' | 'tram' | 'bus'

export interface StopBadge {
  id: string
  lon: number
  lat: number
  /** Texte du badge : « M1 », « T1 », « 12 », « 15 · 16 ». */
  label: string
  color: string
  mode: BadgeMode
  /** Nom de l'arrêt, pour la feuille basse et l'aria-label. */
  name: string
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
}

const BUS_COLOR = '#D97706'

/** Regroupe les arrêts de bus par position (un arrêt = un badge, N lignes). */
function buildBusBadges(): StopBadge[] {
  const byKey = new Map<string, StopBadge>()

  for (const line of busLines) {
    line.directions.forEach((direction, dirIndex) => {
      direction.stops.forEach((stop, stopIndex) => {
        const key = `${stop.lat.toFixed(4)},${stop.lon.toFixed(4)}`
        const isTerminus = stopIndex === 0 || stopIndex === direction.stops.length - 1
        const existing = byKey.get(key)
        if (existing) {
          if (!existing.lines.includes(line.shortName)) existing.lines.push(line.shortName)
          existing.major = existing.major || isTerminus
          return
        }
        byKey.set(key, {
          id: `bus-${key}-${dirIndex}`,
          lon: stop.lon,
          lat: stop.lat,
          label: line.shortName,
          color: line.color || BUS_COLOR,
          mode: 'bus',
          name: stop.name,
          lines: [line.shortName],
          major: isTerminus,
        })
      })
    })
  }

  // « 15 · 16 » quand plusieurs lignes partagent l'arrêt (2 max affichées).
  const badges = Array.from(byKey.values())
  badges.forEach((badge) => {
    badge.lines.sort((a, b) => a.localeCompare(b, 'fr', { numeric: true }))
    badge.label = badge.lines.slice(0, 2).join(' · ')
    badge.major = badge.major || badge.lines.length >= 3
  })

  return badges
}

let cache: { locale: Locale; badges: StopBadge[] } | null = null

/** Tous les badges du réseau (métro, tram, bus), mémoïsés par langue. */
export function getStopBadges(locale: Locale): StopBadge[] {
  if (cache && cache.locale === locale) return cache.badges

  const railBadges: StopBadge[] = allStations.map((station, index) => {
    const isMetro = station.type === 'metro'
    const line = isMetro ? 'M1' : 'T1'
    // Terminus de chaque ligne : repères qui survivent au dézoom.
    const sameMode = allStations.filter((s) => s.type === station.type)
    const position = sameMode.findIndex((s) => s.id === station.id)
    return {
      id: `rail-${station.id}-${index}`,
      lon: station.lon,
      lat: station.lat,
      label: line,
      color: isMetro ? METRO_COLOR : TRAM_COLOR,
      mode: isMetro ? 'metro' : 'tram',
      name: getStationName(station, locale),
      lines: [line],
      major: position === 0 || position === sameMode.length - 1,
      stationId: station.id,
    }
  })

  const badges = [...railBadges, ...buildBusBadges()]
  cache = { locale, badges }
  return badges
}

/**
 * Badges à afficher pour une vue donnée. La hiérarchie par zoom évite
 * l'empilement : au niveau quartier on montre tout, en dézoomant on ne garde
 * que la structure du réseau — jamais de clusters chiffrés.
 */
export function selectVisibleBadges(
  badges: StopBadge[],
  bounds: { west: number; south: number; east: number; north: number },
  zoom: number,
  limit = 70,
): StopBadge[] {
  const inView = badges.filter((b) =>
    b.lon >= bounds.west && b.lon <= bounds.east &&
    b.lat >= bounds.south && b.lat <= bounds.north,
  )

  let eligible: StopBadge[]
  if (zoom >= 15) {
    eligible = inView                                   // tous modes
  } else if (zoom >= 13) {
    eligible = inView.filter((b) => b.mode !== 'bus' || b.major)  // rail + pôles bus
  } else {
    eligible = inView.filter((b) => b.mode !== 'bus')    // structure seule
  }

  if (eligible.length <= limit) return eligible

  // Au-delà du plafond : le rail et les pôles priment sur les arrêts ordinaires.
  const priority = (b: StopBadge) => (b.mode !== 'bus' ? 0 : b.major ? 1 : 2)
  return [...eligible].sort((a, b) => priority(a) - priority(b)).slice(0, limit)
}

/** Élément DOM du badge — état normal ou épingle sélectionnée. */
export function createBadgeElement(badge: StopBadge, selected: boolean): HTMLElement {
  const wrapper = document.createElement('div')
  wrapper.style.cssText = 'position:relative;display:flex;flex-direction:column;align-items:center;cursor:pointer'

  const pill = document.createElement('div')
  const height = selected ? 22 : 18
  const fontSize = selected ? 12 : 10
  const paddingX = selected ? 7 : 6
  pill.textContent = badge.label
  pill.style.cssText = [
    `min-width:${selected ? 24 : 20}px`,
    `height:${height}px`,
    `padding:0 ${paddingX}px`,
    'border-radius:6px',
    `background:${badge.color}`,
    'border:2px solid #fff',
    `font:600 ${fontSize}px Inter,system-ui,sans-serif`,
    'color:#fff',
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

  const modeName = badge.mode === 'metro' ? 'Métro' : badge.mode === 'tram' ? 'Tramway' : 'Bus'
  wrapper.setAttribute('role', 'button')
  wrapper.setAttribute('tabindex', '0')
  // Le contraste des badges tram/bus est faible : l'information passe aussi
  // par le libellé accessible, jamais par la seule couleur.
  // Conservé en dataset : MapLibre écrase aria-label au moment du addTo, et
  // l'appelant le repose depuis cette copie.
  const label = `${badge.name} — ${modeName} ${badge.lines.join(', ')}`
  wrapper.dataset.label = label
  wrapper.setAttribute('aria-label', label)

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

'use client'

import { useState, useCallback, useEffect } from 'react'
import type { Coordinate } from '@/lib/otp'
import { translations } from '@/lib/i18n'
import type { SavedPlaceKey } from '@/hooks/useSavedPlaces'

/**
 * Extrémité d'une recherche récente. On enregistre ce que l'usager a VOULU,
 * pas un instantané :
 * - « Ma position » ne stocke AUCUNE coordonnée : rejouer le récent repart de
 *   la position actuelle (avant, il repartait de l'endroit d'hier sous le
 *   libellé « Ma position »), et la position réelle n'a rien à faire dans le
 *   stockage du navigateur ;
 * - « Maison » / « Travail » gardent leur clé, traduite à l'affichage ;
 * - un lieu garde son nom tel qu'affiché alors (arrêt, adresse).
 */
export type RecentEndpoint =
  | { kind: 'myLocation' }
  | { kind: 'saved'; key: SavedPlaceKey; lat: number; lon: number }
  | { kind: 'place'; label: string; lat: number; lon: number }

export interface RecentSearch {
  id: string
  from: RecentEndpoint
  to: RecentEndpoint
  timestamp: number
}

/**
 * Marques posées par le formulaire sur les coordonnées qu'il envoie
 * (SearchBar → page.tsx → addSearch) : le type d'extrémité voyage avec la
 * coordonnée sans changer la signature de onSearch ni de addSearch.
 */
export interface CoordinateMarks {
  nouriKind?: 'myLocation'
  savedKey?: SavedPlaceKey
}

export type MarkedCoordinate = Coordinate & CoordinateMarks

const STORAGE_KEY = 'alger-transit-recents'
const MAX_ENTRIES = 5

// Libellés de « Ma position », « Maison », « Travail » dans les trois langues :
// les anciennes entrées stockaient le TEXTE traduit au moment de la recherche.
const labelsOf = (key: 'myLocation' | 'homePlace' | 'workPlace') =>
  new Set([translations.fr[key], translations.ar[key], translations.en[key]])
const MY_LOCATION_LABELS = labelsOf('myLocation')
const HOME_LABELS = labelsOf('homePlace')
const WORK_LABELS = labelsOf('workPlace')

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)

function legacyEndpoint(label: unknown, coord: unknown): RecentEndpoint | null {
  const text = typeof label === 'string' ? label : ''
  if (MY_LOCATION_LABELS.has(text)) return { kind: 'myLocation' }
  const c = coord as { lat?: unknown; lon?: unknown } | null
  if (!c || !isNum(c.lat) || !isNum(c.lon)) return null
  if (HOME_LABELS.has(text)) return { kind: 'saved', key: 'home', lat: c.lat, lon: c.lon }
  if (WORK_LABELS.has(text)) return { kind: 'saved', key: 'work', lat: c.lat, lon: c.lon }
  return { kind: 'place', label: text || `${c.lat.toFixed(4)}, ${c.lon.toFixed(4)}`, lat: c.lat, lon: c.lon }
}

function validEndpoint(value: unknown): RecentEndpoint | null {
  const e = value as Partial<RecentEndpoint> & Record<string, unknown> | null
  if (!e || typeof e !== 'object') return null
  if (e.kind === 'myLocation') return { kind: 'myLocation' }
  if (!isNum(e.lat) || !isNum(e.lon)) return null
  if (e.kind === 'saved' && (e.key === 'home' || e.key === 'work')) return { kind: 'saved', key: e.key, lat: e.lat, lon: e.lon }
  if (e.kind === 'place' && typeof e.label === 'string') return { kind: 'place', label: e.label, lat: e.lat, lon: e.lon }
  return null
}

/** Lit une entrée, au format actuel ou ancien ({fromLabel, fromCoord…}). */
function normalizeEntry(raw: unknown): RecentSearch | null {
  const r = raw as Record<string, unknown> | null
  if (!r || typeof r !== 'object') return null
  const from = 'from' in r ? validEndpoint(r.from) : legacyEndpoint(r.fromLabel, r.fromCoord)
  const to = 'to' in r ? validEndpoint(r.to) : legacyEndpoint(r.toLabel, r.toCoord)
  if (!from || !to) return null
  const timestamp = isNum(r.timestamp) ? r.timestamp : Date.now()
  return { id: typeof r.id === 'string' ? r.id : String(timestamp), from, to, timestamp }
}

/** Entrées stockées (format actuel ou ancien) → format actuel ; le reste est écarté. */
export function normalizeRecentEntries(parsed: unknown): RecentSearch[] {
  if (!Array.isArray(parsed)) return []
  return parsed.map(normalizeEntry).filter((e): e is RecentSearch => e !== null).slice(0, MAX_ENTRIES)
}

function load(): RecentSearch[] {
  if (typeof window === 'undefined') return []
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]')
    const entries = normalizeRecentEntries(parsed)
    // Réécrit au nouveau format : les anciennes coordonnées de « Ma position »
    // disparaissent du stockage.
    if (JSON.stringify(entries) !== JSON.stringify(parsed)) save(entries)
    return entries
  } catch {
    return []
  }
}

function save(searches: RecentSearch[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(searches))
  } catch {
    // localStorage indisponible (mode privé, quota)
  }
}

/** Extrémité à enregistrer pour une coordonnée envoyée par le formulaire. */
export function endpointFromCoordinate(coord: MarkedCoordinate): RecentEndpoint {
  if (coord.nouriKind === 'myLocation') return { kind: 'myLocation' }
  if (coord.savedKey) return { kind: 'saved', key: coord.savedKey, lat: coord.lat, lon: coord.lon }
  // Ancien appelant sans marque : on reconnaît encore « Ma position » à son texte.
  if (coord.name && MY_LOCATION_LABELS.has(coord.name)) return { kind: 'myLocation' }
  return {
    kind: 'place',
    label: coord.name ?? `${coord.lat.toFixed(4)}, ${coord.lon.toFixed(4)}`,
    lat: coord.lat,
    lon: coord.lon,
  }
}

/** Clé de dédoublonnage : la même destination depuis « Ma position » n'est gardée qu'une fois. */
function endpointKey(e: RecentEndpoint): string {
  if (e.kind === 'myLocation') return 'me'
  if (e.kind === 'saved') return `saved:${e.key}`
  return `${e.lat.toFixed(4)},${e.lon.toFixed(4)}`
}

export function useRecentSearches() {
  const [searches, setSearches] = useState<RecentSearch[]>([])

  useEffect(() => {
    setSearches(load())
  }, [])

  const addSearch = useCallback((from: MarkedCoordinate, to: MarkedCoordinate) => {
    const entry: RecentSearch = {
      id: `${Date.now()}`,
      from: endpointFromCoordinate(from),
      to: endpointFromCoordinate(to),
      timestamp: Date.now(),
    }
    const key = `${endpointKey(entry.from)}>${endpointKey(entry.to)}`
    setSearches((prev) => {
      const filtered = prev.filter((s) => `${endpointKey(s.from)}>${endpointKey(s.to)}` !== key)
      const updated = [entry, ...filtered].slice(0, MAX_ENTRIES)
      save(updated)
      return updated
    })
  }, [])

  const clearSearches = useCallback(() => {
    setSearches([])
    save([])
  }, [])

  return { searches, addSearch, clearSearches }
}

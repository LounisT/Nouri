'use client'

import { useState, useEffect, useCallback } from 'react'

export type SavedPlaceKey = 'home' | 'work'

export interface SavedPlace {
  key: SavedPlaceKey
  label: string
  lat: number
  lon: number
  address: string
}

// Plus d icône ici : les emoji 🏠 / 💼 stockés dans ce modèle ne servaient qu à
// être affichés, et l interface les rend désormais en SVG stroke
// (components/icons.tsx). Le libellé, lui, vient des traductions — celui-ci
// n est qu un repli.
const DEFAULT_PLACES: Record<SavedPlaceKey, Omit<SavedPlace, 'lat' | 'lon' | 'address'> & { lat: null; lon: null; address: '' }> = {
  home: { key: 'home', label: 'Maison', lat: null, lon: null, address: '' },
  work: { key: 'work', label: 'Travail', lat: null, lon: null, address: '' },
}

const STORAGE_KEY = 'alger-transit-saved-places'

type SavedPlaces = Partial<Record<SavedPlaceKey, SavedPlace>>

function isPlace(value: unknown, key: SavedPlaceKey): value is SavedPlace {
  const p = value as Record<string, unknown> | null
  return Boolean(p) && p!.key === key
    && typeof p!.lat === 'number' && Number.isFinite(p!.lat)
    && typeof p!.lon === 'number' && Number.isFinite(p!.lon)
}

/**
 * Lieux enregistrés, lus à l'instant dans le stockage. Les composants qui
 * n'affichent pas les raccourcis (un récent « Maison » rejoué depuis le
 * formulaire) s'en servent pour retrouver l'adresse ACTUELLE de Maison, pas
 * celle du jour de la recherche. Toute entrée malformée est ignorée.
 */
export function readSavedPlaces(): SavedPlaces {
  if (typeof window === 'undefined') return {}
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw) as Record<string, unknown>
    const out: SavedPlaces = {}
    for (const key of ['home', 'work'] as const) {
      if (isPlace(parsed?.[key], key)) out[key] = parsed[key] as SavedPlace
    }
    return out
  } catch {
    return {}
  }
}

export function useSavedPlaces() {
  const [places, setPlaces] = useState<SavedPlaces>({})

  useEffect(() => {
    setPlaces(readSavedPlaces())
  }, [])

  const savePlace = useCallback((place: SavedPlace) => {
    setPlaces((prev) => {
      const next = { ...prev, [place.key]: place }
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify(next)) } catch { /* ignore */ }
      return next
    })
  }, [])

  const removePlace = useCallback((key: SavedPlaceKey) => {
    setPlaces((prev) => {
      const next = { ...prev }
      delete next[key]
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify(next)) } catch { /* ignore */ }
      return next
    })
  }, [])

  const getPlaceConfig = (key: SavedPlaceKey) => DEFAULT_PLACES[key]

  return { places, savePlace, removePlace, getPlaceConfig }
}

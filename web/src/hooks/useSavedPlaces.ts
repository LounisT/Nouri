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

export function useSavedPlaces() {
  const [places, setPlaces] = useState<Partial<Record<SavedPlaceKey, SavedPlace>>>({})

  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY)
      if (raw) setPlaces(JSON.parse(raw))
    } catch { /* ignore */ }
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

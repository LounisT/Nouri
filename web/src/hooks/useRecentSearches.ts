'use client'

import { useState, useCallback, useEffect } from 'react'
import { Coordinate } from '@/lib/otp'

export interface RecentSearch {
  id: string
  fromCoord: Coordinate
  toCoord: Coordinate
  fromLabel: string
  toLabel: string
  timestamp: number
}

const STORAGE_KEY = 'alger-transit-recents'
const MAX_ENTRIES = 5

function load(): RecentSearch[] {
  if (typeof window === 'undefined') return []
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]')
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

export function useRecentSearches() {
  const [searches, setSearches] = useState<RecentSearch[]>([])

  useEffect(() => {
    setSearches(load())
  }, [])

  const addSearch = useCallback((from: Coordinate, to: Coordinate) => {
    const entry: RecentSearch = {
      id: `${Date.now()}`,
      fromCoord: from,
      toCoord: to,
      fromLabel: from.name ?? `${from.lat.toFixed(4)}, ${from.lon.toFixed(4)}`,
      toLabel: to.name ?? `${to.lat.toFixed(4)}, ${to.lon.toFixed(4)}`,
      timestamp: Date.now(),
    }
    setSearches((prev) => {
      // Dédoublonner par labels
      const filtered = prev.filter(
        (s) => !(s.fromLabel === entry.fromLabel && s.toLabel === entry.toLabel)
      )
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

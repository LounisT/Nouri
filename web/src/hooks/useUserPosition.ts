'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

export type PositionError = 'insecure' | 'denied' | 'unavailable' | 'unsupported'

export interface UserPosition {
  lon: number
  lat: number
  accuracy: number
  heading: number | null
  timestamp: number
}

interface UseUserPositionResult {
  position: UserPosition | null
  error: PositionError | null
  /** Demande la position et lance le suivi continu. */
  start: () => void
  /** Suivi actif (au moins un consommateur l'a demandé). */
  watching: boolean
}

/**
 * Source UNIQUE de la position de l'usager, partagée par la carte et par le
 * calcul de progression. Auparavant, deux hooks séparés suivaient chacun leur
 * position : le bandeau et la carte finissaient par diverger.
 *
 * Le suivi est continu (`watchPosition`) car la navigation en a besoin en temps
 * réel — un simple point ponctuel ne permettrait pas de savoir où l'on est.
 */
export function useUserPosition(enabled = false): UseUserPositionResult {
  const [position, setPosition] = useState<UserPosition | null>(null)
  const [error, setError] = useState<PositionError | null>(null)
  const [watching, setWatching] = useState(false)
  const watchIdRef = useRef<number | null>(null)

  const start = useCallback(() => {
    // Les navigateurs n'exposent la position que sur un contexte sécurisé
    // (https ou localhost). En http sur une IP du réseau local, l'API existe
    // mais échoue : autant le dire tout de suite.
    if (typeof window !== 'undefined' && !window.isSecureContext) {
      setError('insecure')
      return
    }
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      setError('unsupported')
      return
    }
    if (watchIdRef.current !== null) return

    setWatching(true)
    watchIdRef.current = navigator.geolocation.watchPosition(
      (pos) => {
        setError(null)
        setPosition({
          lon: pos.coords.longitude,
          lat: pos.coords.latitude,
          accuracy: pos.coords.accuracy,
          heading: Number.isFinite(pos.coords.heading) ? pos.coords.heading : null,
          timestamp: pos.timestamp,
        })
      },
      (err) => {
        setError(err.code === err.PERMISSION_DENIED ? 'denied' : 'unavailable')
      },
      { enableHighAccuracy: true, maximumAge: 2000, timeout: 15000 },
    )
  }, [])

  // La navigation démarre le suivi d'elle-même : on ne veut pas que l'usager
  // ait à appuyer sur un bouton pour que son trajet avance.
  useEffect(() => {
    if (enabled) start()
  }, [enabled, start])

  // Si la permission est déjà accordée, le point apparaît sans rien demander.
  useEffect(() => {
    if (typeof navigator === 'undefined' || !navigator.permissions?.query) return
    navigator.permissions
      .query({ name: 'geolocation' as PermissionName })
      .then((status) => {
        if (status.state === 'granted') start()
      })
      .catch(() => {})
  }, [start])

  useEffect(() => () => {
    if (watchIdRef.current !== null && typeof navigator !== 'undefined') {
      navigator.geolocation.clearWatch(watchIdRef.current)
      watchIdRef.current = null
    }
  }, [])

  return { position, error, start, watching }
}

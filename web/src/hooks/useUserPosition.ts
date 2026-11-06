'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { isInServiceAreaPoint } from '@/lib/service-area'

export type PositionError = 'insecure' | 'denied' | 'unavailable' | 'unsupported'

/**
 * - 'high' : navigation — GPS haute précision, une position par seconde ;
 * - 'low'  : point sur la carte — réseau/Wi-Fi accepté, positions espacées ;
 * - 'off'  : aucun suivi (la batterie des téléphones d'entrée de gamme compte).
 */
export type PositionMode = 'off' | 'low' | 'high'

export interface UserPosition {
  lon: number
  lat: number
  accuracy: number
  heading: number | null
  /** Vitesse GPS (m/s), quand le téléphone la fournit. */
  speed: number | null
  /** Horodatage du fix (horloge GPS sur certains appareils : peut être décalé). */
  timestamp: number
  /** Horloge du téléphone à la réception : c'est elle qui dit si la position est récente. */
  receivedAt: number
}

/**
 * Zone où l'app sait guider : la même que le formulaire (service-area.ts,
 * emprise des arrêts du GTFS + ~3 km). Au-delà, une position n'est pas une
 * erreur, mais un départ « Ma position » ou un guidage n'auraient aucun sens.
 */
export function isInAlgiersArea(lat: number, lon: number): boolean {
  return isInServiceAreaPoint(lat, lon)
}

export type LocateResult = { position: UserPosition; error: null } | { position: null; error: PositionError }

export interface UseUserPositionResult {
  position: UserPosition | null
  error: PositionError | null
  /** Position connue mais hors de la région d'Alger. */
  outsideArea: boolean
  /**
   * Demande explicite (bouton « Ma position ») : lance le suivi au moins en
   * basse précision, et redemande l'autorisation même après un refus.
   */
  start: () => void
  /** Annule une demande explicite (le suivi suit alors le mode demandé). */
  stop: () => void
  /** Position ponctuelle (formulaire « Ma position »), ou la raison de l'échec. */
  locate: () => Promise<LocateResult>
  locating: boolean
  /** Suivi actif. */
  watching: boolean
  /** Mode réellement appliqué. */
  mode: PositionMode
}

const WATCH_OPTIONS: Record<'low' | 'high', PositionOptions> = {
  high: { enableHighAccuracy: true, maximumAge: 2000, timeout: 15000 },
  low: { enableHighAccuracy: false, maximumAge: 30000, timeout: 20000 },
}

function toPosition(pos: GeolocationPosition): UserPosition {
  const { coords } = pos
  return {
    lon: coords.longitude,
    lat: coords.latitude,
    accuracy: coords.accuracy,
    heading: Number.isFinite(coords.heading) ? coords.heading : null,
    speed: typeof coords.speed === 'number' && Number.isFinite(coords.speed) ? coords.speed : null,
    timestamp: pos.timestamp,
    receivedAt: Date.now(),
  }
}

function unavailableReason(): PositionError | null {
  // Les navigateurs n'exposent la position que sur un contexte sécurisé
  // (https ou localhost). En http sur une IP du réseau local, l'API existe
  // mais échoue : autant le dire tout de suite.
  if (typeof window !== 'undefined' && !window.isSecureContext) return 'insecure'
  if (typeof navigator === 'undefined' || !navigator.geolocation) return 'unsupported'
  return null
}

/**
 * Source UNIQUE de la position de l'usager, partagée par la carte, le
 * formulaire (« Ma position ») et la navigation.
 *
 * `mode` : 'high' pendant la navigation, 'low' quand la carte est visible,
 * 'off' sinon. Un booléen est accepté (ancienne API) : true = 'high',
 * false = 'off'. Le suivi s'ARRÊTE quand le mode repasse à 'off' — il tournait
 * auparavant en haute précision du lancement de l'app à sa fermeture.
 */
export function useUserPosition(mode: PositionMode | boolean = false): UseUserPositionResult {
  const desired: PositionMode = mode === true ? 'high' : mode === false ? 'off' : mode
  const [position, setPosition] = useState<UserPosition | null>(null)
  const [error, setError] = useState<PositionError | null>(null)
  const [watching, setWatching] = useState(false)
  const [locating, setLocating] = useState(false)
  // Demande explicite de l'usager, valable jusqu'au prochain changement de
  // mode (fin de navigation, carte quittée) : on retient la « génération » du
  // mode au moment de la demande. Le calcul est idempotent, donc sans risque
  // pendant le rendu.
  const generationRef = useRef({ desired, generation: 0 })
  if (generationRef.current.desired !== desired) {
    generationRef.current = { desired, generation: generationRef.current.generation + 1 }
  }
  const [manualGeneration, setManualGeneration] = useState<number | null>(null)
  const manual = manualGeneration === generationRef.current.generation
  // Incrémenté pour relancer le suivi (nouvelle autorisation, nouvel essai).
  const [restart, setRestart] = useState(0)
  const watchRef = useRef<{ id: number; high: boolean } | null>(null)
  const deniedRef = useRef(false)
  const positionRef = useRef<UserPosition | null>(null)

  const effective: PositionMode = desired !== 'off' ? desired : manual ? 'low' : 'off'

  const clearWatch = useCallback(() => {
    if (watchRef.current !== null && typeof navigator !== 'undefined' && navigator.geolocation) {
      navigator.geolocation.clearWatch(watchRef.current.id)
    }
    watchRef.current = null
    setWatching(false)
  }, [])

  useEffect(() => {
    if (effective === 'off' || deniedRef.current) {
      clearWatch()
      return
    }
    const reason = unavailableReason()
    if (reason) {
      setError(reason)
      return
    }
    const high = effective === 'high'
    if (watchRef.current && watchRef.current.high === high) return
    // Les options d'un watchPosition ne se changent pas après coup : on relance.
    clearWatch()
    const id = navigator.geolocation.watchPosition(
      (pos) => {
        const next = toPosition(pos)
        positionRef.current = next
        setPosition(next)
        setError(null)
      },
      (err) => {
        if (err.code === err.PERMISSION_DENIED) {
          // Refus : on arrête tout et on oublie la position, pour que le bouton
          // « Ma position » puisse relancer la demande (avant, il ne faisait
          // plus rien jusqu'au rechargement de la page).
          deniedRef.current = true
          clearWatch()
          positionRef.current = null
          setPosition(null)
          setError('denied')
          return
        }
        // Délai dépassé ou signal perdu : le suivi continue d'essayer, la
        // dernière position reste (son receivedAt dit son âge).
        setError('unavailable')
      },
      high ? WATCH_OPTIONS.high : WATCH_OPTIONS.low,
    )
    watchRef.current = { id, high }
    setWatching(true)
  }, [effective, restart, clearWatch])

  // Autorisation accordée (ou retirée) dans les réglages : prise en compte
  // sans recharger la page.
  useEffect(() => {
    if (typeof navigator === 'undefined' || !navigator.permissions?.query) return
    let status: PermissionStatus | null = null
    const onChange = () => {
      if (!status) return
      if (status.state === 'granted') {
        deniedRef.current = false
        setError(null)
        setRestart((n) => n + 1)
      } else if (status.state === 'denied') {
        deniedRef.current = true
        clearWatch()
        setError('denied')
      }
    }
    navigator.permissions
      .query({ name: 'geolocation' as PermissionName })
      .then((s) => {
        status = s
        if (s.state === 'denied') deniedRef.current = true
        s.addEventListener('change', onChange)
      })
      .catch(() => {})
    return () => status?.removeEventListener('change', onChange)
  }, [clearWatch])

  useEffect(() => clearWatch, [clearWatch])

  const start = useCallback(() => {
    const reason = unavailableReason()
    if (reason) {
      setError(reason)
      return
    }
    deniedRef.current = false
    setError(null)
    setManualGeneration(generationRef.current.generation)
    // Après un refus, il faut un nouvel appel à watchPosition pour que le
    // navigateur redemande (ou confirme le refus).
    if (!watchRef.current) setRestart((n) => n + 1)
  }, [])

  const stop = useCallback(() => setManualGeneration(null), [])

  const locate = useCallback((): Promise<LocateResult> => {
    // Une position récente et assez précise suffit : pas de seconde attente.
    const current = positionRef.current
    if (current && Date.now() - current.receivedAt < 60_000 && current.accuracy <= 150) {
      return Promise.resolve({ position: current, error: null })
    }
    const reason = unavailableReason()
    if (reason) {
      setError(reason)
      return Promise.resolve({ position: null, error: reason })
    }
    setLocating(true)
    return new Promise((resolve) => {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          const next = toPosition(pos)
          deniedRef.current = false
          positionRef.current = next
          setPosition(next)
          setError(null)
          setLocating(false)
          resolve({ position: next, error: null })
        },
        (err) => {
          const failure: PositionError = err.code === err.PERMISSION_DENIED ? 'denied' : 'unavailable'
          if (failure === 'denied') deniedRef.current = true
          setError(failure)
          setLocating(false)
          resolve({ position: null, error: failure })
        },
        { enableHighAccuracy: true, timeout: 15000, maximumAge: 30000 },
      )
    })
  }, [])

  return {
    position,
    error,
    outsideArea: position !== null && !isInAlgiersArea(position.lat, position.lon),
    start,
    stop,
    locate,
    locating,
    watching,
    mode: effective,
  }
}

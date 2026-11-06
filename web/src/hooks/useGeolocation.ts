'use client'

import { useState, useCallback } from 'react'
import type { TranslationKey } from '@/lib/i18n'
import { isInAlgiersArea, type PositionError, type UseUserPositionResult } from './useUserPosition'

export interface GeolocationState {
  lat: number | null
  lon: number | null
  accuracy: number | null
  /** Horloge du téléphone à l'obtention : un départ « Ma position » a un âge. */
  receivedAt: number | null
  loading: boolean
  /**
   * CLÉ i18n, jamais une phrase : la traduction appartient au composant qui
   * affiche. Un hook qui renvoie du français casse l'arabe et l'anglais.
   */
  error: TranslationKey | null
}

const ERROR_KEYS: Record<PositionError, TranslationKey> = {
  insecure: 'geoInsecure',
  denied: 'geoDenied',
  // Un délai dépassé se raconte comme un signal trop faible : c'est ce que
  // l'usager constate, et geoUnavailable le dit déjà en trois langues.
  unavailable: 'geoUnavailable',
  unsupported: 'geoUnavailable',
}

const EMPTY: GeolocationState = { lat: null, lon: null, accuracy: null, receivedAt: null, loading: false, error: null }

/**
 * Position ponctuelle pour le formulaire (« Ma position » comme départ).
 *
 * Passer la source partagée (`useGeolocation(userPosition)`, où userPosition
 * vient de useUserPosition) évite de lancer une SECONDE session GPS en
 * parallèle du suivi de la carte et de la navigation. Sans argument, le hook
 * reste autonome (ancienne API).
 *
 * Une position hors de la région d'Alger n'est pas renvoyée comme départ :
 * OTP répondrait par un code d'erreur brut. On le dit en clair à la place.
 */
export function useGeolocation(shared?: Pick<UseUserPositionResult, 'locate' | 'locating'>) {
  const [state, setState] = useState<GeolocationState>(EMPTY)

  const accept = useCallback((lat: number, lon: number, accuracy: number, receivedAt: number) => {
    if (!isInAlgiersArea(lat, lon)) {
      setState({ ...EMPTY, error: 'nav_outsideArea' })
      return
    }
    setState({ lat, lon, accuracy, receivedAt, loading: false, error: null })
  }, [])

  const locate = useCallback(() => {
    if (shared) {
      setState((s) => ({ ...s, loading: true, error: null }))
      void shared.locate().then((result) => {
        if (result.position) {
          const p = result.position
          accept(p.lat, p.lon, p.accuracy, p.receivedAt)
        } else {
          // Jamais d'anciennes coordonnées en repli : le champ reste vide et
          // la raison est dite.
          setState({ ...EMPTY, error: ERROR_KEYS[result.error] })
        }
      })
      return
    }

    // Les navigateurs n'exposent la position QUE sur un contexte sécurisé
    // (https ou localhost). En http sur une IP du réseau local — le cas du
    // test téléphone — l'API existe mais échoue : il faut le dire.
    if (typeof window !== 'undefined' && !window.isSecureContext) {
      setState((s) => ({ ...s, loading: false, error: 'geoInsecure' }))
      return
    }
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      setState((s) => ({ ...s, loading: false, error: 'geoUnavailable' }))
      return
    }

    setState((s) => ({ ...s, loading: true, error: null }))
    // getCurrentPosition redemande l'autorisation à chaque appel : après un
    // refus, un nouvel appui sur « Ma position » relance bien la demande.
    navigator.geolocation.getCurrentPosition(
      (pos) => accept(pos.coords.latitude, pos.coords.longitude, pos.coords.accuracy, Date.now()),
      (err) => {
        const key = ERROR_KEYS[err.code === err.PERMISSION_DENIED ? 'denied' : 'unavailable']
        setState((s) => ({ ...s, loading: false, error: key }))
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 30000 },
    )
  }, [shared, accept])

  return { ...state, loading: state.loading || Boolean(shared?.locating), locate }
}

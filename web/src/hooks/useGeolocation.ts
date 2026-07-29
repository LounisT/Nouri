'use client'

import { useState, useCallback } from 'react'
import type { TranslationKey } from '@/lib/i18n'

export interface GeolocationState {
  lat: number | null
  lon: number | null
  accuracy: number | null
  loading: boolean
  /**
   * CLÉ i18n, jamais une phrase : la traduction appartient au composant qui
   * affiche. Un hook qui renvoie du français casse l'arabe et l'anglais.
   */
  error: TranslationKey | null
}

export function useGeolocation() {
  const [state, setState] = useState<GeolocationState>({
    lat: null,
    lon: null,
    accuracy: null,
    loading: false,
    error: null,
  })

  const locate = useCallback(() => {
    // Les navigateurs n'exposent la position QUE sur un contexte sécurisé
    // (https ou localhost). En http sur une IP du réseau local — le cas du
    // test téléphone — l'API existe mais échoue : il faut le dire.
    if (typeof window !== 'undefined' && !window.isSecureContext) {
      setState((s) => ({ ...s, loading: false, error: 'geoInsecure' }))
      return
    }

    if (!navigator.geolocation) {
      setState((s) => ({ ...s, error: 'geoUnavailable' }))
      return
    }

    setState((s) => ({ ...s, loading: true, error: null }))

    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setState({
          lat: pos.coords.latitude,
          lon: pos.coords.longitude,
          accuracy: pos.coords.accuracy,
          loading: false,
          error: null,
        })
      },
      (err) => {
        // Un délai dépassé se raconte comme un signal trop faible : c'est ce
        // que l'usager constate, et geoUnavailable le dit déjà en trois langues.
        const key: TranslationKey =
          err.code === err.PERMISSION_DENIED ? 'geoDenied' : 'geoUnavailable'
        setState((s) => ({ ...s, loading: false, error: key }))
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 }
    )
  }, [])

  return { ...state, locate }
}

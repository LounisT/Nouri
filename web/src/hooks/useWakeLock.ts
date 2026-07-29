'use client'

import { useEffect, useRef } from 'react'

/**
 * Maintient l'écran allumé pendant la navigation.
 *
 * En navigation l'usager marche téléphone à la main : sans ce verrou, l'écran
 * s'éteint au bout de ~30 s et il faut le rallumer à chaque carrefour — alors
 * que la carte d'étape est précisément faite pour être lue en marchant.
 *
 * Le verrou est PERDU dès que l'onglet passe en arrière-plan (appel entrant,
 * changement d'app, écran verrouillé) : il faut le reprendre au retour, d'où
 * l'écoute de `visibilitychange`. L'API manque sur Safari iOS < 16.4 — l'échec
 * est alors silencieux : la navigation n'a pas à s'arrêter pour ça, et un
 * message d'erreur n'apprendrait rien à l'usager, qui n'y peut rien.
 */
export function useWakeLock(enabled: boolean) {
  const sentinelRef = useRef<WakeLockSentinel | null>(null)

  useEffect(() => {
    if (!enabled) return
    if (typeof navigator === 'undefined' || !('wakeLock' in navigator)) return

    let cancelled = false

    const release = () => {
      const sentinel = sentinelRef.current
      sentinelRef.current = null
      sentinel?.release().catch(() => {})
    }

    const acquire = async () => {
      if (cancelled || sentinelRef.current) return
      // Une demande hors onglet visible est systématiquement rejetée.
      if (document.visibilityState !== 'visible') return
      try {
        const sentinel = await navigator.wakeLock.request('screen')
        if (cancelled) {
          sentinel.release().catch(() => {})
          return
        }
        sentinelRef.current = sentinel
        // Le navigateur peut relâcher de lui-même (batterie faible) : ne pas
        // garder une sentinelle morte, sinon la reprise ne se ferait jamais.
        sentinel.addEventListener('release', () => {
          if (sentinelRef.current === sentinel) sentinelRef.current = null
        })
      } catch {
        // Refus de l'utilisateur, batterie faible, onglet masqué : sans effet.
      }
    }

    const onVisibility = () => {
      if (document.visibilityState === 'visible') void acquire()
    }

    void acquire()
    document.addEventListener('visibilitychange', onVisibility)

    return () => {
      cancelled = true
      document.removeEventListener('visibilitychange', onVisibility)
      release()
    }
  }, [enabled])
}

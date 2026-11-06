'use client'

import { useEffect, useState } from 'react'

// Heure courante rafraîchie à chaque changement de minute. Les états
// « Ouvert / Fermé » et les fréquences du catalogue dépendent de l'heure :
// sans minuterie, un onglet laissé ouvert à 22:55 affichait encore « Ouvert »
// à 23:10, jusqu'à ce qu'une autre action provoque un rendu.
//
// null au rendu serveur et à l'hydratation : l'heure du serveur n'est pas
// celle du téléphone, et un texte qui en dépend ferait échouer l'hydratation
// (composant gardé monté mais masqué). L'appelant n'affiche rien qui dépend
// de l'heure tant que la valeur est null — une image plus tard, elle arrive.
//
// Minuterie recalée sur la minute pleine (pas de dérive d'un setInterval) ;
// Alger est à UTC+1 fixe, donc la minute du téléphone et celle d'Alger
// changent au même instant. Au retour au premier plan (téléphone réveillé,
// minuteries gelées en arrière-plan), l'heure est relue tout de suite.
// `enabled` à false (onglet masqué) : plus de rendu chaque minute ; l'heure
// est relue dès la réactivation.
export function useMinuteTick(enabled = true): Date | null {
  const [now, setNow] = useState<Date | null>(null)

  useEffect(() => {
    if (!enabled) return
    let timer: ReturnType<typeof setTimeout> | null = null
    const schedule = () => {
      if (timer) clearTimeout(timer)
      // +50 ms : on tombe juste après le changement de minute, pas juste avant.
      const delay = 60_000 - (Date.now() % 60_000) + 50
      timer = setTimeout(() => {
        setNow(new Date())
        schedule()
      }, delay)
    }
    const refresh = () => {
      if (document.visibilityState !== 'visible') return
      setNow(new Date())
      schedule()
    }
    setNow(new Date())
    schedule()
    document.addEventListener('visibilitychange', refresh)
    return () => {
      if (timer) clearTimeout(timer)
      document.removeEventListener('visibilitychange', refresh)
    }
  }, [enabled])

  return now
}

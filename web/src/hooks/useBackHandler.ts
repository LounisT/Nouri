'use client'

import { useEffect, useRef } from 'react'
import { pushLayer, removeLayer, updateLayer } from '@/lib/back-stack'

// Tant que `active` est vrai, le retour système (bouton Android, geste iOS,
// touche retour du navigateur) appelle `onBack` au lieu de quitter la page.
// L'ordre d'activation fixe l'ordre de dépilement : le dernier écran ouvert
// est le premier refermé.
export function useBackHandler(active: boolean, onBack: () => void) {
  const idRef = useRef<number | null>(null)
  const onBackRef = useRef(onBack)
  onBackRef.current = onBack

  useEffect(() => {
    if (!active) return
    const id = pushLayer(() => onBackRef.current())
    idRef.current = id
    return () => {
      removeLayer(id)
      idRef.current = null
    }
  }, [active])

  useEffect(() => {
    if (idRef.current !== null) updateLayer(idRef.current, () => onBackRef.current())
  })
}

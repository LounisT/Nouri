'use client'

import { useEffect, type RefObject } from 'react'

/**
 * Pose ou retire l'attribut `inert` (React 18 ne le sérialise pas : il est
 * arrivé en React 19). Un écran recouvert ou hors champ sort ainsi du parcours
 * clavier ET de l'arbre d'accessibilité — `pointer-events` n'écarte que la
 * souris, `aria-hidden` que l'annonce, pas le focus.
 */
export function useInert(ref: RefObject<HTMLElement>, inert: boolean) {
  useEffect(() => {
    const el = ref.current
    if (!el) return
    if (inert) el.setAttribute('inert', '')
    else el.removeAttribute('inert')
  }, [ref, inert])
}

'use client'

import { RefObject, useEffect, useRef } from 'react'

// Largeur de la zone de bord où le geste peut démarrer (comme UIKit).
const EDGE_PX = 24
// Seuils de validation : un tiers de l'écran, ou un lancer rapide.
const DISTANCE_RATIO = 0.33
const VELOCITY_PX_MS = 0.45
const SETTLE_MS = 320

function isStandalone() {
  if (typeof window === 'undefined') return false
  return window.matchMedia?.('(display-mode: standalone)').matches
    || (navigator as Navigator & { standalone?: boolean }).standalone === true
}

// Geste « glisser depuis le bord » d'iOS pour fermer un écran poussé.
// En PWA installée, iOS n'offre aucun retour système : sans ce geste, la
// seule sortie était la petite flèche en haut de l'écran. L'écran suit le
// doigt, puis se referme ou revient en place selon la distance et la vitesse.
// Dans Safari (hors PWA) le navigateur gère déjà ce geste via l'historique.
export function useEdgeSwipeBack(
  ref: RefObject<HTMLElement>,
  { enabled, rtl, onBack }: { enabled: boolean; rtl: boolean; onBack: () => void },
) {
  const onBackRef = useRef(onBack)
  onBackRef.current = onBack

  useEffect(() => {
    const el = ref.current
    if (!el || !enabled || !isStandalone()) return

    let tracking = false
    let dragging = false
    let startX = 0
    let startY = 0
    let dx = 0
    let lastX = 0
    let lastT = 0
    let velocity = 0
    let width = 0
    let settleTimer: ReturnType<typeof setTimeout> | null = null
    // Styles en ligne posés par React (la transition de l'écran Résultats) :
    // on les restaure à l'identique au lieu de les effacer.
    let saved: { transition: string; transform: string } | null = null
    const restore = () => {
      if (!saved) return
      el.style.transition = saved.transition
      el.style.transform = saved.transform
      saved = null
    }

    // Distance parcourue dans le sens « retour » (vers la droite en LTR).
    const forward = (clientX: number) => (rtl ? startX - clientX : clientX - startX)

    const onStart = (e: TouchEvent) => {
      if (e.touches.length !== 1) return
      const touch = e.touches[0]
      const fromEdge = rtl ? window.innerWidth - touch.clientX : touch.clientX
      if (fromEdge > EDGE_PX) return
      tracking = true
      dragging = false
      startX = lastX = touch.clientX
      startY = touch.clientY
      lastT = e.timeStamp
      dx = 0
      velocity = 0
      width = el.offsetWidth || window.innerWidth
    }

    const onMove = (e: TouchEvent) => {
      if (!tracking) return
      const touch = e.touches[0]
      const d = forward(touch.clientX)
      if (!dragging) {
        const dy = Math.abs(touch.clientY - startY)
        // Défilement vertical : on laisse la liste scroller.
        if (dy > 10 && dy > Math.abs(d)) {
          tracking = false
          return
        }
        if (d < 8) return
        dragging = true
        if (settleTimer) clearTimeout(settleTimer)
        if (!saved) saved = { transition: el.style.transition, transform: el.style.transform }
        el.style.transition = 'none'
      }
      e.preventDefault()
      dx = Math.max(0, d)
      const dt = e.timeStamp - lastT
      if (dt > 0) velocity = (forward(touch.clientX) - forward(lastX)) / dt
      lastX = touch.clientX
      lastT = e.timeStamp
      el.style.transform = `translateX(${rtl ? -dx : dx}px)`
    }

    const onEnd = () => {
      if (!tracking) return
      tracking = false
      if (!dragging) return
      dragging = false
      el.style.transition = `transform ${SETTLE_MS}ms cubic-bezier(0.2, 0, 0, 1)`
      const done = dx > width * DISTANCE_RATIO || (velocity > VELOCITY_PX_MS && dx > 30)
      // On garde la main sur `transform` le temps de l'animation : rendre la
      // main aux classes tout de suite ferait revenir l'écran d'une image
      // avant que React n'applique l'état fermé.
      el.style.transform = done ? `translateX(${rtl ? '-100%' : '100%'})` : 'translateX(0)'
      if (done) onBackRef.current()
      settleTimer = setTimeout(restore, SETTLE_MS + 20)
    }

    el.addEventListener('touchstart', onStart, { passive: true })
    // passive: false — sinon impossible d'empêcher le défilement pendant le geste.
    el.addEventListener('touchmove', onMove, { passive: false })
    el.addEventListener('touchend', onEnd)
    el.addEventListener('touchcancel', onEnd)
    return () => {
      el.removeEventListener('touchstart', onStart)
      el.removeEventListener('touchmove', onMove)
      el.removeEventListener('touchend', onEnd)
      el.removeEventListener('touchcancel', onEnd)
      if (settleTimer) clearTimeout(settleTimer)
      restore()
    }
  }, [ref, enabled, rtl])
}

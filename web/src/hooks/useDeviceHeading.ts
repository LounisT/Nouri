'use client'

import { useEffect, useRef } from 'react'

/**
 * Cap de l'appareil (degrés, 0 = nord, sens horaire), RAPPORTÉ AU NORD, ou null.
 *
 * Sur Chrome Android, l'événement 'deviceorientation' est RELATIF depuis
 * Chrome 50 : alpha part de l'orientation du téléphone au chargement de la
 * page, pas du nord. « 360 − alpha » y donnait un cône pointant dans une
 * direction arbitraire. Seuls valent comme cap :
 *  - 'deviceorientationabsolute' (Chrome Android), ou un événement marqué
 *    `absolute` ;
 *  - `webkitCompassHeading` (iOS Safari, après permission).
 * Sinon on rend null : pas de cône plutôt qu'un cône faux.
 *
 * Le rappel est appelé au plus une fois par image et seulement si le cap a
 * bougé de plus de 2° — il écrit directement dans le DOM, sans rendu React.
 */
export function useDeviceHeading(onHeading: (heading: number | null) => void, enabled = true): void {
  const callbackRef = useRef(onHeading)
  callbackRef.current = onHeading

  useEffect(() => {
    if (!enabled || typeof window === 'undefined') {
      callbackRef.current(null)
      return
    }
    const eventName = 'ondeviceorientationabsolute' in window ? 'deviceorientationabsolute' : 'deviceorientation'
    let last: number | null = null
    let pending: number | null = null
    let frame = 0

    const flush = () => {
      frame = 0
      if (pending === null) return
      if (last === null || angleDelta(pending, last) > 2) {
        last = pending
        callbackRef.current(pending)
      }
    }

    const onOrient = (event: DeviceOrientationEvent) => {
      const webkit = (event as DeviceOrientationEvent & { webkitCompassHeading?: number }).webkitCompassHeading
      let heading: number | null = null
      if (typeof webkit === 'number' && Number.isFinite(webkit) && webkit >= 0) {
        heading = webkit // iOS : déjà rapporté au nord (magnétique)
      } else if (event.absolute && event.alpha !== null) {
        heading = 360 - event.alpha // repère terrestre uniquement
      }
      if (heading === null) {
        // Repère relatif : on n'invente pas de cap.
        if (last !== null) {
          last = null
          callbackRef.current(null)
        }
        return
      }
      // Écran tourné (paysage) : le haut de l'écran n'est plus le haut de
      // l'appareil.
      const screenAngle = typeof screen !== 'undefined' && screen.orientation ? screen.orientation.angle : 0
      pending = ((heading + screenAngle) % 360 + 360) % 360
      if (!frame) frame = window.requestAnimationFrame(flush)
    }

    window.addEventListener(eventName, onOrient as EventListener)
    return () => {
      window.removeEventListener(eventName, onOrient as EventListener)
      if (frame) window.cancelAnimationFrame(frame)
    }
  }, [enabled])
}

function angleDelta(a: number, b: number): number {
  const d = Math.abs(a - b) % 360
  return d > 180 ? 360 - d : d
}

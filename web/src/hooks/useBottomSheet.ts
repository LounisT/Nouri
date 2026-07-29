'use client'

import { useEffect, useRef, useState } from 'react'
import { useMotionValue, useAnimation, useDragControls } from 'framer-motion'

export type SnapPoint = 'peek' | 'half' | 'full'

// Pourcentage de hauteur visible pour chaque snap (en % de l'écran)
export const SNAP_PERCENT: Record<SnapPoint, number> = {
  peek: 32,
  half: 60,
  full: 92,
}

const ORDER: SnapPoint[] = ['peek', 'half', 'full']

export function useBottomSheet(initial: SnapPoint = 'half', sheetHeight?: number | null) {
  const [snap, setSnap] = useState<SnapPoint>(initial)
  const scrollRef = useRef<HTMLDivElement>(null)
  const controls = useAnimation()
  const dragControls = useDragControls()

  // y = 0 → sheet plein écran (full), y positif → sheet descend
  const y = useMotionValue(0)

  const getSheetHeight = () => {
    if (typeof window === 'undefined') return sheetHeight ?? 0
    const maxSheetH = window.innerHeight * 0.9
    return Math.min(sheetHeight ?? maxSheetH, maxSheetH)
  }

  const getYForSnap = (point: SnapPoint) => {
    if (typeof window === 'undefined') return 0
    const screenH = window.innerHeight
    const visibleH = screenH * (SNAP_PERCENT[point] / 100)
    return Math.max(getSheetHeight() - visibleH, 0)
  }

  const snapToPoint = (point: SnapPoint, animate = true) => {
    const targetY = getYForSnap(point)
    setSnap(point)
    if (animate) {
      controls.start({ y: targetY, transition: { type: 'spring', stiffness: 400, damping: 40 } })
    } else {
      y.set(targetY)
    }
  }

  const cycleSnap = () => {
    const currentIdx = ORDER.indexOf(snap)
    const nextIdx = (currentIdx + 1) % ORDER.length
    snapToPoint(ORDER[nextIdx])
  }

  const startDrag = (event: PointerEvent | React.PointerEvent<Element>) => {
    dragControls.start(event)
  }

  useEffect(() => {
    if (typeof window === 'undefined') return
    y.set(getYForSnap(snap))
  }, [sheetHeight]) // eslint-disable-line react-hooks/exhaustive-deps

  const onDragEnd = (_: unknown, info: { offset: { y: number }; velocity: { y: number } }) => {
    const { velocity } = info
    const currentIdx = ORDER.indexOf(snap)
    let newIdx = currentIdx

    if (Math.abs(velocity.y) > 200) {
      // Swipe rapide : haut = ouvre davantage, bas = referme
      newIdx = velocity.y > 0
        ? Math.max(currentIdx - 1, 0)
        : Math.min(currentIdx + 1, ORDER.length - 1)
    } else {
      // Swipe lent → snap le plus proche selon position actuelle
      const currentY = y.get()
      const dists = ORDER.map((point) => Math.abs(getYForSnap(point) - currentY))
      newIdx = dists.indexOf(Math.min(...dists))
    }

    const next = ORDER[newIdx]
    setSnap(next)
    controls.start({
      y: getYForSnap(next),
      transition: { type: 'spring', stiffness: 400, damping: 40 },
    })
  }

  return {
    snap,
    snapToPoint,
    cycleSnap,
    startDrag,
    scrollRef,
    // Props à passer au motion.div
    motionProps: {
      drag: 'y' as const,
      dragListener: false,
      dragControls,
      dragConstraints: { top: 0, bottom: getYForSnap('peek') },
      dragElastic: 0.1,
      dragMomentum: false,
      animate: controls,
      style: { y },
      onDragEnd,
    },
    initialY: getYForSnap(initial),
  }
}

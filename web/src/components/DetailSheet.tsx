'use client'

// Feuille basse glissable de l'écran Itinéraire (handoff « Itinéraire Alger »).
//
// Trois positions d'arrêt (plein / milieu par défaut / réduit), saisissable
// depuis n'importe où : poignée, en-tête, résumé, fil du trajet. Physique de
// la maquette (classe Component : onSheetDown, onMove, onUp, cycleSnap) :
// - seuil de démarrage 6 px, puis la feuille suit le doigt SANS transition ;
// - résistance élastique au-delà des bornes : FULL − √dépassement·2 au-dessus,
//   PEEK + √dépassement·3 en dessous ;
// - au relâchement : position + vitesse (px/ms) × 220, puis aimantation sur
//   la position d'arrêt la plus proche, transform .42s cubic-bezier(.22,1,.36,1) ;
// - un glisser ne déclenche jamais un tap (poignée, accordéons, boutons).
// Défilement contre glisser, comme une feuille iOS : le fil ne défile qu'en
// plein écran ; vers le haut, ou vers le bas une fois défilé, c'est la liste
// qui bouge ; tirer vers le bas la liste revenue en haut redescend la feuille,
// y compris au milieu d'un même geste.
//
// Le suivi du doigt n'entraîne AUCUN rendu React : la position vit dans des
// refs et s'écrit en transform à chaque image (requestAnimationFrame). React
// ne connaît que la position d'arrêt (snap), remontée au parent.
//
// Grand écran (> 768 px) : pas de feuille, le détail occupe la colonne.

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type FocusEvent,
  type ReactNode,
} from 'react'
import { useTranslation } from '@/hooks/useTranslation'
import { ChevronUpIcon, MyLocationIcon } from '@/components/icons'

export type DetailSnap = 'peek' | 'mid' | 'full'

const EASE = 'cubic-bezier(.22,1,.36,1)'
const SNAP_MS = 420
/** Seuil de démarrage du glisser (px). */
const SLOP = 6
/** Projection du lancer : position + vitesse (px/ms) × 220. */
const PROJECTION_MS = 220
/** Fenêtre de calcul de la vitesse au relâchement. */
const VELOCITY_WINDOW_MS = 90
/** Bouton flottant : 44 px + 14 px d'écart au-dessus du bord de la feuille. */
const LOCATE_OFFSET = 58

/**
 * Positions d'arrêt (bord haut de la feuille, depuis le haut de la zone
 * visible) : 52 / 330 / 512 sur l'écran de 844 de la maquette, en
 * proportions. En plein écran, la feuille laisse au moins la zone sûre du
 * haut (encoche, barre d'état d'une PWA installée) plus 8 px.
 */
export function sheetStops(height: number, safeTop: number) {
  const full = Math.max(Math.round((height * 52) / 844), Math.round(safeTop) + 8)
  const mid = Math.max(full + 80, Math.round((height * 330) / 844))
  const peek = Math.max(mid + 60, Math.round((height * 512) / 844))
  return { full, mid, peek }
}

interface Geometry {
  height: number
  full: number
  mid: number
  peek: number
}

interface Gesture {
  x0: number
  y0: number
  off0: number
  mode: 'pending' | 'drag' | 'scroll' | 'ignore'
  inScroll: boolean
  lastY: number
  samples: { y: number; t: number }[]
}

interface DetailSheetProps {
  /** Grand écran : colonne statique, sans feuille ni bouton flottant. */
  wide: boolean
  /** Détail ouvert et à l'écran (sinon rien n'est cliquable). */
  interactive: boolean
  snap: DetailSnap
  onSnapChange: (snap: DetailSnap) => void
  /**
   * Hauteur (px) que la feuille cache en bas de la carte, une fois arrêtée
   * hors plein écran : la carte cadre le trajet au-dessus.
   */
  onMapInset?: (px: number) => void
  /** Bouton flottant : recadrer la carte sur le trajet. */
  onRefit?: () => void
  header: ReactNode
  summary: ReactNode
  /** Rangée « Reprendre la navigation », au-dessus du fil. */
  topSlot?: ReactNode
  /** Fil du trajet (zone défilante). */
  children: ReactNode
  /** Contenu de la barre fixe du bas (« Commencer »). */
  footer: ReactNode
}

export default function DetailSheet({
  wide,
  interactive,
  snap,
  onSnapChange,
  onMapInset,
  onRefit,
  header,
  summary,
  topSlot,
  children,
  footer,
}: DetailSheetProps) {
  const { t } = useTranslation()
  const sheetRef = useRef<HTMLDivElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const locateRef = useRef<HTMLButtonElement>(null)
  const probeRef = useRef<HTMLDivElement>(null)

  const [geom, setGeom] = useState<Geometry | null>(null)
  const geomRef = useRef<Geometry | null>(null)
  geomRef.current = geom
  const snapRef = useRef(snap)
  snapRef.current = snap
  const onSnapChangeRef = useRef(onSnapChange)
  onSnapChangeRef.current = onSnapChange

  /** Position courante du bord haut (px), y compris pendant un glisser. */
  const yRef = useRef<number | null>(null)
  const gestureRef = useRef<Gesture | null>(null)
  const frameRef = useRef(0)
  const pendingYRef = useRef<number | null>(null)
  const lastDragEndRef = useRef(-Infinity)

  const stopOf = (g: Geometry, s: DetailSnap) => (s === 'full' ? g.full : s === 'peek' ? g.peek : g.mid)

  // ── Mesure : hauteur de la zone visible et zone sûre du haut ──────────────
  useLayoutEffect(() => {
    if (wide) return
    const region = sheetRef.current?.parentElement
    if (!region) return
    const measure = () => {
      const height = region.clientHeight
      if (!height) return
      const safeTop = probeRef.current?.offsetHeight ?? 0
      const next = { height, ...sheetStops(height, safeTop) }
      setGeom((prev) => (prev && prev.height === next.height && prev.full === next.full ? prev : next))
    }
    measure()
    const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measure) : null
    observer?.observe(region)
    window.addEventListener('resize', measure)
    return () => {
      observer?.disconnect()
      window.removeEventListener('resize', measure)
    }
  }, [wide])

  // ── Écriture de la position (aucun rendu React) ───────────────────────────
  const paint = useCallback((y: number, animate: boolean) => {
    const sheet = sheetRef.current
    const g = geomRef.current
    if (!sheet || !g) return
    yRef.current = y
    sheet.style.transition = animate ? `transform ${SNAP_MS}ms ${EASE}` : 'none'
    sheet.style.transform = `translate3d(0, ${y}px, 0)`
    const button = locateRef.current
    if (button) {
      // Le bouton suit la feuille avec la même transition ; il s'efface en
      // approchant du plein écran (au-dessus de la mi-course plein ↔ milieu).
      button.style.transition = animate
        ? `transform ${SNAP_MS}ms ${EASE}, opacity 200ms ease`
        : 'opacity 200ms ease'
      button.style.transform = `translate3d(0, ${y - LOCATE_OFFSET}px, 0)`
      button.style.opacity = y < (g.full + g.mid) / 2 ? '0' : '1'
    }
  }, [])

  // Position d'arrêt (changement d'état ou de taille d'écran). Animée sauf à
  // la première mesure et quand seule la taille de l'écran a changé.
  const paintedGeomRef = useRef<Geometry | null>(null)
  useLayoutEffect(() => {
    if (wide || !geom) return
    const animate = paintedGeomRef.current === geom
    paintedGeomRef.current = geom
    if (gestureRef.current?.mode === 'drag') return
    paint(stopOf(geom, snap), animate)
  }, [snap, geom, wide, paint])

  // La carte cadre le trajet au-dessus de la feuille, après chaque arrêt —
  // sauf en plein écran (la carte n'est presque plus visible).
  const onMapInsetRef = useRef(onMapInset)
  onMapInsetRef.current = onMapInset
  useEffect(() => {
    if (wide || !geom || snap === 'full') return
    onMapInsetRef.current?.(geom.height - Math.min(stopOf(geom, snap), geom.peek))
  }, [snap, geom, wide])

  // Sortie du plein écran : le fil revient en haut (le milieu montre le début).
  useEffect(() => {
    if (snap === 'full') return
    const scroller = scrollRef.current
    if (scroller && scroller.scrollTop > 0) scroller.scrollTo({ top: 0, behavior: 'smooth' })
  }, [snap])

  // ── Gestes ────────────────────────────────────────────────────────────────
  useEffect(() => {
    const sheet = sheetRef.current
    if (!sheet || wide) return

    const flush = () => {
      frameRef.current = 0
      if (pendingYRef.current !== null) paint(pendingYRef.current, false)
    }

    const begin = (x: number, y: number, target: EventTarget | null) => {
      const g = geomRef.current
      if (!g) return
      gestureRef.current = {
        x0: x,
        y0: y,
        off0: yRef.current ?? stopOf(g, snapRef.current),
        mode: 'pending',
        inScroll: Boolean(target instanceof Node && scrollRef.current?.contains(target)),
        lastY: y,
        samples: [],
      }
    }

    const move = (x: number, y: number, event: { cancelable: boolean; preventDefault: () => void }) => {
      const d = gestureRef.current
      const g = geomRef.current
      if (!d || !g || d.mode === 'ignore') return
      const now = performance.now()
      if (d.mode === 'pending') {
        const dx = x - d.x0
        const dy = y - d.y0
        if (Math.abs(dy) < SLOP && Math.abs(dx) < SLOP) return
        // Geste horizontal (retour depuis le bord, iOS) : pas pour la feuille.
        if (Math.abs(dx) > Math.abs(dy)) {
          d.mode = 'ignore'
          return
        }
        const scroller = scrollRef.current
        if (snapRef.current === 'full' && d.inScroll && scroller && (dy < 0 || scroller.scrollTop > 0)) {
          d.mode = 'scroll'
          d.lastY = y
          return
        }
        d.mode = 'drag'
      } else if (d.mode === 'scroll') {
        const scroller = scrollRef.current
        // La liste est revenue en haut et le doigt continue vers le bas : la
        // feuille prend le relais dans le même geste (feuille iOS).
        if (!scroller || scroller.scrollTop > 0 || y <= d.lastY) {
          d.lastY = y
          return
        }
        d.mode = 'drag'
        d.y0 = y
        d.off0 = yRef.current ?? g.full
      }

      if (event.cancelable) event.preventDefault()
      let next = d.off0 + (y - d.y0)
      if (next < g.full) next = g.full - Math.sqrt(g.full - next) * 2
      if (next > g.peek) next = g.peek + Math.sqrt(next - g.peek) * 3
      d.samples.push({ y, t: now })
      while (d.samples.length > 2 && now - d.samples[0].t > VELOCITY_WINDOW_MS) d.samples.shift()
      d.lastY = y
      pendingYRef.current = next
      if (!frameRef.current) frameRef.current = requestAnimationFrame(flush)
    }

    const finish = () => {
      const d = gestureRef.current
      gestureRef.current = null
      const g = geomRef.current
      if (!d || !g || d.mode !== 'drag') return
      if (frameRef.current) {
        cancelAnimationFrame(frameRef.current)
        frameRef.current = 0
      }
      const y = pendingYRef.current ?? yRef.current ?? stopOf(g, snapRef.current)
      pendingYRef.current = null
      const now = performance.now()
      const first = d.samples[0]
      const last = d.samples[d.samples.length - 1]
      // Doigt immobile avant de lâcher : pas d'élan.
      const velocity = first && last && last.t > first.t && now - last.t < VELOCITY_WINDOW_MS
        ? (last.y - first.y) / (last.t - first.t)
        : 0
      const projected = y + velocity * PROJECTION_MS
      const target = (['full', 'mid', 'peek'] as const).reduce((best, s) =>
        (Math.abs(stopOf(g, s) - projected) < Math.abs(stopOf(g, best) - projected) ? s : best), 'mid' as DetailSnap)
      lastDragEndRef.current = performance.now()
      paint(stopOf(g, target), true)
      if (target !== snapRef.current) onSnapChangeRef.current(target)
    }

    // Toucher : Touch Events, seuls à permettre de choisir EN COURS de geste
    // entre défilement natif et glisser (preventDefault sur touchmove).
    const onTouchStart = (e: TouchEvent) => {
      if (e.touches.length !== 1) {
        if (gestureRef.current?.mode === 'drag') finish()
        gestureRef.current = null
        return
      }
      begin(e.touches[0].clientX, e.touches[0].clientY, e.target)
    }
    const onTouchMove = (e: TouchEvent) => {
      const touch = e.touches[0]
      if (touch) move(touch.clientX, touch.clientY, e)
    }
    const onTouchEnd = () => finish()

    // Souris et stylet : Pointer Events (le toucher passe par les Touch Events).
    let unbind: (() => void) | null = null
    const onPointerDown = (e: PointerEvent) => {
      if (e.pointerType === 'touch' || e.button !== 0) return
      begin(e.clientX, e.clientY, e.target)
      const onMove = (ev: PointerEvent) => move(ev.clientX, ev.clientY, ev)
      const onUp = () => {
        unbind?.()
        finish()
      }
      window.addEventListener('pointermove', onMove)
      window.addEventListener('pointerup', onUp)
      window.addEventListener('pointercancel', onUp)
      unbind = () => {
        window.removeEventListener('pointermove', onMove)
        window.removeEventListener('pointerup', onUp)
        window.removeEventListener('pointercancel', onUp)
        unbind = null
      }
    }

    // Un glisser ne doit jamais valoir un tap (poignée, accordéon, retour).
    const onClickCapture = (e: MouseEvent) => {
      if (performance.now() - lastDragEndRef.current < 400) {
        e.preventDefault()
        e.stopPropagation()
      }
    }

    sheet.addEventListener('touchstart', onTouchStart, { passive: true })
    sheet.addEventListener('touchmove', onTouchMove, { passive: false })
    sheet.addEventListener('touchend', onTouchEnd)
    sheet.addEventListener('touchcancel', onTouchEnd)
    sheet.addEventListener('pointerdown', onPointerDown)
    sheet.addEventListener('click', onClickCapture, true)
    return () => {
      sheet.removeEventListener('touchstart', onTouchStart)
      sheet.removeEventListener('touchmove', onTouchMove)
      sheet.removeEventListener('touchend', onTouchEnd)
      sheet.removeEventListener('touchcancel', onTouchEnd)
      sheet.removeEventListener('pointerdown', onPointerDown)
      sheet.removeEventListener('click', onClickCapture, true)
      unbind?.()
      if (frameRef.current) cancelAnimationFrame(frameRef.current)
      frameRef.current = 0
      gestureRef.current = null
    }
  }, [wide, paint])

  // Poignée : réduit → milieu → plein → milieu.
  const cycleSnap = () => {
    onSnapChange(snap === 'peek' ? 'mid' : snap === 'mid' ? 'full' : 'mid')
  }

  // Clavier : un élément du fil qui reçoit le focus hors plein écran serait
  // masqué (fil non défilant) — la feuille s'agrandit.
  const onFocusCapture = (e: FocusEvent) => {
    if (wide || snap === 'full') return
    const target = e.target as HTMLElement
    const scroller = scrollRef.current
    // Seulement le fil (l'en-tête et le résumé restent toujours visibles), et
    // seulement un élément caché sous la barre du bas.
    if (!scroller?.contains(target)) return
    const region = sheetRef.current?.parentElement
    const limit = (region?.getBoundingClientRect().bottom ?? window.innerHeight) - 100
    if (target.getBoundingClientRect().bottom > limit) onSnapChange('full')
  }

  const full = snap === 'full'
  const pointer = interactive ? 'auto' : 'none'

  if (wide) {
    return (
      <div className="absolute inset-0 flex flex-col bg-white" style={{ pointerEvents: pointer }}>
        <div className="shrink-0" style={{ paddingTop: 'calc(env(safe-area-inset-top, 0px) + 12px)' }}>
          {header}
          {summary}
        </div>
        <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto">
          {topSlot}
          {children}
          <div className="h-[130px]" aria-hidden="true" />
        </div>
        <CtaBar>{footer}</CtaBar>
      </div>
    )
  }

  return (
    <>
      {/* Sonde de la zone sûre du haut (encoche, barre d'état en PWA). */}
      <div ref={probeRef} className="pointer-events-none invisible absolute inset-x-0 top-0" style={{ height: 'env(safe-area-inset-top, 0px)' }} aria-hidden="true" />

      {/* « Ma position » de la maquette : recadre la carte sur le trajet. */}
      <button
        ref={locateRef}
        type="button"
        onClick={onRefit}
        aria-label={t('page_fitRoute')}
        aria-hidden={full || undefined}
        tabIndex={full ? -1 : undefined}
        className="absolute end-[14px] top-0 z-[15] flex h-11 w-11 items-center justify-center rounded-[14px] bg-white shadow-[0_2px_10px_rgba(20,24,30,.16)]"
        style={{
          color: '#1E6FE0',
          visibility: geom ? 'visible' : 'hidden',
          pointerEvents: interactive && !full ? 'auto' : 'none',
        }}
      >
        <MyLocationIcon size={22} />
      </button>

      <div
        ref={sheetRef}
        className="absolute inset-x-0 top-0 z-20 flex select-none flex-col rounded-t-[26px] bg-white shadow-[0_-6px_24px_rgba(20,24,30,.12)]"
        style={{
          height: geom ? geom.height - geom.full : '100%',
          visibility: geom ? 'visible' : 'hidden',
          pointerEvents: pointer,
          // Le fil défilant (plein écran) garde le défilement natif vertical ;
          // partout ailleurs, la feuille gère seule le geste.
          touchAction: 'none',
        }}
        onFocusCapture={onFocusCapture}
      >
        <button
          type="button"
          onClick={cycleSnap}
          aria-expanded={full}
          aria-label={full ? t('page_showMap') : t('page_expandDetail')}
          className="flex h-[30px] w-full shrink-0 items-center justify-center"
          style={{ color: '#A3AAB3', cursor: 'grab' }}
        >
          {/* Pointe vers le bas en plein écran (0,3 s, même courbe). */}
          <ChevronUpIcon
            size={30}
            className={`transition-transform duration-300 ease-[cubic-bezier(.22,1,.36,1)] ${full ? 'rotate-180' : ''}`}
          />
        </button>
        {header}
        {summary}
        <div
          ref={scrollRef}
          className="min-h-0 flex-1"
          style={{
            overflowY: full ? 'auto' : 'hidden',
            overscrollBehaviorY: 'none',
            touchAction: full ? 'pan-y' : 'none',
          }}
        >
          {topSlot}
          {children}
          {/* Le bas du fil n'est jamais masqué par la barre « Commencer ». */}
          <div className="h-[130px]" aria-hidden="true" />
        </div>
      </div>

      <CtaBar interactive={interactive}>{footer}</CtaBar>
    </>
  )
}

function CtaBar({ children, interactive = true }: { children: ReactNode; interactive?: boolean }) {
  return (
    <div
      className="absolute inset-x-0 bottom-0 z-[25] border-t bg-white px-5 pt-3"
      style={{
        borderColor: '#EEF0F2',
        paddingBottom: 'max(30px, calc(env(safe-area-inset-bottom, 0px) + 10px))',
        pointerEvents: interactive ? 'auto' : 'none',
      }}
    >
      {children}
    </div>
  )
}

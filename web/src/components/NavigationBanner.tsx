'use client'

// Bandeau de navigation pas à pas (planche 1i) : carte d'étape en haut,
// feuille basse « Ensuite » + sortie. Tout le contenu vient de
// useNavigationSession().banner — ce composant ne calcule rien.

import { useEffect, useId, useRef } from 'react'
import { useTranslation } from '@/hooks/useTranslation'
import type { NavigationSession } from '@/hooks/useNavigationSession'
import { formatDuration } from '@/lib/otp'

interface NavigationBannerProps {
  session: NavigationSession
  onQuit: () => void
  /** Recalcul depuis la position actuelle (hors trajet). */
  onReroute?: () => void
}

export default function NavigationBanner({ session, onQuit, onReroute }: NavigationBannerProps) {
  const { t, locale } = useTranslation()
  const banner = session.banner
  const visible = session.active && Boolean(banner) && Boolean(session.itinerary)
  const titleId = useId()
  const cardRef = useRef<HTMLDivElement>(null)
  const focusedRef = useRef(false)

  // Entrée en navigation : le bouton « Commencer » vient de disparaître dans
  // un panneau devenu inerte. On porte le focus sur la carte d'étape (nommée
  // par la consigne) pour que le lecteur d'écran la lise et que le parcours
  // clavier reparte d'ici. Une seule fois par session : les changements
  // d'étape suivants passent par la région live, sans voler le focus.
  useEffect(() => {
    if (!visible) {
      focusedRef.current = false
      return
    }
    if (focusedRef.current) return
    focusedRef.current = true
    let done = false
    const frame = requestAnimationFrame(() => {
      done = true
      cardRef.current?.focus({ preventScroll: true })
    })
    return () => {
      cancelAnimationFrame(frame)
      if (!done) focusedRef.current = false
    }
  }, [visible])

  if (!visible || !banner || !session.itinerary) return null
  const { meta, itinerary } = session
  const fromName = meta?.fromName ?? itinerary.legs[0].from.name
  const toName = meta?.toName ?? itinerary.legs[itinerary.legs.length - 1].to.name

  return (
    <div className="pointer-events-none absolute inset-0 z-30">
      {/* Carte du haut : l'étape courante, rien d'autre */}
      <div
        ref={cardRef}
        tabIndex={-1}
        role="group"
        aria-labelledby={titleId}
        className="card-in-top pointer-events-auto absolute inset-x-5 rounded-card bg-white px-4 pb-3 pt-3.5 shadow-soft focus:outline-none"
        style={{ top: 'calc(env(safe-area-inset-top, 0px) + 14px)' }}
      >
        <div className="flex items-baseline justify-between gap-3">
          <span className="flex min-w-0 items-center gap-1.5">
            {banner.badge && (
              <span
                className="inline-flex h-5 min-w-[26px] shrink-0 items-center justify-center rounded-[6px] px-1.5 text-[11px] font-semibold text-white"
                style={{ backgroundColor: banner.badge.color }}
                dir="ltr"
              >
                {banner.badge.text}
              </span>
            )}
            <span className="truncate text-label font-semibold uppercase tracking-[0.06em] text-ink-600">
              {banner.context}
            </span>
          </span>
          {banner.eta && (
            <span className="tnum shrink-0 text-label text-ink-600">{banner.eta}</span>
          )}
        </div>
        {/* La consigne change en cours de trajet : région live, pour que
            l'usager au lecteur d'écran sache quand descendre sans balayer
            l'écran en boucle. Jamais tronquée (arrêts ETUSA jusqu'à 56
            caractères) : deux lignes. */}
        <p
          id={titleId}
          className={`mt-1 line-clamp-2 text-title font-semibold [overflow-wrap:anywhere] ${banner.approach ? 'text-brand' : 'text-ink-900'}`}
          role="status"
          aria-live={banner.approach ? 'assertive' : 'polite'}
          aria-atomic="true"
        >
          {banner.title}
        </p>
        {banner.detail && (
          <p className={`tnum mt-0.5 text-label ${banner.estimated ? 'text-ink-400' : 'text-ink-600'}`}>
            {banner.detail}
          </p>
        )}
        {banner.hint && (
          <p className="mt-1 text-label text-ink-600">{banner.hint}</p>
        )}
        {banner.showBoardButton && (
          <button
            type="button"
            onClick={session.confirmBoarded}
            className="tap mt-2.5 rounded-full border border-line px-3.5 py-2 text-body font-medium text-ink-900"
          >
            {t('nav_onBoard')}
          </button>
        )}
        <div className="mt-3 flex h-[3px] overflow-hidden rounded-[2px] bg-line">
          <span
            className={`rounded-[2px] transition-[width] duration-700 ${banner.estimated ? 'bg-ink-400' : 'bg-brand'}`}
            style={{ width: `${Math.round(banner.progress * 100)}%` }}
          />
        </div>
      </div>

      {/* Feuille basse : Ensuite + état du suivi + sortie, jamais de rouge */}
      <div className="sheet-in pointer-events-auto absolute inset-x-0 bottom-0 rounded-t-sheet bg-white shadow-[0_-4px_14px_rgba(16,24,40,0.07)]">
        {banner.next && (
          <div className="flex items-center gap-3 border-b border-line px-5 py-4">
            <span className="shrink-0 text-label font-semibold uppercase tracking-[0.06em] text-ink-400">
              {t('nextLabel')}
            </span>
            <span className="min-w-0 flex-1 truncate text-body text-ink-600">{banner.next}</span>
          </div>
        )}

        {banner.notice && (
          <p className="border-b border-line px-5 py-2.5 text-label text-ink-600" role="status">
            {banner.notice}
          </p>
        )}

        {/* Hors trajet : on le dit et on propose de repartir d'ici. */}
        {banner.offRoute && (
          <div className="flex items-center justify-between gap-3 border-b border-line px-5 py-2.5" role="status">
            <p className="min-w-0 text-label text-ink-900">{banner.offRoute}</p>
            {banner.canReroute && onReroute && (
              <button
                type="button"
                onClick={onReroute}
                className="tap shrink-0 text-label font-semibold text-brand"
              >
                {t('nav_reroute')}
              </button>
            )}
          </div>
        )}

        {/* Suivi dégradé (GPS perdu, imprécis, refusé, hors zone) : on le dit
            plutôt que de laisser croire à un suivi réel. */}
        {banner.note && (
          <p className="border-b border-line px-5 py-2.5 text-label text-ink-400" role="status">
            {banner.note}
          </p>
        )}

        <div
          className="flex items-center justify-between gap-3 px-5 pt-3"
          style={{ paddingBottom: 'max(30px, env(safe-area-inset-bottom, 0px))' }}
        >
          <button
            type="button"
            onClick={onQuit}
            className="tap relative shrink-0 whitespace-nowrap rounded-full border border-line px-4 py-2.5 text-body font-medium text-ink-900 after:absolute after:inset-x-0 after:-inset-y-[3px] after:content-['']"
          >
            {banner.quitLabel}
          </button>
          {/* Chaque nom est un isolat : en arabe, « départ ← arrivée » garde
              son sens même quand les deux noms sont en caractères latins. */}
          <span className="tnum min-w-0 truncate text-label text-ink-400">
            {/* Même règle que la liste et le détail (results-format,
                ItineraryPanel) : unité localisée, « ~ » dès qu'un véhicule est
                emprunté (fréquences, pas de temps réel). Isolat : le « ~ »
                reste collé au nombre en RTL. */}
            <bdi>{fromName}</bdi> {t('routeArrow')} <bdi>{toName}</bdi> ·{' '}
            <bdi>
              {itinerary.legs.some((leg) => leg.mode !== 'WALK') ? '~' : ''}
              {formatDuration(itinerary.duration, locale)}
            </bdi>
          </span>
        </div>
      </div>
    </div>
  )
}

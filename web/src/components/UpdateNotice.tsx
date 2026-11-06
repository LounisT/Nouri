'use client'

import { useEffect, useState } from 'react'
import { useTranslation } from '@/hooks/useTranslation'
import { applyAppUpdate, onAppUpdateReady, setAppBusy } from '@/lib/app-update'

interface UpdateNoticeProps {
  /**
   * L'app est occupée (navigation guidée, résultats affichés) : la nouvelle
   * version n'est PAS appliquée d'elle-même en arrière-plan.
   */
  busy: boolean
  /** Ne rien afficher (pendant la navigation guidée : rien ne distrait). */
  hidden?: boolean
  /** Distance au bas de l'écran (au-dessus de la barre d'onglets). */
  bottomOffset?: string
}

/**
 * Bandeau discret « Une nouvelle version est prête · Recharger ». Il ne
 * recharge JAMAIS de lui-même : l'usager choisit le moment, sinon la mise à
 * jour s'applique quand l'app passe en arrière-plan et n'est pas occupée.
 */
export default function UpdateNotice({
  busy,
  hidden = false,
  bottomOffset = 'calc(54px + env(safe-area-inset-bottom, 0px) + 12px)',
}: UpdateNoticeProps) {
  const { t } = useTranslation()
  const [ready, setReady] = useState(false)
  const [dismissed, setDismissed] = useState(false)

  useEffect(() => { setAppBusy(busy) }, [busy])
  useEffect(() => () => setAppBusy(false), [])
  useEffect(() => onAppUpdateReady(() => setReady(true)), [])

  if (!ready || dismissed || hidden) return null

  return (
    <div
      className="pointer-events-none fixed inset-x-0 z-[60] flex justify-center px-5"
      style={{ bottom: bottomOffset }}
    >
      <div
        role="status"
        aria-live="polite"
        className="pointer-events-auto flex max-w-md items-center gap-3 rounded-control bg-ink-900 py-1.5 pe-1.5 ps-4 text-body text-white shadow-soft"
        style={{ animation: 'toast-in 200ms ease-out' }}
      >
        <span className="min-w-0 flex-1">{t('ux_updateReady')}</span>
        <button
          type="button"
          onClick={applyAppUpdate}
          className="min-h-[44px] shrink-0 rounded-[10px] px-3 font-semibold text-brand-muted active:bg-[rgba(255,255,255,0.12)]"
        >
          {t('ux_reload')}
        </button>
        <button
          type="button"
          onClick={() => setDismissed(true)}
          aria-label={t('close')}
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[10px] text-white/70 active:bg-[rgba(255,255,255,0.12)]"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </svg>
        </button>
      </div>
    </div>
  )
}

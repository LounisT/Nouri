'use client'

import { useEffect } from 'react'
import { useTranslation } from '@/hooks/useTranslation'

// Frontière d'erreur de l'écran principal : une exception pendant le rendu
// affichait l'écran blanc de Next « Application error: a client-side
// exception has occurred ». On dit sobrement ce qui se passe, dans la langue
// de l'usager (le fournisseur de langue est au-dessus, dans layout.tsx), et on
// propose de recharger. Recharger plutôt que reset() : l'état fautif est
// souvent en mémoire, un nouvel essai de rendu retomberait sur la même erreur.
export default function AppError({ error }: { error: Error & { digest?: string }; reset: () => void }) {
  const { t } = useTranslation()

  useEffect(() => {
    // Trace pour le diagnostic (console du navigateur, rapport d'erreur).
    console.error(error)
  }, [error])

  return (
    <main
      className="flex h-full min-h-[100dvh] flex-col items-center justify-center bg-white px-6 text-center"
      role="alert"
    >
      <p className="text-title font-semibold text-ink-900">{t('ux_errorTitle')}</p>
      <p className="mt-2 max-w-sm text-body text-ink-600">{t('ux_errorBody')}</p>
      <button
        type="button"
        onClick={() => window.location.reload()}
        className="tap mt-5 inline-flex min-h-[44px] items-center justify-center rounded-control bg-brand px-6 text-emph font-semibold text-white active:bg-brand-dark"
      >
        {t('ux_reload')}
      </button>
      {error.digest && (
        <p className="mt-4 text-caption text-ink-400" dir="ltr">
          ref. {error.digest}
        </p>
      )}
    </main>
  )
}

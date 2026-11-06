'use client'

import { useEffect } from 'react'
import { uxStrings } from '@/lib/strings/ux'

// Dernier filet : une erreur dans le layout racine lui-même (fournisseur de
// langue compris). Next remplace alors TOUT le document : ce composant rend
// son propre <html> et <body>, sans fournisseur ni feuille de style de l'app.
// La langue de l'usager n'est pas connue avec certitude ici — le message est
// donné dans les trois langues, l'arabe dans son propre sens d'écriture.
const LANGS = [
  { code: 'fr', dir: 'ltr' },
  { code: 'ar', dir: 'rtl' },
  { code: 'en', dir: 'ltr' },
] as const

export default function GlobalError({ error }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error)
  }, [error])

  return (
    <html lang="fr" dir="ltr">
      <body
        style={{
          margin: 0,
          minHeight: '100dvh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: '#ffffff',
          color: '#111827',
          fontFamily: 'system-ui, -apple-system, "Segoe UI", Roboto, "Noto Sans Arabic", sans-serif',
        }}
      >
        <main role="alert" style={{ maxWidth: 360, padding: 24, textAlign: 'center' }}>
          {LANGS.map(({ code, dir }) => (
            <div key={code} lang={code} dir={dir} style={{ marginBottom: 18 }}>
              <p style={{ margin: 0, fontSize: 17, fontWeight: 600, lineHeight: '22px' }}>
                {uxStrings[code].ux_errorTitle}
              </p>
              <p style={{ margin: '4px 0 0', fontSize: 14, lineHeight: '20px', color: '#4B5563' }}>
                {uxStrings[code].ux_errorBody}
              </p>
            </div>
          ))}
          <button
            type="button"
            onClick={() => window.location.reload()}
            style={{
              minHeight: 44,
              padding: '0 24px',
              border: 0,
              borderRadius: 12,
              background: '#1D6FE0',
              color: '#ffffff',
              fontSize: 15,
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            {uxStrings.fr.ux_reload} · <span lang="ar">{uxStrings.ar.ux_reload}</span> · {uxStrings.en.ux_reload}
          </button>
        </main>
      </body>
    </html>
  )
}

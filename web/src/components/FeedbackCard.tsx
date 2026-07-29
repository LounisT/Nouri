'use client'

import { useState } from 'react'
import { useTranslation } from '@/hooks/useTranslation'

// Destinataire des retours. Pas de backend : le bouton ouvre le client mail de
// l'usager pré-rempli (mailto). Aucun secret, aucun envoi silencieux qui
// pourrait échouer sans qu'on le sache — cf. principe d'honnêteté du projet.
const CONTACT_EMAIL = 'contact@lounis.dev'

// Section « Nous écrire » de l'accueil (bas de la zone scrollable). Comble le
// blanc sous Raccourcis/Récents et donne un canal bug/contact honnête.
export default function FeedbackCard() {
  const { t } = useTranslation()
  const [message, setMessage] = useState('')

  const canSend = message.trim().length > 0
  const mailto =
    `mailto:${CONTACT_EMAIL}` +
    `?subject=${encodeURIComponent(t('feedbackSubject'))}` +
    `&body=${encodeURIComponent(message)}`

  return (
    <section className="border-t-8 border-paper-2">
      <p className="px-5 pb-2 pt-3.5 text-label font-semibold uppercase tracking-[0.06em] text-ink-600">
        {t('feedbackTitle')}
      </p>
      <div className="px-5 pb-5">
        <p className="text-label text-ink-400">{t('feedbackHint')}</p>

        {/* Pas de <form> imbriqué : SearchBar EST déjà un <form> (recherche
            d'itinéraire). Un textarea + un lien mailto n'y déclenchent rien. */}
        <textarea
          value={message}
          onChange={(event) => setMessage(event.target.value)}
          placeholder={t('feedbackPlaceholder')}
          rows={3}
          className="mt-2.5 w-full resize-none rounded-control bg-paper-2 px-3.5 py-2.5 text-body text-ink-900 placeholder-ink-400 focus:outline-none focus:ring-0"
        />

        <div className="mt-2.5 flex justify-end">
          {/* Un seul traitement : pilule bordée. Pas de plein bleu — le seul CTA
              plein de l'accueil reste « Trouver un itinéraire ». */}
          <a
            href={canSend ? mailto : undefined}
            aria-disabled={!canSend}
            onClick={(event) => { if (!canSend) event.preventDefault() }}
            className={`tap inline-flex items-center gap-2 rounded-full border border-line px-4 py-2.5 text-body font-medium ${
              canSend ? 'text-ink-900' : 'pointer-events-none text-ink-400 opacity-60'
            }`}
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <rect x="3" y="5" width="18" height="14" rx="2.5" stroke="currentColor" strokeWidth="1.8" />
              <path d="M4 7l8 6 8-6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            {t('feedbackSend')}
          </a>
        </div>
      </div>
    </section>
  )
}

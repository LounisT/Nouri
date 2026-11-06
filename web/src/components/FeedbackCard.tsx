'use client'

import { useId, useState } from 'react'
import { useTranslation } from '@/hooks/useTranslation'
import { reportMailto, reportSummary, type ReportContext } from '@/lib/report'

// Pas de backend : les boutons ouvrent le client mail de l'usager, pré-rempli
// (mailto). Aucun secret, aucun envoi silencieux qui pourrait échouer sans
// qu'on le sache — cf. principe d'honnêteté du projet. Destinataire et format
// du message : lib/report.ts.

const MailIcon = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <rect x="3" y="5" width="18" height="14" rx="2.5" stroke="currentColor" strokeWidth="1.8" />
    <path d="M4 7l8 6 8-6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
)

/**
 * Lien discret « Signaler une erreur » à poser sous une fiche (ligne, arrêt,
 * itinéraire). Le mail part pré-rempli avec le contexte (ligne, sens, arrêt,
 * coordonnées, trajet demandé) : l'usager n'a plus qu'à dire ce qui est faux.
 *
 *   <ReportLink context={{ kind: 'line', line: '88', direction: 'Ben Aknoun' }} />
 *   <ReportLink context={{ kind: 'stop', stop: { name, lat, lon }, lines: ['88 → Ben Aknoun'] }} />
 *   <ReportLink context={{ kind: 'itinerary', from, to, requested, legs }} />
 */
export function ReportLink({ context, className = '' }: { context: ReportContext; className?: string }) {
  const { t, locale } = useTranslation()
  return (
    <a
      href={reportMailto(context, locale)}
      className={`tap inline-flex min-h-[44px] items-center gap-2 rounded-[8px] text-body font-medium text-ink-600 ${className}`}
    >
      <MailIcon />
      {t('ux_reportError')}
    </a>
  )
}

/**
 * Section « Nous écrire » (bas de l'accueil, ou toute fiche qui veut un champ
 * libre). Avec `context`, le message joint ce contexte et le résume à l'écran
 * pour que l'usager sache ce qui part avec son texte.
 */
export default function FeedbackCard({ context }: { context?: ReportContext } = {}) {
  const { t, locale } = useTranslation()
  const uid = useId()
  const [message, setMessage] = useState('')
  const ctx: ReportContext = context ?? { kind: 'general' }
  const summary = reportSummary(ctx, locale)

  const canSend = message.trim().length > 0
  const mailto = reportMailto(ctx, locale, message)

  return (
    <section className="border-t-8 border-paper-2" aria-labelledby={`${uid}-title`}>
      <p id={`${uid}-title`} className="px-5 pb-2 pt-3.5 text-label font-semibold uppercase tracking-[0.06em] text-ink-600">
        {t('feedbackTitle')}
      </p>
      <div className="px-5 pb-5">
        <p className="text-label text-ink-600">{t('feedbackHint')}</p>
        {summary && (
          <p className="mt-1.5 text-label text-ink-600">
            {t('ux_reportContextNote')} <bdi className="font-medium text-ink-900">{summary}</bdi>
          </p>
        )}

        {/* Pas de <form> imbriqué : SearchBar EST déjà un <form> (recherche
            d'itinéraire). Un textarea + un lien mailto n'y déclenchent rien.
            16 px : en dessous, iOS zoome sur le champ et la page reste zoomée. */}
        <label htmlFor={`${uid}-message`} className="sr-only">{t('feedbackTitle')}</label>
        <textarea
          id={`${uid}-message`}
          value={message}
          onChange={(event) => setMessage(event.target.value)}
          placeholder={t('feedbackPlaceholder')}
          rows={3}
          // Vide, dir=auto vaut LTR (spéc. HTML) et le placeholder arabe partirait
          // à gauche : on suit alors la langue de l'interface (comme LineView).
          dir={message ? 'auto' : locale === 'ar' ? 'rtl' : 'ltr'}
          className="mt-2.5 w-full resize-none rounded-control bg-paper-2 px-3.5 py-2.5 text-[16px] leading-[22px] text-ink-900 placeholder-ink-400 focus:outline-none focus:ring-2 focus:ring-brand"
        />

        <div className="mt-2.5 flex justify-end">
          {/* Un seul traitement : pilule bordée. Pas de plein bleu — le seul CTA
              plein de l'accueil reste « Trouver un itinéraire ». */}
          <a
            href={canSend ? mailto : undefined}
            aria-disabled={!canSend}
            onClick={(event) => { if (!canSend) event.preventDefault() }}
            className={`tap inline-flex min-h-[44px] items-center gap-2 rounded-full border border-line px-4 py-2.5 text-body font-medium ${
              canSend ? 'text-ink-900' : 'pointer-events-none text-ink-400 opacity-60'
            }`}
          >
            <MailIcon />
            {t('feedbackSend')}
          </a>
        </div>
      </div>
    </section>
  )
}

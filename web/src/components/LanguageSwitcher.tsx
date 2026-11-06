'use client'

import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { LOCALES } from '@/lib/i18n'
import { useTranslation } from '@/hooks/useTranslation'
import { useBackHandler } from '@/hooks/useBackHandler'

// Motif « disclosure » : un bouton qui déplie une courte liste de langues.
// Pas de role="menu" : il imposerait une navigation aux flèches que cette
// liste de trois boutons n'a pas besoin d'avoir.
export default function LanguageSwitcher() {
  const { locale, setLocale, t } = useTranslation()
  const [open, setOpen] = useState(false)
  const current = LOCALES.find((l) => l.code === locale)
  const panelId = useId()
  const triggerRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)

  const close = useCallback((returnFocus = true) => {
    setOpen(false)
    if (returnFocus) requestAnimationFrame(() => triggerRef.current?.focus())
  }, [])

  // Retour Android / geste iOS : referme la liste au lieu de quitter l'app.
  useBackHandler(open, () => close(false))

  useEffect(() => {
    if (!open) return
    // Clavier : le focus va sur la langue en cours ; Échap referme.
    panelRef.current?.querySelector<HTMLButtonElement>('[aria-current="true"]')?.focus()
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      close()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, close])

  const shortLabel = locale === 'ar' ? 'عربية' : current?.code.toUpperCase()

  return (
    <div className="relative">
      {/* Déclencheur façon planche : texte simple + chevron, aucun fond ni bordure.
          Le nom accessible garde la langue visible (WCAG 2.5.3). */}
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="tap flex min-h-[44px] min-w-[44px] items-center justify-center gap-1 rounded-[8px] px-2 text-[13px] font-medium text-ink-600"
        aria-label={`${t('ux_changeLanguage')} (${current?.label ?? ''})`}
        aria-expanded={open}
        aria-controls={panelId}
      >
        <span lang={locale}>{shortLabel}</span>
        <svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden="true">
          <path d="M2 4l3 3 3-3" stroke="#6B7280" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
      </button>

      {open && (
        <div
          ref={panelRef}
          id={panelId}
          className="absolute end-0 top-full z-50 mt-1 min-w-[160px] overflow-hidden rounded-card bg-white shadow-soft"
          style={{ animation: 'fadeIn 200ms ease both' }}
        >
          {/* Rangées plates séparées par des filets. UN seul marqueur d'état :
              la coche bleue. Le fond teinté + le gras + la coche disaient trois
              fois la même chose. Les drapeaux sont retirés : un drapeau désigne
              un pays, pas une langue — 🇩🇿 pour l'arabe et 🇬🇧 pour l'anglais
              n'ont aucun sens dans une app algérienne. */}
          {LOCALES.map((l, i) => (
            <button
              key={l.code}
              type="button"
              onClick={() => { setLocale(l.code); close() }}
              aria-current={locale === l.code ? 'true' : undefined}
              lang={l.code}
              className={`tap flex min-h-[48px] w-full items-center gap-3 px-4 py-2.5 text-start text-emph text-ink-900 transition-colors active:bg-paper-2 ${
                i < LOCALES.length - 1 ? 'border-b border-line' : ''
              }`}
            >
              <span className="min-w-0 flex-1 truncate">{l.label}</span>
              {locale === l.code && (
                <svg width="16" height="16" viewBox="0 0 20 20" fill="currentColor" className="shrink-0 text-brand" aria-hidden="true">
                  <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                </svg>
              )}
            </button>
          ))}
        </div>
      )}

      {open && (
        <div className="fixed inset-0 z-40" onClick={() => close(false)} aria-hidden="true" />
      )}
    </div>
  )
}

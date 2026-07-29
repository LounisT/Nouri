'use client'

import { useState } from 'react'
import { LOCALES } from '@/lib/i18n'
import { useTranslation } from '@/hooks/useTranslation'

export default function LanguageSwitcher() {
  const { locale, setLocale } = useTranslation()
  const [open, setOpen] = useState(false)
  const current = LOCALES.find(l => l.code === locale)

  return (
    <div className="relative">
      {/* Déclencheur façon planche : texte simple + chevron, aucun fond ni bordure */}
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        className="tap flex min-h-[36px] items-center gap-1 px-1 py-2 text-[13px] font-medium text-ink-600"
        aria-label="Changer de langue"
      >
        {locale === 'ar' ? 'عربية' : current?.code.toUpperCase()}
        <svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden="true">
          <path d="M2 4l3 3 3-3" stroke="#9CA3AF" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
      </button>

      {open && (
        <div
          className="absolute top-full mt-1 ltr:right-0 rtl:left-0 bg-white rounded-card shadow-soft overflow-hidden z-50 min-w-[140px]"
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
              onClick={() => { setLocale(l.code); setOpen(false) }}
              aria-current={locale === l.code ? 'true' : undefined}
              lang={l.code}
              className={`tap flex min-h-[44px] w-full items-center gap-3 px-4 py-2.5 text-start text-body text-ink-900 transition-colors active:bg-paper-2 ${
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
        <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
      )}
    </div>
  )
}

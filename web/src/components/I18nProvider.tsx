'use client'

import { useState, useEffect, useCallback } from 'react'
import { MotionConfig } from 'framer-motion'
import { I18nContext } from '@/hooks/useTranslation'
import { translations, LOCALES, type Locale, type TranslationKey } from '@/lib/i18n'

export default function I18nProvider({ children }: { children: React.ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>('fr')

  // Charger la langue sauvegardée + appliquer dir sur <html>
  useEffect(() => {
    const saved = localStorage.getItem('locale') as Locale | null
    if (saved && translations[saved]) setLocaleState(saved)
  }, [])

  useEffect(() => {
    const info = LOCALES.find(l => l.code === locale)
    document.documentElement.lang = locale
    document.documentElement.dir  = info?.dir ?? 'ltr'
  }, [locale])

  const setLocale = useCallback((l: Locale) => {
    setLocaleState(l)
    localStorage.setItem('locale', l)
  }, [])

  const t = useCallback((key: TranslationKey): string => {
    return translations[locale][key] ?? translations.fr[key] ?? key
  }, [locale])

  return (
    <I18nContext.Provider value={{ locale, setLocale, t }}>
      {/* Mouvement réduit : framer-motion anime en JavaScript, hors de portée
          du bloc @media de globals.css qui ne pilote que le CSS. « user » suit
          le réglage système — il supprime déplacements et changements
          d'échelle, et laisse passer les fondus d'opacité : un changement
          d'état reste lisible, seul le mouvement disparaît. */}
      <MotionConfig reducedMotion="user">
        {children}
      </MotionConfig>
    </I18nContext.Provider>
  )
}

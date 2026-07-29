'use client'

import { createContext, useContext } from 'react'
import type { Locale, TranslationKey } from '@/lib/i18n'
import { translations } from '@/lib/i18n'

export interface I18nContextValue {
  locale: Locale
  setLocale: (l: Locale) => void
  t: (key: TranslationKey) => string
}

export const I18nContext = createContext<I18nContextValue>({
  locale: 'fr',
  setLocale: () => {},
  t: (key) => translations.fr[key],
})

export function useTranslation() {
  return useContext(I18nContext)
}

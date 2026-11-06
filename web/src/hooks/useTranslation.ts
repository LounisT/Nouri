'use client'

import { createContext, useContext } from 'react'
import type { Locale, PluralBase, TranslationKey, TranslationVars } from '@/lib/i18n'
import { translate, pluralize } from '@/lib/i18n'

export interface I18nContextValue {
  locale: Locale
  /** Choix EXPLICITE de l'usager : mémorisé. La langue détectée ne l'est pas. */
  setLocale: (l: Locale) => void
  t: (key: TranslationKey) => string
  /** Traduction avec variables : tf('itin_departAt', { time: '08:30' }). */
  tf: (key: TranslationKey, vars: TranslationVars) => string
  /**
   * Nombre + nom accordé selon la langue : tn('ux_stopsLeft', 1) →
   * « 1 arrêt restant » / « محطة واحدة متبقية » / « 1 stop left ».
   * Jamais `${n} ${t('stops')}` : l'arabe accorde le nom selon le nombre.
   */
  tn: (base: PluralBase, n: number, vars?: TranslationVars) => string
}

export const I18nContext = createContext<I18nContextValue>({
  locale: 'fr',
  setLocale: () => {},
  t: (key) => translate('fr', key),
  tf: (key, vars) => translate('fr', key, vars),
  tn: (base, n, vars) => pluralize('fr', base, n, vars),
})

export function useTranslation() {
  return useContext(I18nContext)
}

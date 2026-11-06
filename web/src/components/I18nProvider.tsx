'use client'

import { useState, useEffect, useLayoutEffect, useCallback, useMemo, useRef } from 'react'
import { MotionConfig } from 'framer-motion'
import { I18nContext } from '@/hooks/useTranslation'
import {
  LOCALES,
  LOCALE_STORAGE_KEY,
  detectLocale,
  isLocale,
  pluralize,
  translate,
  type Locale,
  type PluralBase,
  type TranslationKey,
  type TranslationVars,
} from '@/lib/i18n'

// useLayoutEffect ne s'exécute pas côté serveur (et y émet un avertissement) :
// on retombe sur useEffect pendant le rendu serveur.
const useIsoLayoutEffect = typeof window !== 'undefined' ? useLayoutEffect : useEffect

// Le stockage peut lever une SecurityError (cookies et données de site
// bloqués, certains modes privés) : sans garde, toute l'app tombait sur
// « Application error » dès le premier rendu.
function readSavedLocale(): Locale | null {
  try {
    const saved = window.localStorage.getItem(LOCALE_STORAGE_KEY)
    return isLocale(saved) ? saved : null
  } catch {
    return null
  }
}

function writeSavedLocale(locale: Locale) {
  try {
    window.localStorage.setItem(LOCALE_STORAGE_KEY, locale)
  } catch {
    // Stockage indisponible : le choix vaut pour cette session seulement.
  }
}

/**
 * Langue de départ côté client. Le script inline de layout.tsx a déjà posé
 * `<html lang>` (choix enregistré, sinon langue du téléphone) avant le
 * premier affichage ; on la relit. Sans ce script (bloqué, ancien cache), on
 * refait le même calcul ici.
 */
function initialClientLocale(): Locale {
  const fromHtml = document.documentElement.getAttribute('lang')
  if (isLocale(fromHtml) && document.documentElement.hasAttribute('data-locale-resolved')) return fromHtml
  return readSavedLocale() ?? detectLocale(navigator.languages?.length ? navigator.languages : [navigator.language])
}

export default function I18nProvider({ children }: { children: React.ReactNode }) {
  // 'fr' au premier rendu : c'est ce que le serveur a rendu, l'hydratation doit
  // retrouver le même texte. La vraie langue est appliquée juste après, AVANT
  // que le navigateur ne peigne (effet de mise en page).
  const [locale, setLocaleState] = useState<Locale>('fr')
  const [resolved, setResolved] = useState(false)
  // Vrai dès que l'usager a choisi lui-même : la langue du téléphone ne
  // s'impose plus ensuite.
  const explicitRef = useRef(false)

  useIsoLayoutEffect(() => {
    const initial = initialClientLocale()
    explicitRef.current = readSavedLocale() !== null
    setLocaleState(initial)
    setResolved(true)
  }, [])

  // N'écrit lang/dir qu'une fois la langue résolue : sinon le premier passage
  // (« fr ») remettait dir="ltr" pendant une image sur un téléphone en arabe.
  useIsoLayoutEffect(() => {
    if (!resolved) return
    const root = document.documentElement
    const info = LOCALES.find((l) => l.code === locale)
    root.lang = locale
    root.dir = info?.dir ?? 'ltr'
    // Le script inline masque la page tant que la langue n'est pas appliquée
    // (pas de français de gauche à droite qui se retourne en arabe).
    root.removeAttribute('data-i18n-pending')
    try {
      document.title = translate(locale, 'ux_appTitle')
    } catch {
      // document.title en lecture seule (contexte exotique) : sans gravité.
    }
  }, [locale, resolved])

  // Tant que l'usager n'a rien choisi, l'app suit la langue du téléphone,
  // y compris si elle change pendant que l'app est ouverte.
  useEffect(() => {
    const onLanguageChange = () => {
      if (explicitRef.current) return
      setLocaleState(detectLocale(navigator.languages?.length ? navigator.languages : [navigator.language]))
    }
    window.addEventListener('languagechange', onLanguageChange)
    return () => window.removeEventListener('languagechange', onLanguageChange)
  }, [])

  const setLocale = useCallback((l: Locale) => {
    explicitRef.current = true
    setLocaleState(l)
    writeSavedLocale(l)
  }, [])

  const t = useCallback((key: TranslationKey): string => translate(locale, key), [locale])
  const tf = useCallback((key: TranslationKey, vars: TranslationVars) => translate(locale, key, vars), [locale])
  const tn = useCallback(
    (base: PluralBase, n: number, vars?: TranslationVars) => pluralize(locale, base, n, vars),
    [locale],
  )

  const value = useMemo(() => ({ locale, setLocale, t, tf, tn }), [locale, setLocale, t, tf, tn])

  return (
    <I18nContext.Provider value={value}>
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

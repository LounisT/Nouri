'use client'

import { useTranslation } from '@/hooks/useTranslation'

const ARABIC = /[؀-ۿ]/

/**
 * « départ → arrivée » lisible dans les trois langues.
 *
 * Chaque nom est un isolat bidi (<bdi>) : sans lui, en arabe, deux noms en
 * caractères latins (« Grande Poste ← Bab Ezzouar ») entraînaient la flèche
 * neutre dans leur sens gauche-à-droite et toute la chaîne se lisait à
 * l'envers — la flèche pointait vers le départ. Isolés, les noms comptent
 * comme des neutres et la phrase suit le sens du document : en arabe, départ
 * à droite, « ← », arrivée à gauche.
 *
 * En arabe, un nom sans lettre arabe (arrêts OTP, adresses Photon) reçoit
 * `lang="fr"` : le lecteur d'écran le prononce en français plutôt qu'avec la
 * voix arabe.
 */
export default function RouteLabel({ from, to }: { from?: string | null; to?: string | null }) {
  const { t, locale } = useTranslation()
  const name = (text?: string | null) => {
    const value = text ?? '…'
    return <bdi lang={locale === 'ar' && !ARABIC.test(value) ? 'fr' : undefined}>{value}</bdi>
  }
  return (
    <>
      {name(from)} {t('routeArrow')} {name(to)}
    </>
  )
}

/** Un seul nom (départ ou arrivée), isolé comme dans RouteLabel. */
export function PlaceLabel({ name }: { name?: string | null }) {
  const { locale } = useTranslation()
  const value = name ?? '…'
  return <bdi lang={locale === 'ar' && !ARABIC.test(value) ? 'fr' : undefined}>{value}</bdi>
}

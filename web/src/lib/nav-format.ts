// Petits utilitaires de mise en forme pour la navigation et le détail
// d'itinéraire : gabarits « {n} », pluriels (dont le duel arabe), distances
// et minutes localisées, noms d'arrêts en arabe quand on les connaît.
//
// Chiffres toujours latins (usage courant en Algérie, et c'est ce que montre
// la signalétique) : on n'utilise jamais Intl.NumberFormat('ar').
import type { Locale, TranslationKey } from './i18n'
import { allStations } from './stations'

export type Translate = (key: TranslationKey) => string

/** Remplace les « {clé} » d'un gabarit traduit. */
export function fill(template: string, vars: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (match, key: string) => (key in vars ? String(vars[key]) : match))
}

/**
 * Isole un nom propre (FSI … PDI) : un nom d'arrêt latin dans une phrase
 * arabe, ou une heure, ne doit pas entraîner la ponctuation voisine dans son
 * propre sens d'écriture. Invisible à l'écran et pour les lecteurs d'écran.
 */
export function isolate(text: string): string {
  return `⁨${text}⁩`
}

export type PluralCategory = 'one' | 'two' | 'few' | 'many' | 'other'

/** Catégorie de pluriel CLDR : l'arabe a un duel (2) et un « few » (3-10). */
export function pluralCategory(n: number, locale: Locale): PluralCategory {
  try {
    const category = new Intl.PluralRules(locale).select(n)
    return category === 'zero' ? 'other' : (category as PluralCategory)
  } catch {
    return n === 1 ? 'one' : 'other'
  }
}

/** « 1 arrêt » / « 3 arrêts » / « محطتان »… à partir de clés `${base}_${catégorie}`. */
export function plural(
  n: number,
  base: 'nav_stops' | 'nav_stopsLeft',
  t: Translate,
  locale: Locale,
): string {
  const key = `${base}_${pluralCategory(n, locale)}` as TranslationKey
  return fill(t(key), { n })
}

/** Distance à pied : « 350 m », « 1,2 km », « 350 م ». */
export function formatMeters(meters: number, locale: Locale): string {
  const m = Math.max(0, meters)
  if (m < 950) {
    const rounded = m < 100 ? Math.max(5, Math.round(m / 5) * 5) : Math.round(m / 10) * 10
    return `${rounded} ${locale === 'ar' ? 'م' : 'm'}`
  }
  const km = Math.round(m / 100) / 10
  const text = Number.isInteger(km) ? String(km) : km.toFixed(1)
  return `${locale === 'fr' ? text.replace('.', ',') : text} ${locale === 'ar' ? 'كم' : 'km'}`
}

/** « 5 min » / « 5 د » : abréviation invariable, pas d'accord à faire en arabe. */
export function formatMinutes(minutes: number, t: Translate): string {
  return `${Math.max(1, Math.round(minutes))} ${t('nav_minShort')}`
}

const stationById = new Map(allStations.map((s) => [s.id, s]))
const stationByName = new Map(allStations.map((s) => [s.name, s]))

/**
 * Nom d'un arrêt dans la langue de l'interface. OTP est interrogé en français
 * (les girouettes servent de clés) ; le nom arabe vient de `nameAr`, posé par
 * otp.ts (stations.ts pour le rail, name:ar OSM pour les bus quand il existe),
 * sinon de stations.ts. Sans nom arabe sourcé, on garde le nom d'origine
 * plutôt que d'en inventer un.
 */
export function placeName(
  place: { name: string; stopId?: string; nameAr?: string },
  locale: Locale,
): string {
  if (locale !== 'ar') return place.name
  if (place.nameAr) return place.nameAr
  const id = place.stopId?.split(':').pop()
  const station = (id ? stationById.get(id) : undefined) ?? stationByName.get(place.name)
  return station?.nameAr ?? place.name
}

/**
 * Couleur de fond des pastilles de ligne qui portent un texte BLANC. Les
 * couleurs de carte (#D97706 bus, #059669 tram) n'atteignent pas le contraste
 * AA de 4,5:1 sur du texte de 12 px : on prend leur teinte foncée.
 */
export function badgeColor(mode: string): string {
  switch (mode) {
    case 'SUBWAY': return '#1E3A8A' // 10,4:1
    case 'TRAM': return '#047857' // 5,5:1
    case 'BUS': return '#B45309' // 5,0:1
    case 'RAIL': return '#6D28D9'
    default: return '#4B5563'
  }
}

/**
 * Teinte claire dérivée d'une couleur de ligne (fond des pastilles et de la
 * puce d'attente) : la couleur mélangée au blanc. L'identité de la ligne
 * reste portée par la pastille pleine (badgeColor) ; la teinte n'est qu'un
 * fond, jamais une nouvelle couleur de ligne.
 */
export function lineTint(color: string, amount = 0.12): string {
  const hex = color.replace('#', '')
  const full = hex.length === 3 ? hex.split('').map((c) => c + c).join('') : hex
  const value = Number.parseInt(full, 16)
  if (full.length !== 6 || Number.isNaN(value)) return '#F1F3F5'
  const mix = (channel: number) => Math.round(255 - (255 - channel) * amount)
  const r = mix((value >> 16) & 255)
  const g = mix((value >> 8) & 255)
  const b = mix(value & 255)
  return `#${((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1).toUpperCase()}`
}

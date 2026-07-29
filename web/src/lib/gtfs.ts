// Fréquences de service du métro et du tramway, d'après frequencies.txt.
//
// ⚠️ Ce module ne calcule PAS de prochain passage, et ne doit jamais le faire.
// Alger n'a aucun flux temps réel : aucun véhicule n'émet sa position. Une
// version précédente fabriquait un décompte à partir de l'heure courante
// (`headway - (secondes % headway)`) et affichait « Dans 3 min » ou « À quai ».
// Ce chiffre ne correspondait à rien — il donnait juste à l'usager la
// confiance d'un temps réel qui n'existe pas, jusqu'à le laisser croire qu'une
// rame était à quai. On ne renvoie donc que ce qu'on sait vraiment : la
// fréquence en vigueur, et si le service est ouvert.

interface FrequencyRange {
  startH: number  // heure début (0-23)
  endH: number    // heure fin (0-23)
  headwaySecs: number
}

// peak : 07-09h et 17-21h → toutes les 5 min
// off-peak : 05-07h, 09-17h, 21-23h → toutes les 10 min
// hors service : 23h-05h
const FREQUENCIES: FrequencyRange[] = [
  { startH: 5,  endH: 7,  headwaySecs: 600 },
  { startH: 7,  endH: 9,  headwaySecs: 300 },
  { startH: 9,  endH: 17, headwaySecs: 600 },
  { startH: 17, endH: 21, headwaySecs: 300 },
  { startH: 21, endH: 23, headwaySecs: 600 },
]

export interface ServiceFrequency {
  /** Fréquence en vigueur, en secondes. 0 hors service. */
  headwaySecs: number
  /** Service en cours à cette heure-ci. */
  isOpen: boolean
}

/** Fréquence en vigueur maintenant — jamais un temps d'attente. */
export function getServiceFrequency(now: Date = new Date()): ServiceFrequency {
  const totalSecs = now.getHours() * 3600 + now.getMinutes() * 60 + now.getSeconds()
  const range = FREQUENCIES.find(
    (r) => totalSecs >= r.startH * 3600 && totalSecs < r.endH * 3600,
  )
  return range
    ? { headwaySecs: range.headwaySecs, isOpen: true }
    : { headwaySecs: 0, isOpen: false }
}

export function getHeadwayLabel(headwaySecs: number, locale: Locale = 'fr'): string {
  if (headwaySecs === 300) {
    return locale === 'ar' ? 'كل 5 دقائق' : locale === 'en' ? 'Every 5 min' : 'Toutes les 5 min'
  }
  return locale === 'ar' ? 'كل 10 دقائق' : locale === 'en' ? 'Every 10 min' : 'Toutes les 10 min'
}

import type { Locale } from './i18n'

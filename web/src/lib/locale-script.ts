// Script inline exécuté dans <head> AVANT le premier affichage (layout.tsx).
// Il applique la langue — choix enregistré, sinon langue du téléphone — à
// <html lang/dir> et au titre, avant que React ne s'hydrate. Sans lui, un
// téléphone en arabe voyait l'interface française de gauche à droite puis
// tout se retourner (~0,5 s à chaque lancement).
//
// Hors français, la page reste masquée (`data-i18n-pending`, globals.css)
// jusqu'au premier rendu dans la bonne langue : I18nProvider retire
// l'attribut. Un délai de secours la montre quoi qu'il arrive si le
// JavaScript de l'app tarde ou échoue.
//
// La règle de détection doit rester celle de detectLocale (lib/i18n.ts) :
// web/scripts/ux/check-i18n.js vérifie que les deux s'accordent.

import { LOCALE_STORAGE_KEY } from './i18n'
import { uxStrings } from './strings/ux'

export const I18N_PENDING_MAX_MS = 1200

export function buildLocaleScript(): string {
  const titles = JSON.stringify({
    fr: uxStrings.fr.ux_appTitle,
    ar: uxStrings.ar.ux_appTitle,
    en: uxStrings.en.ux_appTitle,
  })
  const key = JSON.stringify(LOCALE_STORAGE_KEY)
  return `(function(){try{var d=document.documentElement,l=null;try{l=window.localStorage.getItem(${key})}catch(e){}`
    + `if(l!=='fr'&&l!=='ar'&&l!=='en'){l='fr';var n=navigator.languages&&navigator.languages.length?navigator.languages:[navigator.language||''];`
    + `for(var i=0;i<n.length;i++){var c=String(n[i]||'').toLowerCase();`
    + `if(c.indexOf('ar')===0){l='ar';break}if(c.indexOf('fr')===0){l='fr';break}if(c.indexOf('en')===0){l='en';break}}}`
    + `d.lang=l;d.dir=l==='ar'?'rtl':'ltr';d.setAttribute('data-locale-resolved','');`
    + `if(l!=='fr'){d.setAttribute('data-i18n-pending','');document.title=${titles}[l];`
    + `setTimeout(function(){d.removeAttribute('data-i18n-pending')},${I18N_PENDING_MAX_MS})}}catch(e){}})()`
}

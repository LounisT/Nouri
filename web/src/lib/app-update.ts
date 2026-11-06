// Mise à jour de l'application, sans jamais recharger sous les doigts de
// l'usager. Le mécanisme vit dans public/sw-register.js (script classique,
// chargé avant React) ; ce module en est la façade typée pour l'interface.
//
// Cycle :
// 1. Un nouveau service worker s'installe et ATTEND (skipWaiting: false) :
//    la page continue sur sa version, avec ses propres fichiers en cache.
// 2. sw-register.js émet « nouri:update-ready ». L'interface peut proposer
//    « Recharger » (UpdateNotice).
// 3. La nouvelle version s'applique :
//    - sur demande (applyAppUpdate, bouton du toast) ;
//    - d'elle-même quand la page passe en arrière-plan ET que l'app n'est
//      pas occupée (setAppBusy) : jamais pendant une navigation guidée ;
//    - au prochain lancement à froid, sinon.

declare global {
  interface Window {
    __nouriBusy?: boolean
    __nouriUpdateReady?: boolean
    __nouriApplyUpdate?: () => void
  }
}

export const UPDATE_READY_EVENT = 'nouri:update-ready'
export const APP_IDLE_EVENT = 'nouri:idle'

/**
 * Vrai pendant une navigation guidée ou tant que des résultats sont affichés :
 * la mise à jour attend. Repassé à faux, elle pourra s'appliquer à la
 * prochaine mise en arrière-plan.
 */
export function setAppBusy(busy: boolean): void {
  if (typeof window === 'undefined') return
  const was = Boolean(window.__nouriBusy)
  window.__nouriBusy = busy
  if (was && !busy) window.dispatchEvent(new Event(APP_IDLE_EVENT))
}

export function isAppUpdateReady(): boolean {
  return typeof window !== 'undefined' && Boolean(window.__nouriUpdateReady)
}

/** Appelle `cb` quand une nouvelle version est prête (tout de suite si elle l'est déjà). */
export function onAppUpdateReady(cb: () => void): () => void {
  if (typeof window === 'undefined') return () => {}
  if (window.__nouriUpdateReady) cb()
  window.addEventListener(UPDATE_READY_EVENT, cb)
  return () => window.removeEventListener(UPDATE_READY_EVENT, cb)
}

/** Applique la nouvelle version maintenant (recharge la page). */
export function applyAppUpdate(): void {
  if (typeof window === 'undefined') return
  if (window.__nouriApplyUpdate) window.__nouriApplyUpdate()
  else window.location.reload()
}

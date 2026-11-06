// Service Worker Registration
// Seul point d'enregistrement du SW (next-pwa a `register: false`).
// Désactivé en développement (localhost) : le cache du SW servirait des pages
// périmées et casserait le hot reload.
//
// Mises à jour : JAMAIS de rechargement sous les doigts de l'usager.
// - Première visite : le SW s'installe et prend la main (clientsClaim), ce qui
//   déclenche `controllerchange`. La page tourne déjà sur la bonne version :
//   on ne recharge pas (avant, la saisie en cours disparaissait sur 3G).
// - Nouvelle version : le SW attend (skipWaiting: false). La page garde ses
//   fichiers, cohérents entre eux. On prévient l'interface
//   (`nouri:update-ready`) et on applique la mise à jour :
//     · sur demande (window.__nouriApplyUpdate, bouton « Recharger ») ;
//     · quand la page passe en arrière-plan et que l'app n'est pas occupée
//       (window.__nouriBusy : navigation guidée, résultats affichés) ;
//     · sinon au prochain lancement à froid.
// Façade typée côté React : src/lib/app-update.ts.

;(function () {
  if (!('serviceWorker' in navigator)) return

  var isLocalhost = ['localhost', '127.0.0.1'].indexOf(location.hostname) !== -1

  if (isLocalhost) {
    // Purger tout SW hérité d'une session précédente sur localhost
    navigator.serviceWorker.getRegistrations().then(function (regs) {
      regs.forEach(function (reg) { reg.unregister() })
    })
    if (window.caches) {
      caches.keys().then(function (keys) { keys.forEach(function (k) { caches.delete(k) }) })
    }
    return
  }

  // Contrôleur présent au chargement : sinon c'est la première installation.
  var hadController = !!navigator.serviceWorker.controller
  var waitingWorker = null
  var applyRequested = false
  var reloading = false

  function isBusy() { return !!window.__nouriBusy }

  function reloadOnce() {
    if (reloading) return
    reloading = true
    location.reload()
  }

  function apply() {
    applyRequested = true
    if (waitingWorker) {
      // Le nouveau SW s'active ; `controllerchange` recharge ensuite.
      waitingWorker.postMessage({ type: 'SKIP_WAITING' })
    } else {
      reloadOnce()
    }
  }

  function applyIfIdleInBackground() {
    if (!window.__nouriUpdateReady) return
    if (document.visibilityState === 'hidden' && !isBusy()) apply()
  }

  function announce(worker) {
    if (worker) waitingWorker = worker
    if (window.__nouriUpdateReady) return
    window.__nouriUpdateReady = true
    try { window.dispatchEvent(new Event('nouri:update-ready')) } catch (e) { /* vieux moteur */ }
    applyIfIdleInBackground()
  }

  window.__nouriApplyUpdate = apply
  document.addEventListener('visibilitychange', applyIfIdleInBackground)
  // L'app vient de redevenir libre (fin de navigation) : si elle est déjà en
  // arrière-plan, la mise à jour peut passer.
  window.addEventListener('nouri:idle', applyIfIdleInBackground)

  navigator.serviceWorker.addEventListener('controllerchange', function () {
    // Première installation : rien à recharger.
    if (!hadController) { hadController = true; return }
    if (applyRequested) { reloadOnce(); return }
    // Activé ailleurs (autre onglet qui a appliqué la mise à jour) : cette
    // page tourne sur l'ancienne version. Même règle : on attend un moment
    // sûr, ou le clic de l'usager.
    waitingWorker = null
    announce(null)
  })

  navigator.serviceWorker
    .register('/sw.js')
    .then(function (reg) {
      var watch = function (worker) {
        if (!worker) return
        worker.addEventListener('statechange', function () {
          // « installed » avec un contrôleur = mise à jour en attente.
          // Sans contrôleur, c'est la première installation : elle s'active seule.
          if (worker.state === 'installed' && navigator.serviceWorker.controller) announce(worker)
        })
      }
      if (reg.waiting && navigator.serviceWorker.controller) announce(reg.waiting)
      watch(reg.installing)
      reg.addEventListener('updatefound', function () { watch(reg.installing) })

      // Chercher une mise à jour dès l'ouverture, puis toutes les heures.
      reg.update().catch(function () {})
      setInterval(function () { reg.update().catch(function () {}) }, 3600000)
    })
    .catch(function () {
      // L'app fonctionne sans service worker : rien à signaler à l'usager.
    })
})()

// Filet de sécurité : après un déploiement, un cache resté sur l'ancienne
// version réclame des fichiers JS qui n'existent plus, et l'app s'arrête sur
// « Application error ». Dans ce cas précis, on purge et on recharge UNE fois.
//
// Une coupure réseau produit exactement les mêmes événements (erreur sur la
// balise, ChunkLoadError) qu'un fichier supprimé. Purger et recharger dans ce
// cas viderait les caches déjà remplis et, si la coupure dure, remplacerait
// l'app (accueil, catalogue encore utilisables) par la page d'erreur du
// navigateur. Avant d'agir, on vérifie donc auprès du serveur que le fichier
// manque VRAIMENT (404/410). Toute erreur réseau = on ne touche à rien.
;(function () {
  if (!('serviceWorker' in navigator)) return
  var RECOVERY_KEY = 'alger-transit:cache-recovery'
  var PROBE_TIMEOUT_MS = 8000
  // URL absolue ou chemin /_next/… (les messages de chunk CSS donnent un chemin)
  var NEXT_URL_RE = /(?:https?:\/\/[^\s)"']+)?\/_next\/[^\s)"']+/
  var checking = false

  var alreadyTried = function () {
    try { return !!sessionStorage.getItem(RECOVERY_KEY) } catch (e) { return true }
  }

  // Résout true seulement si le serveur répond que le fichier n'existe pas.
  // Hors ligne, erreur réseau, délai dépassé, autre statut : false.
  // HEAD n'est routé par aucune règle du SW (toutes en GET) : la sonde va au
  // réseau, jamais au cache.
  var confirmMissing = function (url) {
    return new Promise(function (resolve) {
      if (navigator.onLine === false || typeof fetch !== 'function') return resolve(false)
      var done = false
      var finish = function (v) { if (!done) { done = true; resolve(v) } }
      var ctrl = typeof AbortController === 'function' ? new AbortController() : null
      var timer = setTimeout(function () {
        if (ctrl) { try { ctrl.abort() } catch (e) { /* rien */ } }
        finish(false)
      }, PROBE_TIMEOUT_MS)
      var opts = { method: 'HEAD', cache: 'no-store', credentials: 'same-origin' }
      if (ctrl) opts.signal = ctrl.signal
      try {
        fetch(url, opts)
          .then(function (r) { finish(r.status === 404 || r.status === 410) })
          .catch(function () { finish(false) })
          .then(function () { clearTimeout(timer) })
      } catch (e) {
        clearTimeout(timer)
        finish(false)
      }
    })
  }

  // Purge + désenregistrement + rechargement. La marque « déjà tenté » n'est
  // posée qu'ici, après confirmation : une fausse alerte ne consomme pas
  // l'unique tentative de la session.
  var doRecover = function () {
    try {
      if (sessionStorage.getItem(RECOVERY_KEY)) return // déjà tenté : on n'insiste pas
      sessionStorage.setItem(RECOVERY_KEY, String(Date.now()))
    } catch (e) {
      return // sans stockage, impossible de garantir « une seule fois » : on s'abstient
    }

    var purge = window.caches
      ? caches.keys().then(function (keys) { return Promise.all(keys.map(function (k) { return caches.delete(k) })) })
      : Promise.resolve()

    purge
      .then(function () { return navigator.serviceWorker.getRegistrations() })
      .then(function (regs) { return Promise.all(regs.map(function (reg) { return reg.unregister() })) })
      .catch(function () {})
      .then(function () { location.reload() })
  }

  // Un fichier de la page en cours, pour sonder quand l'erreur ne dit pas
  // lequel manque : si les fichiers de CETTE version ont disparu du serveur,
  // c'est bien un déploiement.
  var samplePageAsset = function () {
    var scripts = document.querySelectorAll('script[src*="/_next/static/"]')
    return scripts.length ? scripts[scripts.length - 1].src : null
  }

  // url : le fichier en cause s'il est connu, sinon null.
  var recoverFromStaleCache = function (url) {
    if (checking || alreadyTried()) return
    var probe = url || samplePageAsset()
    if (!probe) {
      // Rien à sonder : on ne tente qu'en ligne (hors ligne, c'est le réseau).
      if (navigator.onLine !== false) doRecover()
      return
    }
    checking = true
    confirmMissing(probe).then(function (missing) {
      checking = false
      if (missing) doRecover()
    })
  }

  var isStaleCacheError = function (message) {
    return message.indexOf('ChunkLoadError') !== -1
      || message.indexOf('Loading chunk') !== -1
      || message.indexOf('Loading CSS chunk') !== -1
      || message.indexOf('Cannot find module') !== -1
      || message.indexOf('Failed to fetch dynamically imported module') !== -1
      || message.indexOf('Importing a module script failed') !== -1
  }

  // Fichier /_next/ cité par l'erreur (webpack : `request` ; sinon le message).
  var chunkUrlOf = function (err, message) {
    var candidates = [err && err.request, err && err.message, message]
    for (var i = 0; i < candidates.length; i++) {
      var c = candidates[i]
      if (typeof c !== 'string') continue
      var m = c.match(NEXT_URL_RE)
      if (m) {
        try { return new URL(m[0], location.href).href } catch (e) { /* suivant */ }
      }
    }
    return null
  }

  // Chunk Next.js en échec sur une balise (404… ou simple coupure réseau)
  window.addEventListener('error', function (event) {
    var target = event.target
    if (target && (target.tagName === 'SCRIPT' || target.tagName === 'LINK')) {
      var url = target.src || target.href || ''
      if (url.indexOf('/_next/') !== -1) recoverFromStaleCache(url)
    }
  }, true)

  // ChunkLoadError levée par le chargement dynamique de React/Next
  window.addEventListener('unhandledrejection', function (event) {
    var reason = event.reason || {}
    var message = String(reason.name || '') + ' ' + String(reason.message || '')
    if (isStaleCacheError(message)) recoverFromStaleCache(chunkUrlOf(reason, message))
  })

  // Exception levée PENDANT le rendu React : c'est elle qui produit le message
  // « Application error: a client-side exception has occurred ». Le handler
  // ci-dessus ne voit que les rejets de promesse, et celui des balises ne
  // regarde que <script>/<link> : ce cas passait entre les deux.
  // On ne récupère que si le message trahit un module absent — sinon on laisse
  // le vrai bug remonter plutôt que de le masquer derrière un rechargement.
  window.addEventListener('error', function (event) {
    if (event.target && event.target !== window) return // déjà traité plus haut
    var err = event.error || {}
    var message = String(err.name || '') + ' ' + String(err.message || event.message || '')
    if (isStaleCacheError(message)) recoverFromStaleCache(chunkUrlOf(err, message))
  })
})()

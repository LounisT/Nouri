// Service Worker Registration
// Enregistrement du SW pour la PWA — désactivé en développement (localhost) :
// le cache du SW servirait des pages périmées et casserait le hot reload.

const isLocalhost = ['localhost', '127.0.0.1'].includes(location.hostname)

if ('serviceWorker' in navigator && isLocalhost) {
  // Purger tout SW hérité d'une session précédente sur localhost
  navigator.serviceWorker.getRegistrations().then((regs) => {
    regs.forEach((reg) => reg.unregister())
  })
  if (window.caches) {
    caches.keys().then((keys) => keys.forEach((k) => caches.delete(k)))
  }
}

if ('serviceWorker' in navigator && !isLocalhost) {
  navigator.serviceWorker
    .register('/sw.js')
    .then((reg) => {
      // Chercher une mise à jour dès l'ouverture, puis toutes les heures.
      reg.update()
      setInterval(() => {
        reg.update()
      }, 3600000)
    })
    .catch(() => {
      // L'app fonctionne sans service worker : rien à signaler à l'usager.
    })

  // Un nouveau service worker vient de prendre le contrôle : la page tourne
  // encore sur les fichiers de la version précédente, on la recharge.
  let reloadingForUpdate = false
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (reloadingForUpdate) return
    reloadingForUpdate = true
    location.reload()
  })
}

// Filet de sécurité : après un déploiement, un cache resté sur l'ancienne
// version réclame des fichiers JS qui n'existent plus, et l'app s'arrête sur
// « Application error ». Dans ce cas précis, on purge et on recharge UNE fois.
if ('serviceWorker' in navigator) {
  const RECOVERY_KEY = 'alger-transit:cache-recovery'

  const recoverFromStaleCache = () => {
    if (sessionStorage.getItem(RECOVERY_KEY)) return // déjà tenté : on n'insiste pas
    sessionStorage.setItem(RECOVERY_KEY, String(Date.now()))

    const purge = window.caches
      ? caches.keys().then((keys) => Promise.all(keys.map((k) => caches.delete(k))))
      : Promise.resolve()

    purge
      .then(() => navigator.serviceWorker.getRegistrations())
      .then((regs) => Promise.all(regs.map((reg) => reg.unregister())))
      .catch(() => {})
      .then(() => location.reload())
  }

  // Chunk Next.js introuvable (404 sur un fichier /_next/static/…)
  window.addEventListener('error', (event) => {
    const target = event.target
    if (target && (target.tagName === 'SCRIPT' || target.tagName === 'LINK')) {
      const url = target.src || target.href || ''
      if (url.includes('/_next/')) recoverFromStaleCache()
    }
  }, true)

  // ChunkLoadError levée par le chargement dynamique de React/Next
  window.addEventListener('unhandledrejection', (event) => {
    const message = String(event.reason?.name || event.reason?.message || '')
    if (isStaleCacheError(message)) recoverFromStaleCache()
  })

  // Exception levée PENDANT le rendu React : c'est elle qui produit le message
  // « Application error: a client-side exception has occurred ». Le handler
  // ci-dessus ne voit que les rejets de promesse, et celui des balises ne
  // regarde que <script>/<link> : ce cas passait entre les deux.
  // On ne récupère que si le message trahit un module absent — sinon on laisse
  // le vrai bug remonter plutôt que de le masquer derrière un rechargement.
  window.addEventListener('error', (event) => {
    if (event.target && event.target !== window) return // déjà traité plus haut
    const message = String(event.error?.name || event.message || '')
    if (isStaleCacheError(message)) recoverFromStaleCache()
  })

  function isStaleCacheError(message) {
    return message.includes('ChunkLoadError')
      || message.includes('Loading chunk')
      || message.includes('Loading CSS chunk')
      || message.includes('Cannot find module')
      || message.includes('Failed to fetch dynamically imported module')
      || message.includes('Importing a module script failed')
  }
}

// Repère de version affiché dans les signalements d'erreur (lib/report.ts).
// NOURI_BUILD_ID peut être fourni au build ; sinon l'horodatage du build.
const BUILD_ID = process.env.NOURI_BUILD_ID || new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '')

const DAY = 24 * 60 * 60

const withPWA = require('@ducanh2912/next-pwa').default({
  dest: 'public',
  // Un seul point d'enregistrement : public/sw-register.js, qui gère aussi
  // les mises à jour sans rechargement intempestif.
  register: false,
  cacheOnFrontEndNav: true,
  // Le pré-cache agressif servait des pages d'une version précédente : après
  // un redéploiement, l'app réclamait des fichiers JS qui n'existaient plus
  // (« Application error: a client-side exception »).
  aggressiveFrontEndNavCaching: false,
  // Recharger au retour du réseau faisait perdre la navigation en cours à
  // chaque sortie de tunnel du métro. page.tsx gère déjà hors-ligne/en ligne.
  reloadOnOnline: false,
  // « / » est précaché (révision = buildId) et servi depuis le cache sans
  // attendre le réseau : sur un quai à une barre (« lie-fi »), l'app s'ouvrait
  // après 12 s d'écran blanc alors que tout était disponible localement. La
  // page est statique, chaque déploiement change la révision.
  dynamicStartUrl: false,
  swcMinify: true,
  disable: process.env.NODE_ENV === 'development',
  // Nos règles passent AVANT celles de next-pwa ; une règle par défaut qui
  // porte le même cacheName est remplacée.
  extendDefaultRuntimeCaching: true,
  // Fichiers de public/ à ne pas précacher : données servies à la demande
  // (règle « nouri-data » plus bas) et captures du manifeste.
  // SAUF data/line-shapes.json (tracés, ~210 Ko), précaché avec pour révision
  // le hash md5 de son contenu (next-pwa) : retéléchargé seulement s'il change,
  // et servi depuis le cache sans attendre le réseau. En NetworkFirst, le
  // délai de 4 s ne porte que sur les en-têtes : en « lie-fi », la carte
  // montrait ~17 s le tracé schématique alors que la copie était là. Lié à la
  // version du SW, il reste aussi cohérent avec le bundle (contrat
  // shapes[line.id][directionIndex]) quand une mise à jour attend.
  // NE PAS passer workboxOptions.additionalManifestEntries pour cela : next-pwa
  // ne parcourt alors plus public/ du tout (icônes, sw-register.js… perdus).
  publicExcludes: ['!noprecache/**/*', '!data/!(line-shapes.json)', '!data/*/**', '!screenshots/**/*'],
  workboxOptions: {
    disableDevLogs: true,
    // La nouvelle version ATTEND au lieu de prendre la main au milieu d'un
    // trajet : public/sw-register.js lui envoie SKIP_WAITING au bon moment
    // (page en arrière-plan et app libre, ou clic sur « Recharger »).
    skipWaiting: false,
    clientsClaim: true,
    cleanupOutdatedCaches: true,
    // /?from=…&to=… (lien partagé) et /?tab=… (raccourcis du manifeste)
    // tombent sur le « / » précaché.
    ignoreURLParametersMatching: [/^utm_/, /^fbclid$/, /^from$/, /^to$/, /^tab$/],
    // REMPLACE l'exclusion par défaut de next-pwa, dont la règle de polices ne
    // correspondait jamais (les fichiers sont nommés static/media/…, sans
    // /_next/) : 12 polices précachées, dont cyrillique, grec, vietnamien.
    // Seules les polices préchargées (.p.woff2) restent ; les autres arrivent
    // à la demande (règle « static-font-assets »).
    exclude: [/static\/media\/.*(?<!\.p)\.woff2$/, /\.map$/, /^manifest.*\.js$/],
    manifestTransforms: [
      // URL déjà versionnées par un hash de contenu : révision '' (et non
      // null, que la transformation de next-pwa, exécutée après, remplacerait
      // par le hash). Workbox précharge alors en cache:'default' et réutilise
      // le cache HTTP `immutable` au lieu de tout re-télécharger
      // (cache:'reload') : ~1 Mo de moins à la première visite.
      async (entries) => ({
        manifest: entries.map((entry) =>
          /static\/(chunks|css|media)\//.test(entry.url) ? { ...entry, revision: '' } : entry,
        ),
        warnings: [],
      }),
    ],
    runtimeCaching: [
      // Calculateur d'itinéraires et autres API : JAMAIS de cache. Un plan
      // périmé, ou un contrôle de santé servi depuis le cache, ferait croire
      // à un trajet ou à un service qui n'existent plus.
      {
        urlPattern: ({ sameOrigin, url }) => sameOrigin && url.pathname.startsWith('/api/'),
        handler: 'NetworkOnly',
        options: { cacheName: 'apis' },
      },
      // Fond de carte OpenFreeMap. Tuiles vectorielles (URL versionnées,
      // immuables) et relief Natural Earth : cache dédié, servi d'abord, pour
      // que la carte reste utilisable hors ligne sur les zones déjà vues.
      // ~550 tuiles couvrent tout le Grand Alger de z0 à z14.
      {
        urlPattern: /^https:\/\/tiles\.openfreemap\.org\/(planet\/[^/]+|natural_earth\/[^/]+)\/\d+\/\d+\/\d+\.(pbf|png)$/,
        handler: 'CacheFirst',
        options: {
          cacheName: 'ofm-tiles',
          expiration: { maxEntries: 800, maxAgeSeconds: 30 * DAY, purgeOnQuotaError: true },
          cacheableResponse: { statuses: [200] },
        },
      },
      // Glyphes (latin ET arabe) : immuables, cache à part pour ne pas
      // pousser le style hors du cache.
      {
        urlPattern: /^https:\/\/tiles\.openfreemap\.org\/fonts\//,
        handler: 'CacheFirst',
        options: {
          cacheName: 'ofm-glyphs',
          expiration: { maxEntries: 120, maxAgeSeconds: 365 * DAY, purgeOnQuotaError: true },
          cacheableResponse: { statuses: [200] },
        },
      },
      // Style, TileJSON et sprites : servis depuis le cache puis rafraîchis.
      // Le TileJSON en cache garde la version des tuiles en cache cohérente.
      {
        urlPattern: /^https:\/\/tiles\.openfreemap\.org\/(styles\/|sprites\/|planet$)/,
        handler: 'StaleWhileRevalidate',
        options: {
          cacheName: 'ofm-style',
          expiration: { maxEntries: 24, maxAgeSeconds: 30 * DAY },
          cacheableResponse: { statuses: [200] },
        },
      },
      // Géocodage (Photon, Nominatim) : pas de cache du service worker.
      // lib/geocoding.ts a son propre cache et ses délais ; le SW ajoutait
      // jusqu'à 10 s d'attente réseau avant d'échouer.
      {
        urlPattern: /^https:\/\/(photon\.komoot\.io|nominatim\.openstreetmap\.org)\//,
        handler: 'NetworkOnly',
        options: { cacheName: 'geocoding' },
      },
      // Autres données de l'app servies à part (/data/*.json ; line-shapes.json
      // est précaché, sa route passe avant) : à jour quand le réseau répond,
      // depuis le cache en 4 s sinon.
      {
        urlPattern: ({ sameOrigin, url }) => sameOrigin && url.pathname.startsWith('/data/') && url.pathname.endsWith('.json'),
        handler: 'NetworkFirst',
        options: {
          cacheName: 'nouri-data',
          networkTimeoutSeconds: 4,
          expiration: { maxEntries: 16, maxAgeSeconds: 30 * DAY },
          cacheableResponse: { statuses: [200] },
        },
      },
      // Polices non précachées (/_next/static/media/…) : nom versionné, donc
      // immuable. La règle par défaut (4 entrées, 7 jours) les évinçait.
      {
        urlPattern: /\.(?:eot|otf|ttc|ttf|woff|woff2)$/i,
        handler: 'CacheFirst',
        options: {
          cacheName: 'static-font-assets',
          expiration: { maxEntries: 24, maxAgeSeconds: 365 * DAY },
          cacheableResponse: { statuses: [200] },
        },
      },
      // Autres pages du site (navigations seulement : les fichiers statiques
      // gardent les règles de next-pwa) : réseau d'abord, 4 s au plus.
      {
        urlPattern: ({ request, sameOrigin, url }) =>
          sameOrigin && request.mode === 'navigate' && !url.pathname.startsWith('/api/'),
        handler: 'NetworkFirst',
        options: {
          cacheName: 'pages',
          networkTimeoutSeconds: 4,
          expiration: { maxEntries: 32, maxAgeSeconds: DAY },
        },
      },
      // Tout autre domaine (fond de carte personnalisé via
      // NEXT_PUBLIC_TILE_URL…) : réseau d'abord, 4 s au plus.
      {
        urlPattern: ({ sameOrigin }) => !sameOrigin,
        handler: 'NetworkFirst',
        options: {
          cacheName: 'cross-origin',
          networkTimeoutSeconds: 4,
          expiration: { maxEntries: 64, maxAgeSeconds: 7 * DAY },
        },
      },
    ],
  },
})

/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  reactStrictMode: true,
  // Pas d'en-tête « X-Powered-By: Next.js » (inutile, et il renseigne un
  // attaquant). Les autres en-têtes de sécurité sont posés par Caddy.
  poweredByHeader: false,
  transpilePackages: ['maplibre-gl'],
  env: {
    NEXT_PUBLIC_BUILD_ID: BUILD_ID,
  },
  webpack: (config) => {
    config.resolve.fallback = { fs: false, path: false }
    return config
  },
}

module.exports = withPWA(nextConfig)

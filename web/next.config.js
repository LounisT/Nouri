const withPWA = require('@ducanh2912/next-pwa').default({
  dest: 'public',
  cacheOnFrontEndNav: true,
  // Le pré-cache agressif servait des pages d'une version précédente : après
  // un redéploiement, l'app réclamait des fichiers JS qui n'existaient plus
  // (« Application error: a client-side exception »).
  aggressiveFrontEndNavCaching: false,
  reloadOnOnline: true,
  swcMinify: true,
  disable: process.env.NODE_ENV === 'development',
  workboxOptions: {
    disableDevLogs: true,
    // Le nouveau service worker prend la main immédiatement au lieu
    // d'attendre la fermeture de tous les onglets, et purge les caches
    // devenus obsolètes.
    skipWaiting: true,
    clientsClaim: true,
    cleanupOutdatedCaches: true,
  },
})

/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  reactStrictMode: true,
  transpilePackages: ['maplibre-gl'],
  webpack: (config) => {
    config.resolve.fallback = { fs: false, path: false }
    return config
  },
}

module.exports = withPWA(nextConfig)

import type { Metadata, Viewport } from 'next'
import { Inter, Noto_Sans_Arabic } from 'next/font/google'
import './globals.css'
import I18nProvider from '@/components/I18nProvider'

const inter = Inter({
  subsets: ['latin'],
  weight: ['400', '500', '600'],
  display: 'swap',
  variable: '--font-inter',
})

// Inter ne couvre pas l'arabe : Noto Sans Arabic prend le relais
// automatiquement pour les glyphes arabes via la pile de polices.
const notoArabic = Noto_Sans_Arabic({
  subsets: ['arabic'],
  weight: ['400', '500', '600'],
  display: 'swap',
  variable: '--font-noto-arabic',
})

export const metadata: Metadata = {
  title: 'Nouri — Métro, tram & bus à Alger',
  description: 'Métro, tramway et bus d’Alger : horaires estimés et itinéraires. Pas de temps réel à Alger — et on ne fait pas semblant.',
  keywords: ['nouri', 'métro alger', 'tramway alger', 'bus alger', 'ETUSA', 'transport alger'],
  authors: [{ name: 'Nouri' }],
  manifest: '/manifest.json',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'default',
    title: 'Nouri',
  },
  icons: {
    icon: '/icons/icon-192x192.png',
    apple: '/icons/apple-touch-icon.png',
  },
  openGraph: {
    title: 'Nouri',
    description: 'Métro, tram & bus à Alger — itinéraires et horaires estimés',
    type: 'website',
  },
}

export const viewport: Viewport = {
  themeColor: '#1D6FE0',
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  // Le clavier virtuel redimensionne le contenu (Android) : une feuille basse
  // ancrée en bas remonte alors au-dessus du clavier. iOS ignore ce réglage et
  // s'appuie sur le suivi `visualViewport` côté SavedPlaces.
  interactiveWidget: 'resizes-content',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  // `dir` DOIT exister dès le rendu serveur : les variants Tailwind `ltr:` et
  // `rtl:` compilent en `:where([dir="ltr"], [dir="ltr"] *)` et ne s'appliquent
  // donc à RIEN tant que l'attribut est absent — l'écran Résultats, qui se
  // cache par `ltr:translate-x-full`, recouvrait alors l'accueil.
  // I18nProvider le réécrit au changement de langue.
  return (
    <html lang="fr" dir="ltr" className={`${inter.variable} ${notoArabic.variable}`} style={{ colorScheme: 'light' }} suppressHydrationWarning>
      <head>
        <meta name="color-scheme" content="light only" />
        <meta name="theme-color" content="#1D6FE0" />
        <meta name="mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
        <meta name="apple-mobile-web-app-title" content="Nouri" />
        <link rel="preload" href="/icons/icon-192x192.png" as="image" />
        <link rel="preload" href="/icons/apple-touch-icon.png" as="image" />
        <link rel="icon" type="image/png" href="/icons/icon-192x192.png" />
        <script src="/sw-register.js" async />
      </head>
      <body
        className={inter.className}
        style={{
          backgroundColor: '#ffffff',
          color: '#111827',
          colorScheme: 'light',
          fontFamily: 'var(--font-inter), var(--font-noto-arabic), system-ui, sans-serif',
        }}
      >
        <I18nProvider>{children}</I18nProvider>
      </body>
    </html>
  )
}

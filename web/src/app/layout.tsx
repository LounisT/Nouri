import type { Metadata, Viewport } from 'next'
import { Inter, Noto_Sans_Arabic } from 'next/font/google'
import './globals.css'
import I18nProvider from '@/components/I18nProvider'
import { uxStrings } from '@/lib/strings/ux'
import { buildLocaleScript } from '@/lib/locale-script'

const inter = Inter({
  subsets: ['latin'],
  weight: ['400', '500', '600'],
  display: 'swap',
  variable: '--font-inter',
})

// Inter ne couvre pas l'arabe : Noto Sans Arabic prend le relais pour les
// glyphes arabes via la pile de polices. PAS de préchargement : son
// unicode-range la limite aux caractères arabes, le navigateur ne la
// télécharge donc que si de l'arabe s'affiche. Préchargée, elle coûtait
// 166 Ko en priorité haute à chaque usager francophone ou anglophone.
const notoArabic = Noto_Sans_Arabic({
  subsets: ['arabic'],
  weight: ['400', '500', '600'],
  display: 'swap',
  variable: '--font-noto-arabic',
  preload: false,
})

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || 'https://nouri.lounis.dev'

// Les robots d'aperçu (WhatsApp, Facebook…) ne voient jamais la langue
// choisie dans l'app : titre et description d'aperçu sont bilingues FR/AR.
const SHARE_TITLE = 'Nouri — نوري'
const SHARE_DESCRIPTION =
  'Métro, tramway et bus d’Alger : itinéraires et horaires estimés, sans temps réel. — مترو وترامواي وحافلات الجزائر العاصمة: مسارات ومواعيد تقديرية.'

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: uxStrings.fr.ux_appTitle,
  description: 'Métro, tramway et bus d’Alger : horaires estimés et itinéraires. Pas de temps réel à Alger — et on ne fait pas semblant.',
  keywords: ['nouri', 'métro alger', 'tramway alger', 'bus alger', 'ETUSA', 'transport alger', 'مترو الجزائر', 'ترامواي الجزائر'],
  authors: [{ name: 'Nouri' }],
  manifest: '/manifest.json',
  appleWebApp: {
    capable: true,
    // Même valeur que la balise <meta> plus bas : la page dessine elle-même
    // sous la barre d'état (safe-area-inset-top), comme une app native.
    statusBarStyle: 'black-translucent',
    title: 'Nouri',
  },
  icons: {
    icon: '/icons/icon-192x192.png',
    apple: '/icons/apple-touch-icon.png',
  },
  openGraph: {
    title: SHARE_TITLE,
    description: SHARE_DESCRIPTION,
    url: '/',
    siteName: 'Nouri',
    type: 'website',
    locale: 'fr_DZ',
    alternateLocale: ['ar_DZ', 'en_US'],
    images: [{ url: '/icons/icon-512x512.png', width: 512, height: 512, alt: 'Nouri' }],
  },
  twitter: {
    card: 'summary',
    title: SHARE_TITLE,
    description: SHARE_DESCRIPTION,
    images: ['/icons/icon-512x512.png'],
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
  // Pas de maximum-scale ni de user-scalable=no : le zoom reste possible pour
  // qui en a besoin. Le zoom automatique d'iOS est évité autrement (champs à
  // 16 px minimum, globals.css).
}

// Langue appliquée avant le premier affichage : voir lib/locale-script.ts.
const LOCALE_SCRIPT = buildLocaleScript()

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  // `dir` DOIT exister dès le rendu serveur : les variants Tailwind `ltr:` et
  // `rtl:` compilent en `:where([dir="ltr"], [dir="ltr"] *)` et ne s'appliquent
  // donc à RIEN tant que l'attribut est absent — l'écran Résultats, qui se
  // cache par `ltr:translate-x-full`, recouvrait alors l'accueil.
  // Le script inline le corrige avant l'affichage ; I18nProvider le tient à
  // jour ensuite. suppressHydrationWarning : React ne remet pas les valeurs
  // serveur sur <html>.
  return (
    <html lang="fr" dir="ltr" className={`${inter.variable} ${notoArabic.variable}`} style={{ colorScheme: 'light' }} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: LOCALE_SCRIPT }} />
        <meta name="color-scheme" content="light only" />
        <meta name="theme-color" content="#1D6FE0" />
        <meta name="mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
        <meta name="apple-mobile-web-app-title" content="Nouri" />
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

/** @type {import('tailwindcss').Config} */
// Système de design « Casbah » — 6 crans typo, grille 8, neutres chauds, 4 rayons.
// Toute nouvelle UI doit puiser ici ; pas de gray/slate ni de taille arbitraire.
module.exports = {
  darkMode: 'media',
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        // Identité des modes (couleurs officielles — ne jamais dériver)
        metro: { DEFAULT: '#1E3A8A', light: '#3B5BC8', dark: '#162B6B', pastel: '#E8EDF8' },
        tram:  { DEFAULT: '#059669', light: '#10B981', dark: '#047857', pastel: '#E6F5F0' },
        bus:   { DEFAULT: '#D97706', light: '#F59E0B', dark: '#92400E', pastel: '#FBF1E0' },
        // Action « Méditerranée » (CTA, onglet actif, position utilisateur)
        brand: { DEFAULT: '#1D6FE0', light: '#4A8FE8', dark: '#1558B8', pastel: '#EAF2FD', muted: '#D6E6FB' },
        // Neutres froids propres (ambiance claire épurée)
        ink: {
          900: '#111827',
          600: '#4B5563',
          400: '#6B7280',
        },
        line: '#E5E7EB',
        paper: { DEFAULT: '#FFFFFF', 2: '#F9FAFB' },
        skeleton: '#F3F4F6',
        // État de service : « ouvert » réutilise le vert tram (handoff) ;
        // « fermé » = ink-400. Jamais de rouge pour un état normal.
        open: '#047857',
      },
      fontSize: {
        // Échelle unique — 6 crans. [taille, {interligne, espacement}]
        caption: ['11px', { lineHeight: '14px' }],
        label:   ['12px', { lineHeight: '16px' }],
        body:    ['13px', { lineHeight: '18px' }],
        emph:    ['15px', { lineHeight: '20px' }],
        title:   ['17px', { lineHeight: '22px', letterSpacing: '-0.01em' }],
        display: ['22px', { lineHeight: '26px', letterSpacing: '-0.02em' }],
      },
      borderRadius: {
        control: '12px',
        card: '16px',
        sheet: '20px',
      },
      boxShadow: {
        // Ombre douce des cartes blanches (ambiance claire épurée)
        soft: '0 1px 2px rgba(16,24,40,0.05), 0 4px 14px rgba(16,24,40,0.07)',
      },
      transitionTimingFunction: {
        'out-expo': 'cubic-bezier(0.16, 1, 0.3, 1)',
        sheet: 'cubic-bezier(0.32, 0.72, 0, 1)',
      },
      transitionDuration: {
        micro: '120ms',
        state: '200ms',
        panel: '320ms',
      },
      fontFamily: {
        sans: ['var(--font-inter)', 'var(--font-noto-arabic)', 'system-ui', 'sans-serif'],
      },
    },
  },
  plugins: [],
}

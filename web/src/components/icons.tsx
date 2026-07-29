// Icônes de l'application — un seul jeu, un seul gabarit.
//
// Elles étaient jusqu'ici de deux natures : des SVG stroke dans les rangées
// refondues, des emoji (🏠 💼 🚇 🚊 📍) dans les écrans plus anciens. Deux
// natures côte à côte se voient immédiatement : l'emoji est coloré, pleine
// forme, et dépend de la police système — il détonne à côté d'un trait de
// 1,8 px. Tout passe donc en stroke `currentColor`, la couleur venant de la
// classe du parent (jamais d'un hex en dur, qui survivrait à un changement de
// la rampe grise).

interface IconProps {
  size?: number
  className?: string
}

const base = (size: number) => ({
  width: size,
  height: size,
  viewBox: '0 0 24 24',
  fill: 'none' as const,
  'aria-hidden': true,
})

export function HomeIcon({ size = 18, className }: IconProps) {
  return (
    <svg {...base(size)} className={className}>
      <path d="M4 11l8-7 8 7v9h-5.5v-5h-5v5H4v-9z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
    </svg>
  )
}

export function WorkIcon({ size = 18, className }: IconProps) {
  return (
    <svg {...base(size)} className={className}>
      <rect x="4" y="7" width="16" height="13" rx="2" stroke="currentColor" strokeWidth="1.8" />
      <path d="M9 7V5.5A1.5 1.5 0 0 1 10.5 4h3A1.5 1.5 0 0 1 15 5.5V7" stroke="currentColor" strokeWidth="1.8" />
    </svg>
  )
}

/** Rame de métro vue de face — deux fenêtres, deux roues. */
export function MetroIcon({ size = 18, className }: IconProps) {
  return (
    <svg {...base(size)} className={className}>
      <rect x="5" y="3" width="14" height="14" rx="3" stroke="currentColor" strokeWidth="1.8" />
      <path d="M5 11h14" stroke="currentColor" strokeWidth="1.8" />
      <path d="M8.5 17L7 21M15.5 17L17 21" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  )
}

/** Tramway : même gabarit que le métro, distingué par sa perche. */
export function TramIcon({ size = 18, className }: IconProps) {
  return (
    <svg {...base(size)} className={className}>
      <rect x="5" y="5" width="14" height="12" rx="3" stroke="currentColor" strokeWidth="1.8" />
      <path d="M5 12h14" stroke="currentColor" strokeWidth="1.8" />
      <path d="M12 5V2M8.5 17L7 21M15.5 17L17 21" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  )
}

export function BusIcon({ size = 18, className }: IconProps) {
  return (
    <svg {...base(size)} className={className}>
      <rect x="4" y="4" width="16" height="13" rx="3" stroke="currentColor" strokeWidth="1.8" />
      <path d="M4 11h16" stroke="currentColor" strokeWidth="1.8" />
      <path d="M7.5 17L6 21M16.5 17L18 21" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  )
}

/** Repère de lieu — pour tout ce qui n'est pas un arrêt du réseau. */
export function PlaceIcon({ size = 18, className }: IconProps) {
  return (
    <svg {...base(size)} className={className}>
      <path d="M12 21s7-6.1 7-11a7 7 0 1 0-14 0c0 4.9 7 11 7 11z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
      <circle cx="12" cy="10" r="2.5" stroke="currentColor" strokeWidth="1.8" />
    </svg>
  )
}

/** Corbeille — action de suppression d'un lieu enregistré. */
export function TrashIcon({ size = 18, className }: IconProps) {
  return (
    <svg {...base(size)} className={className}>
      <path d="M5 7h14M10 7V5.5A1.5 1.5 0 0 1 11.5 4h1A1.5 1.5 0 0 1 14 5.5V7M6.5 7l.7 11a2 2 0 0 0 2 1.9h5.6a2 2 0 0 0 2-1.9L17.5 7" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

/** Horloge — marque une recherche récente. */
export function RecentIcon({ size = 18, className }: IconProps) {
  return (
    <svg {...base(size)} className={className}>
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.8" />
      <path d="M12 7.5V12l3 2" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

/** Icône d'un résultat de recherche, selon sa nature. */
export function ResultIcon(
  { kind, stationType, size = 18, className }: IconProps & {
    kind: 'station' | 'place' | string
    stationType?: 'metro' | 'tram' | string
  },
) {
  if (kind !== 'station') return <PlaceIcon size={size} className={className} />
  return stationType === 'metro'
    ? <MetroIcon size={size} className={className} />
    : <TramIcon size={size} className={className} />
}

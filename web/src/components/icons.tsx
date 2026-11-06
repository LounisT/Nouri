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

// ── Écran Itinéraire (handoff « Itinéraire Alger ») ──────────────────────────
// Équivalents des Material Symbols Rounded de la maquette, en SVG inline (la
// CSP interdit la police d'icônes). Formes pleines `currentColor`, dessinées
// sur la même grille 24 que le reste du jeu.

const filled = (size: number) => ({ ...base(size), fill: 'currentColor' as const })

/** directions_walk */
export function WalkIcon({ size = 18, className }: IconProps) {
  return (
    <svg {...filled(size)} className={className}>
      <path d="M13.5 5.5a2 2 0 1 0 0-4 2 2 0 0 0 0 4ZM9.8 8.9 7.25 21.8a1 1 0 0 0 .98 1.2h.07a1 1 0 0 0 .98-.78L10.9 15l2.1 2v5a1 1 0 0 0 2 0v-5.6a1 1 0 0 0-.31-.72L13 14.1l.6-3a7.3 7.3 0 0 0 4.42 1.83A1 1 0 0 0 19 11.94a1 1 0 0 0-.9-1A5.2 5.2 0 0 1 14.7 8.6l-1-1.6A2 2 0 0 0 12 6c-.3 0-.5.1-.8.1L6.6 8.04A1 1 0 0 0 6 8.96V12a1 1 0 0 0 2 0V9.6Z" />
    </svg>
  )
}

/** my_location */
export function MyLocationIcon({ size = 22, className }: IconProps) {
  return (
    <svg {...filled(size)} className={className}>
      <path d="M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8Zm8.94 3A8.99 8.99 0 0 0 13 3.06V2a1 1 0 0 0-2 0v1.06A8.99 8.99 0 0 0 3.06 11H2a1 1 0 0 0 0 2h1.06A8.99 8.99 0 0 0 11 20.94V22a1 1 0 0 0 2 0v-1.06A8.99 8.99 0 0 0 20.94 13H22a1 1 0 0 0 0-2h-1.06ZM12 19a7 7 0 1 1 0-14 7 7 0 0 1 0 14Z" />
    </svg>
  )
}

/** keyboard_arrow_up */
export function ChevronUpIcon({ size = 30, className }: IconProps) {
  return (
    <svg {...filled(size)} className={className}>
      <path d="M8.12 14.71 12 10.83l3.88 3.88a1 1 0 0 0 1.41-1.41L12.7 8.71a1 1 0 0 0-1.41 0L6.7 13.3a1 1 0 0 0 1.41 1.41Z" />
    </svg>
  )
}

/** arrow_back_ios_new — pointe vers le début de lecture (retourné en arabe par le parent). */
export function BackIosIcon({ size = 20, className }: IconProps) {
  return (
    <svg {...filled(size)} className={className}>
      <path d="M16.88 2.88a1.25 1.25 0 0 0-1.77 0L7.7 10.3a2.4 2.4 0 0 0 0 3.4l7.41 7.42a1.25 1.25 0 1 0 1.77-1.77L9.77 12l7.11-7.35a1.25 1.25 0 0 0 0-1.77Z" />
    </svg>
  )
}

/** expand_more */
export function ExpandMoreIcon({ size = 20, className }: IconProps) {
  return (
    <svg {...filled(size)} className={className}>
      <path d="M15.88 9.29 12 13.17 8.12 9.29A1 1 0 0 0 6.7 10.7l4.59 4.59a1 1 0 0 0 1.41 0l4.59-4.59a1 1 0 0 0-1.41-1.41Z" />
    </svg>
  )
}

/** navigation */
export function NavigationIcon({ size = 22, className }: IconProps) {
  return (
    <svg {...filled(size)} className={className}>
      <path d="M12.93 3.03a1 1 0 0 0-1.86 0L4.6 19.46a1 1 0 0 0 1.35 1.27L12 18l6.05 2.73a1 1 0 0 0 1.35-1.27Z" />
    </svg>
  )
}

/** info (contour) */
export function InfoIcon({ size = 15, className }: IconProps) {
  return (
    <svg {...filled(size)} className={className}>
      <path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Zm0 18a8 8 0 1 1 0-16 8 8 0 0 1 0 16Zm0-9a1 1 0 0 0-1 1v4a1 1 0 0 0 2 0v-4a1 1 0 0 0-1-1Zm0-4a1.25 1.25 0 1 0 0 2.5A1.25 1.25 0 0 0 12 7Z" />
    </svg>
  )
}

export type ManeuverKind =
  | 'depart' | 'straight' | 'left' | 'right' | 'slightLeft' | 'slightRight'
  | 'uturn' | 'roundabout' | 'stairs'

/**
 * Manœuvre d'une consigne de marche (north_east, turn_left, turn_slight_right,
 * straight, stairs…). Gauche et droite sont celles de la rue : jamais
 * retournées en arabe. `bearing` (degrés, 0 = nord) oriente la flèche de départ.
 */
export function ManeuverIcon({ kind, bearing = 0, size = 18, className }: IconProps & { kind: ManeuverKind; bearing?: number }) {
  const props = { ...filled(size), className }
  switch (kind) {
    case 'depart':
      return (
        <svg {...props}>
          <path transform={`rotate(${bearing} 12 12)`} d="M12.7 3.3a1 1 0 0 0-1.4 0l-6 6a1 1 0 0 0 1.4 1.4L11 6.42V20a1 1 0 1 0 2 0V6.41l4.3 4.3a1 1 0 0 0 1.4-1.42Z" />
        </svg>
      )
    case 'left':
      return (
        <svg {...props}>
          <path d="M7.24 11l.88.88a1 1 0 0 1-1.42 1.41L4.12 10.7a1 1 0 0 1 0-1.41L6.7 6.7a1 1 0 0 1 1.42 1.41L7.24 9H15a2 2 0 0 1 2 2v8a1 1 0 1 1-2 0v-8Z" />
        </svg>
      )
    case 'right':
      return (
        <svg {...props}>
          <path d="M16.76 11l-.88.88a1 1 0 0 0 1.42 1.41l2.58-2.59a1 1 0 0 0 0-1.41L17.3 6.7a1 1 0 0 0-1.42 1.41l.88.89H9a2 2 0 0 0-2 2v8a1 1 0 1 0 2 0v-8Z" />
        </svg>
      )
    case 'slightLeft':
      return (
        <svg {...props}>
          <path d="M8 7.41V9a1 1 0 0 1-2 0V5a1 1 0 0 1 1-1h4a1 1 0 1 1 0 2H9.41l4.3 4.3c.18.18.29.43.29.7v8a1 1 0 1 1-2 0v-7.59Z" />
        </svg>
      )
    case 'slightRight':
      return (
        <svg {...props}>
          <path d="M16 7.41V9a1 1 0 1 0 2 0V5a1 1 0 0 0-1-1h-4a1 1 0 1 0 0 2h1.59l-4.3 4.3a1 1 0 0 0-.29.7v8a1 1 0 1 0 2 0v-7.59Z" />
        </svg>
      )
    case 'uturn':
      return (
        <svg {...base(size)} className={className}>
          <path d="M8 20v-9a4 4 0 0 1 8 0v6m-3-2.5L16 17.5l3-3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      )
    case 'roundabout':
      return (
        <svg {...base(size)} className={className}>
          <circle cx="12" cy="10" r="3.5" stroke="currentColor" strokeWidth="2" />
          <path d="M12 13.5V21M15 7.5l3.5-3.5m0 0H15m3.5 0v3.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      )
    case 'stairs':
      return (
        <svg {...base(size)} className={className}>
          <path d="M4 19h4.5v-4.5H13V10h4.5V5.5H20" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      )
    default:
      return (
        <svg {...props}>
          <path d="M12.7 3.3a1 1 0 0 0-1.4 0l-3 3a1 1 0 0 0 1.4 1.4l1.3-1.29V20a1 1 0 1 0 2 0V6.41l1.3 1.3a1 1 0 0 0 1.4-1.42Z" />
        </svg>
      )
  }
}

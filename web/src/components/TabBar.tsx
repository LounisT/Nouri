'use client'

import { useTranslation } from '@/hooks/useTranslation'

// L'accueil EST l'écran d'itinéraire (« On va où ? ») : il n'y a plus
// d'onglet Itinéraire séparé.
export type Tab = 'home' | 'map' | 'lines'

interface TabBarProps {
  active: Tab
  onChange: (tab: Tab) => void
}

const BRAND = '#1D6FE0'
const INACTIVE = '#6B7280'

// Icônes exactes de la planche (stroke 1.8, 22px). L'icône Itinéraire est
// directionnelle : elle est miroir en RTL (transform dans le rendu).
function TabIcon({ tab, color, rtl }: { tab: Tab; color: string; rtl: boolean }) {
  switch (tab) {
    // L'accueil porte l'icône d'itinéraire : c'est ce que l'écran fait.
    case 'home':
      return (
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true" style={rtl ? { transform: 'scaleX(-1)' } : undefined}>
          <path d="M6 5h9a3.5 3.5 0 0 1 0 7H9a3.5 3.5 0 0 0 0 7h9" stroke={color} strokeWidth="1.8" strokeLinecap="round" />
          <circle cx="5" cy="5" r="1.6" fill={color} />
          <circle cx="19" cy="19" r="1.6" fill={color} />
        </svg>
      )
    case 'map':
      return (
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path d="M12 21s-6.5-5.6-6.5-10.2A6.5 6.5 0 0 1 12 4.3a6.5 6.5 0 0 1 6.5 6.5C18.5 15.4 12 21 12 21z" stroke={color} strokeWidth="1.8" />
          <circle cx="12" cy="10.8" r="2.2" stroke={color} strokeWidth="1.8" />
        </svg>
      )
    case 'lines':
      return (
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path d="M5 7h14M5 12h14M5 17h14" stroke={color} strokeWidth="1.8" strokeLinecap="round" />
        </svg>
      )
  }
}

export default function TabBar({ active, onChange }: TabBarProps) {
  const { t, locale } = useTranslation()
  const rtl = locale === 'ar'

  const tabs: { id: Tab; label: string }[] = [
    { id: 'home', label: t('tabRoute') },
    { id: 'map', label: t('tabMap') },
    { id: 'lines', label: t('tabLines') },
  ]

  return (
    <nav
      className="flex shrink-0 items-stretch border-t border-line bg-white"
      style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}
      aria-label="Navigation principale"
    >
      {tabs.map((tab) => {
        const isActive = active === tab.id
        const color = isActive ? BRAND : INACTIVE
        return (
          <button
            key={tab.id}
            type="button"
            onClick={() => onChange(tab.id)}
            className="tap flex min-h-[56px] flex-1 flex-col items-center justify-center gap-[3px] pb-1.5 pt-2"
            style={{ color }}
            aria-current={isActive ? 'page' : undefined}
          >
            <TabIcon tab={tab.id} color={color} rtl={rtl} />
            <span className="text-[11px] font-medium">{tab.label}</span>
          </button>
        )
      })}
    </nav>
  )
}

'use client'

import { Component, type ErrorInfo, type ReactNode } from 'react'
import { useTranslation } from '@/hooks/useTranslation'

// Frontière d'erreur autour de la carte. MapView sait déjà dire « pas de
// WebGL » ; cette frontière couvre toute AUTRE exception de la carte (pilote
// graphique capricieux, style corrompu, bogue de rendu). Sans elle, une seule
// exception faisait tomber toute l'app sur « Application error », formulaire
// d'itinéraire et catalogue des lignes compris — qui n'ont pas besoin de la
// carte. Le reste de l'écran reste donc utilisable, et on le dit.

function MapCrashed() {
  const { t } = useTranslation()
  return (
    <div className="flex h-full w-full items-center justify-center px-8" style={{ backgroundColor: '#F7F8FA' }}>
      <div className="max-w-sm text-center">
        <p role="status" className="text-body text-ink-600">{t('page_mapCrashed')}</p>
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="tap mt-3 inline-flex min-h-[44px] items-center justify-center rounded-control border border-line bg-white px-5 text-body font-medium text-ink-900"
        >
          {t('ux_reload')}
        </button>
      </div>
    </div>
  )
}

interface State {
  failed: boolean
}

export default class MapErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { failed: false }

  static getDerivedStateFromError(): State {
    return { failed: true }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // Trace pour le diagnostic (console du navigateur).
    console.error('[Nouri] carte', error, info.componentStack)
  }

  render() {
    return this.state.failed ? <MapCrashed /> : this.props.children
  }
}

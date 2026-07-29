'use client'

import dynamic from 'next/dynamic'
import { useState, useCallback, useEffect, useMemo, useRef } from 'react'
import { motion } from 'framer-motion'
import SearchBar from '@/components/SearchBar'
import ItineraryPanel from '@/components/ItineraryPanel'
import NearbyStations from '@/components/NearbyStations'
import SavedPlaces from '@/components/SavedPlaces'
import LanguageSwitcher from '@/components/LanguageSwitcher'
import LineView from '@/components/LineView'
import TabBar, { type Tab } from '@/components/TabBar'
import { allLines, metroLine, estimatedHeadwayMin } from '@/lib/lines'
import { planTrip, mockPlanTrip, checkOtpHealth, OtpItinerary, Coordinate, formatDuration, formatTime, getLegColor } from '@/lib/otp'
import { useRecentSearches } from '@/hooks/useRecentSearches'
import { useGeolocation } from '@/hooks/useGeolocation'
import { useUserPosition } from '@/hooks/useUserPosition'
import { useWakeLock } from '@/hooks/useWakeLock'
import { useTranslation } from '@/hooks/useTranslation'
import { buildLegGeometries, progressFromElapsed, progressFromPosition } from '@/lib/navigation'

// Fond d'attente de la carte : neutre et statique — jamais de spinner
// plein écran (règle squelette du handoff 1j).
function MapLoadingFallback() {
  const { t } = useTranslation()

  return (
    <div className="flex h-full w-full items-center justify-center" style={{ backgroundColor: '#F7F8FA' }}>
      <p className="text-body text-ink-400">{t('loading')}</p>
    </div>
  )
}

// ssr:false sans option `loading` : le serveur et le premier rendu client
// émettent tous deux « rien » (pas de mismatch d'hydratation). Le fond de
// chargement est rendu en couche permanente sous la carte (voir <main>).
const MapView = dynamic(() => import('@/components/MapView'), { ssr: false })

type OtpStatus = 'unknown' | 'online' | 'offline'

// Tarif estimé d'un itinéraire : chaque tronçon transport = un ticket (le
// réseau algérois n'a pas de correspondance tarifaire). On additionne les
// tarifs connus des lignes empruntées.
function estimateFare(legs: { mode: string; routeShortName?: string }[]): string | null {
  let total = 0
  let found = false
  for (const leg of legs) {
    if (leg.mode === 'WALK') continue
    const line = allLines.find((l) => l.shortName === leg.routeShortName)
    const price = line?.fare ? parseInt(line.fare, 10) : NaN
    if (!Number.isNaN(price)) { total += price; found = true }
  }
  return found ? `${total} DZD` : null
}

export default function Home() {
  const [itineraries, setItineraries] = useState<OtpItinerary[]>([])
  const [previewIndex, setPreviewIndex] = useState(0)
  const [confirmedIndex, setConfirmedIndex] = useState<number | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [demoMode, setDemoMode] = useState(false)
  const [otpStatus, setOtpStatus] = useState<OtpStatus>('unknown')
  const [clickMode, setClickMode] = useState<'from' | 'to' | null>(null)
  const [externalFrom, setExternalFrom] = useState<Coordinate | null>(null)
  const [externalTo, setExternalTo] = useState<Coordinate | null>(null)
  const [fromName, setFromName] = useState<string | undefined>()
  const [toName, setToName] = useState<string | undefined>()
  // L'accueil EST le formulaire d'itinéraire : il ne reste que deux niveaux,
  // les onglets (« home ») et l'écran de résultats poussé par-dessus.
  const [sheet, setSheet] = useState<'home' | 'results'>('home')
  const [activeTab, setActiveTab] = useState<Tab>('home')
  const [navMode, setNavMode] = useState(false)
  // Navigation : la progression se mesure depuis l'appui sur « Commencer »
  // (durées cumulées des étapes), pas sur les horodatages OTP — un trajet
  // calculé pour 10 h et lancé le soir n'est pas « déjà terminé ».
  const [navNow, setNavNow] = useState(() => Date.now())
  const [navStartedAt, setNavStartedAt] = useState<number | null>(null)
  const [locateSignal, setLocateSignal] = useState(0)
  // React 18 ne sérialise pas l'attribut `inert` (arrivé en React 19) : il faut
  // le poser à la main, sinon l'écran Résultats reste tabulable une fois sorti
  // de l'écran — aria-hidden ne retire que l'annonce, pas le focus.
  const resultsPanelRef = useRef<HTMLDivElement>(null)
  // Résultats façon RATP : la liste et le détail sont deux écrans distincts.
  const [detailOpen, setDetailOpen] = useState(false)
  // Hors-ligne (PWA) : bandeau plat informatif, le statique reste consultable.
  const [isOffline, setIsOffline] = useState(false)

  useEffect(() => {
    const goOffline = () => setIsOffline(true)
    const goOnline = () => setIsOffline(false)
    setIsOffline(!navigator.onLine)
    window.addEventListener('offline', goOffline)
    window.addEventListener('online', goOnline)
    return () => {
      window.removeEventListener('offline', goOffline)
      window.removeEventListener('online', goOnline)
    }
  }, [])

  const autoSearchRef = useRef(false)
  // Tronçon le plus avancé déjà atteint : empêche la progression de reculer si
  // le trajet repasse au même endroit ou si le GPS saute.
  const reachedLegRef = useRef(0)
  const { searches: recentSearches, addSearch } = useRecentSearches()
  const geo = useGeolocation()
  // Suivi continu de la position, actif dès l'entrée en navigation.
  const { position: userPosition, error: positionError, start: requestPosition } = useUserPosition(navMode)
  // L'écran reste allumé tant qu'on navigue : sinon il s'éteint toutes les 30 s
  // et l'usager doit le rallumer à chaque carrefour.
  useWakeLock(navMode)
  const { t, locale } = useTranslation()

  const getModeLabel = useCallback((mode: string) => {
    if (mode === 'SUBWAY') return t('metro')
    if (mode === 'TRAM') return t('tram')
    return t('walk')
  }, [t])

  const getItineraryAria = useCallback((itinerary: OtpItinerary) => {
    const modes = itinerary.legs
      .filter((leg) => leg.mode !== 'WALK')
      .map((leg) => getModeLabel(leg.mode))
      .join(' + ')

    return `${t('journey')}: ${modes || t('onFoot')}`
  }, [getModeLabel, t])

  useEffect(() => {
    checkOtpHealth().then((ok) => setOtpStatus(ok ? 'online' : 'offline'))
  }, [])

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const fromParam = params.get('from')
    const toParam = params.get('to')
    if (!fromParam || !toParam) return

    const parse = (value: string): Coordinate | null => {
      const parts = value.split(',')
      if (parts.length < 2) return null
      const lat = parseFloat(parts[0])
      const lon = parseFloat(parts[1])
      if (Number.isNaN(lat) || Number.isNaN(lon)) return null
      return {
        lat,
        lon,
        name: parts.slice(2).map(decodeURIComponent).join(',') || undefined,
      }
    }

    const from = parse(fromParam)
    const to = parse(toParam)
    if (from && to) {
      setExternalFrom(from)
      setExternalTo(to)
      autoSearchRef.current = true
    }
  }, [])

  useEffect(() => {
    if (!autoSearchRef.current || !externalFrom || !externalTo) return
    autoSearchRef.current = false
    void handleSearch(externalFrom, externalTo)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [externalFrom, externalTo])

  useEffect(() => {
    const panel = resultsPanelRef.current
    if (!panel) return
    if (sheet === 'results') panel.removeAttribute('inert')
    else panel.setAttribute('inert', '')
  }, [sheet])

  const handleTabChange = useCallback((tab: Tab) => {
    setActiveTab(tab)
    setSheet('home')
    // L'onglet Carte centre automatiquement sur la position de l'utilisateur.
    if (tab === 'map') setLocateSignal((n) => n + 1)
  }, [])

  // Une destination choisie ailleurs (carte, ligne, arrêt) remplit le
  // formulaire d'accueil et y ramène l'utilisateur.
  const handlePickDestination = useCallback((coord: Coordinate) => {
    setExternalTo(coord)
    setActiveTab('home')
    setSheet('home')
  }, [])

  const handleSearch = useCallback(async (
    from: Coordinate | null,
    to: Coordinate | null,
    date?: Date,
    arriveBy?: boolean,
  ) => {
    if (!from || !to) return

    setLoading(true)
    setError(null)
    setDemoMode(false)
    setClickMode(null)
    setDetailOpen(false)
    setFromName(from.name)
    setToName(to.name)
    // Handoff 1j : on ouvre l'écran résultats tout de suite avec des rangées
    // squelettes — jamais de spinner plein écran.
    setItineraries([])
    setSheet('results')

    if (otpStatus !== 'offline') {
      try {
        const result = await planTrip(
          { lat: from.lat, lon: from.lon, name: from.name },
          { lat: to.lat, lon: to.lon, name: to.name },
          date,
          arriveBy,
        )

        // OTP signale « trivial distance » sous ~1,5 km TOUT EN renvoyant un
        // itinéraire à pied parfaitement valable. Ne jamais court-circuiter sur
        // une erreur si un plan accompagne la réponse — sinon tous les trajets
        // de centre-ville affichent « points trop proches » pour rien.
        const hasPlan = Boolean(result.plan?.itineraries?.length)

        if (result.error && !hasPlan) {
          const otpCode = result.error.message ?? ''
          const otpMsg = result.error.msg?.toLowerCase() ?? ''

          if (otpMsg.includes('trivial distance')) {
            setError(t('tooClose'))
            setLoading(false)
            return
          }

          if (
            otpCode !== 'PATH_NOT_FOUND' &&
            otpCode !== 'LOCATION_NOT_ACCESSIBLE' &&
            !otpMsg.includes('unknown') &&
            !result.error.noPath
          ) {
            setError(`${t('impossible')} - ${otpCode || otpMsg || t('error')}`)
            setLoading(false)
            return
          }
        }

        if (result.plan?.itineraries.length) {
          setItineraries(result.plan.itineraries)
          setPreviewIndex(0)
          setConfirmedIndex(null)
          setSheet('results')
          setOtpStatus('online')
          addSearch(from, to)
          setLoading(false)
          return
        }
      } catch {
        setOtpStatus('offline')
      }
    }

    const mock = mockPlanTrip(
      { lat: from.lat, lon: from.lon, name: from.name },
      { lat: to.lat, lon: to.lon, name: to.name },
    )

    if (mock.plan?.itineraries.length) {
      setItineraries(mock.plan.itineraries)
      setPreviewIndex(0)
      setConfirmedIndex(null)
      setSheet('results')
      setDemoMode(true)
      addSearch(from, to)
    } else {
      // Explication planche 1j : factuelle, avec le dernier départ utile.
      setError(
        `${t('noRouteExplain')}${metroLine.hours ? ` ${t('lastDeparture').charAt(0).toUpperCase()}${t('lastDeparture').slice(1)} M1 : ${metroLine.hours.last}.` : ''}`,
      )
    }

    setLoading(false)
  }, [addSearch, otpStatus, t])

  const handleMapClick = useCallback((coord: Coordinate) => {
    if (clickMode === 'from') {
      setExternalFrom(coord)
      setClickMode('to')
    } else if (clickMode === 'to') {
      setExternalTo(coord)
      setClickMode(null)
    }
  }, [clickMode])

  const handleReset = useCallback(() => {
    setItineraries([])
    setConfirmedIndex(null)
    setDemoMode(false)
    setDetailOpen(false)
    setError(null)
    // Retour planche 1g : les résultats reviennent au formulaire (l'accueil).
    setActiveTab('home')
    setSheet('home')
  }, [])

  const handleGo = useCallback(() => {
    setConfirmedIndex(previewIndex)
    setNavMode(true)
    setNavStartedAt(Date.now())
    setSheet('home')
    // Façon Apple Plans : entrer en navigation active le suivi de position.
    setLocateSignal((n) => n + 1)
  }, [previewIndex])

  useEffect(() => {
    if (!navMode) return
    setNavNow(Date.now())
    const id = setInterval(() => setNavNow(Date.now()), 30000)
    return () => clearInterval(id)
  }, [navMode])

  const handleExitNav = useCallback(() => {
    setNavMode(false)
    setSheet('results')
  }, [])

  const displayedItinerary = itineraries[confirmedIndex ?? previewIndex] ?? null
  const navItinerary = navMode && confirmedIndex !== null ? itineraries[confirmedIndex] ?? null : null

  // Géométrie décodée une seule fois par trajet : la projection de la position
  // s'en sert à chaque rafraîchissement du GPS.
  const navGeometries = useMemo(
    () => (navItinerary ? buildLegGeometries(navItinerary) : null),
    [navItinerary],
  )

  // Progression de navigation : calculée UNE fois ici, puis partagée avec la
  // carte. Elle suit la POSITION réelle ; l'horloge n'est qu'un repli quand le
  // GPS est indisponible (http non sécurisé, permission refusée, signal perdu).
  const navProgress = useMemo(() => {
    if (!navItinerary || !navGeometries) return null

    if (userPosition) {
      const fromGps = progressFromPosition(
        navItinerary,
        navGeometries,
        [userPosition.lon, userPosition.lat],
        // On ne revient pas en arrière : un trajet qui repasse au même endroit
        // (boucle, aller-retour) ne doit pas faire reculer la progression.
        reachedLegRef.current,
      )
      if (fromGps) return { ...fromGps, nav: navItinerary }
    }

    const elapsed = navStartedAt !== null ? navNow - navStartedAt : 0
    return { ...progressFromElapsed(navItinerary, elapsed), nav: navItinerary }
  }, [navItinerary, navGeometries, userPosition, navStartedAt, navNow])

  // Mémorise le tronçon le plus avancé atteint (garde-fou anti-retour).
  useEffect(() => {
    if (!navMode) {
      reachedLegRef.current = 0
      return
    }
    if (navProgress && navProgress.legIndex > reachedLegRef.current) {
      reachedLegRef.current = navProgress.legIndex
    }
  }, [navMode, navProgress])
  // La couche des onglets s'efface pour laisser voir la carte (onglet Carte ou
  // navigation) ; sur les résultats elle reste, simplement reculée.
  const contentHidden = sheet !== 'results' && (navMode || activeTab === 'map')

  // `h-screen` (100vh) inclut la zone derrière la barre d'URL mobile : la barre
  // d'onglets, dernier enfant, tombait alors SOUS le repli visible. `100dvh`
  // suit la hauteur réellement visible ; `h-screen` reste le repli pour les
  // très vieux navigateurs qui ignorent `dvh`.
  return (
    <main className="relative h-screen w-screen overflow-hidden" style={{ height: '100dvh', backgroundColor: '#F7F8FA' }}>
      <div className="absolute inset-0">
        <MapLoadingFallback />
      </div>
      <MapView
        itinerary={sheet === 'results' || navMode ? displayedItinerary : null}
        onMapClick={handleMapClick}
        clickMode={clickMode}
        hideControls={navMode}
        navigating={navMode}
        navLegIndex={navProgress?.legIndex}
        navLegProgress={navProgress?.legProgress}
        userPosition={userPosition}
        onRequestPosition={requestPosition}
        positionError={positionError}
        mapActive={activeTab === 'map' && sheet === 'home' && !navMode}
        autoLocateSignal={locateSignal}
      />

      {/* Couche des onglets. L'accueil EST le formulaire d'itinéraire
          (planche 1f) ; la carte n'apparaît que sur son onglet, les résultats
          et la navigation. Push vers les résultats : l'écran recule de 25 %
          sous un voile 4 % (spec motion). */}
      <motion.div
        className="absolute inset-x-0 top-0 z-10 flex flex-col bg-white md:hidden"
        initial={false}
        animate={sheet === 'results' ? { x: locale === 'ar' ? '25%' : '-25%' } : { x: 0 }}
        transition={{ duration: 0.32, ease: [0.2, 0, 0, 1] }}
        style={{
          bottom: 'calc(54px + env(safe-area-inset-bottom, 0px))',
          pointerEvents: sheet === 'home' && !navMode && activeTab !== 'map' ? 'auto' : 'none',
          opacity: contentHidden ? 0 : 1,
          // Le fond blanc revient d'un coup : un fondu 0→1 laisserait voir la
          // carte par transparence, et il saccade pendant que MapLibre rend
          // ses tuiles. On ne fond que dans le sens « on va vers la carte ».
          transition: contentHidden ? 'opacity 200ms ease' : 'none',
          visibility: contentHidden ? 'hidden' : 'visible',
        }}
      >
        {isOffline && (
          <p className="shrink-0 bg-paper-2 px-5 py-2 text-label text-ink-600" style={{ paddingTop: 'calc(env(safe-area-inset-top, 0px) + 8px)' }}>
            {t('offlineBanner')}
          </p>
        )}

        {/* Crossfade 200 ms au changement d'onglet ou de langue (spec motion) */}
        <div className="min-h-0 flex-1">
          {activeTab === 'home' && (
            <div key={`home-${locale}`} className="state-fade h-full">
              <SearchBar
                onSearch={handleSearch}
                loading={loading}
                recentSearches={recentSearches}
                externalFrom={externalFrom}
                externalTo={externalTo}
                visible={sheet === 'home'}
                geo={geo}
                headerAction={<LanguageSwitcher />}
              >
                <SavedPlaces onSelect={handlePickDestination} />
              </SearchBar>
            </div>
          )}
          {activeTab === 'lines' && (
            <div
              key={`lines-${locale}`}
              className="state-fade h-full"
              style={{ paddingTop: 'calc(env(safe-area-inset-top, 0px) + 14px)' }}
            >
              <LineView
                onSelectStation={handlePickDestination}
              />
            </div>
          )}
        </div>

        <div
          className="pointer-events-none absolute inset-0 bg-black transition-opacity duration-[320ms]"
          style={{ opacity: sheet === 'results' ? 0.04 : 0 }}
          aria-hidden="true"
        />
      </motion.div>

      <div
        className="absolute inset-x-0 bottom-0 z-20 md:hidden"
        style={{ pointerEvents: sheet === 'home' && !navMode ? 'auto' : 'none' }}
      >
        <TabBar active={activeTab} onChange={handleTabChange} />
      </div>

      {/* Résultats (planche 1g) : écran plein, push 320 ms depuis le côté */}
      <div
        ref={resultsPanelRef}
        className={`absolute inset-0 z-20 flex flex-col bg-white md:hidden ${
          sheet === 'results' ? 'translate-x-0' : 'ltr:translate-x-full rtl:-translate-x-full'
        }`}
        style={{
          transition: 'transform 320ms cubic-bezier(0.2, 0, 0, 1)',
          pointerEvents: sheet === 'results' ? 'auto' : 'none',
        }}
        // Hors écran, cet écran doit sortir AUSSI du parcours clavier et de
        // l'arbre d'accessibilité : `pointer-events` n'écarte que la souris.
        // `inert` est posé par un effet, pas ici : React 18 ignore l'attribut.
        // Pas de `visibility: hidden`, qui ferait disparaître l'écran d'un coup
        // au lieu de le laisser glisser sur 320 ms.
        aria-hidden={sheet !== 'results'}
      >
        {!detailOpen ? (
          /* Header résultats (planche 1g) */
          <div
            className="flex shrink-0 items-center gap-3 border-b border-line px-5 pb-3.5"
            style={{ paddingTop: 'calc(env(safe-area-inset-top, 0px) + 12px)' }}
          >
            <button
              onClick={handleReset}
              aria-label={t('back')}
              className="tap relative shrink-0 pe-0.5 pt-0.5 after:absolute after:-inset-[11px] after:content-['']"
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" className="rtl:rotate-180" aria-hidden="true">
                <path d="M14.5 5l-7 7 7 7" stroke="#111827" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
            <div className="min-w-0">
              <p className="truncate text-emph font-semibold text-ink-900">
                {fromName} {t('routeArrow')} {toName}
              </p>
              <p className="tnum mt-0.5 text-label text-ink-400">
                {/* « Départ maintenant » reste RTL en arabe ; seule l'heure est
                    en latin dir=ltr. */}
                {t('departNow')} {itineraries[0] ? <>· <span dir="ltr">{formatTime(itineraries[0].startTime)}</span></> : ''}
              </p>
            </div>
            {demoMode && (
              <span className="ms-auto shrink-0 rounded-full bg-paper-2 px-2 py-0.5 text-xs font-medium text-ink-600">
                {t('demoMode')}
              </span>
            )}
          </div>
        ) : (
          /* Header détail (planche 1h) : une seule rangée discrète */
          <div
            className="flex shrink-0 items-center gap-3 px-5 pb-0"
            style={{ paddingTop: 'calc(env(safe-area-inset-top, 0px) + 12px)' }}
          >
            <button
              onClick={() => setDetailOpen(false)}
              aria-label={t('back')}
              className="tap relative shrink-0 pe-0.5 pt-0.5 after:absolute after:-inset-[11px] after:content-['']"
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" className="rtl:rotate-180" aria-hidden="true">
                <path d="M14.5 5l-7 7 7 7" stroke="#111827" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
            <p className="min-w-0 truncate text-body text-ink-600">
              {fromName} {t('routeArrow')} {toName}
            </p>
          </div>
        )}

        {/* Push liste → détail 320 ms (spec motion) : le détail glisse depuis
            le côté, la liste recule de 25 % sous un voile 4 %. */}
        <div className="relative min-h-0 flex-1 overflow-hidden" style={{ backgroundColor: '#ffffff' }}>
          <div
            className={`absolute inset-0 overflow-y-auto transition-transform duration-[320ms] ease-[cubic-bezier(0.2,0,0,1)] ${
              detailOpen ? 'ltr:-translate-x-1/4 rtl:translate-x-1/4' : ''
            }`}
          >
          {loading ? (
            /* Chargement (handoff 1j) : squelette de 2 rangées, jamais de spinner */
            <div className="skeleton-pulse" aria-hidden="true">
              {[0, 1].map((row) => (
                <div key={row} className={`flex items-center gap-3 px-5 py-[13px] ${row > 0 ? 'border-t border-line' : ''}`}>
                  <span className="h-[26px] w-9 rounded-[8px] bg-skeleton" />
                  <span className="flex-1">
                    <span className="block h-3 rounded-[6px] bg-skeleton" style={{ width: row === 0 ? '60%' : '48%' }} />
                    <span className="mt-1.5 block h-[9px] rounded-[5px] bg-paper-2" style={{ width: row === 0 ? '35%' : '30%' }} />
                  </span>
                  <span className="h-3.5 w-[52px] rounded-[7px] bg-skeleton" />
                </div>
              ))}
            </div>
          ) : error ? (
            /* Aucun itinéraire (handoff 1j) : expliquer, proposer, jamais de rouge */
            <div className="px-5 pb-[30px] pt-7 text-center">
              <p className="text-emph font-medium text-ink-900">{t('noRoutesAvailable')}</p>
              <p className="mt-1.5 text-body text-ink-600">{error}</p>
              <button
                type="button"
                onClick={() => { setError(null); setSheet('home'); setActiveTab('lines') }}
                className="tap relative mt-3.5 text-body font-medium text-brand after:absolute after:inset-x-0 after:-inset-y-[13px] after:content-['']"
              >
                {t('seeNearbyLines')}
              </button>
            </div>
          ) : (
            /* Résultats (handoff 1g) : rangées plates triées par durée, une seule
               valeur dominante (« 52 min ») + qualificatif ; tap → écran détail.
               Padding bas = safe-area : sinon la note finale passe sous le home
               indicator de l'iPhone. */
            <div style={{ paddingBottom: 'max(8px, env(safe-area-inset-bottom, 0px))' }}>
              {(() => {
                // Tri pondéré : à durée quasi égale, on remonte l'itinéraire
                // qui fait moins marcher (au-delà de 15 min de marche). Le
                // coefficient 0.3 a été mesuré — plus haut, il afficherait
                // « 73 min » au-dessus de « 60 min », ce qui passe pour un bug.
                const walkPenalty = (it: OtpItinerary) =>
                  it.duration + 0.3 * Math.max(0, it.walkTime - 900)
                const fastestDuration = Math.min(...itineraries.map((it) => it.duration))
                const sorted = itineraries
                  .map((it, originalIndex) => ({ it, originalIndex }))
                  // Garde-fou : jamais remonter un trajet plus lent de +5 min.
                  .sort((a, b) => {
                    if (a.it.duration - b.it.duration > 300) return 1
                    if (b.it.duration - a.it.duration > 300) return -1
                    return walkPenalty(a.it) - walkPenalty(b.it)
                  })
                  .slice(0, 4)
                // Le badge suit la VRAIE durée minimale, pas le vainqueur du
                // tri : sinon « le plus rapide » mentirait.
                const fastestIdx = sorted.find(({ it }) => it.duration === fastestDuration)?.originalIndex
                // Le badge se base sur le TEMPS de marche — c'est ce que la
                // rangée affiche. Sur walkDistance, « moins de marche » pouvait
                // atterrir sur l'itinéraire montrant le plus de minutes à pied.
                const lessWalkIdx = sorted.length > 1
                  ? sorted.reduce((best, cur) =>
                      cur.it.walkTime < best.it.walkTime ? cur : best
                    ).originalIndex
                  : undefined
                const fareOf = (legs: typeof itineraries[0]['legs']) => {
                  const f = estimateFare(legs)
                  return f ? parseInt(f, 10) : Infinity
                }
                const cheapestIdx = sorted.length > 1
                  ? sorted.reduce((best, cur) =>
                      fareOf(cur.it.legs) < fareOf(best.it.legs) ? cur : best
                    ).originalIndex
                  : undefined
                return sorted.map(({ it: itinerary, originalIndex }, index) => {
                  const transitLegs = itinerary.legs.filter((leg) => leg.mode !== 'WALK')
                  const first = transitLegs[0]
                  const fare = estimateFare(itinerary.legs)
                  const walkMin = Math.round(
                    itinerary.legs.filter((l) => l.mode === 'WALK').reduce((s, l) => s + l.duration, 0) / 60,
                  )
                  const qualifier = originalIndex === fastestIdx
                    ? { text: t('fastest'), color: '#059669' }
                    : originalIndex === lessWalkIdx && lessWalkIdx !== fastestIdx
                      ? { text: t('lessWalking'), color: '#9CA3AF' }
                      : originalIndex === cheapestIdx && cheapestIdx !== fastestIdx && cheapestIdx !== lessWalkIdx
                        ? { text: t('cheapest'), color: '#9CA3AF' }
                        : null
                  // Planche 1g : un bus sans correspondance est « direct » et sa
                  // 3e info est la fréquence de la ligne, pas l'heure de départ.
                  const isDirectBus = itinerary.transfers === 0 && transitLegs.length === 1 && first?.mode === 'BUS'
                  const directLine = isDirectBus ? allLines.find((l) => l.shortName === first?.routeShortName) : undefined
                  // Le pluriel est une affaire de langue, pas de concaténation :
                  // « تحويلةs » n'existe pas.
                  const thirdInfo = itinerary.transfers > 0
                    ? `${itinerary.transfers} ${itinerary.transfers > 1 ? t('correspondencesWord') : t('correspondenceWord')}`
                    : directLine
                      ? `${t('frequencyWord')} ~${estimatedHeadwayMin(directLine)} ${t('min')}`
                      : first
                        ? `${t('departPrefix')} ~${formatTime(first.startTime)}`
                        : t('walkingOnly')
                  return (
                    <button
                      key={originalIndex}
                      type="button"
                      onClick={() => { setPreviewIndex(originalIndex); setDetailOpen(true) }}
                      className={`tap w-full px-5 py-4 text-start active:bg-paper-2 ${index > 0 ? 'border-t border-line' : ''}`}
                      aria-label={getItineraryAria(itinerary)}
                    >
                      <div className="flex items-center justify-between gap-3.5">
                        <div className="min-w-0 flex-1">
                          {/* Séquence planche 1g : badges + chevrons + marche agrégée */}
                          <div className="flex flex-wrap items-center gap-2">
                            {transitLegs.map((leg, li) => (
                              <span key={li} className="flex items-center gap-2">
                                {li > 0 && (
                                  <svg width="10" height="10" viewBox="0 0 10 10" fill="none" className="rtl:rotate-180" aria-hidden="true">
                                    <path d="M3 1.5L7 5 3 8.5" stroke="#9CA3AF" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                                  </svg>
                                )}
                                <span
                                  className="inline-flex h-6 min-w-[32px] items-center justify-center rounded-[8px] px-[7px] text-label font-semibold text-white"
                                  style={{ backgroundColor: getLegColor(leg.mode) }}
                                  dir="ltr"
                                >
                                  {leg.routeShortName}
                                </span>
                              </span>
                            ))}
                            {walkMin > 0 && (
                              <span className="text-body text-ink-600">
                                {isDirectBus ? `${t('direct')} ` : ''}{transitLegs.length > 0 ? '+ ' : ''}{walkMin} {t('min')} {t('walkingOnly')}
                              </span>
                            )}
                          </div>
                          {/* dir=ltr sur la SEULE plage horaire, pas sur toute
                              la ligne : `fare` et `thirdInfo` peuvent être en
                              arabe (« 50 دج », « التردد ~10 دقيقة ») et doivent
                              suivre le sens RTL du document, sinon leurs mots se
                              lisent à l'envers. */}
                          <p className="tnum mt-1.5 truncate text-label text-ink-400">
                            <span dir="ltr">{formatTime(itinerary.startTime)} → {formatTime(itinerary.endTime)}</span>
                            {fare ? ` · ${fare}` : ''}
                            {` · ${thirdInfo}`}
                          </p>
                        </div>
                        <span className="shrink-0 text-end">
                          <span className="tnum block text-title font-semibold leading-[22px] text-ink-900">
                            {formatDuration(itinerary.duration)}
                          </span>
                          {qualifier && (
                            <span className="mt-0.5 block text-label" style={{ color: qualifier.color }}>
                              {qualifier.text}
                            </span>
                          )}
                        </span>
                      </div>
                    </button>
                  )
                })
              })()}
              <p className="px-5 py-3.5 text-label text-ink-400">
                {/* En mode démo le trajet est FABRIQUÉ par mockPlanTrip :
                    prétendre qu'il vient des fréquences officielles serait le
                    mensonge le plus grave que l'app puisse faire. */}
                {demoMode ? t('demoNote') : t('estimatedNote')}
              </p>
            </div>
          )}
            <div
              className="pointer-events-none absolute inset-0 bg-black transition-opacity duration-[320ms]"
              style={{ opacity: detailOpen ? 0.04 : 0 }}
              aria-hidden="true"
            />
          </div>

          {/* Couche détail (planche 1h) : glisse depuis le côté au-dessus de la liste */}
          <div
            className={`absolute inset-0 flex flex-col bg-white transition-transform duration-[320ms] ease-[cubic-bezier(0.2,0,0,1)] ${
              detailOpen ? 'translate-x-0' : 'ltr:translate-x-full rtl:-translate-x-full'
            }`}
            style={{ pointerEvents: detailOpen ? 'auto' : 'none' }}
          >
            {displayedItinerary && detailOpen && (
              <div className="min-h-0 flex-1 overflow-y-auto">
                <ItineraryPanel
                  itineraries={[displayedItinerary]}
                  selectedIndex={0}
                  onSelect={() => {}}
                  onClose={() => {}}
                  hideHeader
                />
              </div>
            )}
          </div>
        </div>

        {detailOpen && (
          <div
            className="shrink-0 px-5 pt-3"
            style={{ backgroundColor: '#ffffff', paddingBottom: 'max(34px, env(safe-area-inset-bottom, 0px))' }}
          >
            <button
              type="button"
              onClick={handleGo}
              className="tap flex h-[50px] w-full items-center justify-center rounded-control bg-brand text-emph font-semibold text-white"
            >
              {t('go')}
            </button>
          </div>
        )}
      </div>

      {navMode && navProgress && (() => {
        // Progression réelle (position GPS projetée sur le tracé), partagée
        // avec la carte. `source` dit si elle vient du GPS ou de l'horloge.
        const { nav, legIndex: currentIdx, legProgress: progress, remainingMeters, stopsLeft, source } = navProgress
        const leg = nav.legs[currentIdx]
        const next = nav.legs[currentIdx + 1]
        const isWalk = leg.mode === 'WALK'
        // Sans détection d arrivée, le bandeau tournait indéfiniment sur
        // « ~1 min » (remainMin est planché à 1) et l heure d arrivée glissait
        // avec l horloge. En GPS on déclare l arrivée sous 40 m du point de
        // descente ; sans position, quand les durées prévues sont épuisées.
        const arrived = currentIdx === nav.legs.length - 1
          && (source === 'gps' ? remainingMeters < 40 : progress >= 1)
        const ctx = leg.mode === 'SUBWAY'
          ? t('ctxMetro')
          : leg.mode === 'TRAM'
            ? t('ctxTram')
            : leg.mode === 'BUS'
              ? t('ctxBus')
              : t('ctxWalk')
        // Temps restant sur l'étape : déduit de la distance qui reste
        // réellement à parcourir, pas d'un décompte d'horloge.
        const legSpeed = leg.distance > 0 ? leg.distance / Math.max(1, leg.duration) : 0
        const remainMin = legSpeed > 0
          ? Math.max(1, Math.ceil(remainingMeters / legSpeed / 60))
          : Math.max(1, Math.ceil(leg.duration * (1 - progress) / 60))
        // À pied, la distance restante parle plus que le nombre d'arrêts.
        const stopsPart = isWalk
          ? `${Math.max(10, Math.round(remainingMeters / 10) * 10)} m`
          : stopsLeft !== null
            ? `${stopsLeft} ${t('stopsLeft')}`
            : null
        const nextSummary = next
          ? next.mode === 'WALK'
            ? `${Math.round(next.distance)} m ${t('ctxWalk').toLowerCase()} ${t('towards')} ${next.to.name} · ${Math.max(1, Math.round(next.duration / 60))} ${t('min')}`
            : `${next.routeShortName ?? ''} ${t('towards')} ${next.headsign ?? next.to.name} · ${Math.max(1, Math.round(next.duration / 60))} ${t('min')}`
          : `${toName ?? nav.legs[nav.legs.length - 1].to.name} · ${formatTime(nav.endTime)}`

        return (
          <div className="absolute inset-0 z-30 pointer-events-none md:hidden">
            {/* Carte du haut (planche 1i) : l'étape courante, rien d'autre */}
            <div
              className="card-in-top pointer-events-auto absolute inset-x-5 rounded-card bg-white px-4 pb-3 pt-3.5 shadow-soft"
              style={{ top: 'calc(env(safe-area-inset-top, 0px) + 14px)' }}
            >
              <div className="flex items-baseline justify-between gap-3">
                <span className="truncate text-label font-semibold uppercase tracking-[0.06em] text-ink-600" dir="auto">
                  {ctx}{!isWalk && leg.routeShortName ? ` · ${leg.routeShortName}` : ''}
                </span>
                {!arrived && (
                  <span className="tnum shrink-0 text-label text-ink-600">
                    {t('arrivalAbbr')} ~{formatTime(navNow + navProgress.remainingSeconds * 1000)}
                  </span>
                )}
              </div>
              {/* L'instruction est la seule information de l'écran et elle
                  change en cours de trajet : sans région live, l'usager au
                  lecteur d'écran devrait balayer l'écran en boucle pour
                  savoir quand descendre. */}
              {/* Jamais de `truncate` ici : c'est la seule information de l'écran,
                  et les arrêts ETUSA vont jusqu'à 56 caractères (« École Supérieure
                  d'Hôtellerie et de Restauration d'Alger »). La carte est en position
                  absolue, sa hauteur est libre — deux lignes suffisent. */}
              <p
                className="mt-1 line-clamp-2 text-title font-semibold text-ink-900 [overflow-wrap:anywhere]"
                role="status"
                aria-live="polite"
                aria-atomic="true"
              >
                {arrived
                  ? t('navArrived')
                  : isWalk ? `${t('walkTowards')} ${leg.to.name}` : `${t('alightAt')} ${leg.to.name}`}
              </p>
              <p className="tnum mt-0.5 text-label text-ink-400">
                {arrived
                  ? (toName ?? nav.legs[nav.legs.length - 1].to.name)
                  : [stopsPart, `~${remainMin} ${t('min')}`].filter(Boolean).join(' · ')}
              </p>
              <div className="mt-3 flex h-[3px] overflow-hidden rounded-[2px] bg-line">
                <span
                  className="rounded-[2px] bg-brand transition-[width] duration-700"
                  style={{ width: `${Math.round(progress * 100)}%` }}
                />
              </div>
            </div>

            {/* Feuille basse (planche 1i) : Ensuite + sortie discrète, jamais de rouge */}
            <div className="sheet-in pointer-events-auto absolute inset-x-0 bottom-0 rounded-t-sheet bg-white shadow-[0_-4px_14px_rgba(16,24,40,0.07)]">
              {/* Arrivé, « Ensuite » ne dirait que la destination — déjà lue
                  juste au-dessus. La rangée disparaît plutôt que de se répéter. */}
              {!arrived && (
                <div className="flex items-center gap-3 border-b border-line px-5 py-4">
                  <span className="shrink-0 text-label font-semibold uppercase tracking-[0.06em] text-ink-400">
                    {t('nextLabel')}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-body text-ink-600">{nextSummary}</span>
                </div>
              )}

              {/* Sans position, l'avancement suit les horaires prévus : on le
                  dit plutôt que de laisser croire à un suivi réel. */}
              {source === 'time' && (
                <p className="border-b border-line px-5 py-2.5 text-label text-ink-400">
                  {positionError === 'insecure' ? t('geoInsecure') : t('progressEstimated')}
                </p>
              )}
              <div
                className="flex items-center justify-between gap-3 px-5 pt-3"
                style={{ paddingBottom: 'max(30px, env(safe-area-inset-bottom, 0px))' }}
              >
                {/* Handoff : discret exprès (texte gris). L'usager l'a jugé
                    invisible → on lui donne une frontière (pilule bordée = un
                    seul traitement), pas de rouge : quitter reste réversible. */}
                <button
                  type="button"
                  onClick={handleExitNav}
                  className="tap relative shrink-0 whitespace-nowrap rounded-full border border-line px-4 py-2.5 text-body font-medium text-ink-900 after:absolute after:inset-x-0 after:-inset-y-[3px] after:content-['']"
                >
                  {t('quitNav')}
                </button>
                <span className="tnum min-w-0 truncate text-label text-ink-400">
                  {fromName} {t('routeArrow')} {toName} · {formatDuration(nav.duration)}
                </span>
              </div>
            </div>
          </div>
        )
      })()}

      <div className="absolute left-0 top-0 bottom-0 z-10 hidden w-80 flex-col border-r border-line bg-white md:flex">
        <SearchBar
          onSearch={handleSearch}
          loading={loading}
          recentSearches={recentSearches}
          externalFrom={externalFrom}
          externalTo={externalTo}
          geo={geo}
        />
        {itineraries.length > 0 ? (
          <div className="mt-2 flex-1 overflow-hidden border-t border-gray-100">
            <ItineraryPanel
              itineraries={itineraries}
              selectedIndex={previewIndex}
              onSelect={setPreviewIndex}
              onClose={handleReset}
              fromName={fromName}
              toName={toName}
            />
          </div>
        ) : (
          <>
            <SavedPlaces onSelect={(coord) => { setExternalTo(coord) }} />
            {geo.lat !== null && geo.lon !== null && (
              <NearbyStations lat={geo.lat} lon={geo.lon} onSelect={(coord) => setExternalTo(coord)} />
            )}
          </>
        )}
      </div>
    </main>
  )
}

'use client'

// Écran principal : orchestre les onglets (Itinéraire, Lignes, Carte), la
// recherche, l'écran Résultats et la navigation pas à pas. Ce fichier ne
// calcule rien lui-même : la recherche vient de searchItineraries (otp.ts,
// erreurs typées, jamais de trajet fabriqué), la mise en forme des rangées de
// results-format.ts, la navigation de useNavigationSession (machine à états
// de navigation.ts, persistance, GPS, écran allumé).

import dynamic from 'next/dynamic'
import { useState, useCallback, useEffect, useMemo, useRef } from 'react'
import { motion } from 'framer-motion'
import SearchBar, { type SearchWhen } from '@/components/SearchBar'
import SavedPlaces from '@/components/SavedPlaces'
import LanguageSwitcher from '@/components/LanguageSwitcher'
import LineView from '@/components/LineView'
import TabBar, { type Tab } from '@/components/TabBar'
import NavigationBanner from '@/components/NavigationBanner'
import UpdateNotice from '@/components/UpdateNotice'
import ResultsScreen, { START_LATER_MS, type DetailSnap } from '@/components/ResultsScreen'
import MapErrorBoundary from '@/components/MapErrorBoundary'
import type { MapFocusLine, MapPadding } from '@/components/MapView'
import {
  describePlanError,
  resolvePlanQuery,
  searchItineraries,
  watchOtpHealth,
  type Coordinate,
  type PlanOutcome,
  type PlanWhen,
} from '@/lib/otp'
import { resultsAnnouncement, stateIsDemo, stateItineraries, type SearchState } from '@/lib/results-format'
import { useRecentSearches, type MarkedCoordinate } from '@/hooks/useRecentSearches'
import { useGeolocation } from '@/hooks/useGeolocation'
import { useNavigationSession } from '@/hooks/useNavigationSession'
import { useBackHandler } from '@/hooks/useBackHandler'
import { useEdgeSwipeBack } from '@/hooks/useEdgeSwipeBack'
import { useInert } from '@/hooks/useInert'
import { haptic } from '@/lib/haptics'
import { useTranslation } from '@/hooks/useTranslation'

// Fond d'attente de la carte : neutre et statique — jamais de spinner
// plein écran (règle squelette du handoff 1j).
function MapLoadingFallback() {
  const { t } = useTranslation()

  return (
    // Purement visuel et rendu en permanence sous la carte : masqué aux
    // lecteurs d'écran, sinon « Chargement… » restait annoncé carte chargée
    // ou en échec (MapErrorBoundary dit lui-même l'échec).
    <div aria-hidden="true" className="absolute inset-0 flex items-center justify-center" style={{ backgroundColor: '#F7F8FA' }}>
      <p className="text-body text-ink-400">{t('loading')}</p>
    </div>
  )
}

// ssr:false sans option `loading` : le serveur et le premier rendu client
// émettent tous deux « rien » (pas de mismatch d'hydratation). Le fond de
// chargement est rendu en couche permanente sous la carte.
const MapView = dynamic(() => import('@/components/MapView'), { ssr: false })

/** Largeur de la colonne de l'app sur grand écran (globals.css, .app-column). */
const COLUMN_PX = 420
/** Une session quittée peut être reprise pendant ce délai (useNavigationSession). */
const RESUME_OFFER_MS = 10 * 60_000
// Emprise acceptée pour un lien partagé (?from=…&to=…) : le Grand Alger avec
// une large marge. Au-delà, des coordonnées farfelues ne lancent aucune
// recherche ; à l'intérieur, le proxy dit lui-même « hors zone couverte ».
const LINK_BOUNDS = { minLat: 36.4, maxLat: 37.0, minLon: 2.6, maxLon: 3.6 }

/**
 * Un point d'un lien partagé : « lat,lon,nom ». Jamais d'exception : un nom
 * contenant « % » (ancien lien doublement décodé) faisait tomber toute l'app.
 */
function parseLinkPoint(value: string | null): MarkedCoordinate | null {
  if (!value) return null
  const parts = value.split(',')
  if (parts.length < 2) return null
  const lat = Number(parts[0])
  const lon = Number(parts[1])
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null
  if (lat < LINK_BOUNDS.minLat || lat > LINK_BOUNDS.maxLat || lon < LINK_BOUNDS.minLon || lon > LINK_BOUNDS.maxLon) return null
  const raw = parts.slice(2).join(',').trim()
  let name = raw
  try {
    name = decodeURIComponent(raw)
  } catch {
    // « % » isolé : le nom tel quel.
  }
  name = name.slice(0, 120).trim()
  return { lat, lon, name: name || undefined }
}

/** Grand écran (tablette, téléphone en paysage) et hauteur visible. */
function useViewport() {
  const [viewport, setViewport] = useState({ wide: false, height: 800 })
  useEffect(() => {
    const query = window.matchMedia('(min-width: 768px)')
    const update = () => setViewport({ wide: query.matches, height: window.innerHeight })
    update()
    window.addEventListener('resize', update)
    query.addEventListener?.('change', update)
    return () => {
      window.removeEventListener('resize', update)
      query.removeEventListener?.('change', update)
    }
  }, [])
  return viewport
}

function outcomeToState(out: PlanOutcome): SearchState {
  if (out.status === 'error') {
    return {
      status: 'error',
      query: out.query,
      error: out.error,
      itineraries: out.error.walkFallback ? [out.error.walkFallback] : [],
    }
  }
  if (out.status === 'nextService') {
    return {
      status: 'nextService',
      query: out.query,
      itineraries: out.itineraries,
      dayOffset: out.dayOffset,
      fallback: out.fallback,
      serviceQuery: out.serviceQuery,
    }
  }
  return { status: 'ok', query: out.query, itineraries: out.itineraries, notice: out.notice, demo: out.demo }
}

interface LastSearch {
  from: MarkedCoordinate
  to: MarkedCoordinate
  when: PlanWhen
  arriveBy: boolean
}

export default function Home() {
  const { t, locale } = useTranslation()
  const rtl = locale === 'ar'
  const { wide, height: viewportHeight } = useViewport()

  // ── État de l'écran ────────────────────────────────────────────────────────
  const [search, setSearch] = useState<SearchState>({ status: 'idle' })
  const [previewIndex, setPreviewIndex] = useState(0)
  // Résultats façon RATP : la liste et le détail sont deux écrans distincts.
  const [detailOpen, setDetailOpen] = useState(false)
  // Feuille du détail sur téléphone : réduit / milieu (défaut) / plein.
  const [detailSnap, setDetailSnap] = useState<DetailSnap>('mid')
  // Hauteur de carte cachée par la feuille arrêtée (hors plein écran) : la
  // carte cadre le trajet au-dessus (DetailSheet).
  const [detailMapInset, setDetailMapInset] = useState<number | null>(null)
  // Bouton flottant du détail : recadrer la carte sur le trajet.
  const [fitSignal, setFitSignal] = useState(0)
  const [externalFrom, setExternalFrom] = useState<MarkedCoordinate | null>(null)
  const [externalTo, setExternalTo] = useState<MarkedCoordinate | null>(null)
  const [fromName, setFromName] = useState<string | undefined>()
  const [toName, setToName] = useState<string | undefined>()
  // L'accueil EST le formulaire d'itinéraire : il ne reste que deux niveaux,
  // les onglets (« home ») et l'écran de résultats poussé par-dessus.
  const [sheet, setSheet] = useState<'home' | 'results'>('home')
  const [activeTab, setActiveTab] = useState<Tab>('home')
  const [locateSignal, setLocateSignal] = useState(0)
  // « Y aller » : la destination remplie, SearchBar lance la recherche si le
  // départ est déjà résolu (sinon il attend l'usager).
  const [submitSignal, setSubmitSignal] = useState(0)
  // Ligne montrée seule sur la carte (fiche d'arrêt, catalogue des lignes).
  const [focusLine, setFocusLine] = useState<MapFocusLine | null>(null)
  // Ré-appui sur l'onglet Lignes déjà actif : retour au catalogue.
  const [linesResetSignal, setLinesResetSignal] = useState(0)
  // « Voir les lignes proches du départ » (recherche sans résultat) : le
  // catalogue s'ouvre sur les lignes autour de CE point, pas sur la liste A-Z.
  const [nearPoint, setNearPoint] = useState<{ lat: number; lon: number; name: string } | null>(null)
  // Hors-ligne (PWA) : bandeau plat informatif, le statique reste consultable.
  const [isOffline, setIsOffline] = useState(false)
  // Calculateur injoignable : information seulement, chaque recherche le retente.
  const [otpDown, setOtpDown] = useState(false)
  // « Reprendre la navigation » après une sortie (pas après une arrivée).
  const [resumeOffer, setResumeOffer] = useState<{ toName: string; until: number } | null>(null)

  const tabContentRef = useRef<HTMLDivElement>(null)
  const homePanelRef = useRef<HTMLDivElement>(null)
  const tabLayerRef = useRef<HTMLDivElement>(null)
  const tabBarRef = useRef<HTMLDivElement>(null)
  const mapWrapRef = useRef<HTMLDivElement>(null)
  const resultsPanelRef = useRef<HTMLDivElement>(null)
  const detailPanelRef = useRef<HTMLDivElement>(null)
  const navWrapRef = useRef<HTMLDivElement>(null)

  const { searches: recentSearches, addSearch } = useRecentSearches()

  // ── Navigation et position (une seule session GPS) ─────────────────────────
  // Hors navigation, la position n'est suivie (basse précision) que lorsque
  // la carte est à l'écran ; le hook passe seul en haute précision pendant la
  // navigation, garde l'écran allumé et relâche tout après l'arrivée.
  const mapTabShown = activeTab === 'map' && sheet === 'home'
  const nav = useNavigationSession({ idlePosition: mapTabShown ? 'low' : 'off' })
  const navMode = nav.active
  const positionApi = nav.position
  const userPosition = positionApi.position
  const geo = useGeolocation(positionApi)

  // Navigation restaurée au chargement (rechargement, onglet tué puis rendu
  // par le système) : la carte reprend le suivi de la position, comme à
  // l'entrée en navigation. resumed ne passe à vrai qu'au montage.
  useEffect(() => {
    if (nav.resumed) setLocateSignal((n) => n + 1)
  }, [nav.resumed])
  // Le formulaire juge l'âge d'une position sur l'horloge du téléphone
  // (receivedAt) : certains appareils datent le fix avec l'horloge GPS.
  const formPosition = useMemo(
    () => (userPosition
      ? { lat: userPosition.lat, lon: userPosition.lon, accuracy: userPosition.accuracy, timestamp: userPosition.receivedAt }
      : null),
    [userPosition],
  )

  // ── Réseau et calculateur ──────────────────────────────────────────────────
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

  // Le statut d'OTP n'est qu'un bandeau : il ne bloque plus aucune recherche
  // et se revérifie seul (retour du réseau, retour au premier plan).
  useEffect(() => watchOtpHealth((info) => setOtpDown(!info.ok)), [])

  // ── Recherche ──────────────────────────────────────────────────────────────
  // Une seule recherche vivante : la précédente est annulée, et une réponse
  // arrivée après un retour ou une nouvelle recherche est ignorée (elle
  // rouvrait l'écran Résultats sous les doigts de l'usager).
  const reqIdRef = useRef(0)
  const ctrlRef = useRef<AbortController | null>(null)
  const lastSearchRef = useRef<LastSearch | null>(null)

  const runSearch = useCallback(async (from: MarkedCoordinate, to: MarkedCoordinate, when: PlanWhen, arriveBy: boolean) => {
    ctrlRef.current?.abort()
    const ctrl = new AbortController()
    ctrlRef.current = ctrl
    const id = ++reqIdRef.current
    lastSearchRef.current = { from, to, when, arriveBy }

    setResumeOffer(null)
    setFromName(from.name)
    setToName(to.name)
    setDetailOpen(false)
    setDetailSnap('mid')
    setPreviewIndex(0)
    // Handoff 1j : l'écran Résultats s'ouvre tout de suite avec des rangées
    // squelettes — jamais de spinner plein écran. L'en-tête dit déjà l'heure
    // demandée (« maintenant » = l'instant de l'envoi).
    setSearch({ status: 'loading', query: resolvePlanQuery(when, arriveBy) })
    setSheet('results')

    let out: PlanOutcome
    try {
      out = await searchItineraries(
        { lat: from.lat, lon: from.lon, name: from.name },
        { lat: to.lat, lon: to.lon, name: to.name },
        // locale 'fr' : OTP traduit désormais girouettes et arrêts
        // (translations.txt) ; les rapprochements par girouette (sens d'une
        // ligne, tracé déduit) attendent le français du GTFS. L'arabe est
        // choisi au rendu (placeName, legHeadsign).
        { when, arriveBy, signal: ctrl.signal, locale: 'fr' },
      )
    } catch {
      // searchItineraries ne lève pas ; garde-fou contre une réponse imprévue.
      out = { status: 'error', error: { kind: 'otpUnavailable' }, query: resolvePlanQuery(when, arriveBy) }
    }
    if (id !== reqIdRef.current) return
    ctrlRef.current = null
    if (out.status === 'error' && out.error.kind === 'aborted') return
    setSearch(outcomeToState(out))
    if (out.status !== 'error') addSearch(from, to)
  }, [addSearch])

  // Signature de SearchBar : `when` détaille l'heure choisie (heure murale
  // d'Alger) ; `date` n'est qu'un repli.
  const handleSearch = useCallback((
    from: Coordinate | null,
    to: Coordinate | null,
    date?: Date,
    arriveBy?: boolean,
    when?: SearchWhen,
  ) => {
    if (!from || !to) return
    const planWhen: PlanWhen = when && when.kind !== 'now' && when.date && when.time
      ? { date: when.date, time: when.time }
      : date ?? 'now'
    void runSearch(from, to, planWhen, Boolean(arriveBy))
  }, [runSearch])

  const handleRetry = useCallback(() => {
    const last = lastSearchRef.current
    if (last) void runSearch(last.from, last.to, last.when, last.arriveBy)
  }, [runSearch])

  // ── Liens partagés et raccourcis de l'app installée ────────────────────────
  const autoSearchRef = useRef(false)
  // Quitter la navigation depuis l'effet des liens, qui ne doit tourner qu'une fois.
  const navQuitRef = useRef(nav.quit)
  navQuitRef.current = nav.quit
  useEffect(() => {
    const applyTab = (tab: string | null) => {
      if (tab !== 'lines' && tab !== 'map' && tab !== 'home') return
      setActiveTab(tab)
      setSheet('home')
      if (tab === 'map') setLocateSignal((n) => n + 1)
    }
    const params = new URLSearchParams(window.location.search)
    const from = parseLinkPoint(params.get('from'))
    const to = parseLinkPoint(params.get('to'))
    if (from && to) {
      // Un lien explicite remplace une navigation restaurée (session en
      // localStorage) : sinon la carte d'étape recouvrait les résultats du
      // lien. Même règle que handleReroute (quit puis recherche). La
      // restauration (useNavigationSession, appelé plus haut) a déjà eu lieu.
      navQuitRef.current()
      setExternalFrom(from)
      setExternalTo(to)
      autoSearchRef.current = true
    } else {
      applyTab(params.get('tab'))
    }
    // L'adresse redevient « / » : un rechargement ne rejoue pas la recherche
    // du lien, et le retour système reste celui de l'app.
    if (params.has('from') || params.has('to') || params.has('tab')) {
      try {
        window.history.replaceState(window.history.state, '', window.location.pathname)
      } catch {
        // Historique verrouillé (aperçus intégrés) : sans conséquence.
      }
    }
    // App déjà ouverte : un raccourci du manifeste arrive par launchQueue.
    const launchQueue = (window as Window & {
      launchQueue?: { setConsumer: (consumer: (params: { targetURL?: string }) => void) => void }
    }).launchQueue
    launchQueue?.setConsumer((launch) => {
      try {
        if (launch.targetURL) applyTab(new URL(launch.targetURL).searchParams.get('tab'))
      } catch {
        // URL illisible : on reste où l'on est.
      }
    })
  }, [])

  useEffect(() => {
    if (!autoSearchRef.current || !externalFrom || !externalTo) return
    autoSearchRef.current = false
    void runSearch(externalFrom, externalTo, 'now', false)
  }, [externalFrom, externalTo, runSearch])

  // ── Onglets et choix venus d'ailleurs ──────────────────────────────────────
  const handleTabChange = useCallback((tab: Tab) => {
    haptic('selection')
    // Comme sur iOS et Android : toucher l'onglet déjà actif ramène sa liste
    // tout en haut (et, pour les Lignes, au catalogue) au lieu de ne rien faire.
    if (tab === activeTab && sheet === 'home') {
      tabContentRef.current?.querySelectorAll<HTMLElement>('*').forEach((el) => {
        if (el.scrollTop > 0) el.scrollTo({ top: 0, behavior: 'smooth' })
      })
      if (tab === 'lines') setLinesResetSignal((n) => n + 1)
    }
    setActiveTab(tab)
    setSheet('home')
    // L'onglet Carte centre sur l'usager, sauf si une ligne y est montrée.
    if (tab === 'map' && !focusLine) setLocateSignal((n) => n + 1)
  }, [activeTab, sheet, focusLine])

  // Une destination choisie ailleurs (carte, ligne, arrêt, raccourci) remplit
  // le formulaire d'accueil et y ramène l'usager. Le formulaire restant monté,
  // le départ déjà saisi n'est plus perdu.
  const handlePickDestination = useCallback((coord: MarkedCoordinate) => {
    setExternalTo(coord)
    setActiveTab('home')
    setSheet('home')
  }, [])

  const handlePickOrigin = useCallback((coord: MarkedCoordinate) => {
    // Indispensable : sur téléphone, le formulaire n'est pas visible depuis
    // l'onglet Carte.
    setExternalFrom(coord)
    setActiveTab('home')
    setSheet('home')
  }, [])

  // « Y aller » / « Partir d'ici » depuis la fiche d'arrêt ou un point choisi.
  const handleNavigateTo = useCallback((coord: Coordinate, name: string) => {
    handlePickDestination({ lat: coord.lat, lon: coord.lon, name: coord.name ?? name })
    setSubmitSignal((n) => n + 1)
  }, [handlePickDestination])

  const handleDepartFrom = useCallback((coord: Coordinate, name: string) => {
    handlePickOrigin({ lat: coord.lat, lon: coord.lon, name: coord.name ?? name })
  }, [handlePickOrigin])

  /** Ligne montrée seule sur la carte (catalogue des lignes → « Voir sur la carte »). */
  const handleShowLineOnMap = useCallback((lineId: string, directionIndex: number) => {
    setFocusLine({ lineId, directionIndex })
    // Pas de handleTabChange('map') : il recentrerait la carte sur l'usager
    // et lui ferait quitter le cadrage de la ligne.
    setActiveTab('map')
    setSheet('home')
  }, [])

  // ── Résultats ──────────────────────────────────────────────────────────────
  const itineraries = stateItineraries(search)

  const handleReset = useCallback(() => {
    // Invalide et annule la recherche en cours : sa réponse ne rouvrira pas
    // l'écran, et le bouton du formulaire ne reste pas sur « Recherche… ».
    reqIdRef.current += 1
    ctrlRef.current?.abort()
    ctrlRef.current = null
    setSearch({ status: 'idle' })
    setDetailOpen(false)
    // Retour planche 1g : les résultats reviennent au formulaire (l'accueil).
    setActiveTab('home')
    setSheet('home')
    // Le focus revient au bouton du formulaire, pas au début de la page.
    requestAnimationFrame(() => {
      homePanelRef.current?.querySelector<HTMLElement>('button[type="submit"]')?.focus({ preventScroll: true })
    })
  }, [])

  const handleOpenDetail = useCallback((index: number) => {
    setPreviewIndex(index)
    setDetailSnap('mid')
    setDetailOpen(true)
  }, [])

  const handleCloseDetail = useCallback(() => setDetailOpen(false), [])
  const handleRefitRoute = useCallback(() => setFitSignal((n) => n + 1), [])

  const handleSeeNearbyLines = useCallback(() => {
    const from = lastSearchRef.current?.from
    if (from) {
      const name = from.nouriKind === 'myLocation' ? t('myLocation') : from.name || t('from')
      setNearPoint({ lat: from.lat, lon: from.lon, name })
    }
    setSearch({ status: 'idle' })
    setDetailOpen(false)
    setSheet('home')
    setActiveTab('lines')
    setLinesResetSignal((n) => n + 1)
  }, [t])

  // Sans point explicite : les lignes autour de la position obtenue par « Ma
  // position » (formulaire), si elle a moins de 15 min — au-delà, l'usager a
  // pu se déplacer. Réévalué à l'ouverture de l'onglet.
  const nearForLines = useMemo(() => {
    if (nearPoint) return nearPoint
    if (geo.lat === null || geo.lon === null || geo.receivedAt === null) return null
    if (activeTab !== 'lines' || Date.now() - geo.receivedAt > 15 * 60_000) return null
    return { lat: geo.lat, lon: geo.lon }
  }, [nearPoint, geo.lat, geo.lon, geo.receivedAt, activeTab])
  const clearNearPoint = useCallback(() => setNearPoint(null), [])

  // ── Navigation ─────────────────────────────────────────────────────────────
  const handleGo = useCallback(() => {
    const it = itineraries[previewIndex]
    if (!it) return
    // Trajet qui part bien plus tard (nuit, « Départ 18:00 » cherché à 14:00) :
    // la navigation compterait depuis maintenant — arrivée inventée. Le
    // bouton est déjà remplacé par une phrase (ResultsScreen) ; garde-fou.
    if (it.startTime - Date.now() > START_LATER_MS) return
    haptic('impact')
    nav.start(it, { fromName, toName, demo: stateIsDemo(search) || Boolean(it.demo) })
    setResumeOffer(null)
    setSheet('home')
    // Façon Apple Plans : entrer en navigation recentre sur la position.
    setLocateSignal((n) => n + 1)
  }, [itineraries, previewIndex, nav, fromName, toName, search])

  const handleExitNav = useCallback(() => {
    const finished = Boolean(nav.banner?.arrived)
    const legs = nav.itinerary?.legs
    const destination = nav.meta?.toName ?? legs?.[legs.length - 1]?.to.name ?? ''
    nav.quit()
    // Sortie par erreur (retour système, mauvais bouton) : la session reste
    // reprenable quelques minutes. Pas après une arrivée.
    setResumeOffer(finished ? null : { toName: destination, until: Date.now() + RESUME_OFFER_MS })
    setSheet(itineraries.length ? 'results' : 'home')
  }, [nav, itineraries.length])

  const handleResumeNav = useCallback(() => {
    nav.resume()
    setResumeOffer(null)
    setSheet('home')
    // Reprise : la carte suit de nouveau la position (comme handleGo).
    setLocateSignal((n) => n + 1)
  }, [nav])

  useEffect(() => {
    if (!resumeOffer) return
    const id = setTimeout(() => setResumeOffer(null), Math.max(0, resumeOffer.until - Date.now()))
    return () => clearTimeout(id)
  }, [resumeOffer])

  // Hors trajet constaté : nouveau calcul depuis la position actuelle.
  const handleReroute = useCallback(() => {
    const target = nav.rerouteTarget
    if (!target) return
    nav.quit()
    void runSearch(
      { lat: target.from.lat, lon: target.from.lon, name: t('myLocation'), nouriKind: 'myLocation' },
      { lat: target.to.lat, lon: target.to.lon, name: target.to.name },
      'now',
      false,
    )
  }, [nav, runSearch, t])

  // Hauteurs réelles de la carte d'étape et de la feuille basse : la carte y
  // centre le point bleu et y place « Recentrer » et ses messages.
  const [navInsets, setNavInsets] = useState<{ top: number; bottom: number } | null>(null)
  useEffect(() => {
    if (!navMode) {
      setNavInsets(null)
      return
    }
    const measure = () => {
      const root = navWrapRef.current?.firstElementChild as HTMLElement | null
      const top = root?.children[0] as HTMLElement | undefined
      const bottom = root?.children[1] as HTMLElement | undefined
      if (!root || !top || !bottom) return
      // offsetTop/offsetHeight ignorent les animations d'entrée (transform).
      const next = { top: top.offsetTop + top.offsetHeight, bottom: root.clientHeight - bottom.offsetTop }
      setNavInsets((prev) => (prev && Math.abs(prev.top - next.top) < 2 && Math.abs(prev.bottom - next.bottom) < 2 ? prev : next))
    }
    measure()
    window.addEventListener('resize', measure)
    return () => window.removeEventListener('resize', measure)
  }, [navMode, nav.banner])

  // ── Retour système et gestes ───────────────────────────────────────────────
  // Le retour (bouton Android, geste iOS, touche retour) referme l'écran du
  // dessus au lieu de quitter l'app. Les résultats restent « ouverts » sous la
  // navigation pour que le retour en sorte vers le détail du trajet. La fiche
  // d'arrêt, la ligne consultée (carte) et le détail de ligne (catalogue) ont
  // leur propre entrée.
  const resultsOpen = sheet === 'results' || (navMode && itineraries.length > 0)
  useBackHandler(resultsOpen, handleReset)
  useBackHandler(resultsOpen && detailOpen, handleCloseDetail)
  useBackHandler(navMode, handleExitNav)

  // Glisser depuis le bord (PWA iOS) : referme le détail, sinon la liste.
  useEdgeSwipeBack(resultsPanelRef, { enabled: sheet === 'results' && !detailOpen, rtl, onBack: handleReset })
  useEdgeSwipeBack(detailPanelRef, { enabled: sheet === 'results' && detailOpen, rtl, onBack: handleCloseDetail })

  // ── Ce qui est à l'écran ───────────────────────────────────────────────────
  // Détail sur téléphone : la carte est sous la feuille glissable.
  const mobileDetail = sheet === 'results' && detailOpen && !wide
  // La couche des onglets s'efface pour laisser voir la carte : onglet Carte,
  // navigation, et détail (le trajet apparaît au-dessus de la feuille).
  const tabLayerHidden = navMode || (sheet === 'home' && activeTab === 'map') || mobileDetail
  // Carte visible (sinon recouverte : hors du parcours clavier et des
  // lecteurs d'écran). Feuille en plein écran : il n'en reste qu'une bande.
  const mapVisible = wide || navMode || (sheet === 'home' && activeTab === 'map') || (mobileDetail && detailSnap !== 'full')

  useInert(tabLayerRef, sheet === 'results' || tabLayerHidden)
  useInert(tabBarRef, sheet === 'results' || navMode)
  useInert(mapWrapRef, !mapVisible)

  const mapItinerary = navMode ? nav.itinerary : sheet === 'results' ? itineraries[previewIndex] ?? null : null

  // Cadrage du trajet ou d'une ligne : la zone de carte réellement visible.
  const fitPadding = useMemo<MapPadding | undefined>(() => {
    if (wide) {
      if (mapTabShown) return { top: 80, bottom: 90, left: 60, right: 60 }
      const start = COLUMN_PX + 40
      return rtl ? { top: 60, bottom: 60, left: 60, right: start } : { top: 60, bottom: 60, left: start, right: 60 }
    }
    if (sheet === 'results' && detailOpen) {
      // Handoff : haut 64, côtés 24 / 70 (le bouton flottant est côté fin de
      // lecture), bas = hauteur cachée par la feuille + 20. La valeur ne
      // change pas en plein écran : la carte n'y est pas recadrée.
      const bottom = (detailMapInset ?? Math.round(viewportHeight * (514 / 844))) + 20
      return rtl ? { top: 64, bottom, left: 70, right: 24 } : { top: 64, bottom, left: 24, right: 70 }
    }
    return undefined
  }, [wide, mapTabShown, rtl, sheet, detailOpen, viewportHeight, detailMapInset])

  const cameraPadding = useMemo(() => {
    if (!navInsets) return undefined
    const sides = wide ? (rtl ? { right: COLUMN_PX } : { left: COLUMN_PX }) : {}
    return { top: navInsets.top + 8, bottom: navInsets.bottom + 8, ...sides }
  }, [navInsets, wide, rtl])

  // Messages empilés avec ceux de la carte (onglet Carte, navigation) : le
  // bandeau hors ligne de l'accueil y est masqué.
  const mapNotices = useMemo(
    () => (isOffline && (navMode || mapTabShown) ? [t('offlineBanner')] : undefined),
    [isOffline, navMode, mapTabShown, t],
  )

  // Annonce vocale de l'écran Résultats (région live hors du panneau, jamais
  // rendue inerte) : « recherche en cours », « 3 itinéraires trouvés », échec.
  const srStatus = sheet === 'results'
    ? resultsAnnouncement(search, locale, search.status === 'error' ? describePlanError(search.error, locale) : undefined)
    : ''

  const showResume = Boolean(resumeOffer && nav.canResume && !navMode)
  const [resumeBefore, resumeAfter = ''] = t('page_resumeNavTo').split('{to}')
  const resumeRow = showResume ? (
    <div className="flex items-center justify-between gap-3 border-b border-line bg-paper-2 px-5 py-2.5">
      <button
        type="button"
        onClick={handleResumeNav}
        className="tap min-h-[44px] min-w-0 flex-1 text-start text-body font-semibold text-brand"
      >
        {resumeOffer?.toName ? (
          // Le nom est un isolat bidi : en arabe, un nom latin ne retourne
          // pas la phrase.
          <>{resumeBefore}<bdi>{resumeOffer.toName}</bdi>{resumeAfter}</>
        ) : t('nav_resume')}
      </button>
      <button
        type="button"
        onClick={() => setResumeOffer(null)}
        aria-label={t('close')}
        className="tap flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-ink-600"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        </svg>
      </button>
    </div>
  ) : null

  // La colonne de l'app (grand écran) n'a pas d'ombre quand elle n'est pas
  // remplie : onglet Carte (seule la barre d'onglets), navigation (carte
  // d'étape et feuille basse ont leur propre ombre).
  const columnEmpty = tabLayerHidden && sheet === 'home'

  // `h-screen` (100vh) inclut la zone derrière la barre d'URL mobile : la barre
  // d'onglets, dernier enfant, tombait alors SOUS le repli visible. `100dvh`
  // suit la hauteur réellement visible ; `h-screen` reste le repli pour les
  // très vieux navigateurs qui ignorent `dvh`.
  return (
    <main className="relative h-screen w-screen overflow-hidden" style={{ height: '100dvh', backgroundColor: '#F7F8FA' }}>
      <div ref={mapWrapRef} className="absolute inset-0">
        <MapLoadingFallback />
        <MapErrorBoundary>
          <MapView
            itinerary={mapItinerary}
            hideControls={navMode}
            navigating={navMode}
            navLegIndex={nav.view?.legIndex}
            navLegProgress={nav.view?.legProgress}
            navAlongMeters={nav.view?.along}
            navGeometries={nav.geometries}
            userPosition={userPosition}
            positionStale={navMode ? nav.view?.source !== 'gps' : undefined}
            // En navigation, le bandeau dit déjà « position perdue / imprécise ».
            showPositionNotices={!navMode}
            onRequestPosition={positionApi.start}
            positionError={positionApi.error}
            mapActive={mapTabShown && !navMode}
            autoLocateSignal={locateSignal}
            onNavigateTo={handleNavigateTo}
            onDepartFrom={handleDepartFrom}
            focusLine={focusLine}
            onFocusLineChange={setFocusLine}
            fitPadding={fitPadding}
            fitSignal={fitSignal}
            detailChrome={mobileDetail}
            cameraPadding={cameraPadding}
            extraNotices={mapNotices}
          />
        </MapErrorBoundary>
      </div>

      {/* Colonne de l'app : plein écran sur téléphone ; au-delà de 768 px,
          420 px côté début de lecture, la carte occupant le reste. */}
      <div
        className="app-column pointer-events-none absolute inset-0 overflow-hidden"
        style={columnEmpty ? { boxShadow: 'none' } : undefined}
      >
        {/* Couche des onglets. L'accueil EST le formulaire d'itinéraire
            (planche 1f) ; la carte n'apparaît que sur son onglet, le détail
            et la navigation. Push vers les résultats : l'écran recule de 25 %
            sous un voile 4 % (spec motion). */}
        <motion.div
          ref={tabLayerRef}
          className="absolute inset-x-0 top-0 z-10 flex flex-col bg-white"
          initial={false}
          animate={sheet === 'results' ? { x: rtl ? '25%' : '-25%' } : { x: 0 }}
          transition={{ duration: 0.32, ease: [0.2, 0, 0, 1] }}
          style={{
            bottom: 'calc(54px + env(safe-area-inset-bottom, 0px))',
            pointerEvents: sheet === 'home' && !tabLayerHidden ? 'auto' : 'none',
            opacity: tabLayerHidden ? 0 : 1,
            // Le fond blanc revient d'un coup : un fondu 0→1 laisserait voir la
            // carte par transparence, et il saccade pendant que MapLibre rend
            // ses tuiles. On ne fond que dans le sens « on va vers la carte ».
            transition: tabLayerHidden ? 'opacity 200ms ease' : 'none',
            visibility: tabLayerHidden ? 'hidden' : 'visible',
          }}
        >
          {isOffline ? (
            <p className="shrink-0 bg-paper-2 px-5 py-2 text-label text-ink-600" style={{ paddingTop: 'calc(env(safe-area-inset-top, 0px) + 8px)' }}>
              {t('offlineBanner')}
            </p>
          ) : otpDown ? (
            <p className="shrink-0 bg-paper-2 px-5 py-2 text-label text-ink-600" role="status" style={{ paddingTop: 'calc(env(safe-area-inset-top, 0px) + 8px)' }}>
              {t('page_otpDown')}
            </p>
          ) : null}
          {resumeRow}

          {/* Les deux onglets restent montés (masqués) : le départ saisi, la
              ligne ouverte et le défilement survivent à un changement
              d'onglet ou de langue. L'animation d'apparition (200 ms) rejoue
              quand un panneau repasse de display:none à visible. */}
          <div ref={tabContentRef} className="min-h-0 flex-1">
            <div ref={homePanelRef} className={activeTab === 'home' ? 'state-fade h-full' : 'hidden'}>
              <SearchBar
                onSearch={handleSearch}
                loading={search.status === 'loading'}
                recentSearches={recentSearches}
                externalFrom={externalFrom}
                externalTo={externalTo}
                submitSignal={submitSignal}
                visible={sheet === 'home'}
                geo={geo}
                userPosition={formPosition}
                headerAction={<LanguageSwitcher />}
              >
                <SavedPlaces onSelect={handlePickDestination} />
              </SearchBar>
            </div>
            <div
              className={activeTab === 'lines' ? 'state-fade h-full' : 'hidden'}
              style={{ paddingTop: 'calc(env(safe-area-inset-top, 0px) + 14px)' }}
            >
              <LineView
                onSelectStation={handlePickDestination}
                onShowLineOnMap={handleShowLineOnMap}
                active={activeTab === 'lines' && sheet === 'home' && !navMode}
                resetSignal={linesResetSignal}
                near={nearForLines}
                onClearNear={clearNearPoint}
              />
            </div>
          </div>

          <div
            className="pointer-events-none absolute inset-0 bg-black transition-opacity duration-[320ms]"
            style={{ opacity: sheet === 'results' ? 0.04 : 0 }}
            aria-hidden="true"
          />
        </motion.div>

        <div
          ref={tabBarRef}
          className="absolute inset-x-0 bottom-0 z-20"
          style={{ pointerEvents: sheet === 'home' && !navMode ? 'auto' : 'none' }}
        >
          <TabBar active={activeTab} onChange={handleTabChange} />
        </div>

        {/* Résultats (planche 1g) et détail (planche 1h) */}
        <ResultsScreen
          open={sheet === 'results'}
          state={search}
          fromName={fromName}
          toName={toName}
          selectedIndex={previewIndex}
          detailOpen={detailOpen}
          detailSnap={detailSnap}
          wide={wide}
          panelRef={resultsPanelRef}
          detailRef={detailPanelRef}
          onBack={handleReset}
          onOpenDetail={handleOpenDetail}
          onCloseDetail={handleCloseDetail}
          onSnapChange={setDetailSnap}
          onDetailMapInset={setDetailMapInset}
          onRefitRoute={handleRefitRoute}
          onGo={handleGo}
          onRetry={handleRetry}
          onSeeNearbyLines={handleSeeNearbyLines}
          resumeSlot={resumeRow}
        />

        {/* Navigation pas à pas (planche 1i) : tout le contenu vient de
            useNavigationSession. Visible à toute largeur (plus de md:hidden :
            un téléphone tourné en paysage perdait la consigne). */}
        <div ref={navWrapRef} className="contents">
          <NavigationBanner session={nav} onQuit={handleExitNav} onReroute={handleReroute} />
        </div>
      </div>

      {/* Région live de l'écran Résultats : hors du panneau, jamais inerte. */}
      <p className="sr-only" role="status" aria-live="polite" aria-atomic="true">{srStatus}</p>

      {/* Nouvelle version : proposée, jamais appliquée pendant une navigation
          ni sous des résultats affichés (sw-register.js). */}
      <UpdateNotice
        busy={navMode || sheet === 'results'}
        hidden={navMode}
        bottomOffset={sheet === 'results'
          ? 'calc(104px + env(safe-area-inset-bottom, 0px))'
          : undefined}
      />
    </main>
  )
}

'use client'

import { useEffect, useMemo, useRef, useState, useCallback } from 'react'
import type { Feature, FeatureCollection, Geometry, LineString, Point } from 'geojson'
import maplibregl from 'maplibre-gl'
import { metroLineGeoJSON, tramLineGeoJSON, METRO_COLOR, TRAM_COLOR } from '@/lib/stations'
import { allLines, busLines, metroLine, tramLine, headwayAt, isInService, directionIndexByTripId, railSpecialPeriodNotice, nextPassLabel, isDeducedShape, type TransitLine } from '@/lib/lines'
import { loadLineShapes, type LineShapes } from '@/lib/line-shapes'
import {
  getStopBadges,
  layoutBadges,
  createBadgeElement,
  badgeDirectionRows,
  directionDestination,
  readableTextColor,
  type StopBadge,
} from '@/lib/map-badges'
import {
  buildBusNetwork,
  cumulativeMeters,
  splitAtAlong,
  splitAtArtifacts,
  projectStopsAlong,
  directionShapeStatus,
  boundsOf,
  metersBetween,
  type LonLat,
} from '@/lib/map-traces'
import {
  ensureRtlTextPlugin,
  FALLBACK_STYLE,
  isFallbackStyle,
  mapPalette,
  lineDisplayColor,
  applyBaseMapTheme,
  localizeBaseMapLabels,
  firstBaseSymbolLayerId,
  addChevronImage,
  CHEVRON_IMAGE,
  MAP_MAX_BOUNDS,
  isInServiceArea,
  type MapPalette,
} from '@/lib/map-style'
import { stopReportMailto } from '@/lib/map-report'
import { type OtpItinerary, legCoordinates, getLegColor, isSchematicLeg, placeName, type Coordinate } from '@/lib/otp'
import { useTranslation } from '@/hooks/useTranslation'
import { useBackHandler } from '@/hooks/useBackHandler'
import { useDeviceHeading } from '@/hooks/useDeviceHeading'
import type { Locale, TranslationKey } from '@/lib/i18n'
import styles from './MapView.module.css'

const TILE_URL = process.env.NEXT_PUBLIC_TILE_URL ?? 'https://tiles.openfreemap.org/styles/positron'
// Fond de carte indisponible : nouvelle tentative après 15 s, 30 s, puis
// toutes les 60 s (et au retour du réseau, de l'onglet ou sur « Réessayer »).
const BASEMAP_RETRY_MIN_MS = 15_000
const BASEMAP_RETRY_MAX_MS = 60_000
const BASEMAP_PROBE_TIMEOUT_MS = 10_000
const ALGIERS_CENTER: [number, number] = [3.085, 36.745]
/** Marge haute (légende, boutons, épingle) du cadrage au-dessus de la feuille. */
const SHEET_FRAME_TOP = 72
/**
 * Au-delà, la dernière position reçue est affichée comme périmée (sauf avis
 * du parent via positionStale). Plus court en navigation, où une position
 * figée fait croire que l'on n'avance pas ; en consultation, un téléphone
 * immobile peut légitimement espacer ses points.
 */
const STALE_AFTER_MS = { navigating: 30_000, browsing: 120_000 }
/** Au-delà, la position est annoncée comme approximative. */
const IMPRECISE_M = 100

// Le module n'est chargé que côté client (import dynamique ssr:false).
if (typeof window !== 'undefined') ensureRtlTextPlugin()

// ── Types publics ────────────────────────────────────────────────────────────

/** Ligne à afficher seule sur la carte (catalogue, fiche d'arrêt). */
export interface MapFocusLine {
  lineId: string
  /** Indice dans line.directions ; absent = direction 0. */
  directionIndex?: number
}

export interface MapPadding {
  top: number
  bottom: number
  left: number
  right: number
}

export interface MapUserPosition {
  lon: number
  lat: number
  accuracy: number
  heading: number | null
  /** m/s ; le cap GPS n'est fiable qu'en mouvement (> 1 m/s). */
  speed?: number | null
  /** Horloge du téléphone à la réception du point (Date.now()). */
  receivedAt?: number
  timestamp?: number
}

/** Géométrie d'un tronçon telle que la calcule navigation.ts (buildLegGeometries). */
export interface MapLegGeometry {
  coords: [number, number][]
  cumulative: number[]
  length: number
  /** Position (m le long du tronçon) de chaque arrêt intermédiaire, si fournie. */
  stopAlongs?: number[]
}

interface MapViewProps {
  itinerary?: OtpItinerary | null
  hideControls?: boolean
  // Mode navigation (planche 1i) : tracé parcouru grisé, arrêts intermédiaires,
  // pas de marqueur de départ (la position utilisateur le remplace).
  navigating?: boolean
  // Progression calculée par le parent (source unique) : index du tronçon en
  // cours et fraction parcourue de ce tronçon. Recalculer ici ferait diverger
  // la carte du bandeau de navigation.
  navLegIndex?: number
  navLegProgress?: number
  /**
   * Distance (m) parcourue le long du tronçon courant, telle que la calcule la
   * navigation. Prioritaire sur navLegProgress : la coupure grise et les arrêts
   * dépassés sont alors calculés en mètres, exactement comme le bandeau.
   */
  navAlongMeters?: number
  /** Géométries du trajet déjà décodées par le parent (mêmes distances que la navigation). */
  navGeometries?: MapLegGeometry[] | null
  // Position fournie par le parent (source unique partagée avec le calcul de
  // progression). La carte ne suit plus la position de son côté.
  userPosition?: MapUserPosition | null
  /** Le parent juge la position périmée (sinon : plus de 30 s sans nouveau point). */
  positionStale?: boolean
  /** Demande au parent d'activer le suivi de position (bouton localiser). */
  onRequestPosition?: () => void
  /** Erreur de position remontée par le parent, pour l'expliquer sur la carte. */
  positionError?: 'insecure' | 'denied' | 'unavailable' | 'unsupported' | null
  // false quand l'onglet Carte n'est pas au premier plan : la fiche se ferme.
  mapActive?: boolean
  // Incrémenté par le parent pour recentrer la carte sur l'utilisateur
  // (ouverture de l'onglet Carte, départ de la navigation).
  autoLocateSignal?: number
  /** « Y aller » depuis une fiche d'arrêt ou un point choisi (appui long). */
  onNavigateTo?: (coord: Coordinate, name: string) => void
  /** « Partir d'ici » depuis une fiche d'arrêt ou un point choisi. */
  onDepartFrom?: (coord: Coordinate, name: string) => void
  /** Ligne à montrer seule sur la carte (contrôlé par le parent si fourni). */
  focusLine?: MapFocusLine | null
  /** Appelé quand la carte ouvre (rangée de fiche) ou ferme (✕, retour) une ligne. */
  onFocusLineChange?: (focus: MapFocusLine | null) => void
  /** Marges de cadrage d'un trajet ou d'une ligne (feuille basse, panneau). */
  fitPadding?: MapPadding
  /** Incrémenté par le parent pour recadrer le trajet (bouton flottant du détail). */
  fitSignal?: number
  /**
   * Détail d'itinéraire sur téléphone (handoff « Itinéraire Alger ») : la
   * feuille porte son propre bouton flottant ; les contrôles de la carte sont
   * masqués et les messages d'état passent en haut, hors de la feuille.
   */
  detailChrome?: boolean
  /**
   * Zones masquées par l'interface de navigation (carte du haut, feuille du
   * bas ; sur grand écran, la colonne de l'app côté début de lecture).
   */
  cameraPadding?: { top: number; bottom: number; left?: number; right?: number }
  /** Suivi de position actif / interrompu (glissé de la carte). */
  onFollowingChange?: (following: boolean) => void
  /** Bouton « Recentrer » quand le suivi est interrompu (contrôles masqués). */
  showRecenterButton?: boolean
  /** Messages « position périmée / approximative / hors zone » sur la carte. */
  showPositionNotices?: boolean
  /** Thème imposé ; sinon suit la classe `dark` (ou data-theme) de <html>. */
  theme?: 'light' | 'dark'
  /**
   * Messages d'état fournis par le parent (hors ligne…), empilés avec ceux de
   * la carte au lieu de se superposer à eux.
   */
  extraNotices?: string[]
}

type Selected =
  | { kind: 'stop'; badgeId: string }
  | { kind: 'point'; coords: [number, number]; name: string | null }

// ── Constantes de rendu ──────────────────────────────────────────────────────

const EMPTY_FC: FeatureCollection = { type: 'FeatureCollection', features: [] }
const ZERO_PADDING: MapPadding = { top: 0, bottom: 0, left: 0, right: 0 }
const OWN_LAYER = /^(bus-|metro-|tram-|itin-|focus-|user-)/
const isOwnLayer = (id: string) => OWN_LAYER.test(id)
const NETWORK_LAYERS = ['metro-casing', 'metro-fill', 'tram-casing', 'tram-fill', 'bus-casing', 'bus-fill', 'bus-fill-deduced']
const FOCUS_LAYERS = ['focus-casing', 'focus-fill', 'focus-fill-deduced', 'focus-arrow', 'focus-stops']

/** Épaisseur selon le zoom : fine en vue d'ensemble, lisible en rue. */
function ramp(stops: number[], base = 1): maplibregl.ExpressionSpecification {
  return ['interpolate', ['exponential', base], ['zoom'], ...stops] as maplibregl.ExpressionSpecification
}
const WIDTH = {
  netCasing: ramp([11, 3, 13, 4, 16, 7]),
  netFill: ramp([11, 1.5, 13, 2.5, 16, 4]),
  railCasing: ramp([10, 5, 13, 7, 16, 10]),
  railFill: ramp([10, 2.5, 13, 3.5, 16, 5]),
  strongCasing: ramp([10, 5, 13, 8, 16, 11, 18, 15], 1.3),
  strongLine: ramp([10, 2.5, 13, 4.5, 16, 6.5, 18, 9], 1.3),
  walk: ramp([10, 2, 13, 3, 16, 4, 18, 5], 1.3),
  // Image de 24 px à pixelRatio 2 : chevron de ~7,5 px à 1, calé sur strongLine.
  arrow: ramp([12, 0.55, 14, 0.75, 16, 0.95, 18, 1.25]),
}

// Trajet consulté (hors navigation), handoff « Itinéraire Alger » : marche en
// trait gris PLEIN, transports en trait épais couleur de ligne, sans liseré
// ni chevrons ; arrêts en cercles blancs bordés de la couleur de ligne.
const ROUTE_STYLE = {
  walkColor: '#8A929C',
  walkWidth: 4,
  walkOpacity: 0.7,
  transitWidth: 6,
  // Tracé non relevé (schématique) ou déduit de la voirie : plein mais pâle,
  // visiblement distinct d'un tracé relevé — et annoncé dans le fil du trajet.
  unsurveyedOpacity: 0.45,
  start: '#1E6FE0',
  end: '#111418',
}

// ── Thème ────────────────────────────────────────────────────────────────────

function useDarkTheme(theme?: 'light' | 'dark'): boolean {
  const [dark, setDark] = useState(theme === 'dark')
  useEffect(() => {
    if (theme) {
      setDark(theme === 'dark')
      return
    }
    const root = document.documentElement
    const read = () => setDark(root.classList.contains('dark') || root.dataset.theme === 'dark')
    read()
    const observer = new MutationObserver(read)
    observer.observe(root, { attributes: true, attributeFilter: ['class', 'data-theme'] })
    return () => observer.disconnect()
  }, [theme])
  return dark
}

// ── Composant ────────────────────────────────────────────────────────────────

export default function MapView({
  itinerary,
  hideControls,
  navigating = false,
  navLegIndex = 0,
  navLegProgress = 0,
  navAlongMeters,
  navGeometries,
  userPosition,
  positionStale,
  onRequestPosition,
  positionError,
  mapActive = true,
  autoLocateSignal,
  onNavigateTo,
  onDepartFrom,
  focusLine,
  onFocusLineChange,
  fitPadding,
  fitSignal = 0,
  detailChrome = false,
  cameraPadding,
  onFollowingChange,
  showRecenterButton = true,
  showPositionNotices = true,
  theme,
  extraNotices,
}: MapViewProps) {
  const { t, locale } = useTranslation()
  const dark = useDarkTheme(theme)
  const palette = useMemo(() => mapPalette(dark), [dark])
  const tf = useCallback((key: TranslationKey, vars: Record<string, string | number>) =>
    Object.entries(vars).reduce((text, [k, v]) => text.split(`{${k}}`).join(String(v)), t(key)), [t])

  const mapContainerRef = useRef<HTMLDivElement>(null)
  const sheetRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<maplibregl.Map | null>(null)
  const mountedRef = useRef(true)
  // Nos couches n'existent qu'après le chargement d'un style ; chaque nouveau
  // style (repli hors ligne, retour en ligne) incrémente cette version et les
  // effets qui en dépendent reposent leurs couches. Remplace l'ancienne file
  // d'attente « whenReady ».
  const [styleVersion, setStyleVersion] = useState(0)
  const ready = styleVersion > 0
  const firstSymbolRef = useRef<string | undefined>(undefined)
  const originalsRef = useRef<Map<string, unknown>>(new Map())
  const baseSourcesRef = useRef<Set<string>>(new Set())
  const remoteStylePendingRef = useRef(true)
  const tileErrorsRef = useRef(0)
  const tileOkRef = useRef(0)
  // Tuiles du fond réussies depuis le chargement du style : à 0 malgré des
  // erreurs, le plan des rues est entièrement absent (« down »), pas « partiel ».
  const tileEverOkRef = useRef(0)
  // Reprise du fond de carte : délai croissant entre deux tentatives et sonde
  // du style en cours (une seule à la fois).
  const basemapRetryDelayRef = useRef(BASEMAP_RETRY_MIN_MS)
  const basemapProbeRef = useRef(false)
  // Marqueurs DOM et identifiants des couches posées par le trajet.
  const markersRef = useRef<maplibregl.Marker[]>([])
  const itinIdsRef = useRef<{ layers: string[]; sources: string[] }>({ layers: [], sources: [] })
  const intermediateRef = useRef<{ el: HTMLElement; legIndex: number; along: number; color: string }[]>([])
  const badgeMarkersRef = useRef<Map<string, maplibregl.Marker>>(new Map())
  const memberMarkersRef = useRef<maplibregl.Marker[]>([])
  const pinMarkerRef = useRef<maplibregl.Marker | null>(null)
  const userMarkerRef = useRef<maplibregl.Marker | null>(null)
  const puckRef = useRef<{ dot: HTMLElement; halo: HTMLElement; cone: HTMLElement } | null>(null)
  const gpsCourseRef = useRef<number | null>(null)
  const compassRef = useRef<number | null>(null)
  const longPressAtRef = useRef(0)
  // Zoom de rue au premier point reçu après « localiser » (pas à chaque point).
  const zoomOnNextFixRef = useRef(false)

  const [mapError, setMapError] = useState(false)
  const [basemap, setBasemap] = useState<'ok' | 'down' | 'partial'>('ok')
  // Palier de zoom seulement (0 : < 13, 1 : 13-15, 2 : ≥ 15) : un rendu React
  // par franchissement de seuil, pas un par image de pincement.
  const [zoomTier, setZoomTier] = useState(0)
  const [following, setFollowing] = useState(false)
  const followingRef = useRef(false)
  const [selected, setSelected] = useState<Selected | null>(null)
  const [lineFocus, setLineFocus] = useState<MapFocusLine | null>(focusLine ?? null)
  const [shapes, setShapes] = useState<LineShapes | null>(null)
  const [shapesState, setShapesState] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle')
  const shapesStateRef = useRef<'idle' | 'loading' | 'ready' | 'error'>('idle')
  const [badgeHint, setBadgeHint] = useState({ zoom: 0, collision: 0 })
  const [showMetro, setShowMetro] = useState(true)
  const [showTram, setShowTram] = useState(true)
  const [staleInfo, setStaleInfo] = useState({ stale: false, ageSec: 0 })

  // Refs « dernière valeur » pour les gestionnaires MapLibre enregistrés une fois.
  const localeRef = useRef(locale)
  localeRef.current = locale
  const darkRef = useRef(dark)
  darkRef.current = dark
  const paletteRef = useRef(palette)
  paletteRef.current = palette
  const tRef = useRef(t)
  tRef.current = t
  const navigatingRef = useRef(navigating)
  navigatingRef.current = navigating
  const onFollowingChangeRef = useRef(onFollowingChange)
  onFollowingChangeRef.current = onFollowingChange
  const userPositionRef = useRef(userPosition)
  userPositionRef.current = userPosition
  const staleRef = useRef(false)
  staleRef.current = staleInfo.stale

  const setFollow = useCallback((value: boolean) => {
    if (followingRef.current === value) return
    followingRef.current = value
    setFollowing(value)
    onFollowingChangeRef.current?.(value)
  }, [])

  const cameraPaddingRef = useRef(cameraPadding)
  cameraPaddingRef.current = cameraPadding
  const navPadding = useCallback((): MapPadding => (
    navigatingRef.current && cameraPaddingRef.current
      ? {
          top: cameraPaddingRef.current.top,
          bottom: cameraPaddingRef.current.bottom,
          left: cameraPaddingRef.current.left ?? 0,
          right: cameraPaddingRef.current.right ?? 0,
        }
      : ZERO_PADDING
  ), [])

  // ── Ligne consultée ────────────────────────────────────────────────────────
  useEffect(() => {
    setLineFocus(focusLine ?? null)
  }, [focusLine?.lineId, focusLine?.directionIndex]) // eslint-disable-line react-hooks/exhaustive-deps

  const openLineFocus = useCallback((focus: MapFocusLine | null) => {
    setLineFocus(focus)
    onFocusLineChange?.(focus)
  }, [onFocusLineChange])

  // ── Création de la carte ───────────────────────────────────────────────────
  const handleStyleLoad = useRef<(map: maplibregl.Map) => void>(() => {})
  handleStyleLoad.current = (map: maplibregl.Map) => {
    originalsRef.current = new Map()
    const fallback = isFallbackStyle(map)
    if (!fallback) {
      remoteStylePendingRef.current = false
      tileErrorsRef.current = 0
      tileOkRef.current = 0
      tileEverOkRef.current = 0
      setBasemap('ok')
    }
    baseSourcesRef.current = new Set(Object.keys(map.getStyle()?.sources ?? {}))
    firstSymbolRef.current = firstBaseSymbolLayerId(map)
    applyBaseMapTheme(map, darkRef.current, originalsRef.current, isOwnLayer)
    localizeBaseMapLabels(map, localeRef.current)
    addChevronImage(map)
    addTransitLayers(map, firstSymbolRef.current, paletteRef.current)
    map.getCanvas().setAttribute('aria-label', tRef.current('map_canvasLabel'))
    itinIdsRef.current = { layers: [], sources: [] }
    setStyleVersion((v) => v + 1)
  }

  useEffect(() => {
    mountedRef.current = true
    if (!mapContainerRef.current || mapRef.current) return

    let map: maplibregl.Map
    try {
      map = new maplibregl.Map({
        container: mapContainerRef.current,
        style: TILE_URL,
        center: ALGIERS_CENTER,
        zoom: 12,
        minZoom: 10,
        maxZoom: 18,
        maxBounds: MAP_MAX_BOUNDS,
        attributionControl: { compact: true },
        // Libellé du bouton « crédits » dans la langue de l'interface dès la
        // première image (MapLibre ne l'écrit qu'à l'ajout du contrôle ; les
        // changements de langue sont repris par l'effet de langue plus bas).
        locale: { 'AttributionControl.ToggleAttribution': tRef.current('map_attributionToggle') },
        antialias: true,
      })
    } catch {
      // Sans WebGL (GPU sur liste noire, accélération coupée, WebView) le
      // constructeur lève : on le dit, et le reste de l'app reste utilisable.
      setMapError(true)
      return
    }
    mapRef.current = map
    remoteStylePendingRef.current = true

    map.on('zoom', () => {
      const z = map.getZoom()
      const tier = z < 13 ? 0 : z < 15 ? 1 : 2
      setZoomTier((prev) => (prev === tier ? prev : tier))
    })
    // Toute manipulation manuelle de la carte sort du mode suivi.
    map.on('dragstart', () => setFollow(false))
    map.on('style.load', () => handleStyleLoad.current(map))
    map.on('error', (event) => {
      const sourceId = (event as unknown as { sourceId?: string }).sourceId
      // Le style distant n'a pas pu être chargé (hors connexion, métro) :
      // style de repli local, pour que lignes, trajet et position s'affichent.
      if (remoteStylePendingRef.current && !sourceId) {
        remoteStylePendingRef.current = false
        setBasemap('down')
        map.setStyle(FALLBACK_STYLE, { diff: false })
        return
      }
      if (sourceId && baseSourcesRef.current.has(sourceId)) {
        tileOkRef.current = 0
        tileErrorsRef.current += 1
        if (tileErrorsRef.current >= 3) {
          // Aucune tuile reçue depuis le chargement du style : plus une seule
          // rue à l'écran, ce n'est pas « une partie » du plan qui manque.
          const none = tileEverOkRef.current === 0
          setBasemap((b) => (none
            ? (b === 'ok' || b === 'partial' ? 'down' : b)
            : (b === 'ok' || (b === 'down' && !isFallbackStyle(map)) ? 'partial' : b)))
        }
      }
    })
    map.on('sourcedata', (event) => {
      if (!event.tile || !baseSourcesRef.current.has(event.sourceId)) return
      tileOkRef.current += 1
      tileEverOkRef.current += 1
      if (tileOkRef.current >= 3) {
        tileErrorsRef.current = 0
        // « down » dû aux tuiles (style distant chargé) : levé dès qu'elles
        // reviennent ; celui du style de repli ne l'est qu'au rechargement.
        setBasemap((b) => (b === 'partial' || (b === 'down' && !isFallbackStyle(map)) ? 'ok' : b))
      }
    })

    const badgeMarkers = badgeMarkersRef.current

    return () => {
      mountedRef.current = false
      markersRef.current.forEach((m) => m.remove())
      markersRef.current = []
      badgeMarkers.forEach((m) => m.remove())
      badgeMarkers.clear()
      memberMarkersRef.current.forEach((m) => m.remove())
      memberMarkersRef.current = []
      pinMarkerRef.current?.remove()
      pinMarkerRef.current = null
      userMarkerRef.current?.remove()
      userMarkerRef.current = null
      map.remove()
      mapRef.current = null
      setStyleVersion(0)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ── Thème et langue du fond ────────────────────────────────────────────────
  useEffect(() => {
    const map = mapRef.current
    if (!map || !ready) return
    applyBaseMapTheme(map, dark, originalsRef.current, isOwnLayer)
    setPaintSafe(map, 'bus-casing', 'line-color', palette.casing)
    setPaintSafe(map, 'metro-casing', 'line-color', palette.casing)
    setPaintSafe(map, 'tram-casing', 'line-color', palette.casing)
    setPaintSafe(map, 'focus-casing', 'line-color', palette.casing)
    setPaintSafe(map, 'metro-fill', 'line-color', lineDisplayColor(METRO_COLOR, dark))
    setPaintSafe(map, 'tram-fill', 'line-color', lineDisplayColor(TRAM_COLOR, dark))
    setPaintSafe(map, 'focus-stops', 'circle-color', palette.surface)
  }, [dark, palette, styleVersion, ready])

  useEffect(() => {
    const map = mapRef.current
    if (!map || !ready) return
    localizeBaseMapLabels(map, locale)
    map.getCanvas().setAttribute('aria-label', t('map_canvasLabel'))
    // MapLibre 4.7 n'a pas de setLocale : le bouton des crédits (posé une fois
    // par le constructeur, conservé d'un style à l'autre) est relibellé ici.
    const attribToggle = map.getContainer().querySelector<HTMLElement>('.maplibregl-ctrl-attrib-button')
    if (attribToggle) {
      const label = t('map_attributionToggle')
      attribToggle.title = label
      attribToggle.setAttribute('aria-label', label)
    }
  }, [locale, t, styleVersion, ready])

  // ── Reprise du fond de carte ───────────────────────────────────────────────
  // Style distant en échec (repli neutre) : on SONDE d'abord le style, et on
  // ne le recharge que s'il répond — un setStyle raté effacerait lignes et
  // trajet le temps de l'échec. Tuiles toutes en échec (style chargé) : on les
  // redemande sans toucher au style.
  const retryBasemapRef = useRef<() => void>(() => {})
  retryBasemapRef.current = () => {
    const map = mapRef.current
    if (!map || !mountedRef.current) return
    if (isFallbackStyle(map)) {
      if (basemapProbeRef.current) return
      basemapProbeRef.current = true
      const controller = new AbortController()
      const timeout = window.setTimeout(() => controller.abort(), BASEMAP_PROBE_TIMEOUT_MS)
      fetch(TILE_URL, { signal: controller.signal })
        .then((response) => {
          if (!response.ok || !mountedRef.current || mapRef.current !== map || !isFallbackStyle(map)) return
          remoteStylePendingRef.current = true
          map.setStyle(TILE_URL, { diff: false })
        })
        .catch(() => {})
        .finally(() => {
          window.clearTimeout(timeout)
          basemapProbeRef.current = false
        })
      return
    }
    // Style distant chargé mais aucune tuile reçue : on vide les tuiles en
    // échec du fond pour que MapLibre les redemande au prochain rendu.
    if (tileEverOkRef.current > 0) return
    tileErrorsRef.current = 0
    tileOkRef.current = 0
    try {
      baseSourcesRef.current.forEach((id) => map.style?.sourceCaches?.[id]?.clearTiles())
      // _update(true) marque les sources à recalculer (triggerRepaint seul ne
      // redemande pas les tuiles retirées — vérifié sur maplibre 4.7.1).
      map._update(true)
    } catch {
      // API interne indisponible : on recharge le style distant.
      remoteStylePendingRef.current = true
      map.setStyle(TILE_URL, { diff: false })
    }
  }
  const retryBasemap = useCallback(() => retryBasemapRef.current(), [])

  useEffect(() => {
    if (basemap !== 'down') {
      basemapRetryDelayRef.current = BASEMAP_RETRY_MIN_MS
      return
    }
    let timer: number | null = null
    const schedule = () => {
      timer = window.setTimeout(() => {
        // Onglet masqué : pas de requête ; le retour au premier plan relance.
        if (!document.hidden) retryBasemapRef.current()
        basemapRetryDelayRef.current = Math.min(basemapRetryDelayRef.current * 2, BASEMAP_RETRY_MAX_MS)
        schedule()
      }, basemapRetryDelayRef.current)
    }
    schedule()
    // Retour du réseau, de l'onglet ou de la fenêtre : on retente aussitôt.
    const onBack = () => {
      if (!document.hidden) retryBasemapRef.current()
    }
    window.addEventListener('online', onBack)
    window.addEventListener('focus', onBack)
    document.addEventListener('visibilitychange', onBack)
    return () => {
      if (timer !== null) window.clearTimeout(timer)
      window.removeEventListener('online', onBack)
      window.removeEventListener('focus', onBack)
      document.removeEventListener('visibilitychange', onBack)
    }
  }, [basemap])

  // ── Tracés des lignes (hors bundle, chargés à la demande) ──────────────────
  const requestShapes = useCallback(() => {
    if (shapesStateRef.current === 'loading' || shapesStateRef.current === 'ready') return
    shapesStateRef.current = 'loading'
    setShapesState('loading')
    loadLineShapes()
      .then((loaded) => {
        if (!mountedRef.current) return
        shapesStateRef.current = 'ready'
        setShapes(loaded)
        setShapesState('ready')
      })
      .catch(() => {
        if (!mountedRef.current) return
        shapesStateRef.current = 'error'
        setShapesState('error')
      })
  }, [])

  const itineraryHasBus = Boolean(itinerary?.legs.some((leg) => leg.mode === 'BUS'))
  const needShapes = !navigating && (Boolean(lineFocus) || itineraryHasBus)
  useEffect(() => {
    if (needShapes) requestShapes()
  }, [needShapes, requestShapes])

  // Préchargement discret une fois la carte affichée : le fichier est alors en
  // cache pour le hors-ligne (métro). Pas en mode économie de données.
  useEffect(() => {
    if (!ready || !mapActive) return
    const connection = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection
    if (connection?.saveData) return
    const id = window.setTimeout(requestShapes, 4000)
    return () => window.clearTimeout(id)
  }, [ready, mapActive, requestShapes])

  useEffect(() => {
    const onOnline = () => {
      if (shapesStateRef.current !== 'error') return
      shapesStateRef.current = 'idle'
      requestShapes()
    }
    window.addEventListener('online', onOnline)
    return () => window.removeEventListener('online', onOnline)
  }, [requestShapes])

  const retryShapes = useCallback(() => {
    shapesStateRef.current = 'idle'
    requestShapes()
  }, [requestShapes])

  const busNetwork = useMemo(() => (shapes ? buildBusNetwork(busLines, shapes) : null), [shapes])

  useEffect(() => {
    const map = mapRef.current
    if (!map || !ready) return
    setSourceData(map, 'bus-lines', busNetwork?.data ?? EMPTY_FC)
    setSourceData(map, 'metro-line', railGeoJSON(metroLine, metroLineGeoJSON as Feature, shapes))
    setSourceData(map, 'tram-line', railGeoJSON(tramLine, tramLineGeoJSON as Feature, shapes))
  }, [busNetwork, shapes, styleVersion, ready])

  // ── Visibilité du réseau ───────────────────────────────────────────────────
  useEffect(() => {
    const map = mapRef.current
    if (!map || !ready) return
    // En NAVIGATION (planche 1i), la carte ne porte plus que le trajet.
    if (navigating) {
      setLayerVisibility(map, [...NETWORK_LAYERS, ...FOCUS_LAYERS], false)
      return
    }
    if (itinerary) {
      // Trajet consulté : seuls les modes et les DIRECTIONS de bus réellement
      // empruntés restent affichés, en retrait sous le tracé du trajet.
      const focus = buildItineraryFocus(itinerary)
      setLayerVisibility(map, FOCUS_LAYERS, false)
      setLayerVisibility(map, ['metro-casing', 'metro-fill'], focus.modes.has('SUBWAY'))
      setLayerVisibility(map, ['tram-casing', 'tram-fill'], focus.modes.has('TRAM'))
      setLayerVisibility(map, ['bus-casing', 'bus-fill', 'bus-fill-deduced'], focus.modes.has('BUS'))
      const match: maplibregl.ExpressionSpecification = ['any',
        ['in', ['get', 'key'], ['literal', focus.busKeys]],
        ['in', ['get', 'name'], ['literal', focus.busNames]],
      ]
      setFilterSafe(map, 'bus-casing', ['all', ['!', ['get', 'deduced']], match])
      setFilterSafe(map, 'bus-fill', ['all', ['!', ['get', 'deduced']], match])
      setFilterSafe(map, 'bus-fill-deduced', ['all', ['get', 'deduced'], match])
      // Les deux sens d'une même ligne ne s'affichent ensemble que faute de
      // direction identifiée : décalés chacun sur leur droite, ils ne se
      // superposent plus.
      const offset = focus.busNames.length > 0 ? ramp([12, 1.5, 16, 3.5]) : 0
      ;['bus-casing', 'bus-fill', 'bus-fill-deduced'].forEach((id) => setPaintSafe(map, id, 'line-offset', offset))
      setNetworkOpacity(map, 0.45)
      return
    }
    setLayerVisibility(map, NETWORK_LAYERS, false)
    setLayerVisibility(map, FOCUS_LAYERS, Boolean(lineFocus))
  }, [itinerary, navigating, lineFocus, styleVersion, ready])

  // ── Ligne consultée : tracé, arrêts, cadrage ───────────────────────────────
  const focusModel = useMemo(
    () => (lineFocus ? buildFocusModel(lineFocus, shapes, shapesState, locale, dark) : null),
    [lineFocus, shapes, shapesState, locale, dark],
  )
  const focusVisible = Boolean(focusModel) && !itinerary && !navigating

  useEffect(() => {
    const map = mapRef.current
    if (!map || !ready) return
    setSourceData(map, 'focus-line', focusModel?.lines ?? EMPTY_FC)
    setSourceData(map, 'focus-stops', focusModel?.stops ?? EMPTY_FC)
    if (focusModel) setPaintSafe(map, 'focus-stops', 'circle-stroke-color', focusModel.color)
  }, [focusModel, styleVersion, ready])

  const focusKey = lineFocus ? `${lineFocus.lineId}|${lineFocus.directionIndex ?? 0}` : null
  useEffect(() => {
    const map = mapRef.current
    if (!map || !ready || !focusKey || itinerary || navigating || !focusModel?.bounds) return
    const [w, s, e, n] = focusModel.bounds
    map.setPadding(ZERO_PADDING)
    map.fitBounds([[w, s], [e, n]], { padding: fitPadding ?? defaultFitPadding(), duration: 800, maxZoom: 15.5 })
    setFollow(false)
    // Cadrage au changement de ligne seulement (pas à l'arrivée des tracés).
  }, [focusKey, ready, itinerary, navigating]) // eslint-disable-line react-hooks/exhaustive-deps

  // Retour système : referme la ligne affichée (seulement sur l'onglet Carte,
  // sinon le retour fermerait une vue invisible).
  useBackHandler(focusVisible && mapActive, () => openLineFocus(null))

  // ── Trajet ─────────────────────────────────────────────────────────────────

  // Géométrie décodée UNE fois par trajet (et non trois fois par position GPS).
  const legGeoms = useMemo((): MapLegGeometry[] | null => {
    if (!itinerary) return null
    const fromParent = navGeometries && navGeometries.length === itinerary.legs.length ? navGeometries : null
    return itinerary.legs.map((leg, i) => {
      const parent = fromParent?.[i]
      const coords = (parent?.coords ?? legCoordinates(leg)) as LonLat[]
      const cumulative = parent?.cumulative ?? cumulativeMeters(coords)
      const length = parent?.length ?? cumulative[cumulative.length - 1] ?? 0
      const stops = (leg.intermediateStops ?? []).map((s) => [s.lon, s.lat] as LonLat)
      const stopAlongs = parent?.stopAlongs ?? projectStopsAlong(coords, cumulative, stops)
      return { coords, cumulative, length, stopAlongs }
    })
  }, [itinerary, navGeometries])
  const legSchematic = useMemo(() => itinerary?.legs.map((leg) => isSchematicLeg(leg)) ?? [], [itinerary])
  // Bus sur un tracé DÉDUIT de la voirie (non relevé) : tirets comme au
  // catalogue, jamais l'aspect d'une voie relevée.
  const legDeduced = useMemo(
    () => itinerary?.legs.map((leg, i) => leg.mode === 'BUS' && !legSchematic[i] && isDeducedShape(leg.routeShortName, leg.headsign, leg.tripId)) ?? [],
    [itinerary, legSchematic],
  )
  const currentIdx = itinerary ? Math.min(navLegIndex, itinerary.legs.length - 1) : 0

  // Effet STRUCTUREL : ne s'exécute qu'au changement de trajet, de mode, de
  // tronçon ou de thème — quelques fois par trajet, et non à chaque position
  // GPS (avant : 22 marqueurs et ~9 couches détruits et recréés chaque seconde).
  useEffect(() => {
    const map = mapRef.current
    if (!map || !ready) return
    clearItinerary(map, itinIdsRef.current, markersRef.current)
    markersRef.current = []
    intermediateRef.current = []
    if (!itinerary || !legGeoms) return

    const before = firstSymbolRef.current
    const ids = itinIdsRef.current
    const addSource = (id: string, data: Feature | FeatureCollection) => {
      map.addSource(id, { type: 'geojson', data })
      ids.sources.push(id)
    }
    const addLayer = (layer: maplibregl.AddLayerObject) => {
      // Sous les noms de rues du fond : le trajet ne masque plus le nom des
      // rues qu'il emprunte.
      map.addLayer(layer, before)
      ids.layers.push(layer.id)
    }
    const lastWalkIdx = itinerary.legs.reduce((acc, l, i) => (l.mode === 'WALK' ? i : acc), -1)

    itinerary.legs.forEach((leg, index) => {
      const { coords, stopAlongs } = legGeoms[index]
      const isWalk = leg.mode === 'WALK'
      // Tracé non relevé : sans shape dans le GTFS, OTP relie les arrêts en
      // ligne droite. Un trait plein affirmerait un itinéraire qu'on ne
      // connaît pas — tirets larges, sans liseré, et l'interface le dit.
      const schematic = legSchematic[index]
      const deduced = legDeduced[index]
      const isPast = navigating && index < currentIdx
      const isCurrent = navigating && index === currentIdx && !isWalk
      const isFinalWalk = isWalk && index === lastWalkIdx && index === itinerary.legs.length - 1
      const color = lineDisplayColor(getLegColor(leg.mode), dark)
      const sourceId = `itin-src-${index}`
      addSource(sourceId, lineFeature(coords))

      // Liseré (couleur du fond) : le trait se détache du plan. Pas de liseré
      // sous un tracé schématique ou déduit, qui ne doit pas avoir l'air d'une
      // voie relevée.
      // Consultation (handoff) : traits pleins, sans liseré ni chevrons.
      const consult = !navigating
      if (consult) {
        addLayer({
          id: `itin-line-${index}`,
          type: 'line',
          source: sourceId,
          layout: { 'line-join': 'round', 'line-cap': 'round' },
          paint: isWalk
            ? { 'line-color': ROUTE_STYLE.walkColor, 'line-width': ROUTE_STYLE.walkWidth, 'line-opacity': ROUTE_STYLE.walkOpacity }
            : {
              'line-color': color,
              'line-width': ROUTE_STYLE.transitWidth,
              'line-opacity': schematic || deduced ? ROUTE_STYLE.unsurveyedOpacity : 1,
            },
        })
        if (!isWalk) {
          markersRef.current.push(
            makeStopMarker([leg.from.lon, leg.from.lat], color, 15, palette, tf('map_boardMarker', { name: placeName(leg.from, localeRef.current) }), 'flat').marker.addTo(map),
            makeStopMarker([leg.to.lon, leg.to.lat], color, 15, palette, tf('map_alightMarker', { name: placeName(leg.to, localeRef.current) }), 'flat').marker.addTo(map),
          )
        }
        return
      }

      if (!isWalk && !schematic && !deduced) {
        addLayer({
          id: `itin-cas-${index}`,
          type: 'line',
          source: sourceId,
          layout: { 'line-join': 'round', 'line-cap': 'round' },
          paint: { 'line-color': palette.casing, 'line-width': WIDTH.strongCasing, 'line-opacity': 0.95 },
        })
      }
      addLayer({
        id: `itin-line-${index}`,
        type: 'line',
        source: sourceId,
        // Tirets du tracé déduit sans bouts arrondis (qui les souderaient),
        // comme au catalogue.
        layout: deduced ? { 'line-join': 'round' } : { 'line-join': 'round', 'line-cap': 'round' },
        paint: {
          'line-color': isWalk
            ? (isFinalWalk && navigating ? palette.walkFinal : palette.walk)
            : (isPast ? palette.done : color),
          'line-width': isWalk ? WIDTH.walk : WIDTH.strongLine,
          // Marche : petits points ; schématique : tirets larges ; déduit : tirets du catalogue.
          ...(isWalk && { 'line-dasharray': [0.667, 2.333] }),
          ...(schematic && { 'line-dasharray': [1.2, 0.9] }),
          ...(deduced && { 'line-dasharray': [2, 1.5] }),
        },
      })

      if (!isWalk) {
        // Portion parcourue (vide au départ, remplie par l'effet léger) et
        // portion restante qui porte les chevrons de sens.
        addSource(`${sourceId}-done`, EMPTY_FC)
        addLayer({
          id: `itin-done-${index}`,
          type: 'line',
          source: `${sourceId}-done`,
          layout: { 'line-join': 'round', 'line-cap': 'round' },
          paint: { 'line-color': palette.done, 'line-width': WIDTH.strongLine },
        })
        if (!schematic && !isPast) {
          addSource(`${sourceId}-ahead`, lineFeature(coords))
          addLayer({
            id: `itin-arrow-${index}`,
            type: 'symbol',
            source: `${sourceId}-ahead`,
            minzoom: 12,
            layout: {
              'symbol-placement': 'line',
              'symbol-spacing': 90,
              'icon-image': CHEVRON_IMAGE,
              'icon-size': WIDTH.arrow,
              'icon-rotation-alignment': 'map',
              // Jamais de collision avec les noms de rues : ils restent affichés.
              'icon-allow-overlap': true,
              'icon-ignore-placement': true,
            },
            paint: { 'icon-opacity': 0.95 },
          })
        }

        const edgeColor = isPast ? palette.done : color
        markersRef.current.push(
          makeStopMarker([leg.from.lon, leg.from.lat], edgeColor, 12, palette, tf('map_boardMarker', { name: placeName(leg.from, localeRef.current) })).marker.addTo(map),
        )
        // Descente du leg courant : cercle agrandi (planche 1i, r6 stroke 3).
        markersRef.current.push(
          makeStopMarker([leg.to.lon, leg.to.lat], edgeColor, isCurrent ? 15 : 12, palette, tf('map_alightMarker', { name: placeName(leg.to, localeRef.current) })).marker.addTo(map),
        )
        // Stations intermédiaires : grises une fois dépassées (effet léger).
        if (navigating && leg.intermediateStops) {
          leg.intermediateStops.forEach((s, si) => {
            const { marker, el } = makeStopMarker([s.lon, s.lat], isPast ? palette.done : color, 12, palette)
            markersRef.current.push(marker.addTo(map))
            intermediateRef.current.push({ el, legIndex: index, along: stopAlongs?.[si] ?? 0, color })
          })
        }
      }
    })

    const firstLeg = itinerary.legs[0]
    const lastLeg = itinerary.legs[itinerary.legs.length - 1]
    // En navigation, la position utilisateur remplace le marqueur de départ.
    if (!navigating) {
      // Handoff : départ rond bleu bordé de blanc, arrivée carré noir.
      markersRef.current.push(
        makeEndpointMarker([firstLeg.from.lon, firstLeg.from.lat], ROUTE_STYLE.start, 'circle', palette, tf('map_startMarker', { name: firstLeg.from.name }), 'route').addTo(map),
        makeEndpointMarker([lastLeg.to.lon, lastLeg.to.lat], dark ? '#E5E7EB' : ROUTE_STYLE.end, 'square', palette, tf('map_endMarker', { name: lastLeg.to.name }), 'route').addTo(map),
      )
    } else {
      markersRef.current.push(
        makeEndpointMarker([lastLeg.to.lon, lastLeg.to.lat], dark ? '#E5E7EB' : '#111827', 'square', palette, tf('map_endMarker', { name: lastLeg.to.name })).addTo(map),
      )
    }

    // Étiquettes de fin de trajet (planche 1i) : l'arrêt où descendre, puis
    // la destination en gras. Uniquement en navigation.
    if (navigating) {
      const alightLeg = itinerary.legs[currentIdx]
      const alightName = alightLeg && alightLeg.mode !== 'WALK' ? alightLeg.to.name : null
      if (alightName && alightName !== lastLeg.to.name) {
        markersRef.current.push(makePillMarker([alightLeg.to.lon, alightLeg.to.lat], alightName, 500, palette).addTo(map))
      }
      markersRef.current.push(makePillMarker([lastLeg.to.lon, lastLeg.to.lat], lastLeg.to.name, 600, palette).addTo(map))
    }
  }, [itinerary, legGeoms, legSchematic, legDeduced, navigating, currentIdx, palette, dark, tf, styleVersion, ready])

  // Effet LÉGER : à chaque position, seulement la coupure grise (setData) et la
  // couleur des arrêts dépassés. Aucun ajout/retrait de couche ni de marqueur.
  // Tout est en MÈTRES, comme le bandeau : les deux comptent les mêmes arrêts.
  const along = useMemo(() => {
    if (!legGeoms || !navigating) return 0
    const g = legGeoms[currentIdx]
    if (!g) return 0
    return navAlongMeters ?? navLegProgress * g.length
  }, [legGeoms, navigating, currentIdx, navAlongMeters, navLegProgress])

  useEffect(() => {
    const map = mapRef.current
    if (!map || !ready || !itinerary || !legGeoms || !navigating) return
    const leg = itinerary.legs[currentIdx]
    const g = legGeoms[currentIdx]
    if (!leg || !g || leg.mode === 'WALK') return
    const { done, todo } = splitAtAlong(g.coords as LonLat[], g.cumulative, along)
    setSourceData(map, `itin-src-${currentIdx}-done`, done.length >= 2 ? lineFeature(done) : EMPTY_FC)
    setSourceData(map, `itin-src-${currentIdx}-ahead`, todo.length >= 2 ? lineFeature(todo) : EMPTY_FC)
    intermediateRef.current.forEach((stop) => {
      if (stop.legIndex !== currentIdx) return
      stop.el.style.borderColor = stop.along <= along ? palette.done : stop.color
    })
  }, [along, itinerary, legGeoms, navigating, currentIdx, palette, styleVersion, ready])

  // Cadrage sur le trajet entier, hors navigation, au changement de trajet.
  const fitKey = fitPadding ? `${fitPadding.top},${fitPadding.bottom},${fitPadding.left},${fitPadding.right}` : ''
  useEffect(() => {
    const map = mapRef.current
    if (!map || !ready || !itinerary || navigating || !legGeoms) return
    const bounds = boundsOf(legGeoms.flatMap((g) => g.coords as LonLat[]))
    if (!bounds) return
    // La marge de navigation persiste dans la caméra (MapLibre l'additionne
    // à celle de fitBounds) : on la remet à zéro avant de cadrer.
    map.setPadding(ZERO_PADDING)
    map.fitBounds([[bounds[0], bounds[1]], [bounds[2], bounds[3]]], {
      padding: fitPadding ?? defaultFitPadding(),
      animate: true,
      duration: 900,
      maxZoom: 16.5,
    })
    // Recadrage aussi à chaque position d'arrêt de la feuille du détail (la
    // marge change) et sur son bouton flottant (fitSignal).
  }, [itinerary, navigating, legGeoms, fitKey, ready, fitSignal]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!navigating) mapRef.current?.setPadding(ZERO_PADDING)
  }, [navigating])

  // ── Pastilles d'arrêt ──────────────────────────────────────────────────────
  // Marqueurs DOM (accessibles, cible de 44 px) avec anti-chevauchement en
  // pixels : une pastille qui en masquerait une plus prioritaire n'est pas posée.
  const selectedBadgeId = selected?.kind === 'stop' ? selected.badgeId : null
  const badgeContext = useMemo((): { filter?: (b: StopBadge) => boolean; allZooms: boolean; selectedId: string | null; minZoom?: number } => {
    const showMode = (b: StopBadge) => (b.mode === 'metro' ? showMetro : b.mode === 'tram' ? showTram : true)
    if (itinerary) {
      const focus = buildItineraryFocus(itinerary)
      const busRefs = new Set(itinerary.legs.filter((l) => l.mode === 'BUS' && l.routeShortName).map((l) => l.routeShortName as string))
      const endpoints = itinerary.legs.filter((l) => l.mode !== 'WALK').flatMap((l) => [[l.from.lon, l.from.lat], [l.to.lon, l.to.lat]] as LonLat[])
      return {
        allZooms: false,
        selectedId: selectedBadgeId,
        // Vue d'ensemble du trajet : le tracé seul ; les arrêts des lignes
        // empruntées n'apparaissent qu'en zoomant (ils masquaient le trait).
        minZoom: 14.5,
        // Seules les lignes du trajet ; jamais par-dessus ses propres cercles.
        filter: (b: StopBadge) => {
          const used = b.mode === 'bus' ? b.lines.some((l) => busRefs.has(l)) : focus.modes.has(b.mode === 'metro' ? 'SUBWAY' : 'TRAM')
          return used && !endpoints.some((p) => metersBetween(p, [b.lon, b.lat]) < 30)
        },
      }
    }
    if (lineFocus) {
      const dir = lineFocus.directionIndex ?? 0
      return {
        allZooms: true,
        selectedId: selectedBadgeId,
        filter: (b: StopBadge) => b.serves.some((s) => s.lineId === lineFocus.lineId && s.dir === dir),
      }
    }
    return { allZooms: false, selectedId: selectedBadgeId, filter: showMode }
  }, [itinerary, lineFocus, showMetro, showTram, selectedBadgeId])
  const badgeContextRef = useRef(badgeContext)
  badgeContextRef.current = badgeContext

  // Le cadrage de l'arrêt choisi attend la feuille (effet « Cadrage » plus
  // bas) : centré sur tout l'écran, il finissait SOUS une feuille haute.
  const onSelectBadge = useCallback((badge: StopBadge) => {
    setSelected({ kind: 'stop', badgeId: badge.id })
  }, [])

  const syncBadges = useCallback(() => {
    const map = mapRef.current
    if (!map) return
    const markers = badgeMarkersRef.current
    // En navigation la carte ne porte que le trajet : aucune pastille de réseau.
    if (navigatingRef.current) {
      markers.forEach((marker) => marker.remove())
      markers.clear()
      return
    }
    const bounds = map.getBounds()
    const center = map.getCenter()
    const ctx = badgeContextRef.current
    const layout = layoutBadges(
      getStopBadges(locale),
      { west: bounds.getWest(), south: bounds.getSouth(), east: bounds.getEast(), north: bounds.getNorth() },
      map.getZoom(),
      {
        project: (lon, lat) => map.project([lon, lat]),
        selectedId: ctx.selectedId,
        center: { lon: center.lng, lat: center.lat },
        filter: ctx.filter,
        allZooms: ctx.allZooms,
        minZoom: ctx.minZoom,
      },
    )
    const keep = new Set<string>()
    layout.visible.forEach((badge) => {
      keep.add(badge.id)
      const isSelected = ctx.selectedId === badge.id
      const existing = markers.get(badge.id)
      const el = existing?.getElement()
      // Recréé seulement si son gabarit change (sélection, langue, thème).
      if (el && el.dataset.selected === String(isSelected) && el.dataset.locale === locale && el.dataset.theme === (dark ? 'dark' : 'light')) return
      existing?.remove()
      const element = createBadgeElement(badge, isSelected, locale, dark)
      element.dataset.selected = String(isSelected)
      element.addEventListener('click', (event) => {
        event.stopPropagation()
        onSelectBadge(badge)
      })
      element.addEventListener('keydown', (event) => {
        if (event.key !== 'Enter' && event.key !== ' ') return
        event.preventDefault()
        onSelectBadge(badge)
      })
      const marker = new maplibregl.Marker({ element, anchor: isSelected ? 'bottom' : 'center' })
        .setLngLat([badge.lon, badge.lat])
        .addTo(map)
      // MapLibre écrase l'aria-label par un « Map marker » générique : on le
      // repose APRÈS addTo, dans la langue de l'interface.
      element.setAttribute('aria-label', element.dataset.label ?? '')
      markers.set(badge.id, marker)
    })
    markers.forEach((marker, id) => {
      if (keep.has(id)) return
      marker.remove()
      markers.delete(id)
    })
    // Au zoom maximal, inviter à zoomer n'aurait plus de sens.
    const collision = map.getZoom() >= map.getMaxZoom() - 0.5 ? 0 : layout.hiddenByCollision
    setBadgeHint((prev) => (prev.zoom === layout.hiddenByZoom && prev.collision === collision
      ? prev
      : { zoom: layout.hiddenByZoom, collision }))
  }, [locale, dark, onSelectBadge])

  useEffect(() => {
    const map = mapRef.current
    if (!map || !ready) return
    syncBadges()
    map.on('moveend', syncBadges)
    return () => { map.off('moveend', syncBadges) }
  }, [syncBadges, ready, styleVersion, navigating, badgeContext])

  // Arrêts physiques d'une pastille regroupée (A, B…) : l'usager voit de quel
  // côté de la rue passe chaque sens.
  const selectedBadge = useMemo(
    () => (selectedBadgeId ? getStopBadges(locale).find((b) => b.id === selectedBadgeId) ?? null : null),
    [selectedBadgeId, locale],
  )
  useEffect(() => {
    const map = mapRef.current
    memberMarkersRef.current.forEach((m) => m.remove())
    memberMarkersRef.current = []
    if (!map || !ready || !selectedBadge || selectedBadge.members.length < 2) return
    selectedBadge.members.forEach((member, index) => {
      const el = document.createElement('div')
      el.textContent = memberLetter(index)
      el.style.cssText = `width:18px;height:18px;border-radius:50%;background:${palette.surface};color:${dark ? '#E5E7EB' : '#111827'};`
        + `border:2px solid ${selectedBadge.color};font:600 10px Inter,system-ui,sans-serif;display:flex;align-items:center;justify-content:center;z-index:1`
      const marker = new maplibregl.Marker({ element: el, anchor: 'center' }).setLngLat([member.lon, member.lat]).addTo(map)
      el.setAttribute('aria-hidden', 'true')
      el.removeAttribute('aria-label')
      memberMarkersRef.current.push(marker)
    })
  }, [selectedBadge, palette, dark, ready, styleVersion])

  // ── Fiche (arrêt ou point choisi) ──────────────────────────────────────────
  const closeSheet = useCallback(() => setSelected(null), [])
  useBackHandler(selected !== null, closeSheet)

  useEffect(() => {
    if (!mapActive || navigating || itinerary) setSelected(null)
  }, [mapActive, navigating, itinerary])

  // Bascules Métro/Tram : la fiche d'une station masquée se referme.
  useEffect(() => {
    if (!selectedBadge) return
    if ((selectedBadge.mode === 'metro' && !showMetro) || (selectedBadge.mode === 'tram' && !showTram)) setSelected(null)
  }, [selectedBadge, showMetro, showTram])

  // Feuille basse : elle prend le focus à l'ouverture et Échap la referme.
  const selectedKey = selected ? (selected.kind === 'stop' ? selected.badgeId : selected.coords.join(',')) : null
  useEffect(() => {
    if (!selectedKey) return
    sheetRef.current?.focus()
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      setSelected(null)
      mapRef.current?.getCanvas().focus()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [selectedKey])

  // Cadrage : l'arrêt choisi (et ses points A, B… d'un pôle) dans la partie
  // VISIBLE de la carte, au-dessus de la feuille — sans marge persistante dans
  // la caméra (offset / cameraForBounds), donc sans effet sur la navigation.
  // Point choisi par appui long : déplacé seulement s'il est caché.
  const sheetFrameRef = useRef<{ key: string | null; height: number }>({ key: null, height: 0 })
  const frameSelectionRef = useRef<(force: boolean) => void>(() => {})
  frameSelectionRef.current = (force: boolean) => {
    const map = mapRef.current
    const sheetEl = sheetRef.current
    if (!map || !ready || !sheetEl || !selected || navigatingRef.current) return
    const height = map.getContainer().clientHeight
    // offsetHeight ignore la translation de l'animation d'entrée.
    const sheetHeight = sheetEl.offsetHeight
    sheetFrameRef.current.height = sheetHeight
    const top = SHEET_FRAME_TOP
    const bottom = sheetHeight + 12
    if (height - top - bottom < 48) return
    const points: LonLat[] = selected.kind === 'point'
      ? [selected.coords]
      : selectedBadge
        ? (selectedBadge.members.length >= 2 ? selectedBadge.members.map((m) => [m.lon, m.lat] as LonLat) : [[selectedBadge.lon, selectedBadge.lat]])
        : []
    if (points.length === 0) return
    const hidden = points.some((p) => {
      const pt = map.project(p)
      return pt.y < top || pt.y > height - bottom
    })
    if (!force && !hidden) return
    const duration = force ? 600 : 400
    if (points.length >= 2) {
      const b = boundsOf(points)
      const camera = b && map.cameraForBounds([[b[0], b[1]], [b[2], b[3]]], {
        padding: { top, bottom, left: 40, right: 40 },
        maxZoom: 17,
        bearing: map.getBearing(),
      })
      if (camera?.center && camera.zoom !== undefined) {
        map.easeTo({ center: camera.center, zoom: camera.zoom, duration })
        return
      }
    }
    const [lon, lat] = selectedBadge && selected.kind === 'stop' ? [selectedBadge.lon, selectedBadge.lat] : points[0]
    map.easeTo({
      center: [lon, lat],
      zoom: selected.kind === 'stop' ? Math.max(map.getZoom(), 14.2) : undefined,
      // Centre de la bande visible entre le haut de la carte et la feuille.
      offset: [0, (top - bottom) / 2],
      duration,
    })
  }

  useEffect(() => {
    const sheetEl = sheetRef.current
    if (!selectedKey || !ready || navigating || !sheetEl) {
      sheetFrameRef.current = { key: null, height: 0 }
      return
    }
    // Nouvel arrêt : cadrage systématique ; nouveau point : seulement s'il
    // est caché.
    if (sheetFrameRef.current.key !== selectedKey) {
      sheetFrameRef.current.key = selectedKey
      frameSelectionRef.current(selected?.kind === 'stop')
    }
    if (typeof ResizeObserver === 'undefined') return
    // La feuille change de hauteur (nom trouvé, langue, rangées) : on recadre
    // seulement si l'arrêt passe dessous.
    const observer = new ResizeObserver(() => {
      if (Math.abs(sheetEl.offsetHeight - sheetFrameRef.current.height) < 8) return
      frameSelectionRef.current(false)
    })
    observer.observe(sheetEl)
    return () => observer.disconnect()
  }, [selectedKey, ready, navigating]) // eslint-disable-line react-hooks/exhaustive-deps

  // Épingle du point choisi par appui long.
  const pinCoords = selected?.kind === 'point' ? selected.coords : null
  useEffect(() => {
    const map = mapRef.current
    pinMarkerRef.current?.remove()
    pinMarkerRef.current = null
    if (!map || !ready || !pinCoords) return
    const el = document.createElement('div')
    el.style.cssText = `width:16px;height:16px;border-radius:50% 50% 50% 0;transform:rotate(-45deg);background:${dark ? '#E5E7EB' : '#111827'};`
      + `border:2.5px solid ${palette.surface};box-shadow:0 1px 4px rgba(16,24,40,.3);z-index:3`
    pinMarkerRef.current = new maplibregl.Marker({ element: el, anchor: 'bottom' }).setLngLat(pinCoords).addTo(map)
    el.setAttribute('aria-hidden', 'true')
    el.removeAttribute('aria-label')
  }, [pinCoords?.[0], pinCoords?.[1], ready, styleVersion, dark, palette]) // eslint-disable-line react-hooks/exhaustive-deps

  const openPoint = useCallback((lngLat: maplibregl.LngLat) => {
    const now = Date.now()
    // Android émet aussi « contextmenu » sur un appui long : un seul point.
    if (now - longPressAtRef.current < 800) return
    longPressAtRef.current = now
    const coords: [number, number] = [lngLat.lng, lngLat.lat]
    setSelected({ kind: 'point', coords, name: null })
    void import('@/lib/geocoding')
      .then(({ reverseGeocode }) => reverseGeocode(lngLat.lat, lngLat.lng, localeRef.current))
      // Échec : les coordonnées, jamais un nom de lieu inventé.
      .catch(() => `${lngLat.lat.toFixed(5)}, ${lngLat.lng.toFixed(5)}`)
      .then((name) => {
        if (!mountedRef.current) return
        setSelected((prev) => (prev?.kind === 'point' && prev.coords[0] === coords[0] && prev.coords[1] === coords[1] ? { ...prev, name } : prev))
      })
  }, [])

  // Appui long (mobile) / clic droit (bureau) : « Y aller / Partir d'ici ».
  const longPressEnabled = mapActive && !itinerary && !navigating && Boolean(onNavigateTo || onDepartFrom)
  useEffect(() => {
    const map = mapRef.current
    if (!map || !ready || !longPressEnabled) return
    const container = map.getCanvasContainer()
    let timer: number | null = null
    let start: { x: number; y: number } | null = null
    const cancel = () => {
      if (timer !== null) window.clearTimeout(timer)
      timer = null
      start = null
    }
    const onTouchStart = (event: TouchEvent) => {
      cancel()
      if (event.touches.length !== 1) return
      const touch = event.touches[0]
      start = { x: touch.clientX, y: touch.clientY }
      timer = window.setTimeout(() => {
        if (!start) return
        const rect = container.getBoundingClientRect()
        openPoint(map.unproject([start.x - rect.left, start.y - rect.top]))
        cancel()
      }, 550)
    }
    const onTouchMove = (event: TouchEvent) => {
      if (!start) return
      const touch = event.touches[0]
      if (event.touches.length !== 1 || Math.hypot(touch.clientX - start.x, touch.clientY - start.y) > 10) cancel()
    }
    const onContextMenu = (event: maplibregl.MapMouseEvent) => {
      event.preventDefault()
      event.originalEvent?.preventDefault()
      openPoint(event.lngLat)
    }
    container.addEventListener('touchstart', onTouchStart, { passive: true })
    container.addEventListener('touchmove', onTouchMove, { passive: true })
    container.addEventListener('touchend', cancel)
    container.addEventListener('touchcancel', cancel)
    map.on('movestart', cancel)
    map.on('contextmenu', onContextMenu)
    return () => {
      cancel()
      container.removeEventListener('touchstart', onTouchStart)
      container.removeEventListener('touchmove', onTouchMove)
      container.removeEventListener('touchend', cancel)
      container.removeEventListener('touchcancel', cancel)
      map.off('movestart', cancel)
      map.off('contextmenu', onContextMenu)
    }
  }, [ready, longPressEnabled, openPoint])

  // Clic sur la carte (hors pastille) : referme la fiche. Choisir un point se
  // fait par appui long / clic droit (« Y aller », « Partir d'ici »).
  useEffect(() => {
    const map = mapRef.current
    if (!map || !ready) return
    const onClick = () => {
      // Le relâché d'un appui long ne referme pas la fiche qu'il vient d'ouvrir.
      if (Date.now() - longPressAtRef.current < 700) return
      setSelected(null)
    }
    map.on('click', onClick)
    return () => { map.off('click', onClick) }
  }, [ready])

  // ── Position de l'usager ───────────────────────────────────────────────────

  const applyHeading = useCallback(() => {
    const cone = puckRef.current?.cone
    if (!cone) return
    // Cap GPS (mesuré, en mouvement) d'abord, sinon boussole rapportée au nord ;
    // sinon AUCUN cône — et jamais sur une position périmée.
    const heading = gpsCourseRef.current ?? compassRef.current
    if (heading === null || staleRef.current) {
      cone.style.display = 'none'
      return
    }
    cone.style.display = 'block'
    cone.style.transform = `rotate(${heading}deg)`
  }, [])

  useDeviceHeading((heading) => {
    compassRef.current = heading
    applyHeading()
  }, Boolean(userPosition) && !mapError)

  // Le gabarit du puck dépend du mode : on le reconstruit au changement.
  useEffect(() => {
    userMarkerRef.current?.remove()
    userMarkerRef.current = null
    puckRef.current = null
  }, [navigating])

  useEffect(() => {
    const map = mapRef.current
    if (!map || !ready || !userPosition) return
    const lngLat: [number, number] = [userPosition.lon, userPosition.lat]
    if (!userMarkerRef.current) {
      const { marker, dot, halo, cone } = makeUserPuck(navigating)
      userMarkerRef.current = marker.setLngLat(lngLat).addTo(map)
      marker.getElement().setAttribute('aria-hidden', 'true')
      marker.getElement().removeAttribute('aria-label')
      puckRef.current = { dot, halo, cone }
    } else {
      userMarkerRef.current.setLngLat(lngLat)
    }
    // Cercle de précision réel du GPS (y compris en navigation) : il montre
    // que la position est mesurée, et avec quelle marge.
    setSourceData(map, 'user-accuracy', userPosition.accuracy > 0
      ? { type: 'Feature', geometry: { type: 'Polygon', coordinates: [makeCircle(userPosition.lat, userPosition.lon, userPosition.accuracy)] }, properties: {} }
      : EMPTY_FC)
    const speed = userPosition.speed ?? null
    gpsCourseRef.current = speed !== null && speed > 1 && userPosition.heading !== null ? userPosition.heading : null
    applyHeading()
    if (followingRef.current && isInServiceArea(userPosition.lon, userPosition.lat)) {
      // Pas de zoom forcé à chaque point : seul le centre suit (un pincement
      // de l'usager est respecté). Zoom de rue seulement au premier point
      // demandé par « localiser ».
      const zoom = zoomOnNextFixRef.current ? Math.max(map.getZoom(), 15) : undefined
      zoomOnNextFixRef.current = false
      map.easeTo({ center: lngLat, zoom, padding: navPadding(), duration: 800 })
    }
  }, [userPosition, navigating, ready, styleVersion, applyHeading, navPadding])

  // Position périmée : puck gris, plus de cône, cercle gris. Le délai se
  // compte depuis la RÉCEPTION du point (horloge du téléphone ; l'horodatage
  // GPS peut venir d'une autre horloge). À défaut de receivedAt, on note
  // l'instant où ce point nous est parvenu.
  const fixAtRef = useRef<{ position: MapUserPosition | null; at: number }>({ position: null, at: 0 })
  if (userPosition && fixAtRef.current.position !== userPosition) {
    fixAtRef.current = { position: userPosition, at: userPosition.receivedAt ?? Date.now() }
  }
  useEffect(() => {
    if (!userPosition) {
      setStaleInfo((prev) => (prev.stale ? { stale: false, ageSec: 0 } : prev))
      return
    }
    const receivedAt = fixAtRef.current.at
    const tick = () => {
      const age = Date.now() - receivedAt
      const stale = positionStale ?? age > (navigating ? STALE_AFTER_MS.navigating : STALE_AFTER_MS.browsing)
      const sec = Math.floor(age / 1000)
      const bucket = !stale ? 0 : sec < 60 ? Math.floor(sec / 10) * 10 : Math.floor(sec / 60) * 60
      setStaleInfo((prev) => (prev.stale === stale && prev.ageSec === bucket ? prev : { stale, ageSec: bucket }))
    }
    tick()
    const id = window.setInterval(tick, 5000)
    return () => window.clearInterval(id)
  }, [userPosition, positionStale, navigating])

  useEffect(() => {
    const puck = puckRef.current
    const map = mapRef.current
    const color = staleInfo.stale ? palette.stale : '#1D6FE0'
    if (puck) {
      puck.dot.style.background = color
      puck.halo.style.background = color
    }
    applyHeading()
    if (map && ready) {
      setPaintSafe(map, 'user-accuracy-fill', 'fill-color', staleInfo.stale ? palette.stale : palette.accuracy)
      setPaintSafe(map, 'user-accuracy-line', 'line-color', staleInfo.stale ? palette.stale : palette.accuracy)
    }
  }, [staleInfo.stale, palette, ready, styleVersion, userPosition, navigating, applyHeading])

  const handleLocate = useCallback(() => {
    // iOS exige un geste utilisateur pour exposer la boussole.
    const orientationEvent = (typeof DeviceOrientationEvent !== 'undefined' ? DeviceOrientationEvent : undefined) as unknown as { requestPermission?: () => Promise<string> } | undefined
    orientationEvent?.requestPermission?.().catch(() => {})
    // Le suivi de position appartient au parent : on lui demande de l'activer
    // et on recentre dès qu'un point arrive.
    onRequestPosition?.()
    const map = mapRef.current
    const position = userPositionRef.current
    // Hors du Grand Alger (diaspora) : la carte reste sur Alger.
    if (position && !isInServiceArea(position.lon, position.lat)) {
      setFollow(false)
      return
    }
    setFollow(true)
    if (map && position) {
      map.easeTo({ center: [position.lon, position.lat], zoom: Math.max(map.getZoom(), 15), padding: navPadding(), duration: 800 })
    } else {
      zoomOnNextFixRef.current = true
    }
  }, [onRequestPosition, setFollow, navPadding])

  // Recentrage automatique quand le parent le demande (onglet Carte, départ).
  const lastLocateSignal = useRef(0)
  useEffect(() => {
    if (!autoLocateSignal || autoLocateSignal === lastLocateSignal.current) return
    lastLocateSignal.current = autoLocateSignal
    handleLocate()
  }, [autoLocateSignal, handleLocate])

  const handleZoomIn = () => { mapRef.current?.zoomIn() }
  const handleZoomOut = () => { mapRef.current?.zoomOut() }

  // ── Modèle de la fiche ─────────────────────────────────────────────────────
  const userPos: LonLat | null = userPosition ? [userPosition.lon, userPosition.lat] : null
  const sheet = useMemo(() => {
    if (!selected) return null
    if (selected.kind === 'point') {
      return {
        kind: 'point' as const,
        title: selected.name ?? t('map_findingAddress'),
        subtitle: `${selected.coords[1].toFixed(5)}, ${selected.coords[0].toFixed(5)}`,
        coords: selected.coords,
        name: selected.name,
        rows: [] as SheetRow[],
        membersNote: null as string | null,
        reportHref: null as string | null,
      }
    }
    if (!selectedBadge) return null
    const distance = userPos ? formatDistance(metersBetween(userPos, [selectedBadge.lon, selectedBadge.lat]), locale) : null
    const modeWord = selectedBadge.mode === 'metro' ? t('metroStation') : selectedBadge.mode === 'tram' ? t('tramStop') : t('busStopWord')
    const rows = buildSheetRows(selectedBadge, locale, t)
    const multi = selectedBadge.members.length > 1
    return {
      kind: 'stop' as const,
      title: selectedBadge.name,
      subtitle: [modeWord, distance].filter(Boolean).join(' · '),
      coords: [selectedBadge.lon, selectedBadge.lat] as [number, number],
      name: selectedBadge.name,
      rows: rows.map((row) => ({ ...row, member: multi ? row.member : null })),
      membersNote: multi ? tf('map_stopMembers', { n: selectedBadge.members.length }) : null,
      reportHref: stopReportMailto({
        subject: tf('map_reportSubject', { name: selectedBadge.name }),
        intro: t('map_reportBody'),
        stopName: selectedBadge.name,
        lat: selectedBadge.lat,
        lon: selectedBadge.lon,
        rows: rows.map((r) => `${r.badge} ${r.label}`),
        locale,
      }),
    }
    // userPos change à chaque point GPS : la distance affichée suit.
  }, [selected, selectedBadge, locale, t, tf, userPos?.[0], userPos?.[1]]) // eslint-disable-line react-hooks/exhaustive-deps

  const pickPayload = (): { coord: Coordinate; name: string } | null => {
    if (!sheet || !sheet.name) return null
    return { coord: { lat: sheet.coords[1], lon: sheet.coords[0], name: sheet.name }, name: sheet.name }
  }
  const showSheetActions = Boolean(sheet && mapActive && !navigating && (onNavigateTo || onDepartFrom))

  // ── Messages d'état ────────────────────────────────────────────────────────
  const outsideArea = Boolean(userPosition && !isInServiceArea(userPosition.lon, userPosition.lat))
  const notices: { key: string; text: string; action?: { label: string; onClick: () => void } }[] = []
  extraNotices?.forEach((text, index) => notices.push({ key: `extra-${index}`, text }))
  if (basemap === 'down') notices.push({ key: 'basemap', text: t('map_basemapDown'), action: { label: t('map_retry'), onClick: retryBasemap } })
  else if (basemap === 'partial') notices.push({ key: 'basemap', text: t('map_basemapPartial') })
  if (needShapes && shapesState === 'error' && !focusVisible) {
    notices.push({ key: 'shapes', text: t('map_shapesError'), action: { label: t('map_retry'), onClick: retryShapes } })
  }
  const browsing = !hideControls && !navigating
  if (showPositionNotices && (browsing ? mapActive : navigating)) {
    if (browsing && positionError) {
      notices.push({ key: 'geo', text: positionError === 'insecure' ? t('geoInsecure') : positionError === 'denied' ? t('geoDenied') : t('geoUnavailable') })
    }
    if (outsideArea) notices.push({ key: 'outside', text: t('map_outsideArea') })
    else if (userPosition && staleInfo.stale) {
      notices.push({
        key: 'stale',
        text: staleInfo.ageSec >= 60
          ? tf('map_positionStaleMin', { n: Math.floor(staleInfo.ageSec / 60) })
          : tf('map_positionStaleSec', { n: Math.max(30, staleInfo.ageSec) }),
      })
    } else if (userPosition && userPosition.accuracy > IMPRECISE_M) {
      notices.push({ key: 'approx', text: tf('map_positionApprox', { n: Math.round(userPosition.accuracy / 10) * 10 }) })
    }
  }
  // Invitation à zoomer : seulement s'il y a VRAIMENT des arrêts cachés dans
  // la vue (par le palier de zoom ou par l'anti-chevauchement).
  const zoomHint = browsing && mapActive && !itinerary && !focusVisible && !selected
    ? (badgeHint.zoom > 0 ? (zoomTier === 0 ? t('map_zoomForStops') : t('map_zoomForAllStops'))
      : badgeHint.collision > 0 ? t('map_zoomForAllStops') : null)
    : null

  const showRecenter = showRecenterButton && Boolean(hideControls || navigating) && Boolean(userPosition) && !following && !outsideArea
  // Sans mesure du parent : hauteurs typiques de la carte du haut et de la
  // feuille du bas en navigation, pour ne pas glisser un message dessous.
  const navTop = cameraPadding?.top ?? 120
  const navBottom = cameraPadding?.bottom ?? 220

  return (
    <div ref={mapContainerRef} className={`map-container ${styles.root}`} data-theme={dark ? 'dark' : 'light'}>

      {mapError && (
        <div className="absolute inset-0 z-10 flex items-center justify-center px-8" style={{ background: palette.background }}>
          <p role="status" className={`max-w-sm text-center text-body ${styles.muted}`}>{t('map_webglError')}</p>
        </div>
      )}

      {/* Légende (planche 1e) : un seul pill flottant, tap = masquer un mode. */}
      {!itinerary && !hideControls && !focusVisible && !mapError && (
        <div
          className={`absolute start-5 z-10 flex h-9 items-center gap-3 rounded-control px-3.5 shadow-soft ${styles.surface}`}
          style={{ top: 'calc(env(safe-area-inset-top, 0px) + 14px)' }}
        >
          {([
            ['metro', showMetro, setShowMetro, lineDisplayColor(METRO_COLOR, dark)],
            ['tram', showTram, setShowTram, lineDisplayColor(TRAM_COLOR, dark)],
          ] as const).map(([key, on, set, color]) => (
            <button
              key={key}
              type="button"
              onClick={() => set((v) => !v)}
              aria-pressed={on}
              className={`flex items-center gap-2 text-[12px] font-medium transition-opacity ${styles.muted} ${styles.hit} ${styles.focusRing}`}
              style={{ opacity: on ? 1 : 0.45 }}
            >
              <span className="h-[3px] w-[10px] rounded-[2px]" style={{ backgroundColor: color }} aria-hidden="true" />
              {t(key)}
            </button>
          ))}
        </div>
      )}

      {/* Ligne consultée : bandeau en haut, avec l'état honnête du tracé. */}
      {focusVisible && focusModel && (
        <div className="absolute start-4 end-[76px] z-10 flex flex-col gap-2" style={{ top: 'calc(env(safe-area-inset-top, 0px) + 14px)' }}>
          <div className={`flex min-h-11 items-center gap-2 rounded-control py-1.5 ps-3 pe-1 shadow-soft ${styles.surface}`}>
            <span
              className="inline-flex h-[24px] min-w-[32px] shrink-0 items-center justify-center rounded-[7px] px-1.5 text-[12px] font-semibold"
              style={{ backgroundColor: focusModel.line.color || '#D97706', color: readableTextColor(focusModel.line.color || '#D97706') }}
              dir="ltr"
            >
              {focusModel.line.shortName}
            </span>
            <span className="min-w-0 flex-1 truncate text-body font-medium">{t('towards')} {focusModel.destination}</span>
            {focusModel.line.directions.length > 1 && (
              <button
                type="button"
                onClick={() => openLineFocus({ lineId: focusModel.line.id, directionIndex: oppositeDirectionIndex(focusModel.line, focusModel.dir) })}
                aria-label={t('map_otherDirection')}
                title={t('map_otherDirection')}
                className={`tap flex h-10 w-10 shrink-0 items-center justify-center rounded-full ${styles.icon} ${styles.focusRing}`}
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                  <path d="M7 4 3 8l4 4M3 8h14M17 20l4-4-4-4M21 16H7" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </button>
            )}
            <button
              type="button"
              onClick={() => openLineFocus(null)}
              aria-label={t('map_closeLine')}
              className={`tap flex h-10 w-10 shrink-0 items-center justify-center rounded-full ${styles.icon} ${styles.focusRing}`}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <path d="M6 6l12 12M18 6 6 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              </svg>
            </button>
          </div>
          {focusNotes(focusModel, t).map((note) => (
            <p key={note.key} role="status" className={`self-start rounded-control px-3 py-2 text-label shadow-soft ${styles.surface} ${styles.muted}`}>
              {note.text}
              {note.key === 'error' && (
                <button type="button" onClick={retryShapes} className={`ms-2 font-semibold underline ${styles.link} ${styles.focusRing}`}>{t('map_retry')}</button>
              )}
            </p>
          ))}
        </div>
      )}

      {/* Contrôles (planche 1e) : localisation · + · − en colonne flottante */}
      {!hideControls && !detailChrome && !mapError && (
        <div
          className={`absolute end-5 z-10 flex flex-col rounded-control shadow-soft ${styles.surface}`}
          style={{ top: 'calc(env(safe-area-inset-top, 0px) + 14px)' }}
        >
          <button
            type="button"
            onClick={handleLocate}
            aria-label={t('myLocation')}
            aria-pressed={following}
            className={`tap flex h-11 w-11 items-center justify-center rounded-t-control ${styles.icon} ${styles.focusRing}`}
          >
            <svg width="19" height="19" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <circle cx="12" cy="12" r="3.5" stroke={following ? '#1D6FE0' : 'currentColor'} strokeWidth="1.8" />
              <path d="M12 2v4M12 18v4M2 12h4M18 12h4" stroke={following ? '#1D6FE0' : 'currentColor'} strokeWidth="1.8" strokeLinecap="round" />
            </svg>
          </button>
          <span className={`mx-2.5 h-px ${styles.divider}`} aria-hidden="true" />
          <button
            type="button"
            onClick={handleZoomIn}
            aria-label={t('zoomIn')}
            className={`tap flex h-11 w-11 items-center justify-center text-[17px] font-medium ${styles.icon} ${styles.focusRing}`}
          >
            +
          </button>
          <span className={`mx-2.5 h-px ${styles.divider}`} aria-hidden="true" />
          <button
            type="button"
            onClick={handleZoomOut}
            aria-label={t('zoomOut')}
            className={`tap flex h-11 w-11 items-center justify-center rounded-b-control text-[17px] font-medium ${styles.icon} ${styles.focusRing}`}
          >
            −
          </button>
        </div>
      )}

      {/* Recentrer : le suivi a été interrompu par un glissé (navigation). */}
      {showRecenter && (
        <button
          type="button"
          onClick={handleLocate}
          aria-label={t('map_recenterAria')}
          className={`tap absolute end-4 z-30 flex h-11 min-w-11 items-center gap-2 rounded-full px-4 text-body font-semibold shadow-soft ${styles.surface} ${styles.focusRing}`}
          style={{ bottom: `calc(${navigating ? navBottom : 54}px + env(safe-area-inset-bottom, 0px) + 14px)` }}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path d="M12 3 5 20l7-4 7 4-7-17Z" fill="#1D6FE0" />
          </svg>
          {t('map_recenter')}
        </button>
      )}

      {/* Messages d'état : sobres, factuels, jamais en rouge. */}
      {!selected && (notices.length > 0 || zoomHint) && (
        <div
          className={`pointer-events-none absolute inset-x-4 z-20 flex flex-col items-start gap-2 ${itinerary && !navigating ? 'md:start-[440px]' : ''}`}
          style={navigating
            ? { top: `calc(env(safe-area-inset-top, 0px) + ${navTop + 8}px)` }
            : detailChrome
              ? { top: 'calc(env(safe-area-inset-top, 0px) + 14px)' }
              : { bottom: 'calc(54px + env(safe-area-inset-bottom, 0px) + 14px)' }}
        >
          {notices.map((notice) => (
            <p key={notice.key} role="status" className={`pointer-events-auto max-w-full rounded-control px-3.5 py-2.5 text-label shadow-soft ${styles.surface} ${styles.muted}`}>
              {notice.text}
              {notice.action && (
                <button type="button" onClick={notice.action.onClick} className={`ms-2 font-semibold underline ${styles.link} ${styles.focusRing}`}>
                  {notice.action.label}
                </button>
              )}
            </p>
          ))}
          {zoomHint && (
            <span className={`inline-flex h-7 items-center rounded-control px-3 text-[11px] shadow-soft ${styles.surface} ${styles.muted}`}>
              {zoomHint}
            </span>
          )}
        </div>
      )}

      {/* Fiche d'arrêt / point choisi en feuille basse (planche 1e). */}
      {sheet && (
        <div
          ref={sheetRef}
          role="dialog"
          aria-modal="false"
          aria-label={sheet.title}
          tabIndex={-1}
          // Plafond + liste défilante : un arrêt desservi par beaucoup de lignes
          // empilait ses rangées jusqu'à pousser la poignée HORS de l'écran.
          className={`sheet-in absolute inset-x-0 bottom-0 z-30 flex max-h-[70dvh] flex-col rounded-t-sheet shadow-[0_-4px_14px_rgba(16,24,40,0.07)] outline-none ${styles.surface}`}
        >
          <div className="flex shrink-0 justify-center pb-0.5 pt-2">
            <span className={`h-1 w-9 rounded-[2px] ${styles.divider}`} aria-hidden="true" />
          </div>
          <div className="flex shrink-0 items-start gap-2 pe-2 ps-5 pt-1">
            <div className="min-w-0 flex-1 pt-1">
              <p className="text-title font-semibold">{sheet.title}</p>
              <p className={`mt-0.5 text-label ${styles.faint}`} dir={sheet.kind === 'point' ? 'ltr' : undefined}>{sheet.subtitle}</p>
            </div>
            <button
              type="button"
              onClick={closeSheet}
              aria-label={t('map_closeSheet')}
              className={`tap flex h-11 w-11 shrink-0 items-center justify-center rounded-full ${styles.icon} ${styles.focusRing}`}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <path d="M6 6l12 12M18 6 6 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              </svg>
            </button>
          </div>
          <div className="mt-1 min-h-0 flex-1 overflow-y-auto" style={{ paddingBottom: 'max(20px, env(safe-area-inset-bottom, 0px))' }}>
            {sheet.rows.map((row, index) => (
              // Une rangée = une direction qui passe ICI ; la toucher montre la
              // ligne sur la carte.
              <button
                key={`${row.lineId}-${row.dir}-${row.arrival ? 'a' : 'b'}`}
                type="button"
                onClick={() => {
                  setSelected(null)
                  openLineFocus({ lineId: row.lineId, directionIndex: row.dir })
                }}
                aria-label={`${tf('map_showLine', { line: row.badge, dest: row.dest })}${row.value ? ` · ${row.value}` : ''}`}
                className={`flex w-full items-center gap-3 px-5 py-3 text-start ${index < sheet.rows.length - 1 ? `border-b ${styles.rowBorder}` : ''} ${styles.focusRing}`}
              >
                <span
                  className="inline-flex h-[26px] min-w-[36px] items-center justify-center rounded-[8px] px-2 text-[13px] font-semibold"
                  style={{ backgroundColor: row.color, color: row.textColor }}
                  dir="ltr"
                >
                  {row.badge}
                </span>
                {row.member !== null && (
                  <span className={`inline-flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full border text-[10px] font-semibold ${styles.rowBorder}`} aria-hidden="true">
                    {memberLetter(row.member)}
                  </span>
                )}
                <span className={`min-w-0 flex-1 truncate text-[13px] ${styles.muted}`}>{row.label}</span>
                {row.value && <span className={`tnum shrink-0 text-end text-label ${styles.muted}`}>{row.value}</span>}
              </button>
            ))}
            {sheet.kind === 'stop' && sheet.rows.length === 0 && (
              <p className={`px-5 pt-1 text-label ${styles.faint}`}>{t('map_noLine')}</p>
            )}
            {sheet.membersNote && <p className={`px-5 pt-2 text-label ${styles.faint}`}>{sheet.membersNote}</p>}

            {showSheetActions && (
              <div className="flex gap-2 px-5 pt-3">
                {onNavigateTo && (
                  <button
                    type="button"
                    disabled={!sheet.name}
                    onClick={() => {
                      const payload = pickPayload()
                      if (!payload) return
                      setSelected(null)
                      onNavigateTo(payload.coord, payload.name)
                    }}
                    className={`tap h-[50px] flex-1 rounded-control bg-brand px-4 text-emph font-semibold text-white disabled:opacity-50 ${styles.focusRing}`}
                  >
                    {t('map_goThere')}
                  </button>
                )}
                {onDepartFrom && (
                  <button
                    type="button"
                    disabled={!sheet.name}
                    onClick={() => {
                      const payload = pickPayload()
                      if (!payload) return
                      setSelected(null)
                      onDepartFrom(payload.coord, payload.name)
                    }}
                    className={`tap h-[50px] flex-1 rounded-control px-4 text-emph font-semibold disabled:opacity-50 ${styles.secondary} ${styles.focusRing}`}
                  >
                    {t('map_departFromHere')}
                  </button>
                )}
              </div>
            )}

            {/* La valeur d'une rangée est une FRÉQUENCE, libellée « toutes les
                ~N min » (nextPassLabel), jamais un « ~N min » nu qui se lirait
                comme un prochain passage. Cette note rappelle la source. */}
            {sheet.rows.length > 0 && <p className={`px-5 pt-3 text-label ${styles.faint}`}>{t('estimatedNote')}</p>}
            {/* Ramadan (fenêtre estimée) : horaires changés, non modélisés. */}
            {sheet.rows.length > 0 && railSpecialPeriodNotice() !== null && (
              <p className="px-5 pt-1.5 text-label">{t('cat_ramadanNotice')}</p>
            )}
            {sheet.reportHref && (
              <a href={sheet.reportHref} className={`mx-5 mt-1 inline-flex min-h-11 items-center text-label underline ${styles.link} ${styles.focusRing}`}>
                {t('map_report')}
              </a>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

// ── Fiche ────────────────────────────────────────────────────────────────────

interface SheetRow {
  lineId: string
  dir: number
  badge: string
  color: string
  textColor: string
  label: string
  /** Destination seule (libellé accessible). */
  dest: string
  value: string
  arrival: boolean
  member: number | null
}

// Contenu de la fiche : directions RÉELLEMENT desservies + fréquence estimée,
// libellée « toutes les ~N min » via nextPassLabel — jamais « ~N min » nu ni
// compte à rebours (pas de temps réel à Alger).
function buildSheetRows(badge: StopBadge, locale: Locale, translate: (key: TranslationKey) => string): SheetRow[] {
  const now = new Date()
  return badgeDirectionRows(badge, locale).map((row) => {
    const line = allLines.find((l) => l.id === row.lineId)
    const open = line ? isInService(line, now) : false
    // La fréquence peut manquer (hors service, donnée absente) : on n'écrit
    // alors aucun chiffre.
    // Fréquence de CE sens à cette heure (heure d'Alger, départs du GTFS).
    const headway: number | null = line && open ? headwayAt(line, now, row.dir) : null
    const arrival = row.towards === null
    const dest = row.towards ?? translate('terminus')
    return {
      lineId: row.lineId,
      dir: row.dir,
      badge: row.line,
      color: row.color,
      textColor: row.textColor,
      label: arrival ? translate('map_arrivalOnly') : `${translate('towards')} ${row.towards}`,
      dest,
      value: arrival ? '' : !open ? translate('closed') : headway !== null ? nextPassLabel(headway, locale) : '',
      arrival,
      member: row.member,
    }
  })
}

function memberLetter(index: number): string {
  return String.fromCharCode(65 + (index % 26))
}

function formatDistance(meters: number, locale: Locale): string {
  const rounded = meters < 1000 ? Math.round(meters / 10) * 10 : Math.round(meters / 100) * 100
  const label = rounded < 1000 ? `${rounded} ${locale === 'ar' ? 'م' : 'm'}` : `${(rounded / 1000).toFixed(1)} ${locale === 'ar' ? 'كم' : 'km'}`
  if (locale === 'ar') return `على بعد ${label}`
  if (locale === 'en') return `${label} away`
  return `à ${label}`
}

// ── Ligne consultée ─────────────────────────────────────────────────────────

interface FocusModel {
  line: TransitLine
  dir: number
  destination: string
  color: string
  lines: FeatureCollection<LineString, { color: string; deduced: boolean }>
  stops: FeatureCollection<Point>
  bounds: [number, number, number, number] | null
  status: 'surveyed' | 'deduced' | 'schematic' | 'unmapped' | 'loading' | 'error'
  truncated: boolean
}

function buildFocusModel(
  focus: MapFocusLine,
  shapes: LineShapes | null,
  shapesState: 'idle' | 'loading' | 'ready' | 'error',
  locale: Locale,
  dark: boolean,
): FocusModel | null {
  const line = allLines.find((l) => l.id === focus.lineId)
  if (!line || line.directions.length === 0) return null
  const dir = Math.max(0, Math.min(line.directions.length - 1, focus.directionIndex ?? 0))
  const direction = line.directions[dir]
  const stopCoords = direction.stops.map((s) => [s.lon, s.lat] as LonLat)
  const color = lineDisplayColor(line.color || '#D97706', dark)

  let shape = shapes?.[line.id]?.[dir] as LonLat[] | undefined
  // Rail : si le fichier des tracés est CHARGÉ mais sans tracé pour ce sens,
  // les stations reliées en ligne droite — dessinées en tirets et annoncées
  // comme schématiques. Fichier pas encore chargé ou en échec : on ne présente
  // pas un schéma comme l'état des données (chargement / « Réessayer »).
  if (shapes && line.mode !== 'bus' && (!shape || shape.length < 2)) shape = stopCoords
  const stationChain = line.mode !== 'bus' && Boolean(shape) && shape!.length === stopCoords.length
    && shape!.every((p, i) => p[0] === stopCoords[i][0] && p[1] === stopCoords[i][1])

  let status: FocusModel['status']
  let parts: LonLat[][] = []
  let truncated = false
  if (!shapes) {
    status = shapesState === 'error' ? 'error' : 'loading'
  } else {
    status = stationChain ? 'schematic' : directionShapeStatus(direction, shape)
    if (status !== 'unmapped' && shape) {
      const split = line.mode === 'bus' ? splitAtArtifacts(shape) : { parts: [shape], cut: 0 }
      parts = split.parts
      truncated = split.cut > 0
    }
  }
  // Déduit ou schématique : tirets sans liseré, jamais l'aspect d'une voie relevée.
  const deduced = status === 'deduced' || status === 'schematic'
  return {
    line,
    dir,
    destination: directionDestination(line, dir, locale),
    color,
    lines: {
      type: 'FeatureCollection',
      features: parts.map((coordinates) => ({ type: 'Feature', geometry: { type: 'LineString', coordinates }, properties: { color, deduced } })),
    },
    stops: {
      type: 'FeatureCollection',
      features: stopCoords.map((coordinates) => ({ type: 'Feature', geometry: { type: 'Point', coordinates }, properties: {} })),
    },
    bounds: boundsOf([...stopCoords, ...parts.flat()]),
    status,
    truncated,
  }
}

/**
 * « Autre sens » : le sens qui fait le trajet INVERSE (départ = terminus de
 * l'actuel, terminus = son départ). Le M1 a 4 sens sur 2 branches : passer au
 * suivant basculait sur l'autre branche. À défaut d'inverse exact (boucle,
 * sens unique), le sens suivant.
 */
function oppositeDirectionIndex(line: TransitLine, dir: number): number {
  const n = line.directions.length
  if (n < 2) return dir
  const stops = line.directions[dir]?.stops ?? []
  const first = stops[0]
  const last = stops[stops.length - 1]
  if (first && last) {
    const same = (a: { id?: string; name: string }, b: { id?: string; name: string }) =>
      (a.id && b.id ? a.id === b.id : a.name === b.name)
    for (let j = 0; j < n; j += 1) {
      if (j === dir) continue
      const other = line.directions[j].stops
      if (other.length === 0) continue
      if (same(other[0], last) && same(other[other.length - 1], first)) return j
    }
  }
  return (dir + 1) % n
}

function focusNotes(model: FocusModel, translate: (key: TranslationKey) => string): { key: string; text: string }[] {
  const notes: { key: string; text: string }[] = []
  if (model.status === 'loading') notes.push({ key: 'loading', text: translate('map_shapesLoading') })
  if (model.status === 'error') notes.push({ key: 'error', text: translate('map_shapesError') })
  if (model.status === 'unmapped') notes.push({ key: 'unmapped', text: translate('map_lineUnmapped') })
  if (model.status === 'deduced') notes.push({ key: 'deduced', text: translate('map_lineDeduced') })
  if (model.status === 'schematic') notes.push({ key: 'schematic', text: translate('map_lineSchematic') })
  if (model.truncated) notes.push({ key: 'truncated', text: translate('map_lineTruncated') })
  // Un seul sens dans les données : le dire, ne pas laisser croire à un retour.
  if (model.line.oneDirection && model.line.directions.length === 1) {
    const stops = model.line.directions[0].stops
    notes.push({
      key: 'oneDirection',
      text: translate('data_oneDirection').replace('{from}', stops[0]?.name ?? '').replace('{to}', stops[stops.length - 1]?.name ?? ''),
    })
  }
  return notes
}

// ── Couches ──────────────────────────────────────────────────────────────────

function addTransitLayers(map: maplibregl.Map, before: string | undefined, palette: MapPalette) {
  const add = (layer: maplibregl.AddLayerObject) => map.addLayer(layer, before)
  const hidden = { visibility: 'none' as const }
  const round = { 'line-join': 'round' as const, 'line-cap': 'round' as const }

  // Réseau bus : une LineString par direction (tracés chargés à la demande).
  map.addSource('bus-lines', { type: 'geojson', data: EMPTY_FC })
  add({
    id: 'bus-casing', type: 'line', source: 'bus-lines', layout: { ...round, ...hidden },
    filter: ['!', ['get', 'deduced']],
    paint: { 'line-color': palette.casing, 'line-width': WIDTH.netCasing, 'line-opacity': 0.9 },
  })
  add({
    id: 'bus-fill', type: 'line', source: 'bus-lines', layout: { ...round, ...hidden },
    filter: ['!', ['get', 'deduced']],
    paint: { 'line-color': ['get', 'color'], 'line-width': WIDTH.netFill },
  })
  // Tracé déduit de la voirie : tirets, sans liseré — visuellement distinct
  // d'une voie relevée.
  add({
    id: 'bus-fill-deduced', type: 'line', source: 'bus-lines', layout: { 'line-join': 'round', ...hidden },
    filter: ['get', 'deduced'],
    paint: { 'line-color': ['get', 'color'], 'line-width': WIDTH.netFill, 'line-dasharray': [2, 1.5] },
  })

  map.addSource('metro-line', { type: 'geojson', data: metroLineGeoJSON as Feature })
  add({ id: 'metro-casing', type: 'line', source: 'metro-line', layout: { ...round, ...hidden }, paint: { 'line-color': palette.casing, 'line-width': WIDTH.railCasing, 'line-opacity': 0.95 } })
  add({ id: 'metro-fill', type: 'line', source: 'metro-line', layout: { ...round, ...hidden }, paint: { 'line-color': lineDisplayColor(METRO_COLOR, palette.dark), 'line-width': WIDTH.railFill } })

  map.addSource('tram-line', { type: 'geojson', data: tramLineGeoJSON as Feature })
  add({ id: 'tram-casing', type: 'line', source: 'tram-line', layout: { ...round, ...hidden }, paint: { 'line-color': palette.casing, 'line-width': WIDTH.railCasing, 'line-opacity': 0.95 } })
  add({ id: 'tram-fill', type: 'line', source: 'tram-line', layout: { ...round, ...hidden }, paint: { 'line-color': lineDisplayColor(TRAM_COLOR, palette.dark), 'line-width': WIDTH.railFill } })

  // Ligne consultée (catalogue, fiche d'arrêt) : trait fort, sens fléché.
  map.addSource('focus-line', { type: 'geojson', data: EMPTY_FC })
  map.addSource('focus-stops', { type: 'geojson', data: EMPTY_FC })
  add({
    id: 'focus-casing', type: 'line', source: 'focus-line', layout: { ...round, ...hidden },
    filter: ['!', ['get', 'deduced']],
    paint: { 'line-color': palette.casing, 'line-width': WIDTH.strongCasing, 'line-opacity': 0.95 },
  })
  add({
    id: 'focus-fill', type: 'line', source: 'focus-line', layout: { ...round, ...hidden },
    filter: ['!', ['get', 'deduced']],
    paint: { 'line-color': ['get', 'color'], 'line-width': WIDTH.strongLine },
  })
  add({
    id: 'focus-fill-deduced', type: 'line', source: 'focus-line', layout: { 'line-join': 'round', ...hidden },
    filter: ['get', 'deduced'],
    paint: { 'line-color': ['get', 'color'], 'line-width': WIDTH.strongLine, 'line-dasharray': [2.2, 1.4] },
  })
  add({
    id: 'focus-arrow', type: 'symbol', source: 'focus-line', minzoom: 12,
    layout: {
      ...hidden,
      'symbol-placement': 'line',
      'symbol-spacing': 90,
      'icon-image': CHEVRON_IMAGE,
      'icon-size': WIDTH.arrow,
      'icon-rotation-alignment': 'map',
      'icon-allow-overlap': true,
      'icon-ignore-placement': true,
    },
    paint: { 'icon-opacity': 0.95 },
  })
  add({
    id: 'focus-stops', type: 'circle', source: 'focus-stops', layout: hidden,
    paint: {
      'circle-radius': ramp([10, 2.5, 14, 4, 17, 5.5]),
      'circle-color': palette.surface,
      'circle-stroke-width': ramp([10, 1.5, 14, 2.5]),
      'circle-stroke-color': '#D97706',
    },
  })

  // Cercle de précision GPS (rempli seulement quand un point arrive).
  map.addSource('user-accuracy', { type: 'geojson', data: EMPTY_FC })
  add({ id: 'user-accuracy-fill', type: 'fill', source: 'user-accuracy', paint: { 'fill-color': palette.accuracy, 'fill-opacity': 0.1 } })
  add({ id: 'user-accuracy-line', type: 'line', source: 'user-accuracy', paint: { 'line-color': palette.accuracy, 'line-opacity': 0.35, 'line-width': 1 } })
}

function railGeoJSON(line: TransitLine, fallback: Feature, shapes: LineShapes | null): Feature<Geometry> {
  const dirs = (shapes?.[line.id] ?? []).filter((s) => s && s.length >= 2)
  if (dirs.length === 0) return fallback as Feature<Geometry>
  return { type: 'Feature', geometry: { type: 'MultiLineString', coordinates: dirs }, properties: {} }
}

function lineFeature(coords: LonLat[]): Feature<LineString> {
  return { type: 'Feature', geometry: { type: 'LineString', coordinates: coords }, properties: {} }
}

function setSourceData(map: maplibregl.Map, id: string, data: Feature | FeatureCollection) {
  const source = map.getSource(id) as maplibregl.GeoJSONSource | undefined
  source?.setData(data as Parameters<maplibregl.GeoJSONSource['setData']>[0])
}

function setPaintSafe(map: maplibregl.Map, id: string, prop: string, value: unknown) {
  if (map.getLayer(id)) map.setPaintProperty(id, prop, value)
}

function setFilterSafe(map: maplibregl.Map, id: string, filter: maplibregl.ExpressionSpecification) {
  if (map.getLayer(id)) map.setFilter(id, filter as maplibregl.FilterSpecification)
}

function setLayerVisibility(map: maplibregl.Map, layerIds: string[], visible: boolean) {
  const visibility = visible ? 'visible' : 'none'
  layerIds.forEach((id) => {
    if (map.getLayer(id) && map.getLayoutProperty(id, 'visibility') !== visibility) map.setLayoutProperty(id, 'visibility', visibility)
  })
}

function setNetworkOpacity(map: maplibregl.Map, opacity: number) {
  ;([
    ['metro-casing', 0.95], ['metro-fill', 1], ['tram-casing', 0.95], ['tram-fill', 1],
    ['bus-casing', 0.6], ['bus-fill', 0.5], ['bus-fill-deduced', 0.5],
  ] as const).forEach(([id, base]) => setPaintSafe(map, id, 'line-opacity', base * opacity))
}

/** Retire UNIQUEMENT ce que l'effet du trajet a posé (sans sérialiser le style). */
function clearItinerary(map: maplibregl.Map, ids: { layers: string[]; sources: string[] }, markers: maplibregl.Marker[]) {
  ids.layers.forEach((id) => { if (map.getLayer(id)) map.removeLayer(id) })
  ids.sources.forEach((id) => { if (map.getSource(id)) map.removeSource(id) })
  ids.layers = []
  ids.sources = []
  markers.forEach((marker) => marker.remove())
}

// Modes, directions et lignes de bus réellement empruntés par un itinéraire.
function buildItineraryFocus(itinerary: OtpItinerary) {
  const modes = new Set<string>()
  const busKeys: string[] = []
  const busNames: string[] = []
  for (const leg of itinerary.legs) {
    if (leg.mode === 'WALK') continue
    modes.add(leg.mode)
    if (leg.mode !== 'BUS' || !leg.routeShortName) continue
    // Sens identifié par le trip_id d'OTP, sinon par la girouette (même champ
    // GTFS) : seul le sens emprunté est dessiné. Sinon, la ligne entière.
    const line = busLines.find((l) => l.shortName === leg.routeShortName)
    let dir = line ? directionIndexByTripId(line, leg.tripId) : -1
    if (line && dir < 0 && leg.headsign) dir = line.directions.findIndex((d) => d.headsign === leg.headsign)
    if (line && dir >= 0) busKeys.push(`${line.id}|${dir}`)
    else busNames.push(leg.routeShortName)
  }
  return { modes, busKeys, busNames }
}

function defaultFitPadding(): MapPadding {
  return window.innerWidth < 768
    ? { top: 140, bottom: 180, left: 40, right: 40 }
    : { top: 60, bottom: 60, left: 340, right: 60 }
}

// ── Marqueurs DOM ────────────────────────────────────────────────────────────

function labelMarker(el: HTMLElement, label?: string) {
  // MapLibre pose un « Map marker » anglais générique : on le remplace par un
  // libellé utile, ou on masque un repère purement décoratif.
  if (label) {
    el.setAttribute('role', 'img')
    el.setAttribute('aria-label', label)
  } else {
    el.removeAttribute('aria-label')
    el.setAttribute('aria-hidden', 'true')
  }
}

function withLabelOnAdd(marker: maplibregl.Marker, label?: string): maplibregl.Marker {
  const addTo = marker.addTo.bind(marker)
  marker.addTo = (map: maplibregl.Map) => {
    addTo(map)
    labelMarker(marker.getElement(), label)
    return marker
  }
  return marker
}

// Navigation (planche 1i) : départ = point bleu, arrivée = carré 12px r3.
// Consultation (handoff « Itinéraire Alger », variante 'route') : départ rond
// bleu r8 bordé de blanc 3 px, arrivée carré 16 px r4 bordé de blanc 3 px.
function makeEndpointMarker(coords: [number, number], color: string, shape: 'circle' | 'square', palette: MapPalette, label: string, variant: 'nav' | 'route' = 'nav') {
  const el = document.createElement('div')
  if (variant === 'route') {
    const size = shape === 'square' ? 22 : 19
    el.style.cssText = `width:${size}px;height:${size}px;border-radius:${shape === 'square' ? '4px' : '50%'};`
      + `background:${color};border:3px solid ${palette.surface};`
      + `${shape === 'square' ? 'box-shadow:0 1px 4px rgba(0,0,0,.3);' : 'box-shadow:0 1px 3px rgba(0,0,0,.18);'}z-index:3`
  } else {
    const size = shape === 'square' ? 14.5 : 18
    el.style.cssText = `width:${size}px;height:${size}px;border-radius:${shape === 'square' ? '4.25px' : '50%'};`
      + `background:${color};border:2.5px solid ${palette.surface};box-shadow:0 1px 4px rgba(16,24,40,0.3);z-index:2`
  }
  return withLabelOnAdd(new maplibregl.Marker({ element: el, anchor: 'center' }).setLngLat(coords), label)
}

// 'flat' (consultation, handoff) : cercle blanc r6 bordé 3 px, sans ombre.
function makeStopMarker(coords: [number, number], color: string, size: number, palette: MapPalette, label?: string, variant: 'nav' | 'flat' = 'nav') {
  const el = document.createElement('div')
  el.style.cssText = `width:${size}px;height:${size}px;border-radius:50%;background:${palette.surface};`
    + `border:${size >= 15 ? 3 : 2.5}px solid ${color};${variant === 'flat' ? '' : 'box-shadow:0 1px 4px rgba(0,0,0,0.25);'}z-index:2`
  return { marker: withLabelOnAdd(new maplibregl.Marker({ element: el, anchor: 'center' }).setLngLat(coords), label), el }
}

// Étiquette « pill » de la planche 1i (h22, radius 7, ombre douce).
function makePillMarker(coords: [number, number], text: string, weight: 500 | 600, palette: MapPalette): maplibregl.Marker {
  const el = document.createElement('div')
  el.textContent = text
  el.style.cssText = `height:22px;padding:0 9px;background:${palette.surface};border-radius:7px;`
    + `box-shadow:0 1px 2px rgba(16,24,40,.05),0 4px 14px rgba(16,24,40,.07);`
    + `font:${weight} 11px Inter,'Noto Sans Arabic',system-ui,sans-serif;color:${palette.dark ? '#E5E7EB' : '#111827'};`
    + `display:inline-flex;align-items:center;white-space:nowrap;z-index:3`
  // Texte visible : le marqueur n'a pas besoin d'un second libellé.
  return withLabelOnAdd(new maplibregl.Marker({ element: el, anchor: 'bottom', offset: [0, -14] }).setLngLat(coords))
}

// Puck utilisateur façon Apple Plans : halo + point bleu + cône d'orientation.
// Deux gabarits : consultation (halo r13, point r7) et navigation (halo r24,
// point r10, liseré blanc 3.5). Mis à jour en place à chaque position.
function makeUserPuck(nav: boolean) {
  const box = nav ? 48 : 26
  const dotSize = nav ? 23.5 : 14
  const ring = nav ? 3.5 : 2.5
  const haloOpacity = nav ? 0.12 : 0.14
  const half = box / 2
  const el = document.createElement('div')
  el.style.zIndex = '4'
  el.innerHTML = `
    <div style="position:relative;width:${box}px;height:${box}px">
      <div data-halo style="position:absolute;inset:0;border-radius:50%;background:#1D6FE0;opacity:${haloOpacity}"></div>
      <svg data-cone width="${box}" height="${box}" viewBox="0 0 ${box} ${box}" style="position:absolute;inset:0;display:none;transform-origin:${half}px ${half}px;overflow:visible">
        <defs>
          <linearGradient id="user-cone-grad-${nav ? 'n' : 'c'}" x1="${half}" y1="${half}" x2="${half}" y2="${half - 74}" gradientUnits="userSpaceOnUse">
            <stop offset="0" stop-color="#1D6FE0" stop-opacity="0.32"/>
            <stop offset="1" stop-color="#1D6FE0" stop-opacity="0"/>
          </linearGradient>
        </defs>
        <polygon points="${half},${half} ${half - 25},${half - 74} ${half + 25},${half - 74}" fill="url(#user-cone-grad-${nav ? 'n' : 'c'})"/>
      </svg>
      <div data-dot style="position:absolute;left:50%;top:50%;width:${dotSize}px;height:${dotSize}px;margin:${-dotSize / 2}px 0 0 ${-dotSize / 2}px;border-radius:50%;background:#1D6FE0;border:${ring}px solid #fff;box-shadow:0 1px 4px rgba(16,24,40,0.3)"></div>
    </div>
  `
  // rotationAlignment 'map' : le cône pivote avec la carte, donc il suffit de
  // le tourner du cap (sans soustraire le relèvement de la carte).
  const marker = new maplibregl.Marker({ element: el, anchor: 'center', rotationAlignment: 'map' })
  return {
    marker,
    dot: el.querySelector('[data-dot]') as HTMLElement,
    halo: el.querySelector('[data-halo]') as HTMLElement,
    cone: el.querySelector('[data-cone]') as HTMLElement,
  }
}

// Cercle géodésique approché (rayon en mètres) pour la zone de précision GPS.
function makeCircle(lat: number, lon: number, radiusMeters: number, points = 48): [number, number][] {
  const coords: [number, number][] = []
  const latRadius = radiusMeters / 111320
  const lonRadius = radiusMeters / (111320 * Math.cos((lat * Math.PI) / 180))
  for (let index = 0; index <= points; index += 1) {
    const angle = (index / points) * Math.PI * 2
    coords.push([lon + lonRadius * Math.cos(angle), lat + latRadius * Math.sin(angle)])
  }
  return coords
}

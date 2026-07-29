'use client'

import { useEffect, useRef, useState, useCallback } from 'react'
import type { Feature, FeatureCollection, LineString, Point } from 'geojson'
import maplibregl from 'maplibre-gl'
import {
  allStations,
  metroStations,
  tramStations,
  metroLineGeoJSON,
  tramLineGeoJSON,
  METRO_COLOR,
  TRAM_COLOR,
  allFutureStations,
  metroExtEastStations,
  metroExtSouthStations,
  getStationName,
} from '@/lib/stations'
import { busLines, metroLine, tramLine, estimatedHeadwayMin, isInService, lineStopName } from '@/lib/lines'
import { getStopBadges, selectVisibleBadges, createBadgeElement, type StopBadge } from '@/lib/map-badges'
import { OtpItinerary, legCoordinates, getLegColor, isSchematicLeg, Coordinate } from '@/lib/otp'
import { useTranslation } from '@/hooks/useTranslation'
import { translations, type Locale, type TranslationKey } from '@/lib/i18n'

const TILE_URL = process.env.NEXT_PUBLIC_TILE_URL ?? 'https://tiles.openfreemap.org/styles/positron'
const ALGIERS_CENTER: [number, number] = [3.085, 36.745]

interface MapViewProps {
  itinerary?: OtpItinerary | null
  onMapClick?: (coord: Coordinate) => void
  clickMode?: 'from' | 'to' | null
  hideControls?: boolean
  // Mode navigation (planche 1i) : tracé parcouru grisé, arrêts intermédiaires,
  // pas de marqueur de départ (la position utilisateur le remplace).
  navigating?: boolean
  // Progression calculée par le parent (source unique) : index du tronçon en
  // cours et fraction parcourue de ce tronçon. Recalculer ici ferait diverger
  // la carte du bandeau de navigation.
  navLegIndex?: number
  navLegProgress?: number
  // Position fournie par le parent (source unique partagée avec le calcul de
  // progression). La carte ne suit plus la position de son côté.
  userPosition?: { lon: number; lat: number; accuracy: number; heading: number | null } | null
  /** Demande au parent d'activer le suivi de position (bouton localiser). */
  onRequestPosition?: () => void
  /** Erreur de position remontée par le parent, pour l'expliquer sur la carte. */
  positionError?: 'insecure' | 'denied' | 'unavailable' | 'unsupported' | null
  // false quand l'onglet Carte n'est pas au premier plan : la fiche se ferme.
  mapActive?: boolean
  // Incrémenté par le parent pour recentrer la carte sur l'utilisateur
  // (ouverture de l'onglet Carte).
  autoLocateSignal?: number
}

interface SelectedStation {
  id: string
  /** Identifiant du marqueur badge correspondant (agrandi en épingle). */
  badgeId?: string
  kind: 'station' | 'future' | 'bus'
  mode: 'metro' | 'tram' | 'bus'
  coords: [number, number]
  name?: string
  openingYear?: number
  busLineRefs?: string[]
}

export default function MapView({ itinerary, onMapClick, clickMode, hideControls, navigating, navLegIndex = 0, navLegProgress = 0, userPosition, onRequestPosition, positionError, mapActive = true, autoLocateSignal }: MapViewProps) {
  const { t, locale } = useTranslation()
  const mapContainerRef = useRef<HTMLDivElement>(null)
  const sheetRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<maplibregl.Map | null>(null)
  const markersRef = useRef<maplibregl.Marker[]>([])
  const userMarkerRef = useRef<maplibregl.Marker | null>(null)
  const userConeRef = useRef<HTMLElement | null>(null)
  const watchIdRef = useRef<number | null>(null)
  const followingRef = useRef(false)
  // Vrai dès que nos couches sont posées. `map.isStyleLoaded()` repasse à false
  // pendant le chargement de tuiles : s'y fier menait à un `once('load')` sur
  // un événement déjà émis, donc à des mises à jour jamais appliquées.
  const layersReadyRef = useRef(false)
  const pendingRef = useRef<Array<() => void>>([])
  // Le puck change de gabarit entre consultation et navigation ; la ref permet
  // au callback de marqueur (mémoïsé) de connaître le mode courant.
  const navigatingRef = useRef(false)
  const localeRef = useRef(locale)
  const clickModeRef = useRef(clickMode)
  const [zoom, setZoom] = useState(12)
  const [following, setFollowing] = useState(false)

  // Exécute une mise à jour de couches dès que la carte est prête (et rejoue
  // celles demandées trop tôt).
  const whenReady = useCallback((fn: () => void) => {
    if (layersReadyRef.current && mapRef.current) fn()
    else pendingRef.current.push(fn)
  }, [])
  const [showMetro, setShowMetro] = useState(true)
  const [showTram, setShowTram] = useState(true)
  const [selectedStation, setSelectedStation] = useState<SelectedStation | null>(null)

  useEffect(() => {
    localeRef.current = locale
  }, [locale])

  useEffect(() => {
    clickModeRef.current = clickMode
  }, [clickMode])

  useEffect(() => {
    if (clickMode) setSelectedStation(null)
  }, [clickMode])

  useEffect(() => {
    if (!mapActive) setSelectedStation(null)
  }, [mapActive])

  // Feuille basse : elle prend le focus à l'ouverture et Échap la referme.
  // Sans cela, le clavier ne peut ni la lire ni en sortir — la seule fermeture
  // était un clic sur la carte.
  useEffect(() => {
    if (!selectedStation) return
    sheetRef.current?.focus()
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      setSelectedStation(null)
      mapRef.current?.getCanvas().focus()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [selectedStation])

  // Le gabarit du puck dépend du mode : on le reconstruit au changement.
  useEffect(() => {
    navigatingRef.current = Boolean(navigating)
    userMarkerRef.current?.remove()
    userMarkerRef.current = null
    userConeRef.current = null
  }, [navigating])

  useEffect(() => {
    if (!selectedStation) return
    if (selectedStation.mode === 'metro' && !showMetro && selectedStation.kind === 'station') setSelectedStation(null)
    else if (selectedStation.mode === 'tram' && !showTram) setSelectedStation(null)
  }, [selectedStation, showMetro, showTram])

  // Puck utilisateur façon Apple Plans : halo fixe + point bleu + cône
  // d'orientation. Toujours visible dès qu'un fix existe — l'utilisateur
  // sait constamment où il est.
  const ensureUserMarker = useCallback((map: maplibregl.Map, lngLat: [number, number], accuracyM?: number) => {
    // Cercle de précision réel du GPS (rayon en mètres → pixels au zoom
    // courant) : il montre que la position est mesurée, pas supposée.
    const accuracySource = map.getSource('user-accuracy') as maplibregl.GeoJSONSource | undefined
    if (accuracySource && accuracyM) {
      accuracySource.setData({
        type: 'FeatureCollection',
        features: [{
          type: 'Feature',
          geometry: { type: 'Polygon', coordinates: [makeCircle(lngLat[1], lngLat[0], accuracyM)] },
          properties: {},
        }],
      })
    }

    if (!userMarkerRef.current) {
      // Deux gabarits : consultation (planche 1e — halo r13, point r7) et
      // navigation (planche 1i — halo r24, point r10, liseré blanc 3.5).
      const nav = navigatingRef.current
      const box = nav ? 48 : 26
      const dot = nav ? 23.5 : 14
      const ring = nav ? 3.5 : 2.5
      const haloOpacity = nav ? 0.12 : 0.14
      const half = box / 2
      const el = document.createElement('div')
      el.innerHTML = `
        <div style="position:relative;width:${box}px;height:${box}px">
          <div style="position:absolute;inset:0;border-radius:50%;background:#1D6FE0;opacity:${haloOpacity}"></div>
          <svg data-cone width="${box}" height="${box}" viewBox="0 0 ${box} ${box}" style="position:absolute;inset:0;display:none;transform-origin:${half}px ${half}px;overflow:visible">
            <defs>
              <linearGradient id="user-cone-grad" x1="${half}" y1="${half}" x2="${half}" y2="${half - 74}" gradientUnits="userSpaceOnUse">
                <stop offset="0" stop-color="#1D6FE0" stop-opacity="0.32"/>
                <stop offset="1" stop-color="#1D6FE0" stop-opacity="0"/>
              </linearGradient>
            </defs>
            <polygon points="${half},${half} ${half - 25},${half - 74} ${half + 25},${half - 74}" fill="url(#user-cone-grad)"/>
          </svg>
          <div style="position:absolute;left:50%;top:50%;width:${dot}px;height:${dot}px;margin:${-dot / 2}px 0 0 ${-dot / 2}px;border-radius:50%;background:#1D6FE0;border:${ring}px solid #fff;box-shadow:0 1px 4px rgba(16,24,40,0.3)"></div>
        </div>
      `
      userConeRef.current = el.querySelector('[data-cone]')
      userMarkerRef.current = new maplibregl.Marker({ element: el, anchor: 'center', rotationAlignment: 'map' })
        .setLngLat(lngLat)
        .addTo(map)
    } else {
      userMarkerRef.current.setLngLat(lngLat)
    }
  }, [])

  // La position arrive du parent (source unique) : la carte se contente de la
  // dessiner et, en mode suivi, de recentrer dessus.
  useEffect(() => {
    const map = mapRef.current
    if (!map || !userPosition) return
    const lngLat: [number, number] = [userPosition.lon, userPosition.lat]
    whenReady(() => {
      ensureUserMarker(map, lngLat, userPosition.accuracy)
      if (followingRef.current) {
        map.easeTo({ center: lngLat, zoom: Math.max(map.getZoom(), 15), duration: 800 })
      }
    })
  }, [userPosition, ensureUserMarker, whenReady])

  // Cône d'orientation : suit la boussole quand l'appareil l'expose.
  useEffect(() => {
    const onOrient = (event: DeviceOrientationEvent) => {
      const cone = userConeRef.current
      if (!cone) return
      const webkitHeading = (event as DeviceOrientationEvent & { webkitCompassHeading?: number }).webkitCompassHeading
      const heading = webkitHeading ?? (event.alpha !== null ? 360 - event.alpha : null)
      if (heading === null) return
      cone.style.display = 'block'
      cone.style.transform = `rotate(${heading}deg)`
    }
    window.addEventListener('deviceorientation', onOrient)
    return () => window.removeEventListener('deviceorientation', onOrient)
  }, [])

  useEffect(() => {
    if (!mapContainerRef.current || mapRef.current) return

    const map = new maplibregl.Map({
      container: mapContainerRef.current,
      style: TILE_URL,
      center: ALGIERS_CENTER,
      zoom: 12,
      minZoom: 10,
      maxZoom: 18,
      attributionControl: { compact: true },
      antialias: true,
    })

    mapRef.current = map

    map.on('zoom', () => setZoom(map.getZoom()))
    // Toute manipulation manuelle de la carte sort du mode suivi.
    map.on('dragstart', () => { followingRef.current = false; setFollowing(false) })
    map.on('load', () => {
      applyBaseMapTheme(map)
      addTransitLayers(
        map,
        () => localeRef.current,
        () => Boolean(clickModeRef.current),
        (station) => setSelectedStation(station),
      )
      layersReadyRef.current = true
      pendingRef.current.forEach((fn) => fn())
      pendingRef.current = []
    })

    return () => {
      if (watchIdRef.current !== null) {
        navigator.geolocation.clearWatch(watchIdRef.current)
        watchIdRef.current = null
      }
      markersRef.current.forEach((marker) => marker.remove())
      userMarkerRef.current?.remove()
      userMarkerRef.current = null
      layersReadyRef.current = false
      pendingRef.current = []
      map.remove()
      mapRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    const map = mapRef.current
    if (!map) return

    whenReady(() => {
      updateStationSourceData(map, locale)
    })
  }, [locale, whenReady])

  useEffect(() => {
    const map = mapRef.current
    if (!map) return

    // Couleurs de mode du design system : bus = ambre #D97706 (avant, un leg
    // BUS tombait dans un gris de repli).
    const legColor = (mode: OtpItinerary['legs'][number]['mode']) => getLegColor(mode)

    whenReady(() => {
      clearItineraryLayers(map)
      removeItineraryMarkers(markersRef.current)
      markersRef.current = []

      if (!itinerary) return

      const lastWalkIdx = itinerary.legs.reduce(
        (acc, l, i) => (l.mode === 'WALK' ? i : acc), -1,
      )
      // Étape courante : fournie par le parent, jamais recalculée ici.
      const currentIdx = Math.min(navLegIndex, itinerary.legs.length - 1)

      itinerary.legs.forEach((leg, index) => {
        const coords = legCoordinates(leg)
        const isWalk = leg.mode === 'WALK'
        // Tracé non relevé : sans shape dans le GTFS, OTP relie les arrêts en
        // ligne droite. Sur la ligne 113 cela faisait traverser la BAIE
        // d'Alger. Un trait plein affirmerait un itinéraire qu'on ne connaît
        // pas — on le dessine donc en pointillé, le langage universel de la
        // liaison schématique, et on le dit en toutes lettres à l'usager.
        const schematic = isSchematicLeg(leg)
        const isPast = Boolean(navigating) && index < currentIdx
        const isFinalWalk = isWalk && index === lastWalkIdx && index === itinerary.legs.length - 1
        const color = legColor(leg.mode)
        const sourceId = `itin-src-${index}`
        const data: Feature<LineString> = {
          type: 'Feature',
          geometry: { type: 'LineString', coordinates: coords },
          properties: {},
        }

        ;[`itin-cas-${index}`, `itin-line-${index}`, `itin-done-${index}`].forEach((id) => {
          if (map.getLayer(id)) map.removeLayer(id)
        })
        ;[sourceId, `${sourceId}-done`].forEach((id) => {
          if (map.getSource(id)) map.removeSource(id)
        })

        // La source garde TOUJOURS la géométrie complète : le liseré blanc et
        // le trait de base s'appuient dessus.
        map.addSource(sourceId, { type: 'geojson', data })

        // Casing blanc (9 px) sur toute la longueur du tronçon (planche 1i).
        // Pas de liseré sous un tracé schématique : le liseré donne au trait
        // l'aspect « voie tracée » qu'on cherche justement à ne pas suggérer.
        if (!isWalk && !schematic) {
          map.addLayer({
            id: `itin-cas-${index}`,
            type: 'line',
            source: sourceId,
            layout: { 'line-join': 'round', 'line-cap': 'round' },
            paint: { 'line-color': '#FFFFFF', 'line-width': 9, 'line-opacity': 0.95 },
          })
        }

        // Trait de base : couleur de la ligne (gris si le tronçon est derrière
        // nous). Il court sur toute la longueur — ce qui est devant l'usager
        // reste donc coloré.
        map.addLayer({
          id: `itin-line-${index}`,
          type: 'line',
          source: sourceId,
          layout: { 'line-join': 'round', 'line-cap': 'round' },
          paint: {
            'line-color': isWalk
              ? (isFinalWalk && navigating ? '#6B7280' : '#9CA3AF')
              : (isPast ? '#9CA3AF' : color),
            'line-width': isWalk ? 3 : 4.5,
            'line-opacity': 1,
            // 2 px de trait / 7 px de vide à line-width 3 (planche 1i).
            ...(isWalk && { 'line-dasharray': [0.667, 2.333] }),
            // Tracé non relevé : tirets larges, distincts des petits pointillés
            // de la marche — on ne prétend pas connaître le chemin emprunté.
            ...(schematic && { 'line-dasharray': [1.2, 0.9] }),
          },
        })

        // Tronçon EN COURS : on repose par-dessus, en gris, la seule portion
        // déjà parcourue. Le reste du trait — devant l'usager — garde la
        // couleur de la ligne (planche 1i : la coupure est à sa position).
        const isCurrent = Boolean(navigating) && index === currentIdx && !isWalk
        if (isCurrent) {
          const { done } = splitPolylineAt(coords, navLegProgress)

          if (done.length > 1) {
            map.addSource(`${sourceId}-done`, {
              type: 'geojson',
              data: { type: 'Feature', geometry: { type: 'LineString', coordinates: done }, properties: {} },
            })
            map.addLayer({
              id: `itin-done-${index}`,
              type: 'line',
              source: `${sourceId}-done`,
              layout: { 'line-join': 'round', 'line-cap': 'round' },
              paint: { 'line-color': '#9CA3AF', 'line-width': 4.5 },
            })
          }
        }

        if (!isWalk) {
          const edgeColor = isPast ? '#9CA3AF' : color
          markersRef.current.push(
            makeStopMarker([leg.from.lon, leg.from.lat], edgeColor).addTo(map),
          )
          // Descente du leg courant : cercle agrandi (planche 1i, r6 stroke 3).
          const isCurrentAlight = Boolean(navigating) && index === currentIdx
          markersRef.current.push(
            makeStopMarker([leg.to.lon, leg.to.lat], edgeColor, isCurrentAlight ? 15 : 12).addTo(map),
          )
          // Stations intermédiaires : grises une fois dépassées. Sur le
          // tronçon en cours, le repère est la fraction parcourue ; sur les
          // tronçons passés/à venir, tout est gris/coloré en bloc.
          if (navigating && leg.intermediateStops) {
            const count = leg.intermediateStops.length
            leg.intermediateStops.forEach((s, si) => {
              const share = (si + 1) / (count + 1)
              const passed = isPast || (isCurrent && share < navLegProgress)
              markersRef.current.push(
                makeStopMarker([s.lon, s.lat], passed ? '#9CA3AF' : color).addTo(map),
              )
            })
          }
        }
      })

      const firstLeg = itinerary.legs[0]
      const lastLeg = itinerary.legs[itinerary.legs.length - 1]

      // En navigation, la position utilisateur remplace le marqueur de départ.
      if (!navigating) {
        markersRef.current.push(
          makeEndpointMarker([firstLeg.from.lon, firstLeg.from.lat], '#1D6FE0', 'circle').addTo(map),
        )
      }
      markersRef.current.push(
        makeEndpointMarker([lastLeg.to.lon, lastLeg.to.lat], '#111827', 'square').addTo(map),
      )

      // Étiquettes de fin de trajet (planche 1i) : l'arrêt où descendre, puis
      // la destination en gras. Uniquement en navigation.
      if (navigating) {
        const alightLeg = itinerary.legs[currentIdx]
        // L'arrêt de descente n'a son étiquette que s'il diffère de la
        // destination — sinon deux pills identiques se superposaient.
        const alightName = alightLeg && alightLeg.mode !== 'WALK' ? alightLeg.to.name : null
        if (alightName && alightName !== lastLeg.to.name) {
          markersRef.current.push(
            makePillMarker([alightLeg.to.lon, alightLeg.to.lat], alightName, 500).addTo(map),
          )
        }
        markersRef.current.push(
          makePillMarker([lastLeg.to.lon, lastLeg.to.lat], lastLeg.to.name, 600).addTo(map),
        )
      }

      // Cadrage sur le trajet entier UNIQUEMENT hors navigation : en
      // navigation la caméra appartient au suivi de position, et ce fitBounds
      // se relançait à chaque tick de 30 s en annulant le suivi.
      const allCoords = itinerary.legs.flatMap((leg) => legCoordinates(leg))
      if (!navigating && allCoords.length > 0) {
        const bounds = allCoords.reduce(
          (value, coord) => value.extend(coord as [number, number]),
          new maplibregl.LngLatBounds(
            allCoords[0] as [number, number],
            allCoords[0] as [number, number],
          ),
        )
        const isMobile = window.innerWidth < 768
        map.fitBounds(bounds, {
          padding: isMobile
            ? { top: 140, bottom: 180, left: 40, right: 40 }
            : { top: 60, bottom: 60, left: 340, right: 60 },
          animate: true,
          duration: 900,
        })
      }
    })
  }, [itinerary, navigating, navLegIndex, navLegProgress, whenReady])

  useEffect(() => {
    const map = mapRef.current
    if (!map) return

    whenReady(() => {
      const NETWORK_LAYERS = [
        'metro-casing', 'metro-fill', 'tram-casing', 'tram-fill', 'bus-casing', 'bus-fill',
        'metro-ext-east-line', 'metro-ext-south-line', 'direction-label',
      ]

      // En NAVIGATION (planche 1i), la carte ne porte plus que le trajet :
      // aucune ligne de réseau, aucune étiquette de direction. Les seuls textes
      // sont les deux pills de fin.
      if (navigating) {
        setLayerVisibility(map, [...NETWORK_LAYERS, 'user-accuracy-fill'], false)
        return
      }
      setLayerVisibility(map, ['user-accuracy-fill'], true)

      // Spec carte v2 : un tracé n'apparaît QUE sur un trajet lancé. La vue par
      // défaut (« autour de moi ») ne montre aucune polyligne : le réseau
      // entier superposé au niveau quartier était illisible.
      const focus = itinerary ? buildItineraryFocus(itinerary) : null

      if (!focus) {
        setLayerVisibility(map, NETWORK_LAYERS, false)
        return
      }

      // Trajet consulté : seuls les modes ET les lignes de bus réellement
      // empruntés restent affichés, en retrait sous le tracé du trajet.
      setLayerVisibility(map, ['metro-casing', 'metro-fill'], focus.modes.has('SUBWAY'))
      setLayerVisibility(map, ['tram-casing', 'tram-fill'], focus.modes.has('TRAM'))
      setLayerVisibility(map, ['bus-casing', 'bus-fill'], focus.modes.has('BUS'))
      setLayerVisibility(map, ['metro-ext-east-line', 'metro-ext-south-line', 'direction-label'], false)

      const busFilter = focus.busRefs.size > 0
        ? (['in', ['get', 'name'], ['literal', Array.from(focus.busRefs)]] as unknown as maplibregl.FilterSpecification)
        : null
      ;['bus-casing', 'bus-fill'].forEach((id) => {
        if (map.getLayer(id)) map.setFilter(id, busFilter)
      })

      setBackgroundLinesOpacity(map, 0.45)
    })
  }, [showMetro, showTram, itinerary, navigating, whenReady])

  // ── Badges d'arrêts (spec carte v2) ────────────────────────────────────────
  // Les arrêts sont des marqueurs DOM et non des cercles : un arrêt porte le
  // badge de sa ligne (« M1 », « 15 · 16 »), impossible à confondre avec le
  // disque bleu plein de la position utilisateur. On ne pose que ce qui est
  // dans la vue, avec une hiérarchie par zoom — jamais de clusters chiffrés.
  const badgeMarkersRef = useRef<Map<string, maplibregl.Marker>>(new Map())
  const selectedIdRef = useRef<string | null>(null)
  selectedIdRef.current = selectedStation?.badgeId ?? null
  const showMetroRef = useRef(showMetro)
  const showTramRef = useRef(showTram)
  showMetroRef.current = showMetro
  showTramRef.current = showTram

  const onSelectBadge = useCallback((badge: StopBadge) => {
    const map = mapRef.current
    setSelectedStation({
      // `id` sert de clé métier (recherche de la station) ; `badgeId` identifie
      // le marqueur à agrandir.
      id: badge.stationId ?? badge.id,
      badgeId: badge.id,
      kind: badge.mode === 'bus' ? 'bus' : 'station',
      mode: badge.mode,
      coords: [badge.lon, badge.lat],
      name: badge.name,
      busLineRefs: badge.mode === 'bus' ? badge.lines : undefined,
    })
    if (map) focusMapOnSelection(map, [badge.lon, badge.lat])
  }, [])

  /** Pose/retire les marqueurs pour coller exactement à `visible`. */
  const renderBadges = useCallback((
    map: maplibregl.Map,
    markers: Map<string, maplibregl.Marker>,
    visible: StopBadge[],
  ) => {
    const keep = new Set<string>()
    visible.forEach((badge) => {
      keep.add(badge.id)
      const selected = selectedIdRef.current === badge.id
      const existing = markers.get(badge.id)
      // Un badge sélectionné change de gabarit : on le recrée plutôt que de
      // muter son DOM, l'élément étant produit d'un bloc par createBadgeElement.
      if (existing && existing.getElement().dataset.selected === String(selected)) return
      existing?.remove()

      const element = createBadgeElement(badge, selected)
      element.dataset.selected = String(selected)
      element.addEventListener('click', (event) => {
        event.stopPropagation()
        onSelectBadge(badge)
      })
      element.addEventListener('keydown', (event) => {
        if (event.key !== 'Enter' && event.key !== ' ') return
        event.preventDefault()
        onSelectBadge(badge)
      })

      const marker = new maplibregl.Marker({ element, anchor: selected ? 'bottom' : 'center' })
        .setLngLat([badge.lon, badge.lat])
        .addTo(map)
      // MapLibre écrase l'aria-label de l'élément fourni par un « Map marker »
      // générique et anglais : un lecteur d'écran annoncerait 70 fois la même
      // chose. On le repose APRÈS addTo, sinon il est perdu.
      element.setAttribute('aria-label', element.dataset.label ?? '')
      markers.set(badge.id, marker)
    })

    markers.forEach((marker, id) => {
      if (keep.has(id)) return
      marker.remove()
      markers.delete(id)
    })
  }, [onSelectBadge])

  const syncBadges = useCallback(() => {
    const map = mapRef.current
    if (!map) return

    const markers = badgeMarkersRef.current

    // En navigation la carte ne porte que le trajet : aucun badge de réseau.
    if (navigatingRef.current) {
      markers.forEach((marker) => marker.remove())
      markers.clear()
      return
    }

    const bounds = map.getBounds()
    const zoom = map.getZoom()
    const box = {
      west: bounds.getWest(),
      south: bounds.getSouth(),
      east: bounds.getEast(),
      north: bounds.getNorth(),
    }

    // Les bascules Métro/Tram filtrent les badges : sans tracés à masquer,
    // elles n'auraient plus aucun effet visible.
    const all = getStopBadges(locale).filter((badge) =>
      badge.mode === 'metro' ? showMetroRef.current
        : badge.mode === 'tram' ? showTramRef.current
          : true,
    )
    renderBadges(map, markers, selectVisibleBadges(all, box, zoom))
  }, [locale, renderBadges])

  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    whenReady(syncBadges)
    map.on('moveend', syncBadges)
    return () => { map.off('moveend', syncBadges) }
  }, [syncBadges, whenReady, navigating, selectedStation, showMetro, showTram])

  useEffect(() => {
    const markers = badgeMarkersRef.current
    return () => {
      markers.forEach((marker) => marker.remove())
      markers.clear()
    }
  }, [])

  useEffect(() => {
    const map = mapRef.current
    if (!map || !clickMode || !onMapClick) {
      if (mapRef.current) mapRef.current.getCanvas().style.cursor = ''
      return
    }

    const handleClick = async (event: maplibregl.MapMouseEvent) => {
      const { lng, lat } = event.lngLat
      const features = map.queryRenderedFeatures(event.point, { layers: ['station-dot'] })
      if (features.length > 0) {
        const props = features[0].properties as { name: string }
        const geom = features[0].geometry as Point
        const [lon2, lat2] = geom.coordinates as [number, number]
        onMapClick({ lat: lat2, lon: lon2, name: props.name })
        return
      }

      const { reverseGeocode } = await import('@/lib/geocoding')
      const name = await reverseGeocode(lat, lng)
      onMapClick({ lat, lon: lng, name })
    }

    map.on('click', handleClick)
    map.getCanvas().style.cursor = 'crosshair'

    return () => {
      map.off('click', handleClick)
      map.getCanvas().style.cursor = ''
    }
  }, [clickMode, onMapClick])

  const handleZoomIn = () => { mapRef.current?.zoomIn() }
  const handleZoomOut = () => { mapRef.current?.zoomOut() }

  const handleLocate = useCallback(() => {
    // iOS exige un geste utilisateur pour exposer la boussole.
    const orientationEvent = DeviceOrientationEvent as unknown as { requestPermission?: () => Promise<string> }
    orientationEvent.requestPermission?.().catch(() => {})
    followingRef.current = true
    setFollowing(true)
    // Le suivi de position appartient au parent : on lui demande de l'activer
    // et on recentre dès qu'un point arrive.
    onRequestPosition?.()
    const map = mapRef.current
    if (map && userPosition) {
      map.easeTo({ center: [userPosition.lon, userPosition.lat], zoom: Math.max(map.getZoom(), 15), duration: 800 })
    }
  }, [onRequestPosition, userPosition])

  // Recentrage automatique quand le parent le demande (onglet Carte ouvert).
  const lastLocateSignal = useRef(0)
  useEffect(() => {
    if (!autoLocateSignal || autoLocateSignal === lastLocateSignal.current) return
    lastLocateSignal.current = autoLocateSignal
    handleLocate()
  }, [autoLocateSignal, handleLocate])

  const userPos: [number, number] | null = userPosition ? [userPosition.lon, userPosition.lat] : null
  const sheet = selectedStation ? buildSheetModel(selectedStation, locale, userPos, t) : null

  return (
    <div ref={mapContainerRef} className="map-container">

      {/* Légende (planche 1e) : un seul pill flottant, tap = masquer un mode. */}
      {!itinerary && !hideControls && (
        <div
          className="absolute start-5 z-10 flex h-9 items-center gap-2 rounded-control bg-white px-3.5 shadow-soft"
          style={{ top: 'calc(env(safe-area-inset-top, 0px) + 14px)' }}
        >
          <button
            type="button"
            onClick={() => setShowMetro((v) => !v)}
            aria-pressed={showMetro}
            className="flex items-center gap-2 text-[12px] font-medium text-ink-600 transition-opacity"
            style={{ opacity: showMetro ? 1 : 0.35 }}
          >
            <span className="h-[3px] w-[10px] rounded-[2px]" style={{ backgroundColor: METRO_COLOR }} aria-hidden="true" />
            {t('metro')}
          </button>
          <button
            type="button"
            onClick={() => setShowTram((v) => !v)}
            aria-pressed={showTram}
            className="flex items-center gap-2 text-[12px] font-medium text-ink-600 transition-opacity"
            style={{ opacity: showTram ? 1 : 0.35 }}
          >
            <span className="h-[3px] w-[10px] rounded-[2px]" style={{ backgroundColor: TRAM_COLOR }} aria-hidden="true" />
            {t('tram')}
          </button>
        </div>
      )}

      {/* Contrôles (planche 1e) : localisation · + · − en colonne flottante */}
      {!hideControls && (
        <div
          className="absolute end-5 z-10 flex flex-col rounded-control bg-white shadow-soft"
          style={{ top: 'calc(env(safe-area-inset-top, 0px) + 14px)' }}
        >
          <button
            type="button"
            onClick={handleLocate}
            aria-label={t('myLocation')}
            className="tap flex h-11 w-11 items-center justify-center"
          >
            <svg width="19" height="19" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <circle cx="12" cy="12" r="3.5" stroke={following ? '#1D6FE0' : '#111827'} strokeWidth="1.8" />
              <path d="M12 2v4M12 18v4M2 12h4M18 12h4" stroke={following ? '#1D6FE0' : '#111827'} strokeWidth="1.8" strokeLinecap="round" />
            </svg>
          </button>
          <span className="mx-2.5 h-px bg-line" aria-hidden="true" />
          <button
            type="button"
            onClick={handleZoomIn}
            aria-label={t('zoomIn')}
            className="tap flex h-11 w-11 items-center justify-center text-[17px] font-medium text-ink-900"
          >
            +
          </button>
          <span className="mx-2.5 h-px bg-line" aria-hidden="true" />
          <button
            type="button"
            onClick={handleZoomOut}
            aria-label={t('zoomOut')}
            className="tap flex h-11 w-11 items-center justify-center text-[17px] font-medium text-ink-900"
          >
            −
          </button>
        </div>
      )}

      {/* Position indisponible : on l'explique au lieu de laisser le bouton
          sans effet (jamais de rouge — c'est un état, pas une erreur). */}
      {!hideControls && mapActive && positionError && (
        <div
          className="absolute inset-x-5 z-30"
          style={{ bottom: 'calc(54px + env(safe-area-inset-bottom, 0px) + 14px)' }}
        >
          <p role="status" className="rounded-control bg-white px-3.5 py-2.5 text-[12px] leading-[16px] text-ink-600 shadow-soft">
            {positionError === 'insecure'
              ? t('geoInsecure')
              : positionError === 'denied'
                ? t('geoDenied')
                : t('geoUnavailable')}
          </p>
        </div>
      )}

      {/* Hiérarchie par zoom : les arrêts de bus n'existent qu'en zoom serré.
          La chip reste visible au-dessus de la fiche (planche 1e). */}
      {!hideControls && !positionError && !itinerary && zoom < 13 && (
        <div
          className={`absolute start-5 ${selectedStation ? 'z-40' : 'z-10'}`}
          style={{
            bottom: selectedStation
              ? 'calc(236px + env(safe-area-inset-bottom, 0px))'
              : 'calc(54px + env(safe-area-inset-bottom, 0px) + 14px)',
          }}
        >
          <span className="inline-flex h-7 items-center rounded-control bg-white px-3 text-[11px] text-ink-600 shadow-soft">
            {t('zoomForBusStops')}
          </span>
        </div>
      )}

      {/* Fiche d'arrêt en feuille basse (planche 1e) — translateY, jamais de fondu */}
      {sheet && (
        <div
          ref={sheetRef}
          role="dialog"
          aria-modal="false"
          aria-label={sheet.title}
          tabIndex={-1}
          // Plafond + liste défilante : un arrêt desservi par beaucoup de lignes
          // empilait ses rangées jusqu'à pousser la poignée HORS de l'écran par
          // le haut (la feuille grandit vers le haut depuis l'ancrage bas).
          className="sheet-in absolute inset-x-0 bottom-0 z-30 flex max-h-[70dvh] flex-col rounded-t-sheet bg-white shadow-[0_-4px_14px_rgba(16,24,40,0.07)]"
        >
          <div className="flex shrink-0 justify-center pb-0.5 pt-2">
            <span className="h-1 w-9 rounded-[2px] bg-line" aria-hidden="true" />
          </div>
          <div className="shrink-0 px-5 pb-0.5 pt-2">
            <p className="text-title font-semibold text-ink-900">{sheet.title}</p>
            <p className="mt-0.5 text-label text-ink-400">{sheet.subtitle}</p>
          </div>
          <div className="mt-1.5 min-h-0 flex-1 overflow-y-auto">
            {sheet.rows.map((row, index) => (
              <div
                key={index}
                className={`flex items-center gap-3 px-5 py-3 ${index < sheet.rows.length - 1 ? 'border-b border-line' : ''}`}
              >
                <span
                  className="inline-flex h-[26px] min-w-[36px] items-center justify-center rounded-[8px] px-2 text-[13px] font-semibold text-white"
                  style={{ backgroundColor: row.color }}
                  dir="ltr"
                >
                  {row.badge}
                </span>
                <span className="min-w-0 flex-1 truncate text-[13px] text-ink-600">{row.label}</span>
                <span className="tnum shrink-0 text-emph font-semibold text-ink-900">{row.value}</span>
              </div>
            ))}
            {/* « ~10 min » en gras à droite d'une rangée « vers X » se lit
                comme un prochain passage. C'est une FRÉQUENCE : sans cette
                phrase, la fiche promettait un temps réel qui n'existe pas. */}
            {sheet.rows.length > 0 && (
              <p className="px-5 pt-1 text-label text-ink-400" style={{ paddingBottom: 'max(26px, env(safe-area-inset-bottom, 0px))' }}>
                {t('estimatedNote')}
              </p>
            )}
            {sheet.rows.length === 0 && (
              <div className="px-5 pb-7 pt-1 text-label text-ink-400" style={{ paddingBottom: 'max(26px, env(safe-area-inset-bottom, 0px))' }}>
                {sheet.emptyNote}
              </div>
            )}
          </div>
        </div>
      )}

      {clickMode && (
        <div className="pointer-events-none absolute left-0 right-0 top-0 z-10">
          <div className="bg-ink-900/90 px-4 py-2 text-center text-xs text-white">
            {clickMode === 'from' ? t('clickFrom') : t('clickTo')}
          </div>
        </div>
      )}
    </div>
  )
}

interface SheetRow {
  badge: string
  color: string
  label: string
  value: string
}

interface SheetModel {
  title: string
  subtitle: string
  rows: SheetRow[]
  emptyNote?: string
}

// Construit le contenu de la fiche : directions + fréquence estimée (« ~ »),
// jamais de compte à rebours (pas de temps réel à Alger).
function buildSheetModel(
  selected: SelectedStation,
  locale: Locale,
  userPos: [number, number] | null,
  translate: (key: TranslationKey) => string,
): SheetModel {
  const distanceLabel = userPos
    ? formatDistance(distanceInMeters(selected.coords[1], selected.coords[0], userPos[1], userPos[0]), locale)
    : null

  if (selected.kind === 'bus') {
    const lines = (selected.busLineRefs ?? [])
      .map((ref) => busLines.find((line) => line.shortName === ref))
      .filter((line): line is NonNullable<typeof line> => Boolean(line))
    return {
      title: selected.name ?? '',
      subtitle: [translate('busStopWord'), distanceLabel].filter(Boolean).join(' · '),
      rows: lines.map((line) => ({
        badge: line.shortName,
        color: line.color || '#D97706',
        label: `${translate('towards')} ${line.directions[0]?.headsign ?? line.longName}`,
        value: isInService(line)
          ? `~${estimatedHeadwayMin(line)} ${translate('min')}`
          : translate('closed'),
      })),
    }
  }

  const station = (selected.kind === 'future' ? allFutureStations : allStations)
    .find((candidate) => candidate.id === selected.id)
  const title = station ? getStationName(station, locale) : selected.name ?? selected.id

  if (selected.kind === 'future') {
    return {
      title,
      subtitle: translate('metroExtension'),
      rows: [],
      emptyNote: `${translate('planned')} ${selected.openingYear ?? 2027}`,
    }
  }

  const line = selected.mode === 'metro' ? metroLine : tramLine
  const open = isInService(line)
  return {
    title,
    subtitle: [
      selected.mode === 'metro' ? translate('metroStation') : translate('tramStop'),
      distanceLabel,
    ].filter(Boolean).join(' · '),
    rows: line.directions.map((direction) => {
      const terminus = direction.stops[direction.stops.length - 1]
      return {
        badge: line.shortName,
        color: line.color,
        label: `${translate('towards')} ${terminus ? lineStopName(terminus, locale) : direction.headsign}`,
        value: open ? `~${estimatedHeadwayMin(line)} ${translate('min')}` : translate('closed'),
      }
    }),
  }
}

function formatDistance(meters: number, locale: Locale): string {
  const rounded = meters < 1000 ? Math.round(meters / 10) * 10 : Math.round(meters / 100) * 100
  const label = rounded < 1000 ? `${rounded} ${locale === 'ar' ? 'م' : 'm'}` : `${(rounded / 1000).toFixed(1)} ${locale === 'ar' ? 'كم' : 'km'}`
  if (locale === 'ar') return `على بعد ${label}`
  if (locale === 'en') return `${label} away`
  return `à ${label}`
}


// Au-delà, relier deux arrêts en ligne droite invente un chemin : c'est ce qui
// faisait « traverser la baie » à la ligne 113. En deçà, la droite entre deux
// arrêts urbains voisins est une approximation acceptable.
const STOP_LINK_MAX_M = 400

function buildBusLinesGeoJSON(): FeatureCollection<LineString, { color: string; name: string }> {
  // Une LineString par DIRECTION, pas par ligne. Les deux sens d'un bus
  // empruntent souvent des rues différentes (sens uniques, boucle de desserte) :
  // ne dessiner qu'un sens laissait les arrêts de l'autre flotter à côté du
  // trait (signalé sur la ligne 3). Les deux features portent le même `name`,
  // donc le filtre « Voir sur la carte » les affiche toutes les deux.
  const features: Feature<LineString, { color: string; name: string }>[] = []

  for (const line of busLines) {
    for (const direction of line.directions) {
      const shape = (direction.shape ?? []) as [number, number][]
      if (shape.length >= 2) {
        // Tracé relevé ou déduit : une seule feature continue.
        features.push({
          type: 'Feature',
          geometry: { type: 'LineString', coordinates: shape },
          properties: { color: line.color, name: line.shortName },
        })
        continue
      }
      // Pas de tracé fiable : on relie les arrêts, mais on COUPE dès qu'un saut
      // dépasse le seuil — le grand écart (jusqu'à 12 km) n'est pas dessiné
      // plutôt que d'inventer un trait à travers la ville. Chaque tronçon
      // continu devient une feature ; les arrêts restent visibles en badges.
      let run: [number, number][] = []
      const stops = direction.stops
      for (let i = 0; i < stops.length; i += 1) {
        const point: [number, number] = [stops[i].lon, stops[i].lat]
        if (run.length > 0) {
          const [plon, plat] = run[run.length - 1]
          if (distanceInMeters(plat, plon, stops[i].lat, stops[i].lon) > STOP_LINK_MAX_M) {
            if (run.length >= 2) {
              features.push({
                type: 'Feature',
                geometry: { type: 'LineString', coordinates: run },
                properties: { color: line.color, name: line.shortName },
              })
            }
            run = []
          }
        }
        run.push(point)
      }
      if (run.length >= 2) {
        features.push({
          type: 'Feature',
          geometry: { type: 'LineString', coordinates: run },
          properties: { color: line.color, name: line.shortName },
        })
      }
    }
  }

  return { type: 'FeatureCollection', features }
}



// Étiquettes de direction colorées aux terminus (planche 1e : « vers Dergana »).
function buildDirectionLabelsGeoJSON(locale: Locale): FeatureCollection<Point, { label: string; color: string; mode: string }> {
  const towards = translations[locale].towards
  const entries: { lat: number; lon: number; name: string; color: string; mode: string }[] = []
  for (const [stations, color, mode] of [
    [metroStations, METRO_COLOR, 'metro'] as const,
    [tramStations, TRAM_COLOR, 'tram'] as const,
  ]) {
    const first = stations[0]
    const last = stations[stations.length - 1]
    if (first) entries.push({ lat: first.lat, lon: first.lon, name: getStationName(first, locale), color, mode })
    if (last) entries.push({ lat: last.lat, lon: last.lon, name: getStationName(last, locale), color, mode })
  }
  return {
    type: 'FeatureCollection',
    features: entries.map((e) => ({
      type: 'Feature' as const,
      geometry: { type: 'Point' as const, coordinates: [e.lon, e.lat] },
      properties: { label: `${towards} ${e.name}`, color: e.color, mode: e.mode },
    })),
  }
}



function updateStationSourceData(map: maplibregl.Map, locale: Locale) {
  const directionsSource = map.getSource('line-directions') as maplibregl.GeoJSONSource | undefined
  if (directionsSource) directionsSource.setData(buildDirectionLabelsGeoJSON(locale))
}

function addTransitLayers(
  map: maplibregl.Map,
  getLocale: () => Locale,
  isClickModeActive: () => boolean,
  onSelectStation: (station: SelectedStation | null) => void,
) {
  // Tracés planche 1e : casing blanc épais + couleur de ligne pleine.
  // Les couleurs de mode identifient ; rien d'autre ne porte de couleur.
  map.addSource('bus-lines', { type: 'geojson', data: buildBusLinesGeoJSON() })
  // Pas de minzoom : un tracé bus n'apparaît plus que sur intention (trajet ou
  // ligne consultée). Le masquer en vue large cacherait ce que l'utilisateur
  // vient précisément de demander — une ligne traverse souvent toute l'agglo.
  map.addLayer({
    id: 'bus-casing',
    type: 'line',
    source: 'bus-lines',
    layout: { 'line-join': 'round', 'line-cap': 'round' },
    paint: {
      'line-color': '#ffffff',
      'line-width': ['interpolate', ['linear'], ['zoom'], 11, 3, 13, 4, 16, 7],
      'line-opacity': 0.9,
    },
  })
  map.addLayer({
    id: 'bus-fill',
    type: 'line',
    source: 'bus-lines',
    layout: { 'line-join': 'round', 'line-cap': 'round' },
    paint: {
      'line-color': ['get', 'color'],
      'line-width': ['interpolate', ['linear'], ['zoom'], 11, 1.5, 13, 2.5, 16, 4],
      'line-opacity': 1,
    },
  })

  map.addSource('metro-line', {
    type: 'geojson',
    data: metroLineGeoJSON as Feature<LineString>,
  })
  map.addLayer({
    id: 'metro-casing',
    type: 'line',
    source: 'metro-line',
    layout: { 'line-join': 'round', 'line-cap': 'round' },
    paint: {
      'line-color': '#ffffff',
      'line-width': ['interpolate', ['linear'], ['zoom'], 10, 5, 13, 7, 16, 10],
      'line-opacity': 0.95,
    },
  })
  map.addLayer({
    id: 'metro-fill',
    type: 'line',
    source: 'metro-line',
    layout: { 'line-join': 'round', 'line-cap': 'round' },
    paint: {
      'line-color': METRO_COLOR,
      'line-width': ['interpolate', ['linear'], ['zoom'], 10, 2.5, 13, 3.5, 16, 5],
      'line-opacity': 1,
    },
  })

  map.addSource('tram-line', {
    type: 'geojson',
    data: tramLineGeoJSON as Feature<LineString>,
  })
  map.addLayer({
    id: 'tram-casing',
    type: 'line',
    source: 'tram-line',
    layout: { 'line-join': 'round', 'line-cap': 'round' },
    paint: {
      'line-color': '#ffffff',
      'line-width': ['interpolate', ['linear'], ['zoom'], 10, 5, 13, 7, 16, 10],
      'line-opacity': 0.95,
    },
  })
  map.addLayer({
    id: 'tram-fill',
    type: 'line',
    source: 'tram-line',
    layout: { 'line-join': 'round', 'line-cap': 'round' },
    paint: {
      'line-color': TRAM_COLOR,
      'line-width': ['interpolate', ['linear'], ['zoom'], 10, 2.5, 13, 3.5, 16, 5],
      'line-opacity': 1,
    },
  })

  // Spec carte v2 : les arrêts ne sont plus des cercles anonymes ni des
  // libellés détachés, mais les BADGES des lignes, posés en marqueurs DOM
  // (voir l'effet de synchronisation des badges plus haut dans le composant).

  // « vers Dergana » / « vers El Harrach » : étiquettes colorées aux terminus.
  map.addSource('line-directions', { type: 'geojson', data: buildDirectionLabelsGeoJSON(getLocale()) })
  map.addLayer({
    id: 'direction-label',
    type: 'symbol',
    source: 'line-directions',
    minzoom: 10.5,
    layout: {
      'text-field': ['get', 'label'],
      'text-font': ['Noto Sans Regular'],
      'text-size': 11,
      'text-offset': [0, -1.2],
      'text-anchor': 'bottom',
      'text-allow-overlap': false,
      'text-optional': true,
    },
    paint: {
      'text-color': ['get', 'color'],
      'text-halo-color': '#ffffff',
      'text-halo-width': 2.5,
      'text-halo-blur': 0.5,
    },
  })

  map.addSource('metro-ext-east', {
    type: 'geojson',
    data: {
      type: 'Feature' as const,
      geometry: {
        type: 'LineString' as const,
        coordinates: [
          [3.13716, 36.72200],
          ...metroExtEastStations.map((station) => [station.lon, station.lat]),
        ],
      },
      properties: {},
    },
  })
  map.addLayer({
    id: 'metro-ext-east-line',
    type: 'line',
    source: 'metro-ext-east',
    layout: { 'line-join': 'round', 'line-cap': 'round' },
    paint: {
      'line-color': '#9CA3AF',
      'line-width': ['interpolate', ['linear'], ['zoom'], 10, 2, 16, 4],
      'line-opacity': 0.7,
      'line-dasharray': [2, 7],
    },
  })

  map.addSource('metro-ext-south', {
    type: 'geojson',
    data: {
      type: 'Feature' as const,
      geometry: {
        type: 'LineString' as const,
        coordinates: metroExtSouthStations.map((station) => [station.lon, station.lat]),
      },
      properties: {},
    },
  })
  map.addLayer({
    id: 'metro-ext-south-line',
    type: 'line',
    source: 'metro-ext-south',
    layout: { 'line-join': 'round', 'line-cap': 'round' },
    paint: {
      'line-color': '#9CA3AF',
      'line-width': ['interpolate', ['linear'], ['zoom'], 10, 2, 16, 4],
      'line-opacity': 0.7,
      'line-dasharray': [2, 7],
    },
  })

  // Cercle de précision GPS (rempli seulement quand un fix arrive).
  map.addSource('user-accuracy', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } })
  map.addLayer({
    id: 'user-accuracy-fill',
    type: 'fill',
    source: 'user-accuracy',
    paint: { 'fill-color': '#1D6FE0', 'fill-opacity': 0.1 },
  })

  // Tap ailleurs sur la carte → la fiche se referme (pas de bouton fermer).
  // Les arrêts sont désormais des marqueurs DOM : un clic sur un badge ne
  // remonte pas jusqu'ici (stopPropagation), donc tout clic reçu ferme la fiche.
  map.on('click', () => {
    if (isClickModeActive()) return
    onSelectStation(null)
  })
}

function clearItineraryLayers(map: maplibregl.Map) {
  const style = map.getStyle()
  if (!style?.layers) return

  style.layers
    .filter((layer) => layer.id.startsWith('itin-'))
    .forEach((layer) => {
      if (map.getLayer(layer.id)) map.removeLayer(layer.id)
    })

  Object.keys(style.sources ?? {})
    .filter((sourceId) => sourceId.startsWith('itin-'))
    .forEach((sourceId) => {
      if (map.getSource(sourceId)) map.removeSource(sourceId)
    })
}

function removeItineraryMarkers(markers: maplibregl.Marker[]) {
  markers.forEach((marker) => marker.remove())
}

function setBackgroundLinesOpacity(map: maplibregl.Map, opacity: number) {
  // Les bases correspondent aux opacités « planche » d'addTransitLayers.
  ;[
    ['metro-casing', 0.95 * opacity],
    ['metro-fill', 1 * opacity],
    ['tram-casing', 0.95 * opacity],
    ['tram-fill', 1 * opacity],
    ['bus-casing', 0.6 * opacity],
    ['bus-fill', 0.5 * opacity],
  ].forEach(([id, value]) => {
    if (map.getLayer(id as string)) map.setPaintProperty(id as string, 'line-opacity', value as number)
  })
}

function setLayerVisibility(map: maplibregl.Map, layerIds: string[], visible: boolean) {
  const visibility = visible ? 'visible' : 'none'
  layerIds.forEach((id) => {
    if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', visibility)
  })
}

// Modes et lignes de bus réellement empruntés par un itinéraire — sert à
// n'afficher que le réseau concerné (carte dynamique).
function buildItineraryFocus(itinerary: OtpItinerary) {
  const modes = new Set<string>()
  const busRefs = new Set<string>()
  for (const leg of itinerary.legs) {
    if (leg.mode === 'WALK') continue
    modes.add(leg.mode)
    if (leg.mode === 'BUS' && leg.routeShortName) busRefs.add(leg.routeShortName)
  }
  return { modes, busRefs }
}


function focusMapOnSelection(map: maplibregl.Map, coords: [number, number]) {
  map.easeTo({
    center: coords,
    zoom: Math.max(map.getZoom(), 14.2),
    duration: 850,
  })
}

function applyBaseMapTheme(map: maplibregl.Map) {
  // Palette claire : on garde le style Positron (blanc/gris doux, le look des
  // grandes apps) et on ne retouche QUE l'eau et les parcs pour un rendu net.
  const style = map.getStyle()
  if (!style?.layers) return

  style.layers.forEach((layer) => {
    const id = layer.id.toLowerCase()

    try {
      if (layer.type === 'fill') {
        if (/water|ocean|lake|river|sea/.test(id)) {
          map.setPaintProperty(layer.id, 'fill-color', '#BFDBF0')
        } else if (/park|green|landcover|vegetation|wood|grass/.test(id)) {
          map.setPaintProperty(layer.id, 'fill-color', '#E4EFE2')
        }
      }
    } catch {
      // Certaines couches n'exposent pas toutes les propriétés de peinture.
    }
  })
}

// Départ = point bleu (comme la position), arrivée = carré noir 12px r3 (planche 1i).
function makeEndpointMarker(coords: [number, number], color: string, shape: 'circle' | 'square') {
  const el = document.createElement('div')
  el.style.cssText = `
    width: ${shape === 'square' ? 14.5 : 18}px;
    height: ${shape === 'square' ? 14.5 : 18}px;
    border-radius: ${shape === 'square' ? '4.25px' : '50%'};
    background: ${color};
    border: 2.5px solid white;
    box-shadow: 0 1px 4px rgba(16,24,40,0.3);
  `
  return new maplibregl.Marker({ element: el, anchor: 'center' }).setLngLat(coords)
}

function makeStopMarker(coords: [number, number], color: string, size = 12) {
  const el = document.createElement('div')
  el.style.cssText = `
    width: ${size}px;
    height: ${size}px;
    border-radius: 50%;
    background: white;
    border: ${size >= 15 ? 3 : 2.5}px solid ${color};
    box-shadow: 0 1px 4px rgba(0,0,0,0.25);
  `
  return new maplibregl.Marker({ element: el, anchor: 'center' }).setLngLat(coords)
}

// Découpe une polyline à une fraction de sa longueur (planche 1i : le tracé
// change de couleur À LA POSITION de l'utilisateur, pas à la fin du tronçon).
function splitPolylineAt(coords: [number, number][], fraction: number): {
  done: [number, number][]
  todo: [number, number][]
} {
  if (coords.length < 2 || fraction <= 0) return { done: [], todo: coords }
  if (fraction >= 1) return { done: coords, todo: [] }

  const segments: number[] = []
  let total = 0
  for (let i = 1; i < coords.length; i += 1) {
    const d = Math.hypot(coords[i][0] - coords[i - 1][0], coords[i][1] - coords[i - 1][1])
    segments.push(d)
    total += d
  }
  if (total === 0) return { done: [], todo: coords }

  const target = total * fraction
  let walked = 0
  for (let i = 0; i < segments.length; i += 1) {
    if (walked + segments[i] >= target) {
      const ratio = segments[i] === 0 ? 0 : (target - walked) / segments[i]
      const a = coords[i]
      const b = coords[i + 1]
      const cut: [number, number] = [
        a[0] + (b[0] - a[0]) * ratio,
        a[1] + (b[1] - a[1]) * ratio,
      ]
      return {
        done: [...coords.slice(0, i + 1), cut],
        todo: [cut, ...coords.slice(i + 1)],
      }
    }
    walked += segments[i]
  }
  return { done: coords, todo: [] }
}

// Étiquette « pill » blanche de la planche 1i (h22, radius 7, ombre douce).
function makePillMarker(
  coords: [number, number],
  text: string,
  weight: 500 | 600,
): maplibregl.Marker {
  const el = document.createElement('div')
  el.textContent = text
  el.style.cssText = `height:22px;padding:0 9px;background:#fff;border-radius:7px;`
    + `box-shadow:0 1px 2px rgba(16,24,40,.05),0 4px 14px rgba(16,24,40,.07);`
    + `font:${weight} 11px Inter,system-ui,sans-serif;color:#111827;`
    + `display:inline-flex;align-items:center;white-space:nowrap`
  return new maplibregl.Marker({ element: el, anchor: 'bottom', offset: [0, -14] }).setLngLat(coords)
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

function distanceInMeters(lat1: number, lon1: number, lat2: number, lon2: number) {
  const toRad = (value: number) => (value * Math.PI) / 180
  const earthRadius = 6371000
  const dLat = toRad(lat2 - lat1)
  const dLon = toRad(lon2 - lon1)
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
  return earthRadius * c
}

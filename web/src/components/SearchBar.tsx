'use client'

import { useState, useRef, useEffect, useLayoutEffect, useCallback, useId } from 'react'
import { motion } from 'framer-motion'
import {
  ADDRESS_DEBOUNCE_MS,
  searchAddresses,
  searchLocal,
  type AddressStatus,
  type PlaceResult,
} from '@/lib/geocoding'
import type { Coordinate } from '@/lib/otp'
import type { GeolocationState } from '@/hooks/useGeolocation'
import { useTranslation } from '@/hooks/useTranslation'
import { ResultIcon, RecentIcon } from '@/components/icons'
import FeedbackCard from '@/components/FeedbackCard'
import RouteLabel from '@/components/RouteLabel'
import type { CoordinateMarks, MarkedCoordinate, RecentEndpoint, RecentSearch } from '@/hooks/useRecentSearches'
import { readSavedPlaces, type SavedPlaceKey } from '@/hooks/useSavedPlaces'
import type { Locale, TranslationKey } from '@/lib/i18n'
import type { ReportContext } from '@/lib/report'
import {
  ALGIERS_OFFSET_MS,
  algiersDayDiff,
  algiersOtpDateTime,
  algiersToEpoch,
  algiersWhenForTime,
  deviceShowsAlgiersTime,
  formatAlgiersTime,
} from '@/lib/algiers-time'
import { isInServiceAreaPoint, kmFromServiceArea } from '@/lib/service-area'

/** Heure demandée, telle que choisie dans le formulaire (heure d'Alger). */
export interface SearchWhen {
  /** now = « Départ maintenant » (date absente) ; depart / arrive = heure choisie. */
  kind: 'now' | 'depart' | 'arrive'
  /** YYYY-MM-DD, calendrier d'Alger (absent pour « maintenant »). */
  date?: string
  /** HH:mm, heure d'Alger (absent pour « maintenant »). */
  time?: string
  /** L'heure choisie est déjà passée aujourd'hui : elle désigne demain. */
  nextDay: boolean
}

/** Position la plus fraîche connue (useUserPosition, suivi continu). */
export interface FreshPosition {
  lat: number
  lon: number
  accuracy: number
  timestamp: number
}

interface SearchBarProps {
  /**
   * `date` : instant demandé (heure d'Alger convertie en epoch), absent pour
   * « maintenant » — à passer tel quel à planTrip. `when` détaille le choix
   * pour l'en-tête des résultats (describePlanQuery / itin_departAt…).
   * Les coordonnées portent des marques (nouriKind, savedKey) que
   * useRecentSearches.addSearch sait lire : les transmettre telles quelles.
   */
  onSearch: (from: Coordinate | null, to: Coordinate | null, date?: Date, arriveBy?: boolean, when?: SearchWhen) => void
  loading?: boolean
  recentSearches?: RecentSearch[]
  externalFrom?: (Coordinate & CoordinateMarks) | null
  externalTo?: (Coordinate & CoordinateMarks) | null
  /**
   * Incrémenté par « Y aller » (fiche d'arrêt, point de la carte) : une fois
   * externalTo appliqué, la recherche part si le départ est déjà résolu
   * (lieu choisi, ou « Ma position » avec un fix récent). Sinon rien : le
   * champ Départ reçoit le focus, jamais de position inventée.
   */
  submitSignal?: number
  visible?: boolean
  // Emplacement « Raccourcis » (planche 1f) : rendu entre l'heure et les récents.
  children?: React.ReactNode
  // Action de droite dans le titre (sélecteur de langue) — l'écran est l'accueil.
  headerAction?: React.ReactNode
  // Position ponctuelle partagée avec le reste de l'écran (« Activer la
  // localisation » remplit aussi le champ Départ). `loading` sert d'indicateur.
  geo: Pick<GeolocationState, 'lat' | 'lon' | 'error'>
    & Partial<Pick<GeolocationState, 'loading' | 'accuracy'>>
    & { locate: () => void }
  /** Position suivie en continu, si disponible : préférée à `geo` quand elle est récente. */
  userPosition?: FreshPosition | null
  /**
   * Clé du brouillon (champs, heure) conservé si le formulaire est démonté
   * (changement d'onglet ou de langue) ou la page rechargée. Par défaut
   * « main » (le premier formulaire monté), « main#2 » pour un second.
   */
  draftKey?: string
  /** Contexte joint à « Nous écrire » (défaut : retour libre). */
  feedbackContext?: ReportContext
}

type Special = 'myLocation' | SavedPlaceKey

interface FieldState {
  /** Texte saisi ou nom du lieu choisi ; ignoré quand `special` est posé. */
  value: string
  place: PlaceResult | null
  /** « Ma position », « Maison », « Travail » : libellé traduit à l'affichage. */
  special?: Special
  /** « Ma position » en attente d'un fix GPS. */
  pending?: boolean
  /** Horodatage de la position utilisée pour « Ma position ». */
  fixAt?: number
}

type FieldName = 'from' | 'to'
type Status = 'idle' | 'loading' | AddressStatus

const EMPTY: FieldState = { value: '', place: null }
// Une position plus vieille que ça n'est pas « ma position » : on en redemande une.
const POSITION_MAX_AGE_MS = 60_000
// Au-delà, pré-remplir « Ma position » serait trompeur (position à l'îlot près).
const PREFILL_MAX_ACCURACY_M = 150
// Une heure choisie il y a plus de 30 min n'est plus celle que l'usager vise.
const DRAFT_TIME_TTL_MS = 30 * 60_000

// ── Brouillon ───────────────────────────────────────────────────────────────
// Le formulaire était démonté à chaque changement d'onglet ou de langue : le
// départ saisi disparaissait et une ancienne destination revenait. Le
// brouillon vit en mémoire (survit au démontage) et en sessionStorage
// (survit au rechargement de mise à jour, pas à la fermeture de l'app).
interface Draft {
  from: FieldState
  to: FieldState
  departTime: string
  timeTouched: boolean
  arriveBy: boolean
  savedAt: number
}

const drafts = new Map<string, Draft>()
// Coordonnées externes (carte, ligne, raccourci) déjà appliquées par
// instance : un remontage ne réinjecte pas une ancienne destination.
const consumedExternals = new Map<string, WeakSet<object>>()

const DRAFT_PREFIX = 'nouri:search-draft:'

// Clés de brouillon des formulaires montés : le premier prend « main », un
// second formulaire monté en même temps (barre latérale bureau) « main#2 ».
// useId ne convient pas : côté client, il change à chaque montage.
const liveDraftKeys = new Set<string>()

function claimDraftKey(base: string): string {
  let key = base
  for (let i = 2; liveDraftKeys.has(key); i++) key = `${base}#${i}`
  liveDraftKeys.add(key)
  return key
}

function readDraft(key: string): Draft | null {
  const inMemory = drafts.get(key)
  if (inMemory) return inMemory
  try {
    const raw = window.sessionStorage.getItem(DRAFT_PREFIX + key)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Draft
    if (!parsed || typeof parsed !== 'object' || !parsed.from || !parsed.to) return null
    return parsed
  } catch {
    return null
  }
}

function writeDraft(key: string, draft: Draft) {
  drafts.set(key, draft)
  try {
    window.sessionStorage.setItem(DRAFT_PREFIX + key, JSON.stringify(draft))
  } catch {
    // Stockage indisponible : le brouillon reste en mémoire.
  }
}

function consumeExternal(key: string, value: object): boolean {
  let seen = consumedExternals.get(key)
  if (!seen) {
    seen = new WeakSet()
    consumedExternals.set(key, seen)
  }
  if (seen.has(value)) return false
  seen.add(value)
  return true
}

/** Restaure un champ : jamais d'attente GPS héritée d'une autre session. */
function restoreField(field: FieldState | undefined): FieldState {
  if (!field) return EMPTY
  return { ...field, pending: false }
}

const nowHHMM = () => formatAlgiersTime(Date.now())

/** Maintenant + 30 min, arrondi aux 5 min suivantes (heure d'Alger). */
function soonHHMM(): string {
  const step = 5 * 60_000
  return formatAlgiersTime(Math.ceil((Date.now() + 30 * 60_000) / step) * step)
}

// useLayoutEffect ne s'exécute pas côté serveur : useEffect y suffit.
const useIsoLayoutEffect = typeof window !== 'undefined' ? useLayoutEffect : useEffect

function placeAt(id: string, name: string, lat: number, lon: number): PlaceResult {
  return { id, name, fullName: name, lat, lon, kind: 'address' }
}

export default function SearchBar({
  onSearch,
  loading,
  recentSearches = [],
  externalFrom,
  externalTo,
  submitSignal = 0,
  visible = true,
  children,
  headerAction,
  geo,
  userPosition,
  draftKey,
  feedbackContext,
}: SearchBarProps) {
  const { t, tf, tn, locale } = useTranslation()
  const uid = useId()
  // Clé du brouillon, attribuée au montage (lue uniquement dans les effets).
  const keyRef = useRef(draftKey ?? 'main')
  const ids = { from: `${uid}-from`, to: `${uid}-to`, time: `${uid}-time`, live: `${uid}-live` }

  // Premier rendu identique au rendu serveur (champs vides) ; le brouillon
  // est restauré juste après, avant que le navigateur ne peigne.
  const [from, setFrom] = useState<FieldState>(EMPTY)
  const [to, setTo] = useState<FieldState>(EMPTY)
  const [results, setResults] = useState<Record<FieldName, PlaceResult[]>>({ from: [], to: [] })
  const [status, setStatus] = useState<Record<FieldName, Status>>({ from: 'idle', to: 'idle' })
  const [activeIndex, setActiveIndex] = useState(-1)
  const [activeField, setActiveField] = useState<FieldName | null>(null)
  // Heure d'ALGER (pas celle du téléphone : diaspora, voyageurs).
  const [departTime, setDepartTime] = useState(nowHHMM)
  const [timeTouched, setTimeTouched] = useState(false)
  const [arriveBy, setArriveBy] = useState(false)
  // Fuseau du téléphone ≠ Alger : on précise « heure d'Alger ». Calculé après
  // le montage (le serveur n'a pas le fuseau de l'usager).
  const [showAlgiersTz, setShowAlgiersTz] = useState(false)
  // Disclosure « Départ maintenant ⌄ » (planche 1f) : les contrôles d'heure
  // n'apparaissent qu'à la demande.
  const [timeOpen, setTimeOpen] = useState(false)
  const [swapDeg, setSwapDeg] = useState(0)
  // Message factuel sous le bouton : position hors zone, champs incomplets.
  const [notice, setNotice] = useState<string | null>(null)
  // Annonce pour les lecteurs d'écran (région live masquée).
  const [announcement, setAnnouncement] = useState('')

  const fromRef = useRef<HTMLInputElement>(null)
  const toRef = useRef<HTMLInputElement>(null)
  const timeRef = useRef<HTMLInputElement>(null)
  const abortRefs = useRef<Record<FieldName, AbortController | null>>({ from: null, to: null })
  const timerRefs = useRef<Record<FieldName, ReturnType<typeof setTimeout> | null>>({ from: null, to: null })
  const latestQuery = useRef<Record<FieldName, string>>({ from: '', to: '' })
  // L'usager a lui-même rempli le départ : on ne le remplace plus par « Ma position ».
  const fromTouchedRef = useRef(false)
  const restoredRef = useRef(false)
  // Recherche lancée alors que « Ma position » attendait un fix : on la
  // termine dès que la position arrive.
  const submitAfterLocateRef = useRef(false)
  // Dernier fix de `geo` (ponctuel) : il n'a pas d'horodatage propre.
  const geoFixAtRef = useRef<number | null>(null)
  const prevGeoLoadingRef = useRef<boolean | undefined>(geo.loading)

  const fieldState = (name: FieldName) => (name === 'from' ? from : to)
  const setField = (name: FieldName, value: FieldState | ((prev: FieldState) => FieldState)) =>
    (name === 'from' ? setFrom : setTo)(value)

  const label = useCallback((field: FieldState): string => {
    if (field.special === 'myLocation') return t('myLocation')
    if (field.special === 'home') return t('homePlace')
    if (field.special === 'work') return t('workPlace')
    return field.value
  }, [t])

  // ── Brouillon : restauré au montage, enregistré à chaque changement ───────
  useIsoLayoutEffect(() => {
    const claimed = draftKey ?? claimDraftKey('main')
    keyRef.current = claimed
    return () => { if (!draftKey) liveDraftKeys.delete(claimed) }
  }, [draftKey])

  useIsoLayoutEffect(() => {
    restoredRef.current = true
    setShowAlgiersTz(!deviceShowsAlgiersTime())
    const draft = readDraft(keyRef.current)
    if (!draft) return
    const from0 = restoreField(draft.from)
    setFrom(from0)
    setTo(restoreField(draft.to))
    fromTouchedRef.current = Boolean(from0.value || from0.special)
    // Une heure choisie il y a longtemps n'est plus d'actualité : retour à
    // « maintenant ».
    if (draft.timeTouched && Date.now() - draft.savedAt < DRAFT_TIME_TTL_MS) {
      setDepartTime(draft.departTime)
      setTimeTouched(true)
      setArriveBy(Boolean(draft.arriveBy))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (!restoredRef.current) return
    writeDraft(keyRef.current, { from, to, departTime, timeTouched, arriveBy, savedAt: Date.now() })
  }, [from, to, departTime, timeTouched, arriveBy])

  // ── Heure : « maintenant » reste maintenant ───────────────────────────────
  // Tant que l'usager n'a pas choisi d'heure, le champ suit l'horloge : une
  // PWA reprise après des heures n'envoie plus l'heure d'ouverture du
  // formulaire, et « Arriver avant HH:MM » n'affiche jamais une heure périmée.
  const refreshNow = useCallback(() => {
    if (!timeTouched) setDepartTime(nowHHMM())
  }, [timeTouched])

  useEffect(() => {
    const onVisible = () => { if (document.visibilityState === 'visible') refreshNow() }
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('focus', refreshNow)
    return () => {
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('focus', refreshNow)
    }
  }, [refreshNow])

  useEffect(() => {
    if (!timeOpen || timeTouched) return
    refreshNow()
    const id = setInterval(refreshNow, 30_000)
    return () => clearInterval(id)
  }, [timeOpen, timeTouched, refreshNow])

  // ── Position ──────────────────────────────────────────────────────────────
  useEffect(() => {
    const was = prevGeoLoadingRef.current
    prevGeoLoadingRef.current = geo.loading
    if (geo.lat === null || geo.lon === null || geo.error) return
    // Fin d'une demande (loading vrai → faux) ou nouvelle position : c'est un
    // fix d'à l'instant, même si le navigateur renvoie les mêmes coordonnées.
    if (geo.loading === undefined || (was === true && geo.loading === false) || geoFixAtRef.current === null) {
      geoFixAtRef.current = Date.now()
    }
  }, [geo.lat, geo.lon, geo.loading, geo.error])

  const freshPosition = useCallback((): FreshPosition | null => {
    const now = Date.now()
    if (userPosition && now - userPosition.timestamp < POSITION_MAX_AGE_MS) return userPosition
    if (geo.lat !== null && geo.lon !== null && !geo.error && geoFixAtRef.current !== null
      && now - geoFixAtRef.current < POSITION_MAX_AGE_MS) {
      return { lat: geo.lat, lon: geo.lon, accuracy: geo.accuracy ?? Number.NaN, timestamp: geoFixAtRef.current }
    }
    return null
  }, [userPosition, geo.lat, geo.lon, geo.error, geo.accuracy])

  /** « Ma position » rempli avec un fix, ou refusé hors du Grand Alger. */
  const myLocationField = useCallback((pos: FreshPosition): FieldState | null => {
    if (!isInServiceAreaPoint(pos.lat, pos.lon)) {
      const km = Math.max(1, Math.round(kmFromServiceArea(pos.lat, pos.lon)))
      setNotice(tf('ux_myLocationOutside', { n: km }))
      return null
    }
    return {
      value: '',
      special: 'myLocation',
      place: placeAt('my-location', t('myLocation'), pos.lat, pos.lon),
      fixAt: pos.timestamp,
    }
  }, [t, tf])

  /** Demande « Ma position » pour un champ : tout de suite si un fix récent existe. */
  const requestMyLocation = useCallback((name: FieldName) => {
    setNotice(null)
    const pos = freshPosition()
    if (pos) {
      const field = myLocationField(pos)
      setField(name, field ?? EMPTY)
      if (field) setAnnouncement(t('ux_myLocationFound'))
      return
    }
    // En http, le navigateur refuse toute position : on le dit sans attendre.
    if (typeof window !== 'undefined' && !window.isSecureContext) {
      setField(name, EMPTY)
      setNotice(t('geoInsecure'))
      return
    }
    // Pas de position récente : champ « Ma position » en attente, jamais
    // d'anciennes coordonnées réutilisées.
    setField(name, { value: '', special: 'myLocation', place: null, pending: true })
    setAnnouncement(t('locating'))
    geo.locate()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [freshPosition, myLocationField, geo.locate, t])

  // Un fix arrive : il résout les champs en attente, puis pré-remplit le
  // départ s'il est vide et que l'usager n'y a pas touché (position déjà
  // autorisée : on évite deux touchers par recherche).
  useEffect(() => {
    const pos = freshPosition()
    if (!pos) return
    let resolvedSomething = false
    for (const name of ['from', 'to'] as const) {
      if (fieldState(name).pending) {
        const field = myLocationField(pos)
        setField(name, field ?? EMPTY)
        if (field) resolvedSomething = true
        else submitAfterLocateRef.current = false
      }
    }
    if (resolvedSomething) setAnnouncement(t('ux_myLocationFound'))
    if (!from.pending && !fromTouchedRef.current && !from.value && !from.special
      && isInServiceAreaPoint(pos.lat, pos.lon)
      && (!Number.isFinite(pos.accuracy) || pos.accuracy <= PREFILL_MAX_ACCURACY_M)) {
      const field = myLocationField(pos)
      if (field) setFrom(field)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [freshPosition, geo.loading])

  // Échec de localisation : on vide le champ en attente et on le dit (le
  // message geo.error s'affiche sous le bouton). Jamais d'anciennes
  // coordonnées. `geo.loading` dans les dépendances : un second échec
  // identique (même clé d'erreur) doit aussi libérer le champ.
  useEffect(() => {
    if (!geo.error || geo.loading) return
    let cleared = false
    for (const name of ['from', 'to'] as const) {
      if (fieldState(name).pending) { setField(name, EMPTY); cleared = true }
    }
    // « Recherche de votre position… » ne doit pas rester annoncé : le
    // message d'erreur (role=status sous le bouton) prend le relais.
    if (cleared) setAnnouncement('')
    submitAfterLocateRef.current = false
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [geo.error, geo.loading])

  // ── Coordonnées venues d'ailleurs (carte, fiche de ligne, raccourcis) ─────
  const fieldFromCoordinate = useCallback((c: Coordinate & CoordinateMarks, id: string): FieldState => {
    if (c.nouriKind === 'myLocation') {
      return { value: '', special: 'myLocation', place: placeAt('my-location', t('myLocation'), c.lat, c.lon), fixAt: Date.now() }
    }
    const name = c.name ?? `${c.lat.toFixed(4)}, ${c.lon.toFixed(4)}`
    return { value: name, special: c.savedKey, place: placeAt(id, name, c.lat, c.lon) }
  }, [t])

  useEffect(() => {
    if (!externalFrom || !consumeExternal(keyRef.current, externalFrom)) return
    fromTouchedRef.current = true
    setFrom(fieldFromCoordinate(externalFrom, 'map-from'))
  }, [externalFrom, fieldFromCoordinate])

  useEffect(() => {
    if (!externalTo || !consumeExternal(keyRef.current, externalTo)) return
    setTo(fieldFromCoordinate(externalTo, 'map-to'))
  }, [externalTo, fieldFromCoordinate])

  // ── Suggestions ───────────────────────────────────────────────────────────
  // Arrêts et stations (index local) à CHAQUE frappe, sans attendre le
  // réseau ; adresses ensuite, en UN appel temporisé et annulable. Un réseau
  // lent ou absent est dit (« Réseau lent : … seuls les arrêts… »), une
  // recherche sans résultat aussi : la liste ne disparaît plus en silence.
  const triggerSearch = useCallback((name: FieldName, query: string) => {
    const timer = timerRefs.current[name]
    if (timer) clearTimeout(timer)
    abortRefs.current[name]?.abort()
    latestQuery.current[name] = query
    setActiveIndex(-1)

    if (query.trim().length < 2) {
      setResults((r) => ({ ...r, [name]: [] }))
      setStatus((s) => ({ ...s, [name]: 'idle' }))
      return
    }

    const local = searchLocal(query, locale)
    setResults((r) => ({ ...r, [name]: local }))
    setStatus((s) => ({ ...s, [name]: 'loading' }))

    const ctrl = new AbortController()
    abortRefs.current[name] = ctrl
    timerRefs.current[name] = setTimeout(async () => {
      try {
        const found = await searchAddresses(query, { signal: ctrl.signal, locale })
        if (latestQuery.current[name] !== query) return // réponse périmée
        const seen = new Set(local.map((p) => p.id))
        const merged = [...local, ...found.results.filter((p) => !seen.has(p.id))].slice(0, 8)
        setResults((r) => ({ ...r, [name]: merged }))
        setStatus((s) => ({ ...s, [name]: found.status }))
        if (found.status === 'slow') setAnnouncement(t('itin_geoSlow'))
        else if (found.status === 'unavailable') setAnnouncement(t('itin_geoUnavailable'))
        else if (merged.length === 0) setAnnouncement(t('itin_geoNoResults'))
        else setAnnouncement(tn('ux_suggestions', merged.length))
      } catch {
        // Annulée par une frappe plus récente : rien à faire.
      }
    }, ADDRESS_DEBOUNCE_MS)
  }, [locale, t, tn])

  useEffect(() => () => {
    for (const name of ['from', 'to'] as const) {
      abortRefs.current[name]?.abort()
      const timer = timerRefs.current[name]
      if (timer) clearTimeout(timer)
    }
  }, [])

  function handleChange(name: FieldName, value: string) {
    if (name === 'from') fromTouchedRef.current = true
    setField(name, { value, place: null })
    setActiveField(name)
    setNotice(null)
    triggerSearch(name, value)
  }

  function selectPlace(name: FieldName, place: PlaceResult) {
    if (name === 'from') fromTouchedRef.current = true
    setField(name, { value: place.name, place })
    setResults((r) => ({ ...r, [name]: [] }))
    setStatus((s) => ({ ...s, [name]: 'idle' }))
    setActiveField(null)
    setActiveIndex(-1)
    setNotice(null)
    if (name === 'from') toRef.current?.focus()
  }

  /** Rejoue un récent : « Ma position » = position ACTUELLE, « Maison » = adresse actuelle. */
  function endpointField(endpoint: RecentEndpoint, name: FieldName): FieldState | 'myLocation' {
    if (endpoint.kind === 'myLocation') return 'myLocation'
    if (endpoint.kind === 'saved') {
      const current = readSavedPlaces()[endpoint.key]
      const shown = endpoint.key === 'home' ? t('homePlace') : t('workPlace')
      // Lieu supprimé depuis : jamais ses anciennes coordonnées sous le même nom.
      if (!current) {
        setNotice(tf('itin_savedPlaceGone', { place: shown }))
        return EMPTY
      }
      return { value: shown, special: endpoint.key, place: placeAt(`rec-${name}`, shown, current.lat, current.lon) }
    }
    return { value: endpoint.label, place: placeAt(`rec-${name}`, endpoint.label, endpoint.lat, endpoint.lon) }
  }

  function selectRecent(search: RecentSearch) {
    fromTouchedRef.current = true
    setNotice(null)
    for (const name of ['from', 'to'] as const) {
      const field = endpointField(name === 'from' ? search.from : search.to, name)
      if (field === 'myLocation') requestMyLocation(name)
      else setField(name, field)
    }
    setActiveField(null)
    setActiveIndex(-1)
    setResults({ from: [], to: [] })
  }

  function handleSwap() {
    fromTouchedRef.current = true
    setSwapDeg((value) => value + 180)
    setFrom(to)
    setTo(from)
  }

  function handleUseMyLocation() {
    fromTouchedRef.current = true
    requestMyLocation('from')
    setActiveField(null)
  }

  // ── Heure demandée ────────────────────────────────────────────────────────
  const timeKind: SearchWhen['kind'] = arriveBy ? 'arrive' : timeTouched ? 'depart' : 'now'
  const chosenWhen = timeKind === 'now' ? null : algiersWhenForTime(departTime)
  const nextDay = chosenWhen !== null && chosenWhen.date !== algiersOtpDateTime().date

  const timeLabel = timeKind === 'now'
    ? t('itin_departNow')
    : `${tf(timeKind === 'arrive' ? 'itin_arriveBy' : 'itin_departAt', { time: departTime })}${nextDay ? ` · ${t('itin_tomorrow')}` : ''}`

  function toggleArriveBy() {
    const next = !arriveBy
    // « Arriver avant maintenant » ne renverrait que des trajets déjà
    // partis : sans heure choisie, on propose dans 30 min, bien visible et
    // modifiable.
    if (next && !timeTouched) {
      setDepartTime(soonHHMM())
      setTimeTouched(true)
    }
    setArriveBy(next)
  }

  function resetToNow() {
    setTimeTouched(false)
    setArriveBy(false)
    setDepartTime(nowHHMM())
  }

  // ── Envoi ─────────────────────────────────────────────────────────────────
  const fieldReady = (field: FieldState) => field.place !== null || field.special === 'myLocation'
  const canSearch = fieldReady(from) && fieldReady(to) && !from.pending && !to.pending

  const emit = useCallback((f0: FieldState, d0: FieldState, forceNow = false) => {
    // « Maison » / « Travail » = adresse ACTUELLE, relue à l'envoi : modifiée
    // ou supprimée depuis qu'elle a été placée dans le formulaire, elle ne
    // doit pas envoyer vers l'ancienne adresse.
    const saved = readSavedPlaces()
    const resolve = (name: FieldName, field: FieldState): FieldState | null => {
      if (field.special !== 'home' && field.special !== 'work') return field
      const current = saved[field.special]
      const shown = label(field)
      if (!current) {
        ;(name === 'from' ? setFrom : setTo)(EMPTY)
        setNotice(tf('itin_savedPlaceGone', { place: shown }))
        return null
      }
      if (field.place && field.place.lat === current.lat && field.place.lon === current.lon) return field
      const next = { ...field, place: placeAt(field.place?.id ?? `saved-${name}`, shown, current.lat, current.lon) }
      ;(name === 'from' ? setFrom : setTo)(next)
      return next
    }
    const f = resolve('from', f0)
    const d = resolve('to', d0)
    if (!f || !d) return
    if (!f.place || !d.place) return
    const toCoordinate = (field: FieldState): MarkedCoordinate => ({
      lat: field.place!.lat,
      lon: field.place!.lon,
      name: label(field) || field.place!.name,
      ...(field.special === 'myLocation' ? { nouriKind: 'myLocation' as const } : {}),
      ...(field.special === 'home' || field.special === 'work' ? { savedKey: field.special } : {}),
    })
    const nowMs = Date.now()
    if (forceNow || timeKind === 'now') {
      onSearch(toCoordinate(f), toCoordinate(d), undefined, false, { kind: 'now', nextDay: false })
      return
    }
    const when = algiersWhenForTime(departTime, nowMs)
    const date = new Date(algiersToEpoch(when.date, when.time))
    onSearch(toCoordinate(f), toCoordinate(d), date, arriveBy, {
      kind: timeKind,
      date: when.date,
      time: when.time,
      nextDay: when.date !== algiersOtpDateTime(nowMs).date,
    })
  }, [label, tf, timeKind, departTime, arriveBy, onSearch])

  // La position attendue est arrivée : on termine la recherche demandée.
  useEffect(() => {
    if (!submitAfterLocateRef.current || from.pending || to.pending) return
    submitAfterLocateRef.current = false
    if (from.place && to.place) emit(from, to)
  }, [from, to, emit])

  // « Y aller » : la destination est appliquée (effet externalTo ci-dessus,
  // même rendu) ; on lance la recherche « partir maintenant » seulement si
  // le départ est déjà résolu. « Ma position » doit avoir un fix récent : une
  // position périmée ou en cours d'acquisition garde ses annonces habituelles
  // et n'envoie rien. Premier rendu (signal 0) ignoré.
  const handledSubmitSignalRef = useRef(submitSignal)
  const [pendingGoTo, setPendingGoTo] = useState(false)
  useEffect(() => {
    if (submitSignal === handledSubmitSignalRef.current) return
    handledSubmitSignalRef.current = submitSignal
    setPendingGoTo(true)
  }, [submitSignal])
  useEffect(() => {
    if (!pendingGoTo || !to.place) return
    setPendingGoTo(false)
    if (loading) return
    let origin: FieldState | null = null
    if (from.special === 'myLocation') {
      const pos = freshPosition()
      if (!from.pending && pos) origin = myLocationField(pos)
    } else if (from.place) {
      origin = from
    }
    if (!origin) {
      if (!from.pending) fromRef.current?.focus()
      return
    }
    if (origin !== from) setFrom(origin)
    // « Y aller » = partir maintenant : l'heure choisie auparavant est oubliée.
    resetToNow()
    setNotice(null)
    emit(origin, to, true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingGoTo, to])

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    if (loading) return
    if (!fieldReady(from) || !fieldReady(to)) {
      // Plus de bouton grisé muet : on dit quoi faire et on va au champ.
      setNotice(t('ux_pickPlaces'))
      ;(fieldReady(from) ? toRef : fromRef).current?.focus()
      return
    }
    setNotice(null)
    // « Ma position » se résout À L'ENVOI avec la position la plus fraîche.
    const pos = freshPosition()
    let nextFrom = from
    let nextTo = to
    let needsFix = false
    for (const name of ['from', 'to'] as const) {
      const field = name === 'from' ? from : to
      if (field.special !== 'myLocation') continue
      const fieldFresh = field.place && field.fixAt && Date.now() - field.fixAt < POSITION_MAX_AGE_MS
      if (pos) {
        const resolved = myLocationField(pos)
        if (!resolved) { setField(name, EMPTY); return }
        if (name === 'from') nextFrom = resolved
        else nextTo = resolved
        setField(name, resolved)
      } else if (!fieldFresh) {
        needsFix = true
        setField(name, { value: '', special: 'myLocation', place: null, pending: true })
      }
    }
    if (needsFix) {
      submitAfterLocateRef.current = true
      setAnnouncement(t('locating'))
      geo.locate()
      return
    }
    emit(nextFrom, nextTo)
  }

  // ── Clavier dans la liste de suggestions (combobox) ───────────────────────
  type Option = { id: string; onPick: () => void; node: React.ReactNode }

  function optionsFor(name: FieldName): Option[] {
    const field = fieldState(name)
    const text = label(field)
    if (activeField !== name) return []
    if (text === '') {
      const opts: Option[] = []
      if (name === 'from') {
        opts.push({ id: 'me', onPick: handleUseMyLocation, node: <MyLocationRow /> })
      }
      for (const search of recentSearches) {
        opts.push({
          id: `rec-${search.id}`,
          onPick: () => selectRecent(search),
          node: <RecentRow search={search} />,
        })
      }
      return opts
    }
    if (field.place || field.special) return []
    return results[name].map((place) => ({
      id: `p-${place.id}`,
      onPick: () => selectPlace(name, place),
      node: <PlaceRow place={place} />,
    }))
  }

  function statusLine(name: FieldName): React.ReactNode {
    const field = fieldState(name)
    if (activeField !== name || field.place || field.special || label(field).trim().length < 2) return null
    const st = status[name]
    const count = results[name].length
    if (st === 'loading') return <LoadingRow text={t('searchingAddress')} />
    if (st === 'slow') return t('itin_geoSlow')
    if (st === 'unavailable') return t('itin_geoUnavailable')
    if ((st === 'ok' || st === 'empty') && count === 0) return t('itin_geoNoResults')
    return null
  }

  function handleKeyDown(name: FieldName, event: React.KeyboardEvent<HTMLInputElement>) {
    const options = optionsFor(name)
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      if (options.length === 0) return
      event.preventDefault()
      setActiveIndex((i) => {
        if (event.key === 'ArrowDown') return i + 1 >= options.length ? 0 : i + 1
        return i - 1 < 0 ? options.length - 1 : i - 1
      })
    } else if (event.key === 'Enter') {
      if (activeIndex >= 0 && activeIndex < options.length) {
        event.preventDefault()
        options[activeIndex].onPick()
      }
    } else if (event.key === 'Escape') {
      if (activeField === name) {
        event.preventDefault()
        setActiveField(null)
        setActiveIndex(-1)
      }
    }
  }

  function renderField(name: FieldName) {
    const field = fieldState(name)
    const inputRef = name === 'from' ? fromRef : toRef
    const options = optionsFor(name)
    const line = statusLine(name)
    const open = options.length > 0 || line !== null
    const listId = `${ids[name]}-list`
    const optionId = (i: number) => `${listId}-${i}`

    return (
      <div className={`relative flex min-h-[52px] items-center overflow-visible px-4 py-1.5 focus-within:ring-2 focus-within:ring-inset focus-within:ring-brand ${
        name === 'from' ? 'rounded-t-control' : 'rounded-b-control'
      }`}>
        {field.pending ? (
          <svg className="absolute start-[13px] top-1/2 z-10 h-3.5 w-3.5 -translate-y-1/2 animate-spin text-brand" fill="none" viewBox="0 0 24 24" aria-hidden="true">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.4 0 0 5.4 0 12h4z" />
          </svg>
        ) : (
          <div
            className={`absolute start-4 top-1/2 z-10 h-2 w-2 -translate-y-1/2 ${name === 'from' ? 'rounded-full bg-brand' : 'rounded-[2px] bg-ink-900'}`}
            aria-hidden="true"
          />
        )}
        <label htmlFor={ids[name]} className="sr-only">
          {name === 'from' ? t('from') : t('to')}
        </label>
        <input
          id={ids[name]}
          ref={inputRef}
          type="text"
          enterKeyHint={name === 'from' ? 'next' : 'search'}
          placeholder={field.pending ? t('locating') : name === 'from' ? t('fromPlaceholder') : t('toPlaceholder')}
          value={label(field)}
          onChange={(event) => handleChange(name, event.target.value)}
          onKeyDown={(event) => handleKeyDown(name, event)}
          onFocus={() => {
            setActiveField(name)
            setActiveIndex(-1)
            const text = label(field)
            if (!field.place && !field.special && text.length >= 2 && results[name].length === 0) {
              triggerSearch(name, text)
            }
          }}
          onBlur={(event) => {
            // Le clavier tabule de l'input vers la liste : refermer la liste
            // sur ce blur détruirait l'élément qui vient de recevoir le
            // focus. On ne referme que si le focus SORT du groupe champ +
            // menu. La souris reste couverte par le preventDefault du menu.
            const next = event.relatedTarget as Node | null
            const group = event.currentTarget.parentElement
            if (next && group?.contains(next)) return
            setTimeout(() => setActiveField((current) => (current === name ? null : current)), 200)
          }}
          className="w-full border-0 bg-transparent py-0 ps-5 pe-12 text-[16px] leading-[22px] text-ink-900 placeholder-ink-400 focus:outline-none focus:ring-0"
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          // Vide, dir=auto vaut LTR (spéc. HTML : le placeholder ne compte
          // pas) et le placeholder arabe partirait à gauche : on suit alors
          // la langue de l'interface, comme LineView.
          dir={label(field) ? 'auto' : locale === 'ar' ? 'rtl' : 'ltr'}
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={open}
          aria-controls={listId}
          aria-activedescendant={activeIndex >= 0 && activeIndex < options.length ? optionId(activeIndex) : undefined}
          aria-busy={field.pending || undefined}
        />
        {open && (
          <ul
            id={listId}
            role="listbox"
            aria-label={name === 'from' ? t('from') : t('to')}
            className="dropdown-animate absolute inset-x-0 top-full z-50 mt-2 max-h-64 overflow-y-auto rounded-card bg-white shadow-soft"
          >
            {options.map((option, i) => (
              <li
                key={option.id}
                id={optionId(i)}
                role="option"
                aria-selected={i === activeIndex}
                onMouseDown={(event) => event.preventDefault()}
                onClick={option.onPick}
                className={`flex min-h-[48px] cursor-pointer items-center gap-2.5 border-b border-line px-3 py-2.5 text-start transition-colors last:border-0 hover:bg-paper-2 ${
                  i === activeIndex ? 'bg-paper-2' : ''
                }`}
              >
                {option.node}
              </li>
            ))}
            {line !== null && (
              <li role="presentation" className="px-3 py-3 text-label text-ink-600">
                {line}
              </li>
            )}
          </ul>
        )}
      </div>
    )
  }

  const showQuickRecents = activeField === null && recentSearches.length > 0
  const waitingForFix = submitAfterLocateRef.current && (from.pending || to.pending)

  return (
    <motion.form
      onSubmit={handleSubmit}
      className="flex h-full flex-col bg-white px-5 pb-2"
      style={{ paddingTop: 'calc(env(safe-area-inset-top, 0px) + 20px)' }}
      initial={false}
      animate={visible ? { opacity: 1, y: 0 } : { opacity: 0.92, y: 12 }}
      transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
      noValidate
    >
      {/* En-tête accueil (maquettes 1a/1b) : glyphe + wordmark « Nouri ».
          Le glyphe est le logo — il ne se miroir jamais en RTL. */}
      <div className="flex shrink-0 items-center justify-between gap-3 pb-4">
        <h2 className="flex items-center gap-2 text-[22px] font-semibold leading-[26px] text-ink-900">
          <svg width="26" height="26" viewBox="0 0 48 48" fill="none" aria-hidden="true" className="shrink-0">
            <g transform="translate(-1 4.6)">
              <path d="M11 16 A13 13 0 0 0 36 19" stroke="#1D6FE0" strokeWidth="5" strokeLinecap="round" />
              <rect x="32.5" y="11" width="9" height="9" rx="2.5" fill="#1D6FE0" />
              <circle cx="22.5" cy="13.5" r="4.5" fill="#1D6FE0" />
            </g>
          </svg>
          {t('appName')}
        </h2>
        {headerAction}
      </div>

      <div className="relative shrink-0 overflow-visible rounded-control bg-paper-2">
        <div className="relative">{renderField('from')}</div>

        {/* Inversion départ/destination — bouton rond blanc planche 1f */}
        <button
          type="button"
          onClick={handleSwap}
          aria-label={t('ux_swap')}
          className="absolute end-3 top-1/2 z-20 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-full bg-white shadow-[0_1px_2px_rgba(16,24,40,0.05)] transition-transform active:scale-[0.97] after:absolute after:-inset-1 after:content-['']"
        >
          <svg
            width="15"
            height="15"
            viewBox="0 0 24 24"
            fill="none"
            style={{ transform: `rotate(${swapDeg}deg)`, transition: 'transform 340ms cubic-bezier(0.34, 1.56, 0.64, 1)' }}
            aria-hidden="true"
          >
            <path d="M8 4v13M8 17l-3.5-3.5M8 17l3.5-3.5M16 20V7M16 7l-3.5 3.5M16 7l3.5 3.5" stroke="#6B7280" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>

        <div className="ms-9 me-4 border-t border-line" aria-hidden="true" />

        <div className="relative">{renderField('to')}</div>
      </div>

      {/* Choix de l'heure (planche 1f) : « Départ maintenant ⌄ » — les
          contrôles ne se déplient qu'à la demande. Heure d'Alger. */}
      <div className="shrink-0 pt-2">
        <button
          type="button"
          onClick={() => { refreshNow(); setTimeOpen((v) => !v) }}
          aria-expanded={timeOpen}
          aria-controls={`${ids.time}-panel`}
          className="tap -mx-1 flex min-h-[44px] items-center gap-1.5 rounded-[8px] px-1 text-body font-medium text-ink-600"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <circle cx="12" cy="12" r="8.5" stroke="#6B7280" strokeWidth="1.8" />
            <path d="M12 7.5V12l3 2" stroke="#6B7280" strokeWidth="1.8" strokeLinecap="round" />
          </svg>
          <span className="tnum">{timeLabel}</span>
          {timeKind !== 'now' && showAlgiersTz && (
            <span className="text-label text-ink-400">({t('itin_algiersTime')})</span>
          )}
          <svg
            width="10"
            height="10"
            viewBox="0 0 10 10"
            fill="none"
            style={{ transform: timeOpen ? 'rotate(180deg)' : undefined, transition: 'transform 200ms ease' }}
            aria-hidden="true"
          >
            <path d="M2 4l3 3 3-3" stroke="#6B7280" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
        </button>

        {timeOpen && (
          <div id={`${ids.time}-panel`} className="flex min-h-[44px] flex-wrap items-center gap-x-4 gap-y-1">
            <label htmlFor={ids.time} className="sr-only">
              {t('ux_timeField')}{showAlgiersTz ? ` (${t('itin_algiersTime')})` : ''}
            </label>
            <input
              id={ids.time}
              ref={timeRef}
              type="time"
              value={departTime}
              onChange={(event) => {
                if (!event.target.value) return
                setDepartTime(event.target.value)
                setTimeTouched(true)
              }}
              className="tnum min-h-[40px] w-[104px] rounded-[8px] border-0 bg-paper-2 px-2 py-1 text-[16px] font-medium text-ink-900 focus:outline-none focus:ring-2 focus:ring-brand"
              dir="ltr"
            />
            <button
              type="button"
              onClick={toggleArriveBy}
              className={`tap relative min-h-[44px] rounded-[8px] px-1 text-body font-medium ${arriveBy ? 'text-brand' : 'text-ink-600'}`}
              aria-pressed={arriveBy}
            >
              {t('arriveBefore')}
            </button>
            {(timeTouched || arriveBy) && (
              <button
                type="button"
                onClick={resetToNow}
                className="tap relative min-h-[44px] rounded-[8px] px-1 text-body font-medium text-brand"
              >
                {t('ux_now')}
              </button>
            )}
            {showAlgiersTz && (
              <span className="text-label text-ink-400">{t('itin_algiersTime')}</span>
            )}
          </div>
        )}
      </div>

      {/* Zone médiane scrollable : Raccourcis puis Récents, sections séparées
          par une bande paper-2 de 8 px (règle de composition n°1) */}
      <div className="-mx-5 mt-2 min-h-0 flex-1 overflow-y-auto">
        {children && <div className="border-t-8 border-paper-2">{children}</div>}

        {showQuickRecents && (
          <div className="border-t-8 border-paper-2">
            <p className="px-5 pb-2 pt-3.5 text-label font-semibold uppercase tracking-[0.06em] text-ink-600">
              {t('recents')}
            </p>
            {recentSearches.slice(0, 3).map((search, i) => (
              <button
                key={search.id}
                type="button"
                onClick={() => selectRecent(search)}
                className={`tap flex min-h-[44px] w-full items-center gap-3 px-5 py-[13px] text-start ${i > 0 ? 'border-t border-line' : ''}`}
              >
                <span className="shrink-0 text-ink-400">
                  <RecentIcon size={18} />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-emph text-ink-900"><bdi>{endpointLabel(search.to, t)}</bdi></p>
                  <p className="truncate text-label text-ink-400">
                    {t('from2')} <bdi>{endpointLabel(search.from, t)}</bdi> · {relativeDay(search.timestamp, locale)}
                  </p>
                </div>
              </button>
            ))}
          </div>
        )}

        {/* Bug / contact — comble le blanc sous Récents. mailto honnête,
            aucun backend (voir FeedbackCard). */}
        <FeedbackCard context={feedbackContext} />
      </div>

      <div className="shrink-0 pb-2 pt-3">
        <button
          type="submit"
          disabled={loading}
          aria-disabled={!canSearch || undefined}
          className={`flex h-[50px] w-full items-center justify-center rounded-control bg-brand text-emph font-semibold text-white transition-colors active:bg-brand-dark disabled:cursor-not-allowed disabled:opacity-40 ${
            canSearch ? '' : 'opacity-40'
          }`}
        >
          {loading ? t('searching') : waitingForFix ? t('locating') : t('searchBtn')}
        </button>
        {(notice || geo.error) && (
          <p className="mt-2 text-center text-label text-ink-600" role="status">
            {notice ?? (geo.error ? t(geo.error) : null)}
          </p>
        )}
        {/* Annonces des listes et de la position pour les lecteurs d'écran. */}
        <p id={ids.live} className="visually-hidden" aria-live="polite" aria-atomic="true">
          {announcement}
        </p>
      </div>
    </motion.form>
  )
}

function endpointLabel(endpoint: RecentEndpoint, t: (key: TranslationKey) => string): string {
  if (endpoint.kind === 'myLocation') return t('myLocation')
  if (endpoint.kind === 'saved') return endpoint.key === 'home' ? t('homePlace') : t('workPlace')
  return endpoint.label
}

// Date relative des Récents (planche 1f : « depuis Télemly · hier »), au
// calendrier d'Alger, chiffres latins.
function relativeDay(timestamp: number, locale: Locale): string {
  const tag = locale === 'ar' ? 'ar-DZ-u-nu-latn' : locale === 'en' ? 'en-GB' : 'fr-FR'
  const daysAgo = -algiersDayDiff(timestamp)
  const shifted = new Date(timestamp + ALGIERS_OFFSET_MS)
  try {
    if (daysAgo <= 1) {
      return new Intl.RelativeTimeFormat(tag, { numeric: 'auto' }).format(-Math.max(0, daysAgo), 'day')
    }
    if (daysAgo < 7) {
      return new Intl.DateTimeFormat(tag, { weekday: 'long', timeZone: 'UTC' }).format(shifted)
    }
    return new Intl.DateTimeFormat(tag, { day: 'numeric', month: 'short', timeZone: 'UTC' }).format(shifted)
  } catch {
    return `${String(shifted.getUTCDate()).padStart(2, '0')}/${String(shifted.getUTCMonth() + 1).padStart(2, '0')}`
  }
}

function PlaceRow({ place }: { place: PlaceResult }) {
  return (
    <>
      {/* Un seul traitement : icône stroke grise. La pastille colorée
          d'avant imitait un badge de ligne alors qu'elle n'en désignait
          aucune — deux vocabulaires pour la même idée. */}
      <span className="shrink-0 text-ink-400">
        <ResultIcon kind={place.kind} stationType={place.stationType} />
      </span>
      <div className="min-w-0">
        <p className="truncate text-emph text-ink-900"><bdi>{place.name}</bdi></p>
        <p className="truncate text-label text-ink-400"><bdi>{place.fullName}</bdi></p>
      </div>
    </>
  )
}

function MyLocationRow() {
  const { t } = useTranslation()
  return (
    <>
      <span className="ms-1 h-2 w-2 shrink-0 rounded-full bg-brand" aria-hidden="true" />
      <p className="truncate text-emph font-medium text-ink-900">{t('myLocation')}</p>
    </>
  )
}

function RecentRow({ search }: { search: RecentSearch }) {
  const { t } = useTranslation()
  return (
    <>
      <span className="shrink-0 text-ink-400">
        <RecentIcon size={16} />
      </span>
      <p className="truncate text-body text-ink-600">
        <RouteLabel from={endpointLabel(search.from, t)} to={endpointLabel(search.to, t)} />
      </p>
    </>
  )
}

function LoadingRow({ text }: { text: string }) {
  return (
    <span className="flex items-center gap-2">
      <svg className="h-3 w-3 animate-spin" fill="none" viewBox="0 0 24 24" aria-hidden="true">
        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.4 0 0 5.4 0 12h4z" />
      </svg>
      {text}
    </span>
  )
}

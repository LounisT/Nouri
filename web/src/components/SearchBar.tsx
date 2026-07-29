'use client'

import { useState, useRef, useEffect, useCallback } from 'react'
import { motion } from 'framer-motion'
import { PlaceResult, searchPlaces, placeToCoordinate } from '@/lib/geocoding'
import { Coordinate } from '@/lib/otp'
import type { GeolocationState } from '@/hooks/useGeolocation'
import { useTranslation } from '@/hooks/useTranslation'
import { ResultIcon, RecentIcon } from '@/components/icons'
import FeedbackCard from '@/components/FeedbackCard'
import type { RecentSearch } from '@/hooks/useRecentSearches'
import type { Locale } from '@/lib/i18n'

interface SearchBarProps {
  onSearch: (from: Coordinate | null, to: Coordinate | null, date?: Date, arriveBy?: boolean) => void
  loading?: boolean
  recentSearches?: RecentSearch[]
  externalFrom?: Coordinate | null
  externalTo?: Coordinate | null
  visible?: boolean
  // Emplacement « Raccourcis » (planche 1f) : rendu entre l'heure et les récents.
  children?: React.ReactNode
  // Action de droite dans le titre (sélecteur de langue) — l'écran est l'accueil.
  headerAction?: React.ReactNode
  // Position partagée avec le reste de l'écran : une seule source, sinon
  // « Activer la localisation » (section à proximité) ne remplirait pas
  // le champ Départ situé juste au-dessus.
  geo: Pick<GeolocationState, 'lat' | 'lon' | 'error'> & { locate: () => void }
}

interface FieldState {
  value: string
  place: PlaceResult | null
}

export default function SearchBar({
  onSearch,
  loading,
  recentSearches = [],
  externalFrom,
  externalTo,
  visible = true,
  children,
  headerAction,
  geo,
}: SearchBarProps) {
  const [from, setFrom] = useState<FieldState>({ value: '', place: null })
  const [to, setTo] = useState<FieldState>({ value: '', place: null })
  const [fromResults, setFromResults] = useState<PlaceResult[]>([])
  const [toResults, setToResults] = useState<PlaceResult[]>([])
  const [activeField, setActiveField] = useState<'from' | 'to' | null>(null)
  const [loadingFrom, setLoadingFrom] = useState(false)
  const [loadingTo, setLoadingTo] = useState(false)
  const [departTime, setDepartTime] = useState(() => {
    const now = new Date()
    return `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`
  })
  const [arriveBy, setArriveBy] = useState(false)
  // Disclosure « Départ maintenant ⌄ » (planche 1f) : les contrôles d'heure
  // n'apparaissent qu'à la demande.
  const [timeOpen, setTimeOpen] = useState(false)
  const [timeTouched, setTimeTouched] = useState(false)
  const [swapDeg, setSwapDeg] = useState(0)

  const fromRef = useRef<HTMLInputElement>(null)
  const toRef = useRef<HTMLInputElement>(null)
  const fromAbort = useRef<AbortController | null>(null)
  const toAbort = useRef<AbortController | null>(null)
  const fromTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const toTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const { t, locale } = useTranslation()

  // Planche 1f : le départ se remplit avec « Ma position », pas une station.
  useEffect(() => {
    if (geo.lat === null || geo.lon === null) return
    const label = t('myLocation')
    setFrom({
      value: label,
      place: { id: 'my-location', name: label, fullName: label, lat: geo.lat, lon: geo.lon, kind: 'address' },
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [geo.lat, geo.lon])

  useEffect(() => {
    if (!externalFrom) return
    const name = externalFrom.name ?? `${externalFrom.lat.toFixed(4)}, ${externalFrom.lon.toFixed(4)}`
    setFrom({
      value: name,
      place: { id: 'map-from', name, fullName: name, lat: externalFrom.lat, lon: externalFrom.lon, kind: 'address' },
    })
  }, [externalFrom])

  useEffect(() => {
    if (!externalTo) return
    const name = externalTo.name ?? `${externalTo.lat.toFixed(4)}, ${externalTo.lon.toFixed(4)}`
    setTo({
      value: name,
      place: { id: 'map-to', name, fullName: name, lat: externalTo.lat, lon: externalTo.lon, kind: 'address' },
    })
  }, [externalTo])

  const triggerSearch = useCallback((
    query: string,
    setResults: (results: PlaceResult[]) => void,
    setSearching: (value: boolean) => void,
    abortRef: React.MutableRefObject<AbortController | null>,
    timerRef: React.MutableRefObject<ReturnType<typeof setTimeout> | null>,
  ) => {
    if (timerRef.current) clearTimeout(timerRef.current)
    abortRef.current?.abort()
    if (query.trim().length < 2) {
      setResults([])
      setSearching(false)
      return
    }

    const ctrl = new AbortController()
    abortRef.current = ctrl

    searchPlaces(query, ctrl.signal, locale).then((results) => {
      setResults(results.filter((result) => result.kind === 'station'))
    })

    timerRef.current = setTimeout(async () => {
      setSearching(true)
      try {
        const results = await searchPlaces(query, ctrl.signal, locale)
        setResults(results)
      } catch {
        // AbortError intentionally ignored.
      } finally {
        setSearching(false)
      }
    }, 150)
  }, [locale])

  function handleFromChange(value: string) {
    setFrom({ value, place: null })
    setActiveField('from')
    triggerSearch(value, setFromResults, setLoadingFrom, fromAbort, fromTimer)
  }

  function handleToChange(value: string) {
    setTo({ value, place: null })
    setActiveField('to')
    triggerSearch(value, setToResults, setLoadingTo, toAbort, toTimer)
  }

  function selectFrom(place: PlaceResult) {
    setFrom({ value: place.name, place })
    setFromResults([])
    setActiveField(null)
    toRef.current?.focus()
  }

  function selectTo(place: PlaceResult) {
    setTo({ value: place.name, place })
    setToResults([])
    setActiveField(null)
  }

  function selectRecent(search: RecentSearch) {
    setFrom({
      value: search.fromLabel,
      place: {
        id: 'rec-from',
        name: search.fromLabel,
        fullName: search.fromLabel,
        lat: search.fromCoord.lat,
        lon: search.fromCoord.lon,
        kind: 'address',
      },
    })
    setTo({
      value: search.toLabel,
      place: {
        id: 'rec-to',
        name: search.toLabel,
        fullName: search.toLabel,
        lat: search.toCoord.lat,
        lon: search.toCoord.lon,
        kind: 'address',
      },
    })
    setActiveField(null)
    setFromResults([])
    setToResults([])
  }

  function previewRecent(search: RecentSearch) {
    selectRecent(search)
    setActiveField(null)
  }

  function handleSwap() {
    setSwapDeg((value) => value + 180)
    setFrom(to)
    setTo(from)
  }

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    if (!from.place || !to.place) return

    const [hours, minutes] = departTime.split(':').map(Number)
    const date = new Date()
    date.setHours(hours, minutes, 0, 0)
    onSearch(placeToCoordinate(from.place), placeToCoordinate(to.place), date, arriveBy)
  }

  const canSearch = from.place !== null && to.place !== null
  const showFromRecents = activeField === 'from' && from.value === ''
  const showToRecents = activeField === 'to' && to.value === '' && recentSearches.length > 0
  // Toujours visible au repos (planche 1f montre les Récents champ rempli).
  const showQuickRecents = activeField === null && recentSearches.length > 0

  function handleUseMyLocation() {
    geo.locate()
    setActiveField(null)
  }
  const swapLabel = locale === 'ar'
    ? 'تبديل الانطلاق والوجهة'
    : locale === 'en'
      ? 'Swap origin and destination'
      : 'Inverser départ et destination'

  return (
    <motion.form
      onSubmit={handleSubmit}
      className="flex h-full flex-col bg-white px-5 pb-2"
      style={{ paddingTop: 'calc(env(safe-area-inset-top, 0px) + 20px)' }}
      initial={false}
      animate={visible ? { opacity: 1, y: 0 } : { opacity: 0.92, y: 12 }}
      transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
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
        <div className="relative">
          <div className="relative flex min-h-[52px] items-center overflow-visible px-4 py-1.5">
            <div className="absolute start-4 top-1/2 z-10 h-2 w-2 -translate-y-1/2 rounded-full bg-brand" aria-hidden="true" />
            <label htmlFor="search-from" className="sr-only">
              {t('from')}
            </label>
            <input
              id="search-from"
              ref={fromRef}
              type="text"
              placeholder={t('fromPlaceholder')}
              value={from.value}
              onChange={(event) => handleFromChange(event.target.value)}
              onFocus={() => {
                setActiveField('from')
                if (from.value.length >= 2 && fromResults.length === 0) {
                  triggerSearch(from.value, setFromResults, setLoadingFrom, fromAbort, fromTimer)
                }
              }}
              onBlur={(event) => {
                // Le clavier tabule de l'input vers la première suggestion :
                // refermer la liste sur ce blur détruirait l'élément qui vient
                // de recevoir le focus. On ne referme que si le focus SORT du
                // groupe champ + menu. La souris reste couverte par le
                // preventDefault des boutons du menu.
                const next = event.relatedTarget as Node | null
                const group = event.currentTarget.parentElement
                if (next && group?.contains(next)) return
                setTimeout(() => setActiveField((field) => field === 'from' ? null : field), 200)
              }}
              className="w-full border-0 bg-transparent py-0 ps-5 pe-12 text-[15px] text-ink-900 placeholder-ink-400 focus:outline-none focus:ring-0"
              autoComplete="off"
              aria-autocomplete="list"
              aria-expanded={activeField === 'from' && fromResults.length > 0}
              role="combobox"
              aria-controls="from-results"
            />
            {showFromRecents ? (
              <RecentDropdown searches={recentSearches} onSelect={selectRecent} onMyLocation={handleUseMyLocation} />
            ) : activeField === 'from' && (fromResults.length > 0 || loadingFrom) ? (
              <PlaceDropdown id="from-results" results={fromResults} loading={loadingFrom} onSelect={selectFrom} />
            ) : null}
          </div>
        </div>

        {/* Inversion départ/destination — bouton rond blanc planche 1f */}
        <button
          type="button"
          onClick={handleSwap}
          aria-label={swapLabel}
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

        <div className="relative">
          <div className="relative flex min-h-[52px] items-center overflow-visible px-4 py-1.5">
            <div className="absolute start-4 top-1/2 z-10 h-2 w-2 -translate-y-1/2 rounded-[2px] bg-ink-900" aria-hidden="true" />
            <label htmlFor="search-to" className="sr-only">
              {t('to')}
            </label>
            <input
              id="search-to"
              ref={toRef}
              type="text"
              placeholder={t('toPlaceholder')}
              value={to.value}
              onChange={(event) => handleToChange(event.target.value)}
              onFocus={() => {
                setActiveField('to')
                if (to.value.length >= 2 && toResults.length === 0) {
                  triggerSearch(to.value, setToResults, setLoadingTo, toAbort, toTimer)
                }
              }}
              onBlur={(event) => {
                // Le clavier tabule de l'input vers la première suggestion :
                // refermer la liste sur ce blur détruirait l'élément qui vient
                // de recevoir le focus. On ne referme que si le focus SORT du
                // groupe champ + menu. La souris reste couverte par le
                // preventDefault des boutons du menu.
                const next = event.relatedTarget as Node | null
                const group = event.currentTarget.parentElement
                if (next && group?.contains(next)) return
                setTimeout(() => setActiveField((field) => field === 'to' ? null : field), 200)
              }}
              className="w-full border-0 bg-transparent py-0 ps-5 pe-12 text-[15px] text-ink-900 placeholder-ink-400 focus:outline-none focus:ring-0"
              autoComplete="off"
              aria-autocomplete="list"
              aria-expanded={activeField === 'to' && toResults.length > 0}
              role="combobox"
              aria-controls="to-results"
            />

            {showToRecents ? (
              <RecentDropdown searches={recentSearches} onSelect={selectRecent} />
            ) : activeField === 'to' && (toResults.length > 0 || loadingTo) ? (
              <PlaceDropdown id="to-results" results={toResults} loading={loadingTo} onSelect={selectTo} />
            ) : null}
          </div>
        </div>

      </div>

      {/* Choix de l'heure (planche 1f) : « Départ maintenant ⌄ » — les
          contrôles ne se déplient qu'à la demande. */}
      <div className="shrink-0 pt-3">
        <button
          type="button"
          onClick={() => setTimeOpen((v) => !v)}
          aria-expanded={timeOpen}
          className="tap flex min-h-[30px] items-center gap-1.5 py-1.5 text-body font-medium text-ink-600"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <circle cx="12" cy="12" r="8.5" stroke="#6B7280" strokeWidth="1.8" />
            <path d="M12 7.5V12l3 2" stroke="#6B7280" strokeWidth="1.8" strokeLinecap="round" />
          </svg>
          <span className="tnum">
            {arriveBy
              ? `${t('arriveBefore')} ${departTime}`
              : timeTouched
                ? `${t('departing')} ${departTime}`
                : t('departNow')}
          </span>
          <svg
            width="10"
            height="10"
            viewBox="0 0 10 10"
            fill="none"
            style={{ transform: timeOpen ? 'rotate(180deg)' : undefined, transition: 'transform 200ms ease' }}
            aria-hidden="true"
          >
            <path d="M2 4l3 3 3-3" stroke="#9CA3AF" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
        </button>

        {timeOpen && (
          <div className="flex min-h-[36px] items-center gap-3">
            <input
              type="time"
              value={departTime}
              onChange={(event) => { setDepartTime(event.target.value); setTimeTouched(true) }}
              className="tnum w-[84px] border-0 bg-paper-2 px-2 py-1 text-body font-medium text-ink-900 rounded-[8px] focus:outline-none focus:ring-0"
              dir="ltr"
            />
            <button
              type="button"
              onClick={() => setArriveBy((value) => !value)}
              className={`tap relative after:absolute after:inset-x-0 after:-inset-y-[13px] after:content-[''] text-body font-medium ${arriveBy ? 'text-brand' : 'text-ink-400'}`}
              aria-pressed={arriveBy}
            >
              {t('arriveBefore')}
            </button>
          </div>
        )}
      </div>

      {/* Zone médiane scrollable : Raccourcis puis Récents, sections séparées
          par une bande paper-2 de 8 px (règle de composition n°1) */}
      <div className="-mx-5 mt-2.5 min-h-0 flex-1 overflow-y-auto">
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
                onClick={() => previewRecent(search)}
                className={`tap flex min-h-[44px] w-full items-center gap-3 px-5 py-[13px] text-start ${i > 0 ? 'border-t border-line' : ''}`}
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" className="shrink-0" aria-hidden="true">
                  <circle cx="12" cy="12" r="8.5" stroke="#9CA3AF" strokeWidth="1.8" />
                  <path d="M12 7.5V12l3 2" stroke="#9CA3AF" strokeWidth="1.8" strokeLinecap="round" />
                </svg>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-emph text-ink-900">{search.toLabel}</p>
                  <p className="truncate text-label text-ink-400">
                    {t('from2')} {search.fromLabel} · {relativeDay(search.timestamp, locale)}
                  </p>
                </div>
              </button>
            ))}
          </div>
        )}

        {/* Bug / contact — comble le blanc sous Récents. mailto honnête,
            aucun backend (voir FeedbackCard). */}
        <FeedbackCard />
      </div>

      <div className="shrink-0 pb-2 pt-3">
        <button
          type="submit"
          disabled={!canSearch || loading}
          className="flex h-[50px] w-full items-center justify-center rounded-control bg-brand text-emph font-semibold text-white transition-colors active:bg-brand-dark disabled:cursor-not-allowed disabled:opacity-40"
        >
          {loading ? t('searching') : t('searchBtn')}
        </button>
        {geo.error && (
          <p className="mt-2 text-center text-label text-ink-400" role="status" aria-live="polite">
            {t(geo.error)}
          </p>
        )}
      </div>
    </motion.form>
  )
}

// Date relative des Récents (planche 1f : « depuis Télemly · hier »).
function relativeDay(timestamp: number, locale: Locale): string {
  const intlLocale = locale === 'ar' ? 'ar-DZ' : locale === 'en' ? 'en-GB' : 'fr-FR'
  const d = new Date(timestamp)
  const startOfDay = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime()
  const diffDays = Math.round((startOfDay(new Date()) - startOfDay(d)) / 86400000)
  if (diffDays <= 1) {
    return new Intl.RelativeTimeFormat(intlLocale, { numeric: 'auto' }).format(-diffDays, 'day')
  }
  if (diffDays < 7) {
    return d.toLocaleDateString(intlLocale, { weekday: 'long' })
  }
  return d.toLocaleDateString(intlLocale, { day: 'numeric', month: 'short' })
}

function PlaceDropdown({
  id,
  results,
  loading,
  onSelect,
}: {
  id?: string
  results: PlaceResult[]
  loading: boolean
  onSelect: (place: PlaceResult) => void
}) {
  const { t } = useTranslation()

  return (
    <ul id={id} role="listbox" className="dropdown-animate absolute left-0 right-0 top-full z-50 mt-2 max-h-56 overflow-y-auto rounded-card bg-white shadow-soft">
      {results.map((place) => (
        <li key={place.id}>
          <button
            type="button"
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => onSelect(place)}
            className="flex w-full items-center gap-2.5 border-b border-line px-3 py-3 text-start text-sm transition-colors last:border-0 hover:bg-paper-2"
          >
            {/* Un seul traitement : icône stroke grise. La pastille colorée
                d'avant imitait un badge de ligne alors qu'elle n'en désignait
                aucune — deux vocabulaires pour la même idée. */}
            <span className="shrink-0 text-ink-400">
              <ResultIcon kind={place.kind} stationType={place.stationType} />
            </span>
            <div className="min-w-0">
              <p className="truncate text-emph text-ink-900">{place.name}</p>
              <p className="truncate text-label text-ink-400">{place.fullName}</p>
            </div>
          </button>
        </li>
      ))}

      {loading && results.length === 0 && (
        <li className="flex items-center gap-2 px-3 py-3 text-xs text-ink-400">
          <svg className="h-3 w-3 animate-spin" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.4 0 0 5.4 0 12h4z" />
          </svg>
          {t('searchingAddress')}
        </li>
      )}
    </ul>
  )
}

function RecentDropdown({ searches, onSelect, onMyLocation }: {
  searches: RecentSearch[]
  onSelect: (search: RecentSearch) => void
  onMyLocation?: () => void
}) {
  const { t } = useTranslation()

  return (
    <ul className="dropdown-animate absolute left-0 right-0 top-full z-50 mt-2 max-h-48 overflow-y-auto rounded-card bg-white shadow-soft">
      {onMyLocation && (
        <li>
          <button
            type="button"
            onMouseDown={(event) => event.preventDefault()}
            onClick={onMyLocation}
            className="flex w-full items-center gap-2.5 border-b border-line px-3 py-3 text-start transition-colors hover:bg-paper-2"
          >
            <span className="h-2 w-2 shrink-0 rounded-full bg-brand" aria-hidden="true" />
            <p className="truncate text-sm font-medium text-ink-900">{t('myLocation')}</p>
          </button>
        </li>
      )}
      {searches.length > 0 && (
        <li className="border-b border-line px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-ink-400">
          {t('recents')}
        </li>
      )}
      {searches.map((search) => (
        <li key={search.id}>
          <button
            type="button"
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => onSelect(search)}
            className="flex w-full items-center gap-2.5 border-b border-line px-3 py-3 text-start transition-colors last:border-0 hover:bg-paper-2"
          >
            <span className="shrink-0 text-ink-400">
              <RecentIcon size={16} />
            </span>
            <p className="truncate text-xs text-ink-600">{search.fromLabel} {t('routeArrow')} {search.toLabel}</p>
          </button>
        </li>
      ))}
    </ul>
  )
}


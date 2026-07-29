'use client'

import { useState, useRef, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { useSavedPlaces, SavedPlaceKey } from '@/hooks/useSavedPlaces'
import { searchPlaces } from '@/lib/geocoding'
import type { Coordinate } from '@/lib/otp'
import { useTranslation } from '@/hooks/useTranslation'
import { HomeIcon, WorkIcon, ResultIcon, TrashIcon } from '@/components/icons'

interface SavedPlacesProps {
  onSelect: (coord: Coordinate) => void
}

const PLACE_KEYS: SavedPlaceKey[] = ['home', 'work']

export default function SavedPlaces({ onSelect }: SavedPlacesProps) {
  const { places, savePlace, removePlace } = useSavedPlaces()
  const { t, locale } = useTranslation()
  const [editing, setEditing] = useState<SavedPlaceKey | null>(null)
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<Awaited<ReturnType<typeof searchPlaces>>>([])
  const [searching, setSearching] = useState(false)
  const [toast, setToast] = useState<string | null>(null)
  // Hauteur du clavier virtuel : la feuille est ancrée en bas, mais un champ
  // dans un élément `position: fixed` reste SOUS le clavier (le navigateur ne
  // peut pas faire défiler un élément fixe). On lit donc `visualViewport` et on
  // remonte la feuille d'autant — la seule méthode fiable sur iOS ET Android.
  const [keyboardInset, setKeyboardInset] = useState(0)
  // Le portail exige `document` : rendu client uniquement.
  const [mounted, setMounted] = useState(false)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const abortRef = useRef<AbortController | null>(null)
  // Dernière requête émise : on ignore une réponse lente devenue périmée.
  const queryRef = useRef('')
  // Bouton d'action de chaque rangée (« Modifier »/« Définir ») : à la
  // fermeture, le focus y revient. On NE dépend PAS de document.activeElement,
  // qui vaut souvent <body> après un tap sur mobile (iOS ne focalise pas les
  // boutons au tactile) — le focus retomberait alors en haut de page.
  const actionRefs = useRef<Partial<Record<SavedPlaceKey, HTMLButtonElement | null>>>({})
  const toastIdRef = useRef(0)
  const dialogRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => { setMounted(true) }, [])

  useEffect(() => {
    if (!editing || typeof window === 'undefined' || !window.visualViewport) {
      setKeyboardInset(0)
      return
    }
    const vv = window.visualViewport
    const update = () => {
      // Portion basse du viewport masquée par le clavier.
      setKeyboardInset(Math.max(0, window.innerHeight - vv.height - vv.offsetTop))
    }
    update()
    vv.addEventListener('resize', update)
    vv.addEventListener('scroll', update)
    return () => {
      vv.removeEventListener('resize', update)
      vv.removeEventListener('scroll', update)
    }
  }, [editing])

  function flashToast(message: string, ms = 1500) {
    // Un identifiant par toast : deux messages identiques rapprochés ne se
    // coupent pas l'un l'autre trop tôt.
    const id = ++toastIdRef.current
    setToast(message)
    setTimeout(() => setToast((current) => (toastIdRef.current === id ? null : current)), ms)
  }

  const getTranslatedLabel = (key: SavedPlaceKey) => (
    key === 'home' ? t('homePlace') : t('workPlace')
  )

  function handleChipPress(key: SavedPlaceKey) {
    const saved = places[key]
    if (saved) {
      onSelect({ lat: saved.lat, lon: saved.lon, name: getTranslatedLabel(key) })
    } else {
      openEdit(key)
    }
  }

  function openEdit(key: SavedPlaceKey) {
    setEditing(key)
    setQuery('')
    queryRef.current = ''
    setResults([])
  }

  function closeEdit() {
    const key = editing
    abortRef.current?.abort()
    if (timerRef.current) clearTimeout(timerRef.current)
    setSearching(false)
    setEditing(null)
    // Le focus revient au bouton d'action de la rangée éditée, une fois la
    // feuille démontée. rAF laisse React retirer le dialogue d'abord.
    requestAnimationFrame(() => {
      if (key) actionRefs.current[key]?.focus()
    })
  }

  function handleQueryChange(val: string) {
    setQuery(val)
    queryRef.current = val
    if (timerRef.current) clearTimeout(timerRef.current)
    abortRef.current?.abort()
    if (val.trim().length < 2) {
      setResults([])
      setSearching(false)
      return
    }
    const ctrl = new AbortController()
    abortRef.current = ctrl
    timerRef.current = setTimeout(async () => {
      setSearching(true)
      try {
        const res = await searchPlaces(val, ctrl.signal, locale)
        if (queryRef.current === val) setResults(res)   // ignore une réponse périmée
      } catch (err) {
        if (!(err instanceof Error && err.name === 'AbortError') && queryRef.current === val) {
          setResults([])
        }
      } finally {
        if (queryRef.current === val) setSearching(false)
      }
    }, 300)
  }

  function handleSelectResult(r: (typeof results)[0]) {
    if (!editing) return
    savePlace({
      key: editing,
      label: getTranslatedLabel(editing),
      lat: r.lat,
      lon: r.lon,
      address: r.fullName,
    })
    flashToast(t('savedToast'))
    closeEdit()
  }

  function handleRemovePlace() {
    if (!editing) return
    removePlace(editing)
    flashToast(t('removedToast'))
    closeEdit()
  }

  // Piège de focus : le dialogue est en portail au niveau body, sans quoi Tab
  // s'échapperait vers la page derrière. On boucle sur les éléments focusables
  // du dialogue.
  function handleDialogKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Escape') { closeEdit(); return }
    if (e.key !== 'Tab' || !dialogRef.current) return
    const focusables = dialogRef.current.querySelectorAll<HTMLElement>(
      'button, input, [href], [tabindex]:not([tabindex="-1"])',
    )
    if (focusables.length === 0) return
    const first = focusables[0]
    const last = focusables[focusables.length - 1]
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault()
      last.focus()
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault()
      first.focus()
    }
  }

  const overlay = editing && (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-ink-900/40"
      onClick={closeEdit}
      onKeyDown={handleDialogKeyDown}
    >
      {/* Feuille au CONTENU : petite quand rien n'est saisi (défaut « trop
          grande pour rien »), elle grandit avec les résultats jusqu'à un
          plafond, puis la liste défile. Remontée de `keyboardInset` pour que le
          champ ne passe jamais sous le clavier. */}
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="saved-place-title"
        className="sheet-in flex max-h-[85dvh] w-full max-w-lg flex-col rounded-t-sheet bg-white"
        style={{
          marginBottom: keyboardInset,
          paddingBottom: keyboardInset ? 8 : 'max(20px, env(safe-area-inset-bottom, 0px))',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mx-auto mt-2.5 h-1 w-9 shrink-0 rounded-full bg-line" aria-hidden="true" />

        <div className="flex shrink-0 items-center gap-2.5 px-5 pb-3 pt-4">
          <span className="text-ink-400">
            {editing === 'home' ? <HomeIcon size={20} /> : <WorkIcon size={20} />}
          </span>
          <p id="saved-place-title" className="text-title font-semibold text-ink-900">
            {(places[editing] ? t('editPlace') : t('setPlace'))} {getTranslatedLabel(editing)}
          </p>
        </div>

        <div className="shrink-0 px-5 pb-3">
          <input
            autoFocus
            type="text"
            value={query}
            onChange={(e) => handleQueryChange(e.target.value)}
            placeholder={t('searchAddressPlaceholder')}
            className="input-field"
          />
        </div>

        {/* Une seule ligne d'état à la fois, en gris : recherche en cours, puis
            « aucun résultat » — jamais un écran muet. */}
        {searching && (
          <p className="shrink-0 px-5 pb-3 text-label text-ink-400" role="status">{t('searching')}</p>
        )}
        {!searching && query.trim().length >= 2 && results.length === 0 && (
          <p className="shrink-0 px-5 pb-3 text-label text-ink-400" role="status">{t('noResults')}</p>
        )}

        {/* Résultats : `max-h` plutôt que `flex-1` — la feuille reste au contenu
            quand la liste est courte. `divide-y` pose un filet ENTRE les items
            seulement, jamais après le dernier (pas de filet doublé). */}
        {results.length > 0 && (
          <ul className="min-h-0 max-h-[46dvh] divide-y divide-line overflow-y-auto border-t border-line">
            {results.map((r) => (
              <li key={r.id}>
                <button
                  type="button"
                  onClick={() => handleSelectResult(r)}
                  className="tap flex min-h-[44px] w-full items-center gap-3 px-5 py-[13px] text-start active:bg-paper-2"
                >
                  <span className="shrink-0 text-ink-400">
                    <ResultIcon kind={r.kind} stationType={r.stationType} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-emph text-ink-900">{r.name}</span>
                    <span className="block truncate text-label text-ink-400">{r.fullName}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}

        {/* Suppression : seulement pour un lieu DÉJÀ enregistré. Séparée par la
            bande 8 px #F9FAFB de la planche — elle change de nature d'action,
            on ne la confond pas avec un résultat. Pas de rouge (réservé aux
            vraies erreurs) : corbeille + libellé, comme une action de menu. */}
        {places[editing] && (
          <>
            <div className="h-2 shrink-0 bg-paper-2" aria-hidden="true" />
            <button
              type="button"
              onClick={handleRemovePlace}
              className="tap flex min-h-[44px] shrink-0 items-center gap-3 px-5 py-[13px] text-start text-body text-ink-600 active:bg-paper-2"
            >
              <span className="shrink-0 text-ink-400"><TrashIcon /></span>
              {t('removePlaceAction')}
            </button>
          </>
        )}
      </div>
    </div>
  )

  const toastNode = toast && (
    // Centré par flexbox (propriété logique), jamais par `left-1/2` physique.
    <div className="pointer-events-none fixed inset-x-0 z-[60] flex justify-center"
      style={{ bottom: 'calc(54px + env(safe-area-inset-bottom, 0px) + 14px)' }}
    >
      <div
        className="rounded-control bg-ink-900 px-4 py-2.5 text-center text-body font-medium text-white shadow-soft"
        style={{ animation: 'toast-in 200ms ease-out' }}
        role="status"
        aria-live="polite"
      >
        {toast}
      </div>
    </div>
  )

  return (
    <>
      {/* Raccourcis (planche 1f) : rangées plates, icône stroke, action à droite */}
      <div>
        <p className="px-5 pb-2 pt-3.5 text-label font-semibold uppercase tracking-[0.06em] text-ink-600">
          {t('saved')}
        </p>
        {/* Rangée = deux boutons distincts : la zone principale utilise le lieu
            (ou l'ouvre à définir), l'action de droite « Modifier » ouvre
            l'édition. Deux <button> imbriqués seraient invalides — d'où le div.
            Un lieu enregistré reste ainsi modifiable ET supprimable, ce qui
            n'existait qu'au clic droit (absent sur mobile). */}
        {PLACE_KEYS.map((key, i) => {
          const translatedLabel = getTranslatedLabel(key)
          const saved = places[key]
          return (
            <div
              key={key}
              className={`flex items-center ${i === 0 ? 'border-b border-line' : ''}`}
            >
              <button
                type="button"
                onClick={() => handleChipPress(key)}
                className="tap flex min-h-[44px] flex-1 items-center gap-3 py-[13px] ps-5 pe-2 text-start active:bg-paper-2"
                title={saved ? saved.address : `${t('setPlace')} ${translatedLabel}`}
              >
                <span className="shrink-0 text-ink-400">
                  {key === 'home' ? <HomeIcon /> : <WorkIcon />}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-emph text-ink-900">{translatedLabel}</span>
                  {saved && (
                    <span className="block truncate text-label text-ink-400">{saved.address}</span>
                  )}
                </span>
              </button>
              <button
                ref={(el) => { actionRefs.current[key] = el }}
                type="button"
                onClick={() => openEdit(key)}
                className="tap min-h-[44px] shrink-0 pe-5 ps-3 text-body font-medium text-brand active:bg-paper-2"
                aria-label={`${saved ? t('editPlace') : t('setPlace')} ${translatedLabel}`}
              >
                {saved ? t('editPlace') : t('setPlace')}
              </button>
            </div>
          )
        })}
      </div>

      {/* Toast et feuille en PORTAIL au niveau body : SearchBar est un
          `motion.form` avec transform → contexte d'empilement qui piégeait
          l'overlay z-50 SOUS la barre d'onglets, et rendait le `fixed` du toast
          relatif au form au lieu du viewport. */}
      {mounted && createPortal(
        <>
          {toastNode}
          {overlay}
        </>,
        document.body,
      )}
    </>
  )
}

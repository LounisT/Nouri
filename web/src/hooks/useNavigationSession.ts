'use client'

// Session de navigation pas à pas : tout l'état vit ici (et plus dans
// page.tsx). La logique est la machine à états pure de lib/navigation.ts ;
// ce hook la nourrit (positions, horloge, « Je suis à bord »), la persiste
// pour survivre à un rechargement, et prépare les textes du bandeau.
//
// Rien n'est inventé : pas de compte à rebours, pas de « prochain bus à »,
// des heures toujours précédées de « ~ », et chaque dégradation (GPS perdu,
// imprécis, refusé, hors zone, hors trajet) est dite en toutes lettres.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { OtpItinerary, OtpLeg } from '@/lib/otp'
import {
  advance,
  buildLegGeometries,
  createNavState,
  navView,
  FRESH_FIX_MS,
  type LegGeometryCache,
  type NavState,
  type NavView,
} from '@/lib/navigation'
import { formatAlgiersTime } from '@/lib/algiers-time'
import { badgeColor, fill, formatMeters, formatMinutes, isolate, placeName, plural } from '@/lib/nav-format'
import { describeWalkStep, lowerFirst, simplifyWalkSteps } from '@/lib/walk-steps'
import { legHeadwayMin } from '@/lib/leg-headway'
import { useTranslation } from './useTranslation'
import { useUserPosition, type PositionMode, type UseUserPositionResult } from './useUserPosition'
import { useWakeLock } from './useWakeLock'

export interface NavSessionMeta {
  fromName?: string
  toName?: string
  /** Trajet fabriqué par le mode démo : jamais présenté comme réel. */
  demo?: boolean
}

export interface NavBanner {
  /** Petit libellé au-dessus de la consigne : « À pied », « Dans le bus »… */
  context: string
  /** Pastille de ligne (texte blanc, contraste AA). */
  badge: { text: string; color: string } | null
  /** Consigne principale, à placer dans une région live. */
  title: string
  /** Ligne secondaire : distance et durée, arrêts restants, direction… */
  detail: string | null
  /** Consigne à venir : prochaine rue à pied, fréquence de la ligne à l'arrêt. */
  hint: string | null
  /** « arrivée ~10:32 » (heure d'Alger), attentes prévues comprises. */
  eta: string | null
  /** 0 → 1 sur le tronçon courant. */
  progress: number
  /** Rangée « Ensuite ». */
  next: string | null
  /** Dégradation du suivi, dite en clair (GPS perdu, imprécis, refusé…). */
  note: string | null
  /** Hors trajet constaté (« Vous êtes à ~350 m du trajet prévu (GPS) »). */
  offRoute: string | null
  canReroute: boolean
  /** Bouton « Je suis à bord » (attente à l'arrêt, ou marche dont la position s'est perdue près de la station). */
  showBoardButton: boolean
  /** Le prochain arrêt est celui où descendre (constaté au GPS). */
  approach: boolean
  arrived: boolean
  /** Libellé du bouton de sortie : « Quitter la navigation » ou « Terminer ». */
  quitLabel: string
  /** Avancement estimé à l'horloge : l'interface peut le griser. */
  estimated: boolean
  /** Message temporaire (session reprise après rechargement). */
  notice: string | null
}

export interface NavigationSession {
  active: boolean
  itinerary: OtpItinerary | null
  meta: NavSessionMeta | null
  geometries: LegGeometryCache[] | null
  state: NavState | null
  view: NavView | null
  banner: NavBanner | null
  /** La position, partagée avec la carte et le formulaire (une seule session GPS). */
  position: UseUserPositionResult
  /** Session restaurée après un rechargement de la page. */
  resumed: boolean
  /** Une session quittée il y a peu peut être reprise. */
  canResume: boolean
  start: (itinerary: OtpItinerary, meta?: NavSessionMeta) => void
  quit: () => void
  resume: () => void
  /** « Je suis à bord » : indispensable sans GPS, et sous terre. */
  confirmBoarded: () => void
  /** Départ et arrivée d'un nouveau calcul depuis la position actuelle. */
  rerouteTarget: { from: { lat: number; lon: number }; to: { lat: number; lon: number; name: string } } | null
}

interface Session {
  itinerary: OtpItinerary
  meta: NavSessionMeta
  geometries: LegGeometryCache[]
  state: NavState
}

interface Stored {
  v: 1
  itinerary: OtpItinerary
  meta: NavSessionMeta
  state: NavState
  savedAt: number
}

const STORAGE_KEY = 'nouri.nav.session.v1'
/** Au-delà, une session interrompue n'est plus reprise d'elle-même. */
const RESUME_MAX_AGE_MS = 30 * 60_000
/** Une session quittée reste « reprenable » ce temps-là. */
const UNDO_QUIT_MS = 10 * 60_000
const TICK_MS = 5_000
/** Arrivé (constaté au GPS) : on relâche l'écran et le GPS après ce délai. */
const RELEASE_AFTER_ARRIVAL_MS = 120_000
const NOTICE_MS = 10_000

function readStored(): Stored | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Stored
    if (parsed?.v !== 1 || !parsed.itinerary?.legs?.length || parsed.state?.version !== 1) return null
    return parsed
  } catch {
    return null
  }
}

function writeStored(value: Stored | null) {
  try {
    if (value) window.localStorage.setItem(STORAGE_KEY, JSON.stringify(value))
    else window.localStorage.removeItem(STORAGE_KEY)
  } catch {
    // Stockage plein ou interdit (navigation privée) : la session continue,
    // elle ne survivra simplement pas à un rechargement.
  }
}

function vibrate(pattern: number | number[]) {
  try {
    if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') navigator.vibrate(pattern)
  } catch {
    // Certains navigateurs refusent hors geste utilisateur : sans importance.
  }
}

const isTransit = (leg: OtpLeg | undefined) => Boolean(leg) && leg!.mode !== 'WALK'

/** Distance restante (m) sous laquelle une marche sans position est « à la station ». */
const BOARD_OFFER_WALK_M = 150

/**
 * Marche vers un arrêt, position perdue (ou jamais obtenue) à moins de 150 m
 * de son bout : l'escalier d'une station souterraine coupe le GPS 40 à 100 m
 * avant le point de la station, et la machine à états ne peut plus constater
 * l'arrivée au quai. Seul l'usager peut alors dire qu'il est monté (R7).
 */
function walkBoardOffer(view: NavView, legs: OtpLeg[]): boolean {
  return view.phase === 'walk'
    && !view.arrived
    && !view.offRoute
    && view.source !== 'gps'
    && isTransit(legs[view.legIndex + 1])
    && view.remainingMeters <= BOARD_OFFER_WALK_M
}

/**
 * Tronçon que « Je suis à bord » ferait commencer maintenant, ou null si le
 * bouton n'a pas lieu d'être : à l'arrêt, ce tronçon ; sur la marche perdue
 * près de la station, le tronçon de transport qui suit. Pur (banc d'essai).
 */
export function boardTargetLeg(view: NavView, itinerary: OtpItinerary): number | null {
  if (view.phase === 'wait') return view.legIndex
  return walkBoardOffer(view, itinerary.legs) ? view.legIndex + 1 : null
}

/**
 * @param idlePosition suivi de position hors navigation : 'low' quand la
 *   carte est visible, 'off' sinon. En navigation, le hook passe lui-même en
 *   haute précision, puis relâche le GPS et l'écran deux minutes après une
 *   arrivée constatée.
 */
export function useNavigationSession({ idlePosition = 'off' }: { idlePosition?: PositionMode } = {}): NavigationSession {
  const { t, locale } = useTranslation()
  const [session, setSession] = useState<Session | null>(null)
  const [resumed, setResumed] = useState(false)
  const [noticeUntil, setNoticeUntil] = useState(0)
  const [now, setNow] = useState(() => Date.now())
  const lastQuitRef = useRef<{ session: Session; at: number } | null>(null)
  const [canResume, setCanResume] = useState(false)

  // ── Horloge : la source (GPS / perdu / horloge) et l'heure d'arrivée
  //    dépendent du temps qui passe, même sans nouvelle position.
  const active = session !== null
  useEffect(() => {
    if (!active) return
    setNow(Date.now())
    const id = setInterval(() => setNow(Date.now()), TICK_MS)
    return () => clearInterval(id)
  }, [active])

  const arrivedAt = session?.state.arrivedAt ?? null
  const released = arrivedAt !== null && now - arrivedAt > RELEASE_AFTER_ARRIVAL_MS
  const tracking = Boolean(session) && !released
  const position = useUserPosition(tracking ? 'high' : idlePosition)
  // L'écran reste allumé tant qu'on guide ; relâché après l'arrivée.
  useWakeLock(tracking)

  // ── Restauration après rechargement ──
  useEffect(() => {
    const stored = readStored()
    if (!stored) return
    const age = Date.now() - stored.savedAt
    const finished = stored.state.phase === 'arrived'
    if (age > RESUME_MAX_AGE_MS || finished) {
      writeStored(null)
      return
    }
    setSession({
      itinerary: stored.itinerary,
      meta: stored.meta,
      geometries: buildLegGeometries(stored.itinerary),
      state: stored.state,
    })
    setResumed(true)
    setNoticeUntil(Date.now() + NOTICE_MS)
  }, [])

  // ── Persistance : l'itinéraire à chaque nouvelle session, l'état au plus
  //    toutes les 10 s ou à chaque changement d'étape.
  const savedRef = useRef<{ itinerary: OtpItinerary | null; at: number; step: string }>({ itinerary: null, at: 0, step: '' })
  useEffect(() => {
    if (!session) return
    const step = `${session.state.legIndex}:${session.state.phase}`
    const saved = savedRef.current
    const nowMs = Date.now()
    if (saved.itinerary === session.itinerary && saved.step === step && nowMs - saved.at < 10_000) return
    writeStored({ v: 1, itinerary: session.itinerary, meta: session.meta, state: session.state, savedAt: nowMs })
    savedRef.current = { itinerary: session.itinerary, at: nowMs, step }
  }, [session])

  // ── Positions → machine à états ──
  const lastFixRef = useRef<number | null>(null)
  const fix = position.position
  useEffect(() => {
    if (!fix || !session) return
    if (lastFixRef.current === fix.receivedAt) return
    lastFixRef.current = fix.receivedAt
    // Position antérieure au départ (point de la carte d'il y a plusieurs
    // minutes) : elle ne dit rien de l'endroit où l'on commence.
    if (fix.receivedAt < session.state.startedAt - FRESH_FIX_MS) return
    setSession((s) => s && {
      ...s,
      state: advance(
        s.state,
        { type: 'fix', fix: { lon: fix.lon, lat: fix.lat, accuracy: fix.accuracy, receivedAt: fix.receivedAt, speed: fix.speed } },
        s.itinerary,
        s.geometries,
      ),
    })
  }, [fix, session])

  const start = useCallback((itinerary: OtpItinerary, meta: NavSessionMeta = {}) => {
    const geometries = buildLegGeometries(itinerary)
    const startedAt = Date.now()
    lastFixRef.current = null
    lastQuitRef.current = null
    setCanResume(false)
    setResumed(false)
    setNoticeUntil(0)
    setNow(startedAt)
    setSession({ itinerary, meta, geometries, state: createNavState(itinerary, geometries, startedAt) })
  }, [])

  const quit = useCallback(() => {
    setSession((s) => {
      if (s) lastQuitRef.current = { session: s, at: Date.now() }
      return null
    })
    setCanResume(true)
    setResumed(false)
    writeStored(null)
    savedRef.current = { itinerary: null, at: 0, step: '' }
  }, [])

  const resume = useCallback(() => {
    const last = lastQuitRef.current
    if (!last || Date.now() - last.at > UNDO_QUIT_MS) {
      setCanResume(false)
      return
    }
    lastQuitRef.current = null
    setCanResume(false)
    // L'état constaté reste valable ; la source redevient « GPS » dès la
    // prochaine position.
    setSession(last.session)
  }, [])

  const view = useMemo(
    () => (session ? navView(session.state, session.itinerary, session.geometries, Math.max(now, session.state.now)) : null),
    [session, now],
  )

  const confirmBoarded = useCallback(() => {
    setSession((s) => {
      if (!s) return s
      const nowMs = Date.now()
      const legIndex = boardTargetLeg(navView(s.state, s.itinerary, s.geometries, nowMs), s.itinerary)
      if (legIndex === null) return s
      return { ...s, state: advance(s.state, { type: 'boarded', now: nowMs, legIndex }, s.itinerary, s.geometries) }
    })
  }, [])

  // ── Alerte d'approche : « Descendez au prochain arrêt » + vibration, une
  //    fois par tronçon, seulement si c'est CONSTATÉ (jamais sur estimation).
  const approachLegRef = useRef<number | null>(null)
  useEffect(() => {
    if (!view?.approach) return
    if (approachLegRef.current === view.legIndex) return
    approachLegRef.current = view.legIndex
    vibrate([220, 120, 220])
  }, [view?.approach, view?.legIndex])
  const arrivedNotifiedRef = useRef(false)
  useEffect(() => {
    if (!session) {
      arrivedNotifiedRef.current = false
      approachLegRef.current = null
      return
    }
    if (view?.arrived && !arrivedNotifiedRef.current) {
      arrivedNotifiedRef.current = true
      vibrate([120, 80, 120])
    }
  }, [session, view?.arrived])

  const banner = useMemo(() => {
    if (!session || !view) return null
    return buildBanner({
      session,
      view,
      t,
      locale,
      now,
      positionError: position.error,
      outsideArea: position.outsideArea,
      notice: resumed && now < noticeUntil ? t('nav_resumed') : null,
    })
  }, [session, view, t, locale, now, position.error, position.outsideArea, resumed, noticeUntil])

  // Réévalué à chaque tic d'horloge (`now`) : sans nouvelle position, une
  // cible calculée il y a plusieurs minutes resterait valable indéfiniment et
  // « Recalculer depuis ma position » partirait d'un point périmé (R26).
  const rerouteTarget = useMemo(() => {
    if (!session || !position.position || position.outsideArea) return null
    const p = position.position
    if (Math.max(now, Date.now()) - p.receivedAt > 60_000) return null
    const last = session.itinerary.legs[session.itinerary.legs.length - 1]
    return {
      from: { lat: p.lat, lon: p.lon },
      to: { lat: last.to.lat, lon: last.to.lon, name: session.meta.toName ?? last.to.name },
    }
  }, [session, position.position, position.outsideArea, now])

  return {
    active,
    itinerary: session?.itinerary ?? null,
    meta: session?.meta ?? null,
    geometries: session?.geometries ?? null,
    state: session?.state ?? null,
    view,
    banner,
    position,
    resumed,
    canResume: canResume && !session,
    start,
    quit,
    resume,
    confirmBoarded,
    rerouteTarget,
  }
}

// ─── Textes du bandeau ──────────────────────────────────────────────────────

interface BannerInput {
  session: Session
  view: NavView
  t: ReturnType<typeof useTranslation>['t']
  locale: ReturnType<typeof useTranslation>['locale']
  now: number
  positionError: UseUserPositionResult['error']
  outsideArea: boolean
  notice: string | null
}

/** Girouette dans la langue de l'interface : arabe sourcé (otp.ts, localizeStops), sinon le terminus. */
function legHeadsignName(leg: OtpLeg, locale: ReturnType<typeof useTranslation>['locale']): string {
  if (locale === 'ar' && leg.headsignAr) return leg.headsignAr
  return placeName({ name: leg.headsign ?? leg.to.name }, locale)
}

export function buildBanner({ session, view, t, locale, now, positionError, outsideArea, notice }: BannerInput): NavBanner {
  const { itinerary, meta } = session
  const legs = itinerary.legs
  const leg = legs[view.legIndex]
  const nextLeg = legs[view.legIndex + 1]
  const isLast = view.legIndex === legs.length - 1
  const tilde = view.estimated ? '~' : ''
  const name = (place: { name: string; stopId?: string }) => isolate(placeName(place, locale))
  const destination = isolate(meta.toName ?? placeName(legs[legs.length - 1].to, locale))
  const line = isolate(leg.routeShortName ?? '')
  const headsign = isolate(legHeadsignName(leg, locale))
  const modeContext = leg.mode === 'SUBWAY' ? t('ctxMetro') : leg.mode === 'TRAM' ? t('ctxTram') : leg.mode === 'BUS' ? t('ctxBus') : t('ctxWalk')
  const badge = isTransit(leg) && leg.routeShortName ? { text: leg.routeShortName, color: badgeColor(leg.mode) } : null
  const legMinutes = (meters: number) => {
    const speed = leg.distance > 0 && leg.duration > 0 ? leg.distance / leg.duration : 1.2
    return meters / speed / 60
  }

  let context = modeContext
  let title: string
  let detail: string | null = null
  let hint: string | null = null
  let showBoardButton = false

  if (view.arrived) {
    title = t('navArrived')
    detail = destination
  } else if (view.timeElapsed) {
    title = t('nav_timeElapsed')
    detail = t('nav_timeElapsedDetail')
  } else if (view.phase === 'walk') {
    if (isTransit(nextLeg)) {
      const key = nextLeg.mode === 'SUBWAY' || nextLeg.mode === 'TRAM' ? 'nav_walkToStation' : 'nav_walkToStop'
      title = fill(t(key), { stop: name(leg.to) })
    } else {
      title = fill(t('nav_walkToPlace'), { place: isLast ? destination : name(leg.to) })
    }
    // Position perdue près de la station : la marche reste affichée telle
    // que constatée, mais l'usager peut dire qu'il est monté.
    showBoardButton = walkBoardOffer(view, legs)
    detail = `${tilde}${formatMeters(view.remainingMeters, locale)} · ~${formatMinutes(legMinutes(view.remainingMeters), t)}`
    // Consigne de rue : seulement sur position constatée, sinon elle mentirait.
    if (!view.estimated && !view.offRoute && !outsideArea && view.source === 'gps' && view.nextStepIndex !== null && view.metersToNextStep !== null) {
      const step = simplifyWalkSteps(leg)[view.nextStepIndex]
      if (step) {
        hint = fill(t('nav_inDistance'), {
          d: formatMeters(view.metersToNextStep, locale),
          step: locale === 'ar' ? describeWalkStep(step, t) : lowerFirst(describeWalkStep(step, t)),
        })
      }
    }
  } else if (view.phase === 'wait') {
    const rail = leg.mode === 'SUBWAY' || leg.mode === 'TRAM'
    context = `${t(rail ? 'nav_ctxStation' : 'nav_ctxStop')} · ${name(leg.from)}`
    title = fill(t(leg.mode === 'SUBWAY' ? 'nav_waitMetro' : leg.mode === 'TRAM' ? 'nav_waitTram' : 'nav_waitBus'), { line })
    detail = fill(t('nav_boardTowards'), { headsign })
    // Fréquence telle qu'OTP l'a utilisée pour les heures affichées
    // (frequencies.txt) : jamais de « prochain passage à HH:MM ».
    // Intervalle d'OTP, ou celui des départs du GTFS quand OTP n'en donne
    // plus (départs explicites) : leg-headway.ts, même règle que le détail.
    const headwayMin = legHeadwayMin(leg)
    hint = headwayMin !== null
      ? fill(t('nav_headway'), { n: headwayMin })
      : t('nav_headwayUnknown')
    showBoardButton = true
  } else {
    // À bord.
    const stopsLeft = view.stopsLeft ?? 1
    const alight = name(leg.to)
    if (view.estimated) {
      title = fill(t('nav_alightAt'), { stop: alight })
      detail = `~${plural(stopsLeft, 'nav_stopsLeft', t, locale)} · ${t('nav_estimated')}`
    } else if (stopsLeft <= 1) {
      title = t('nav_alightNext')
      detail = alight
    } else {
      const stops = leg.intermediateStops ?? []
      const nextStop = view.nextStopIndex !== null && view.nextStopIndex >= 0 ? stops[view.nextStopIndex] : leg.to
      title = fill(t('nav_nextStop'), { stop: name(nextStop ?? leg.to) })
      detail = `${plural(stopsLeft, 'nav_stopsLeft', t, locale)} · ${fill(t('nav_alightAt'), { stop: alight })}`
    }
  }

  // Rangée « Ensuite ».
  let next: string | null = null
  if (!view.arrived && !view.timeElapsed) {
    if (!nextLeg) {
      next = destination
    } else if (nextLeg.mode === 'WALK') {
      next = `${fill(t('nav_nextWalk'), { d: formatMeters(nextLeg.distance, locale), place: legs[view.legIndex + 1] === legs[legs.length - 1] ? destination : name(nextLeg.to) })} · ~${formatMinutes(nextLeg.duration / 60, t)}`
    } else {
      next = `${fill(t('nav_nextTransit'), {
        line: isolate(nextLeg.routeShortName ?? ''),
        headsign: isolate(legHeadsignName(nextLeg, locale)),
      })} · ~${formatMinutes(nextLeg.duration / 60, t)}`
    }
  }

  // Dégradations, de la plus grave à la plus bénigne. Hors trajet ET GPS
  // perdu se disent ensemble : l'écart affiché date de la dernière position.
  let note: string | null = null
  let offRoute: string | null = null
  if (!outsideArea && view.offRoute) {
    offRoute = fill(t('nav_offRoute'), { n: Math.max(100, Math.round(view.offRoute.meters / 50) * 50) })
  }
  if (outsideArea) {
    note = t('nav_outsideArea')
  } else if (view.source === 'time' && !view.arrived) {
    note = positionError === 'insecure'
      ? t('geoInsecure')
      : positionError === 'denied'
        ? `${t('geoDenied')} ${t('progressEstimated')}`
        : positionError
          ? `${t('geoUnavailable')} ${t('progressEstimated')}`
          : t('nav_locatingTime')
  } else if (view.source === 'stale' && !view.arrived) {
    const minutes = Math.max(1, Math.ceil((now - (view.lastFixAt ?? now)) / 60_000))
    note = view.coarseAccuracy !== null
      ? fill(t('nav_coarse'), { n: Math.round(view.coarseAccuracy) })
      : view.estimated
        ? fill(t('nav_staleRide'), { n: minutes })
        // À l'arrêt sans position (quai souterrain, par exemple — on ne
        // l'affirme pas) : seul l'usager peut dire qu'il est monté.
        // Même chose sur la marche, perdue près de la station (escalier).
        : fill(t(view.phase === 'wait' || showBoardButton ? 'nav_staleWait' : 'nav_stale'), { n: minutes })
  }

  // Mode démo : le trajet a été fabriqué faute de calculateur joignable.
  if (meta.demo) note = note ? `${t('demoNote')} ${note}` : t('demoNote')

  const eta = view.arrived || view.timeElapsed
    ? null
    : fill(t('nav_eta'), { time: isolate(formatAlgiersTime(view.etaMs)) })

  return {
    context,
    badge,
    title,
    detail,
    hint,
    eta,
    progress: view.phase === 'wait' ? 0 : view.legProgress,
    next,
    note,
    offRoute,
    // Recalcul seulement depuis une position actuelle : périmée, il partirait
    // de l'endroit d'il y a plusieurs minutes sous le nom « Ma position ».
    canReroute: Boolean(view.offRoute) && !outsideArea && view.source === 'gps',
    showBoardButton,
    approach: view.approach,
    arrived: view.arrived,
    quitLabel: view.arrived || view.timeElapsed ? t('nav_finish') : t('quitNav'),
    estimated: view.estimated,
    notice,
  }
}

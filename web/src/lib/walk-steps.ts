// Consignes de marche rue par rue, tirées des « steps » renvoyés par OTP
// (relativeDirection, streetName, distance). OTP en fournit une douzaine par
// trajet ; l'app les jetait et se contentait de « Marcher 2,5 km ».
//
// Rien n'est inventé : on ne fait que regrouper ce qu'OTP renvoie et le
// traduire. Les noms génériques d'OSM (« route sans nom », « chemin
// piétonnier », bogusName=true) ne sont pas des noms de rue : on les tait.
import type { OtpLeg } from './otp'
import type { TranslationKey } from './i18n'
import { fill, isolate, type Translate } from './nav-format'

export interface OtpWalkStep {
  distance: number
  relativeDirection?: string
  absoluteDirection?: string
  streetName?: string
  bogusName?: boolean
  stayOn?: boolean
  area?: boolean
  lat: number
  lon: number
}

export interface WalkStep {
  /** relativeDirection d'OTP (DEPART, LEFT, CONTINUE…). */
  relative: string
  absolute?: string
  /** Nom de rue réel, ou null si OSM n'en a pas (nom générique). */
  street: string | null
  stairs: boolean
  /** Mètres parcourus depuis le début de cette consigne. */
  distance: number
  /** Point où la consigne commence (là où il faut tourner). */
  lat: number
  lon: number
}

/** Steps bruts d'un tronçon (le champ n'est pas encore typé dans otp.ts). */
export function rawWalkSteps(leg: OtpLeg): OtpWalkStep[] {
  const steps = (leg as OtpLeg & { steps?: OtpWalkStep[] }).steps
  if (!Array.isArray(steps)) return []
  return steps.filter((s) => Number.isFinite(s?.lat) && Number.isFinite(s?.lon) && Number.isFinite(s?.distance))
}

const STAIRS = /escalier|stairs|steps/i
const MILD = new Set(['CONTINUE', 'SLIGHTLY_LEFT', 'SLIGHTLY_RIGHT'])

/**
 * Regroupe les steps d'OTP en consignes utiles :
 * - un bout de voie sans nom pris tout droit s'ajoute à la consigne d'avant ;
 * - deux steps de suite dans la même rue, sans vrai virage, n'en font qu'un.
 * Un vrai virage vers une voie sans nom reste (« Tournez à gauche ») : c'est
 * une information, même sans nom.
 */
export function simplifyWalkSteps(leg: OtpLeg): WalkStep[] {
  const out: WalkStep[] = []
  for (const step of rawWalkSteps(leg)) {
    const relative = step.relativeDirection ?? 'CONTINUE'
    const generic = step.bogusName === true || !step.streetName?.trim()
    const stairs = generic && STAIRS.test(step.streetName ?? '')
    const street = generic ? null : step.streetName!.trim()
    const prev = out[out.length - 1]
    const mild = MILD.has(relative)
    if (prev && relative !== 'DEPART' && mild && !stairs && (street === null || street === prev.street)) {
      prev.distance += step.distance
      continue
    }
    out.push({
      relative,
      absolute: step.absoluteDirection,
      street,
      stairs,
      distance: step.distance,
      lat: step.lat,
      lon: step.lon,
    })
  }
  return out
}

const TURN_KEYS: Record<string, TranslationKey> = {
  LEFT: 'nav_turn_left',
  RIGHT: 'nav_turn_right',
  SLIGHTLY_LEFT: 'nav_turn_slightLeft',
  SLIGHTLY_RIGHT: 'nav_turn_slightRight',
  HARD_LEFT: 'nav_turn_hardLeft',
  HARD_RIGHT: 'nav_turn_hardRight',
  UTURN_LEFT: 'nav_turn_uturn',
  UTURN_RIGHT: 'nav_turn_uturn',
  CIRCLE_CLOCKWISE: 'nav_turn_roundabout',
  CIRCLE_COUNTERCLOCKWISE: 'nav_turn_roundabout',
  ELEVATOR: 'nav_turn_elevator',
  ENTER_STATION: 'nav_turn_enterStation',
  EXIT_STATION: 'nav_turn_exitStation',
  FOLLOW_SIGNS: 'nav_turn_followSigns',
  CONTINUE: 'nav_turn_continue',
}

const DIR_KEYS: Record<string, TranslationKey> = {
  NORTH: 'nav_dir_north',
  NORTHEAST: 'nav_dir_northeast',
  EAST: 'nav_dir_east',
  SOUTHEAST: 'nav_dir_southeast',
  SOUTH: 'nav_dir_south',
  SOUTHWEST: 'nav_dir_southwest',
  WEST: 'nav_dir_west',
  NORTHWEST: 'nav_dir_northwest',
}

/** « Tournez à droite sur Rue Slimane Hocine », dans la langue de l'interface. */
export function describeWalkStep(step: WalkStep, t: Translate): string {
  if (step.stairs) return t('nav_step_stairs')
  const street = step.street ? isolate(step.street) : null
  if (step.relative === 'DEPART') {
    const dirKey = step.absolute ? DIR_KEYS[step.absolute] : undefined
    const dir = dirKey ? t(dirKey) : null
    if (dir && street) return fill(t('nav_step_departOn'), { dir, street })
    if (dir) return fill(t('nav_step_depart'), { dir })
    return street ? fill(t('nav_step_continueOn'), { street }) : t('nav_turn_continue')
  }
  if (step.relative === 'CONTINUE') {
    return street ? fill(t('nav_step_continueOn'), { street }) : t('nav_turn_continue')
  }
  const turn = t(TURN_KEYS[step.relative] ?? 'nav_turn_continue')
  return street ? fill(t('nav_step_onto'), { turn, street }) : turn
}

/** Première lettre en minuscule (« Dans 120 m, tournez… ») — sans effet en arabe. */
export function lowerFirst(text: string): string {
  return text.charAt(0).toLocaleLowerCase() + text.slice(1)
}

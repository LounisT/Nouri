// Heure d'Alger, indépendante du fuseau du téléphone (diaspora, voyageurs).
// Africa/Algiers = UTC+1 toute l'année (pas d'heure d'été) : un décalage fixe
// suffit et évite toute dépendance à Intl.timeZone sur les vieux navigateurs.
export const ALGIERS_OFFSET_MS = 60 * 60 * 1000

export interface AlgiersParts {
  year: number
  month: number // 1-12
  day: number
  hour: number
  minute: number
  /** 0 = dimanche … 5 = vendredi, 6 = samedi */
  weekday: number
  /** minutes depuis minuit, heure d'Alger */
  minutesOfDay: number
}

export function algiersParts(epochMs: number = Date.now()): AlgiersParts {
  const d = new Date(epochMs + ALGIERS_OFFSET_MS)
  const hour = d.getUTCHours()
  const minute = d.getUTCMinutes()
  return {
    year: d.getUTCFullYear(),
    month: d.getUTCMonth() + 1,
    day: d.getUTCDate(),
    hour,
    minute,
    weekday: d.getUTCDay(),
    minutesOfDay: hour * 60 + minute,
  }
}

const pad = (n: number) => String(n).padStart(2, '0')

/** Date et heure au format attendu par OTP (date=YYYY-MM-DD, time=HH:mm), heure d'Alger. */
export function algiersOtpDateTime(epochMs: number = Date.now()): { date: string; time: string } {
  const p = algiersParts(epochMs)
  return { date: `${p.year}-${pad(p.month)}-${pad(p.day)}`, time: `${pad(p.hour)}:${pad(p.minute)}` }
}

/** « 14:05 » à l'heure d'Alger, chiffres latins dans toutes les langues. */
export function formatAlgiersTime(epochMs: number): string {
  const p = algiersParts(epochMs)
  return `${pad(p.hour)}:${pad(p.minute)}`
}

/** Instant (epoch ms) correspondant à YYYY-MM-DD HH:mm, heure d'Alger. */
export function algiersToEpoch(date: string, time: string): number {
  const [y, m, d] = date.split('-').map(Number)
  const [h, mi] = time.split(':').map(Number)
  return Date.UTC(y, m - 1, d, h, mi) - ALGIERS_OFFSET_MS
}

const DAY_MS = 24 * 60 * 60 * 1000

/** Date OTP (YYYY-MM-DD) décalée de `days` jours dans le calendrier d'Alger. */
export function addAlgiersDays(date: string, days: number): string {
  return algiersOtpDateTime(algiersToEpoch(date, '12:00') + days * DAY_MS).date
}

/**
 * Écart en jours calendaires (heure d'Alger) entre deux instants :
 * 0 = même jour, 1 = lendemain. Sert au libellé « demain » des trajets de nuit.
 */
export function algiersDayDiff(epochMs: number, refMs: number = Date.now()): number {
  const day = (ms: number) => Math.floor((ms + ALGIERS_OFFSET_MS) / DAY_MS)
  return day(epochMs) - day(refMs)
}

/**
 * Vrai quand l'horloge du téléphone affiche déjà l'heure d'Alger à cet instant
 * (Alger, mais aussi tout fuseau UTC+1 ce jour-là). Sinon l'interface doit
 * préciser « heure d'Alger » à côté des horaires.
 */
export function deviceShowsAlgiersTime(epochMs: number = Date.now()): boolean {
  return new Date(epochMs).getTimezoneOffset() === -ALGIERS_OFFSET_MS / 60000
}

/**
 * Jour court à l'heure d'Alger (« mar. 10 nov. », « Tue 10 Nov »), chiffres
 * latins dans toutes les langues. Intl formate en UTC une date déjà décalée :
 * aucune dépendance aux bases de fuseaux des vieux navigateurs.
 */
export function formatAlgiersDay(epochMs: number, locale: 'fr' | 'ar' | 'en' = 'fr'): string {
  const shifted = new Date(epochMs + ALGIERS_OFFSET_MS)
  const tag = locale === 'ar' ? 'ar-DZ-u-nu-latn' : locale === 'en' ? 'en-GB' : 'fr-FR'
  try {
    return new Intl.DateTimeFormat(tag, {
      weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC',
    }).format(shifted)
  } catch {
    const p = algiersParts(epochMs)
    return `${pad(p.day)}/${pad(p.month)}`
  }
}

/**
 * Heure choisie dans un champ « HH:mm » (heure d'Alger) → date + heure OTP.
 * Une heure déjà passée de plus de `graceMin` minutes désigne le lendemain :
 * à 23:30, « 06:00 » veut dire demain matin, pas ce matin.
 */
export function algiersWhenForTime(
  time: string,
  nowMs: number = Date.now(),
  graceMin = 60,
): { date: string; time: string } {
  const m = /^(\d{1,2}):(\d{2})/.exec(time.trim())
  const now = algiersOtpDateTime(nowMs)
  if (!m) return now
  const hh = pad(Math.min(23, Number(m[1])))
  const mm = pad(Math.min(59, Number(m[2])))
  const chosen = `${hh}:${mm}`
  const todayEpoch = algiersToEpoch(now.date, chosen)
  if (todayEpoch < nowMs - graceMin * 60000) {
    return { date: addAlgiersDays(now.date, 1), time: chosen }
  }
  return { date: now.date, time: chosen }
}

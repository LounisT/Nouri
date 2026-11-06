// « Signaler une erreur » depuis la fiche d'un arrêt : un mailto pré-rempli
// avec ce que l'usager voit (arrêt, coordonnées, lignes et sens affichés).
// Pas de backend, aucun envoi silencieux : l'usager relit et envoie lui-même.
// Les défauts de données (arrêt mal placé, sens faux, ligne fantôme) ne se
// confirment que sur le terrain — sans contexte, personne ne les signale.

import { formatAlgiersTime, algiersOtpDateTime } from './algiers-time'
import type { Locale } from './i18n'

export const REPORT_EMAIL = 'contact@lounis.dev'

export interface StopReportContext {
  subject: string
  /** Phrase d'invite, dans la langue de l'usager. */
  intro: string
  stopName: string
  lat: number
  lon: number
  /** Rangées affichées (« 88 → Ben Aknoun »). */
  rows: string[]
  locale: Locale
}

export function stopReportMailto(ctx: StopReportContext): string {
  const now = Date.now()
  const { date } = algiersOtpDateTime(now)
  // Bloc de contexte technique, identique dans les trois langues : il sert à
  // retrouver l'arrêt dans les données, pas à être lu par l'usager.
  const body = [
    ctx.intro,
    '',
    '',
    '— Nouri —',
    `stop: ${ctx.stopName}`,
    `lat,lon: ${ctx.lat.toFixed(5)},${ctx.lon.toFixed(5)}`,
    `lines: ${ctx.rows.join(' ; ') || '-'}`,
    `lang: ${ctx.locale}`,
    `date: ${date} ${formatAlgiersTime(now)} (Africa/Algiers)`,
  ].join('\n')
  return `mailto:${REPORT_EMAIL}?subject=${encodeURIComponent(ctx.subject)}&body=${encodeURIComponent(body)}`
}

// « Signaler une erreur » contextuel : un mailto pré-rempli avec ce que
// l'usager regarde (ligne et sens, arrêt et coordonnées, ou trajet demandé et
// ses tronçons). Pas de backend, aucun envoi silencieux : l'usager relit et
// envoie lui-même depuis son client mail.
//
// Les défauts de données (arrêt mal placé, sens faux, ligne fantôme, tracé
// douteux) ne se confirment que sur le terrain. Sans contexte, personne ne
// les signale : il faudrait revenir à l'accueil et tout décrire de mémoire.
//
// Utilisable partout (carte, catalogue, itinéraire) :
//   <ReportLink context={{ kind: 'line', line: '88', direction: 'Ben Aknoun' }} />
// ou, hors React : reportMailto(context, locale).

import { algiersOtpDateTime, formatAlgiersTime } from './algiers-time'
import { translate, type Locale } from './i18n'

export const REPORT_EMAIL = 'contact@lounis.dev'

export interface ReportPoint {
  name?: string
  lat: number
  lon: number
}

export type ReportContext =
  /** Retour libre (bas de l'accueil). */
  | { kind: 'general' }
  /** Fiche de ligne : numéro, sens affiché, et l'arrêt touché s'il y en a un. */
  | {
      kind: 'line'
      line: string
      mode?: 'metro' | 'tram' | 'bus' | string
      /** Terminus ou libellé du sens tel qu'affiché. */
      direction?: string
      stop?: ReportPoint
    }
  /** Fiche d'arrêt : nom, position et lignes affichées (« 88 → Ben Aknoun »). */
  | { kind: 'stop'; stop: ReportPoint; lines?: string[] }
  /** Itinéraire : extrémités, heure demandée, résumé des tronçons. */
  | {
      kind: 'itinerary'
      from: ReportPoint
      to: ReportPoint
      /** Heure demandée, heure d'Alger : « 2026-11-09 08:30 », ou absent = « maintenant ». */
      requested?: string
      arriveBy?: boolean
      /** Un tronçon par entrée : « BUS 88 Chevalley → Dar Diaf 08:12–08:31 ». */
      legs?: string[]
    }

const short = (text: string, max = 60) => (text.length > max ? `${text.slice(0, max - 1)}…` : text)

/** Objet du mail, dans la langue de l'usager. */
export function reportSubject(ctx: ReportContext, locale: Locale): string {
  switch (ctx.kind) {
    case 'line':
      return translate(locale, 'ux_reportSubjectLine', { line: ctx.line })
    case 'stop':
      return translate(locale, 'ux_reportSubjectStop', { name: short(ctx.stop.name ?? '?') })
    case 'itinerary':
      return translate(locale, 'ux_reportSubjectTrip', {
        from: short(ctx.from.name ?? '?', 40),
        to: short(ctx.to.name ?? '?', 40),
      })
    default:
      return translate(locale, 'ux_reportSubjectGeneral')
  }
}

/** Résumé d'une ligne, lisible par l'usager, pour la carte « Nous écrire ». */
export function reportSummary(ctx: ReportContext, locale: Locale): string | null {
  switch (ctx.kind) {
    case 'line':
      return [translate(locale, 'ux_reportLine', { line: ctx.line }), ctx.direction, ctx.stop?.name]
        .filter(Boolean)
        .join(' · ')
    case 'stop':
      return translate(locale, 'ux_reportStop', { name: ctx.stop.name ?? '?' })
    case 'itinerary':
      return translate(locale, 'ux_reportTrip', { from: ctx.from.name ?? '?', to: ctx.to.name ?? '?' })
    default:
      return null
  }
}

const coord = (p: ReportPoint) => `${p.lat.toFixed(5)},${p.lon.toFixed(5)}`

/**
 * Bloc technique joint au message, identique dans les trois langues : il sert
 * à retrouver l'objet dans les données (GTFS, OSM), pas à être lu.
 */
export function reportContextLines(ctx: ReportContext, locale: Locale, nowMs: number = Date.now()): string[] {
  const lines: string[] = ['— Nouri —']
  switch (ctx.kind) {
    case 'line':
      lines.push(`line: ${ctx.line}${ctx.mode ? ` (${ctx.mode})` : ''}`)
      if (ctx.direction) lines.push(`direction: ${ctx.direction}`)
      if (ctx.stop) lines.push(`stop: ${ctx.stop.name ?? '-'} @ ${coord(ctx.stop)}`)
      break
    case 'stop':
      lines.push(`stop: ${ctx.stop.name ?? '-'}`)
      lines.push(`lat,lon: ${coord(ctx.stop)}`)
      if (ctx.lines?.length) lines.push(`lines: ${ctx.lines.join(' ; ')}`)
      break
    case 'itinerary':
      lines.push(`from: ${ctx.from.name ?? '-'} @ ${coord(ctx.from)}`)
      lines.push(`to: ${ctx.to.name ?? '-'} @ ${coord(ctx.to)}`)
      lines.push(`requested: ${ctx.requested ?? 'now'}${ctx.arriveBy ? ' (arrive by)' : ''}`)
      for (const leg of ctx.legs ?? []) lines.push(`leg: ${leg}`)
      break
    default:
      break
  }
  const { date } = algiersOtpDateTime(nowMs)
  lines.push(`lang: ${locale}`)
  lines.push(`build: ${process.env.NEXT_PUBLIC_BUILD_ID || 'dev'}`)
  lines.push(`sent: ${date} ${formatAlgiersTime(nowMs)} (Africa/Algiers)`)
  return lines
}

/**
 * Lien mailto complet. `message` : texte déjà saisi par l'usager (carte
 * « Nous écrire ») ; sinon une invite à compléter.
 */
export function reportMailto(ctx: ReportContext, locale: Locale, message?: string): string {
  const body = [
    message?.trim() || translate(locale, 'ux_reportIntro'),
    '',
    '',
    ...(ctx.kind === 'general' && !message ? [] : reportContextLines(ctx, locale)),
  ].join('\n')
  return `mailto:${REPORT_EMAIL}?subject=${encodeURIComponent(reportSubject(ctx, locale))}&body=${encodeURIComponent(body)}`
}

// Fond de carte et habillage MapLibre : thème clair/sombre, libellés dans la
// langue de l'interface, plugin d'écriture arabe, style de repli quand le plan
// des rues ne charge pas. Module client uniquement (MapView est importé avec
// ssr:false).

import maplibregl from 'maplibre-gl'
import type { Locale } from './i18n'
import { contrastRatio } from './map-badges'

// ── Écriture arabe ──────────────────────────────────────────────────────────
// Sans ce plugin, MapLibre 4 n'applique ni la liaison des lettres ni l'ordre
// droite-à-gauche : « حسيبة بن بوعلي » s'affichait en lettres isolées et à
// l'envers sur tout le fond de carte. Version 0.2.3 servie par le site (donc
// précachée pour le hors-ligne) : la 0.3.x s'enregistre de façon asynchrone et
// n'est acceptée qu'à partir de maplibre-gl 5.
export const RTL_PLUGIN_URL = '/vendor/mapbox-gl-rtl-text-0.2.3.min.js'

export function ensureRtlTextPlugin(): void {
  try {
    const status = maplibregl.getRTLTextPluginStatus()
    // « deferred » = déjà demandé en paresseux : rien à refaire.
    if (status === 'unavailable') {
      // Paresseux : le fichier (200 Ko) n'est chargé qu'à la première tuile
      // qui contient de l'arabe.
      maplibregl.setRTLTextPlugin(RTL_PLUGIN_URL, true).catch(() => {})
    }
  } catch {
    // Plugin déjà enregistré (rechargement à chaud) : sans conséquence.
  }
}

// ── Style de repli ──────────────────────────────────────────────────────────
// Quand le style distant échoue (hors connexion, métro souterrain), la carte
// restait grise avec « Chargement… » et sans le trajet. Ce style minimal, sans
// aucune ressource distante, laisse l'événement de chargement se produire :
// lignes, trajet et position s'affichent sur un fond neutre.
// Couleur claire : applyBaseMapTheme l'assombrit en mode sombre.
export const FALLBACK_STYLE: maplibregl.StyleSpecification = {
  version: 8,
  name: 'nouri-fallback',
  sources: {},
  layers: [{ id: 'background', type: 'background', paint: { 'background-color': '#EEF0F3' } }],
}

export function isFallbackStyle(map: maplibregl.Map): boolean {
  return map.getStyle()?.name === 'nouri-fallback'
}

// ── Palette ─────────────────────────────────────────────────────────────────

export interface MapPalette {
  dark: boolean
  background: string
  /** Liseré des tracés : couleur du fond, pour détacher le trait du plan. */
  casing: string
  /** Portion déjà parcourue / tronçon passé. */
  done: string
  walk: string
  walkFinal: string
  surface: string
  accuracy: string
  stale: string
}

export function mapPalette(dark: boolean): MapPalette {
  return dark
    ? { dark, background: '#0F141B', casing: '#0F141B', done: '#4B5563', walk: '#8B95A1', walkFinal: '#C3CAD3', surface: '#1B222C', accuracy: '#4A8FE8', stale: '#6B7280' }
    : { dark, background: '#F7F8FA', casing: '#FFFFFF', done: '#9CA3AF', walk: '#9CA3AF', walkFinal: '#6B7280', surface: '#FFFFFF', accuracy: '#1D6FE0', stale: '#9CA3AF' }
}

function mix(hex: string, target: string, amount: number): string {
  const p = (h: string) => parseInt(h.replace('#', ''), 16)
  const a = p(hex)
  const b = p(target)
  const ch = (shift: number) => Math.round(((a >> shift) & 255) * (1 - amount) + ((b >> shift) & 255) * amount)
  return `#${[16, 8, 0].map((s) => ch(s).toString(16).padStart(2, '0')).join('')}`
}

/**
 * Couleur de tracé lisible sur le fond : en sombre, le bleu métro #1E3A8A
 * disparaît presque (1,6:1). On éclaircit jusqu'à 3:1 (WCAG 1.4.11, éléments
 * graphiques) sans changer la teinte ; en clair les couleurs officielles
 * restent intactes.
 */
export function lineDisplayColor(color: string, dark: boolean): string {
  if (!dark || !/^#[0-9a-f]{6}$/i.test(color)) return color
  const bg = mapPalette(true).background
  let out = color
  for (let i = 1; i <= 10 && contrastRatio(out, bg) < 3; i += 1) out = mix(color, '#FFFFFF', i * 0.08)
  return out
}

// ── Thème du fond de carte (style Positron d'OpenFreeMap) ────────────────────

type Originals = Map<string, unknown>

function setPaint(map: maplibregl.Map, originals: Originals, id: string, prop: string, value: unknown) {
  const key = `${id}|${prop}`
  try {
    if (!originals.has(key)) originals.set(key, map.getPaintProperty(id, prop))
    map.setPaintProperty(id, prop, value)
  } catch {
    // Certaines couches n'exposent pas toutes les propriétés de peinture.
  }
}

/**
 * Recolore les couches du fond. Les valeurs d'origine sont mémorisées
 * (`originals`, à vider à chaque nouveau style) pour revenir au clair sans
 * recharger le style — donc sans retélécharger quoi que ce soit hors ligne.
 */
export function applyBaseMapTheme(map: maplibregl.Map, dark: boolean, originals: Originals, isOwnLayer?: (id: string) => boolean): void {
  const style = map.getStyle()
  if (!style?.layers) return

  // Retour au clair : on restaure tout, puis on réapplique les retouches.
  if (!dark) {
    originals.forEach((value, key) => {
      const [id, prop] = key.split('|')
      try {
        if (map.getLayer(id)) map.setPaintProperty(id, prop, value)
      } catch {
        // ignorée
      }
    })
  }

  for (const layer of style.layers) {
    if (isOwnLayer?.(layer.id)) continue
    const id = layer.id.toLowerCase()
    if (layer.type === 'background') {
      // En clair, la valeur d'origine vient d'être restaurée.
      if (dark) setPaint(map, originals, layer.id, 'background-color', '#0F141B')
      continue
    }
    if (layer.type === 'fill') {
      // Palette claire : on garde Positron (blanc/gris doux) et on ne retouche
      // QUE l'eau et les parcs pour un rendu net.
      if (/water|ocean|lake|river|sea/.test(id)) setPaint(map, originals, layer.id, 'fill-color', dark ? '#0E2233' : '#BFDBF0')
      else if (/park|green|landcover|vegetation|wood|grass/.test(id)) setPaint(map, originals, layer.id, 'fill-color', dark ? '#14211A' : '#E4EFE2')
      else if (dark && /building/.test(id)) setPaint(map, originals, layer.id, 'fill-color', '#1C232D')
      else if (dark) setPaint(map, originals, layer.id, 'fill-color', '#151B23')
      if (dark) setPaint(map, originals, layer.id, 'fill-outline-color', '#1C232D')
      continue
    }
    if (!dark) continue
    if (layer.type === 'line') {
      let color = '#2A323E'
      if (/water/.test(id)) color = '#0E2233'
      else if (/casing/.test(id)) color = '#141A22'
      else if (/motorway/.test(id)) color = '#3A4352'
      else if (/major/.test(id)) color = '#323B48'
      else if (/rail/.test(id)) color = '#39414E'
      else if (/boundary/.test(id)) color = '#4B5563'
      setPaint(map, originals, layer.id, 'line-color', color)
      continue
    }
    if (layer.type === 'symbol' && layer.layout && 'text-field' in layer.layout) {
      setPaint(map, originals, layer.id, 'text-color', /water/.test(id) ? '#6B8FB0' : '#AEB7C2')
      setPaint(map, originals, layer.id, 'text-halo-color', '#0F141B')
    }
  }
}

/**
 * Libellés du fond dans UNE écriture, celle de l'interface. Positron concatène
 * nom latin et nom arabe (« Hassiba Ben Bouali حسيبة بن بوعلي ») : illisible en
 * petit corps et doublement long. On ne touche qu'aux couches de noms ; les
 * cartouches de numéros de route restent intacts.
 */
export function localizeBaseMapLabels(map: maplibregl.Map, locale: Locale): void {
  const style = map.getStyle()
  if (!style?.layers) return
  const field: maplibregl.ExpressionSpecification = locale === 'ar'
    ? ['coalesce', ['get', 'name:ar'], ['get', 'name:nonlatin'], ['get', 'name:latin'], ['get', 'name']]
    : locale === 'en'
      ? ['coalesce', ['get', 'name:en'], ['get', 'name_en'], ['get', 'name:fr'], ['get', 'name:latin'], ['get', 'name']]
      : ['coalesce', ['get', 'name:fr'], ['get', 'name:latin'], ['get', 'name']]
  for (const layer of style.layers) {
    if (layer.type !== 'symbol') continue
    const current = layer.layout?.['text-field']
    if (!current) continue
    const json = JSON.stringify(current)
    // Couches de noms seulement (celles que l'on a déjà réécrites contiennent
    // aussi 'name:latin').
    if (!json.includes('name:latin') && !json.includes('name:nonlatin')) continue
    try {
      map.setLayoutProperty(layer.id, 'text-field', field)
    } catch {
      // ignorée
    }
  }
}

/** Première couche de texte du fond : nos tracés passent dessous. */
export function firstBaseSymbolLayerId(map: maplibregl.Map): string | undefined {
  return map.getStyle()?.layers?.find((l) => l.type === 'symbol')?.id
}

// ── Chevron de sens ─────────────────────────────────────────────────────────

export const CHEVRON_IMAGE = 'nouri-chevron'

/** Chevron blanc pointant dans le sens du tracé (placement le long de la ligne). */
export function addChevronImage(map: maplibregl.Map): void {
  if (map.hasImage(CHEVRON_IMAGE)) return
  const size = 24
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  // Trait épais, hauteur ≈ largeur du tracé : le chevron tient DANS la ligne
  // (blanc sur la couleur de la ligne), sans déborder sur le liseré.
  ctx.strokeStyle = '#FFFFFF'
  ctx.lineWidth = 5
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  ctx.beginPath()
  ctx.moveTo(8, 4.5)
  ctx.lineTo(16, 12)
  ctx.lineTo(8, 19.5)
  ctx.stroke()
  const data = ctx.getImageData(0, 0, size, size)
  map.addImage(CHEVRON_IMAGE, { width: size, height: size, data: new Uint8Array(data.data.buffer) }, { pixelRatio: 2 })
}

// ── Zone desservie ──────────────────────────────────────────────────────────
// Emprise des arrêts GTFS (36,641-36,817 N ; 2,841-3,381 E) plus ~3 km.
export const SERVICE_BBOX: [number, number, number, number] = [2.80, 36.60, 3.42, 36.85]
// La carte ne s'éloigne pas d'Alger (une position à Paris l'emmenait à Paris
// en zoom 15, sans aucun réseau).
export const MAP_MAX_BOUNDS: [[number, number], [number, number]] = [[2.5, 36.4], [3.7, 37.0]]

export function isInServiceArea(lon: number, lat: number): boolean {
  const [w, s, e, n] = SERVICE_BBOX
  return lon >= w && lon <= e && lat >= s && lat <= n
}

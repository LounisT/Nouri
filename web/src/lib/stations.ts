import type { Locale } from './i18n'

export type TransitMode = 'metro' | 'tram'

export interface Station {
  id: string
  name: string
  nameAr?: string
  lat: number
  lon: number
  type: TransitMode
  future?: boolean
  openingYear?: number
}

export const METRO_COLOR = '#1E3A8A'
export const TRAM_COLOR = '#059669'

export const metroStations: Station[] = [
  { id: 'M01', name: 'Tafourah Grande Poste', nameAr: 'تافورة - البريد المركزي', lat: 36.77201, lon: 3.05807, type: 'metro' },
  { id: 'M02', name: 'Khelifa Boukhalfa', nameAr: 'خليفة بوخالفة', lat: 36.76625, lon: 3.05367, type: 'metro' },
  { id: 'M03', name: '1er Mai', nameAr: 'أول ماي', lat: 36.7602, lon: 3.05661, type: 'metro' },
  { id: 'M04', name: 'Aïssat Idir', nameAr: 'عيسات إيدير', lat: 36.75686, lon: 3.06176, type: 'metro' },
  { id: 'M05', name: 'Hamma', nameAr: 'الحامة', lat: 36.75291, lon: 3.06653, type: 'metro' },
  { id: 'M06', name: "Jardin d'Essai", nameAr: 'حديقة التجارب', lat: 36.74668, lon: 3.07274, type: 'metro' },
  { id: 'M07', name: 'Les Fusillés', nameAr: 'لي فوزيي', lat: 36.74232, lon: 3.08214, type: 'metro' },
  { id: 'M08', name: 'Cité Amirouche', nameAr: 'حي عميروش', lat: 36.73796, lon: 3.09154, type: 'metro' },
  { id: 'M09', name: 'Cité Mer et Soleil', nameAr: 'حي البحر والشمس', lat: 36.73359, lon: 3.10095, type: 'metro' },
  { id: 'M10', name: 'Mohamed Belouizdad', nameAr: 'محمد بلوزداد', lat: 36.73087, lon: 3.10139, type: 'metro' },
  { id: 'M11', name: 'El Magharia', nameAr: 'المقرية', lat: 36.72815, lon: 3.10183, type: 'metro' },
  { id: 'M12', name: 'Haï El Badr', nameAr: 'حي البدر', lat: 36.72543, lon: 3.10227, type: 'metro' },
  { id: 'M13', name: 'Bachdjarah Tennis', nameAr: 'باش جراح - التنس', lat: 36.72432, lon: 3.11209, type: 'metro' },
  { id: 'M14', name: 'Bachdjarah', nameAr: 'باش جراح', lat: 36.72321, lon: 3.12191, type: 'metro' },
  { id: 'M15', name: 'El Harrach Gare', nameAr: 'الحراش - المحطة', lat: 36.72209, lon: 3.13173, type: 'metro' },
  { id: 'M16', name: 'Harrach Centre', nameAr: 'الحراش وسط', lat: 36.722, lon: 3.13716, type: 'metro' },
]

export const tramStations: Station[] = [
  { id: 'T01', name: 'Ruisseau', nameAr: 'الرويصو', lat: 36.74289, lon: 3.08349, type: 'tram' },
  { id: 'T02', name: 'Les Fusillés (Tram)', nameAr: 'لي فوزيي (ترام)', lat: 36.74599, lon: 3.08681, type: 'tram' },
  { id: 'T03', name: 'Tripoli - Thaâlibia', nameAr: 'طرابلس - الثعالبية', lat: 36.74522, lon: 3.09229, type: 'tram' },
  { id: 'T04', name: 'Tripoli - Mosquée', nameAr: 'طرابلس - المسجد', lat: 36.74326, lon: 3.09741, type: 'tram' },
  { id: 'T05', name: 'Tripoli - Hamadèche', nameAr: 'طرابلس - حمداش', lat: 36.74072, lon: 3.10409, type: 'tram' },
  { id: 'T06', name: 'Tripoli - Makaria', nameAr: 'طرابلس - مكارية', lat: 36.73703, lon: 3.11368, type: 'tram' },
  { id: 'T07', name: 'Caroubier', nameAr: 'الكروبييه', lat: 36.73571, lon: 3.11818, type: 'tram' },
  { id: 'T08', name: 'La Glacière', nameAr: 'لا غلاسير', lat: 36.73282, lon: 3.12463, type: 'tram' },
  { id: 'T09', name: 'Pont El Harrach', nameAr: 'جسر الحراش', lat: 36.73028, lon: 3.13016, type: 'tram' },
  { id: 'T10', name: 'Bekri Bouguerra', nameAr: 'بكري بوقرة', lat: 36.72781, lon: 3.14344, type: 'tram' },
  { id: 'T11', name: 'Cinq Maisons', nameAr: 'خمس بيوت', lat: 36.72588, lon: 3.1508, type: 'tram' },
  { id: 'T12', name: "Foire d'Alger", nameAr: 'معرض الجزائر', lat: 36.73127, lon: 3.16137, type: 'tram' },
  { id: 'T13', name: 'Les Pins', nameAr: 'الصنوبر', lat: 36.7322, lon: 3.16703, type: 'tram' },
  { id: 'T14', name: 'Tamaris', nameAr: 'تماريس', lat: 36.73255, lon: 3.17329, type: 'tram' },
  { id: 'T15', name: 'Cité 5 Juillet', nameAr: 'حي 5 جويلية', lat: 36.72153, lon: 3.18282, type: 'tram' },
  { id: 'T16', name: 'Bordj El Kiffan - Lycée', nameAr: 'برج الكيفان - الثانوية', lat: 36.74533, lon: 3.18767, type: 'tram' },
  { id: 'T17', name: 'Bordj El Kiffan - Polyclinique', nameAr: 'برج الكيفان - العيادة متعددة الخدمات', lat: 36.74816, lon: 3.19708, type: 'tram' },
  { id: 'T18', name: 'Ben Mered', nameAr: 'بن مراد', lat: 36.75899, lon: 3.2294, type: 'tram' },
  { id: 'T19', name: 'Café Chergui', nameAr: 'مقهى شرقي', lat: 36.77745, lon: 3.25016, type: 'tram' },
  { id: 'T20', name: 'Dergana Centre', nameAr: 'درقانة وسط', lat: 36.77197, lon: 3.26031, type: 'tram' },
]

export const metroExtEastStations: Station[] = [
  { id: 'M17', name: 'Pôle Universitaire', nameAr: 'القطب الجامعي', lat: 36.7175, lon: 3.1462, type: 'metro', future: true, openingYear: 2027 },
  { id: 'M18', name: 'Université H. Boumediene', nameAr: 'جامعة هواري بومدين', lat: 36.7115, lon: 3.1618, type: 'metro', future: true, openingYear: 2027 },
  { id: 'M19', name: 'Beaulieu', nameAr: 'بو ليو', lat: 36.708, lon: 3.174, type: 'metro', future: true, openingYear: 2027 },
  { id: 'M20', name: 'Oued Smar', nameAr: 'وادي السمار', lat: 36.7048, lon: 3.1852, type: 'metro', future: true, openingYear: 2027 },
  { id: 'M21', name: 'Hacene Badi', nameAr: 'حسان بادي', lat: 36.7018, lon: 3.1942, type: 'metro', future: true, openingYear: 2027 },
  { id: 'M22', name: 'Rabia Tahar', nameAr: 'ربيعة طاهر', lat: 36.6992, lon: 3.2018, type: 'metro', future: true, openingYear: 2027 },
  { id: 'M23', name: 'Smail Yefsah', nameAr: 'إسماعيل يفصح', lat: 36.6965, lon: 3.2082, type: 'metro', future: true, openingYear: 2027 },
  { id: 'M24', name: 'Business District', nameAr: 'حي الأعمال', lat: 36.6938, lon: 3.2127, type: 'metro', future: true, openingYear: 2027 },
  { id: 'M25', name: 'Aéroport H. Boumediene', nameAr: 'مطار هواري بومدين', lat: 36.6912, lon: 3.2154, type: 'metro', future: true, openingYear: 2027 },
]

export const metroExtSouthStations: Station[] = [
  { id: 'B01', name: 'Mohamed Boudiaf', nameAr: 'محمد بوضياف', lat: 36.702, lon: 3.0118, type: 'metro', future: true, openingYear: 2027 },
  { id: 'B02', name: 'Mohamed Belarbi', nameAr: 'محمد بلعربي', lat: 36.6935, lon: 3.0102, type: 'metro', future: true, openingYear: 2027 },
  { id: 'B03', name: 'Aïn Naâdja Gare', nameAr: 'عين النعجة - المحطة', lat: 36.6858, lon: 3.0088, type: 'metro', future: true, openingYear: 2027 },
  { id: 'B04', name: 'Parc Urbain', nameAr: 'الحديقة الحضرية', lat: 36.6775, lon: 3.0072, type: 'metro', future: true, openingYear: 2027 },
]

export const allStations: Station[] = [...metroStations, ...tramStations]
export const allFutureStations: Station[] = [...metroExtEastStations, ...metroExtSouthStations]

function normalizeStationTerm(value: string): string {
  return value.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
}

export function getStationName(station: Station, locale: Locale = 'fr'): string {
  return locale === 'ar' ? (station.nameAr ?? station.name) : station.name
}

export function searchStations(query: string): Station[] {
  if (!query.trim()) return []
  const q = normalizeStationTerm(query)
  return allStations.filter((s) => {
    const names = [s.name, s.nameAr].filter((name): name is string => Boolean(name)).map(normalizeStationTerm)
    return names.some((name) => name.includes(q))
  })
}

export const metroLineGeoJSON = {
  type: 'Feature' as const,
  geometry: {
    type: 'LineString' as const,
    coordinates: metroStations.map((s) => [s.lon, s.lat]),
  },
  properties: { mode: 'metro', color: METRO_COLOR },
}

export const tramLineGeoJSON = {
  type: 'Feature' as const,
  geometry: {
    type: 'LineString' as const,
    coordinates: tramStations.map((s) => [s.lon, s.lat]),
  },
  properties: { mode: 'tram', color: TRAM_COLOR },
}

// Système i18n minimaliste — 3 langues : FR (défaut), AR, EN
// Pas de librairie externe — simple objet de traductions + Context React

import { navStrings } from './strings/nav'
import { itinStrings } from './strings/itin'
import { mapStrings } from './strings/map'
import { catStrings } from './strings/cat'
import { dataStrings } from './strings/data'
import { uxStrings } from './strings/ux'
import { pageStrings } from './strings/page'

export type Locale = 'fr' | 'ar' | 'en'

export const LOCALES: { code: Locale; label: string; dir: 'ltr' | 'rtl'; flag: string }[] = [
  { code: 'fr', label: 'Français', dir: 'ltr', flag: '🇫🇷' },
  { code: 'ar', label: 'العربية',  dir: 'rtl', flag: '🇩🇿' },
  { code: 'en', label: 'English',  dir: 'ltr', flag: '🇬🇧' },
]

// ────────────────────────────────────────────────────────────────────────────
// Dictionnaire de traductions
// ────────────────────────────────────────────────────────────────────────────
const baseTranslations = {
  fr: {
    // Navigation principale
    appName:          'Nouri',
    from:             'Départ',
    to:               'Destination',
    fromPlaceholder:  'Départ',
    toPlaceholder:    'Destination',
    searchBtn:        'Trouver un itinéraire',
    searching:        'Recherche...',
    searchingAddress: 'Recherche d’adresses...',
    searchAddressPlaceholder: 'Rechercher une adresse ou station...',
    go:               'Commencer',
    back:             'Retour',
    copied:           'Copié !',

    // Résultats & navigation
    itineraries:      'itinéraire',
    routesFound:      'trouvé',
    destination:      'Destination',
    arriveBefore:     'Arriver avant',
    estimatedFare:    'Tarif estimé',
    directionShort:   'dir.',
    stop:             'arrêt',
    stops:            'arrêts',
    close:            'Fermer',

    // Statut service
    min:              'min',
    outOfService:     'Fin de service',
    now:              'maintenant',
    remaining:        'restantes',

    // Stations proches
    walkMin:          'min à pied',

    // Carte
    network:          'Réseau',
    zoomIn:           'Zoom avant',
    zoomOut:          'Zoom arrière',
    myLocation:       'Ma position',
    loading:          'Chargement de la carte...',

    // Récents / favoris
    from2:            'depuis',
    saved:            'Raccourcis',
    add:              'Ajouter',
    savedToast:       'Enregistré',
    setPlace:         'Définir',
    editPlace:        'Modifier',
    removePlaceAction:'Supprimer ce lieu',
    removedToast:     'Supprimé',
    homePlace:        'Maison',
    workPlace:        'Travail',

    // Erreurs
    tooClose:         'Points trop proches.',
    noRoute:          'Aucun itinéraire trouvé pour ce trajet.',
    impossible:       'Itinéraire impossible',
    error:            'erreur',

    // Modes de transport
    walk:             'À pied',
    metro:            'Métro',
    tram:             'Tram',
    station:          'station',
    stations:         'stations',
    terminus:         'Terminus',
    lines:            'Lignes',
    onFoot:           'À pied',
    routeArrow:       '→',
    noRoutesAvailable:'Aucun itinéraire trouvé',

    // Handoff design — Accueil groupé + états
    allFilter:        'Toutes',
    cheapest:         'le moins cher',
    walkVerb:         'Marchez',
    metroStation:     'Station de métro',
    tramStop:         'Station de tramway',
    busStopWord:      'Arrêt de bus',
    geoInsecure:      'Position indisponible en http. Ouvrez l’app en https pour que le GPS fonctionne.',
    progressEstimated:'Sans position, l’avancement suit les horaires prévus.',
    geoDenied:        'Localisation refusée. Autorisez-la dans les réglages du navigateur.',
    geoUnavailable:   'Position introuvable pour l’instant — signal GPS trop faible.',
    recents:          'Récents',
    direct:           'direct',
    tildeNote:        'Heures « ~ » estimées : passages d’après la fréquence de la ligne, durée à bord d’après la distance entre arrêts — aucun horaire détaillé n’est publié.',
    seeNearbyLines:   'Voir les lignes proches du départ',
    ctxMetro:         'Dans le métro',
    ctxTram:          'Dans le tram',
    ctxBus:           'Dans le bus',
    ctxWalk:          'À pied',
    stopsLeft:        'arrêts restants',
    nextLabel:        'Ensuite',
    quitNav:          'Quitter la navigation',
    opensAt:          'ouvre',
    estimatedNote:    'Horaires « ~ » estimés à partir de fréquences approximatives — aucun horaire de passage publié, pas de temps réel à Alger.',
    routeNotMapped:   'Le tracé exact de ce tronçon n’est pas relevé : la carte relie ses arrêts.',
    routeEstimated:   'Tracé estimé par la voirie — le parcours exact de cette ligne n’est pas relevé.',
    noNearbyLinesExplain: 'Aucun arrêt relevé à moins de 1,5 km de votre position. Le réseau est cartographié depuis OpenStreetMap : des lignes peuvent manquer.',
    locating:         'Recherche de votre position…',
    navArrived:       'Vous êtes arrivé',
    demoNote:         'Trajet simulé (mode démonstration) : ce n’est pas un itinéraire calculé. Lignes et horaires ne sont pas vérifiés.',
    lessWalking:      'moins de marche',
    departPrefix:     'départ',
    offlineBanner:    'Hors ligne : lignes et arrêts restent consultables, le calcul d’itinéraire et la recherche d’adresses non.',
    feedbackTitle:    'Nous écrire',
    feedbackHint:     'Un bug ou une suggestion ? Votre message part à l’équipe Nouri.',
    feedbackPlaceholder: 'Votre message…',
    feedbackSend:     'Envoyer par e-mail',
    lastDeparture:    'dernier départ',
    open:             'Ouvert',
    closed:           'Fermé',
    filterMode:       'Filtrer par mode',
    chooseDirection:  'Choisir la direction',

    // Architecture RATP — onglets
    tabMap:           'Carte',
    inService:        'En service',

    // Refonte 3 onglets
    tabLines:         'Lignes',
    tabRoute:         'Itinéraire',
    busMode:          'Bus',
    towards:          'vers',
    noNearbyLines:    'Aucune ligne à proximité',
  },

  ar: {
    appName:          'نوري',
    from:             'الانطلاق',
    to:               'الوجهة',
    fromPlaceholder:  'الانطلاق',
    toPlaceholder:    'الوجهة',
    searchBtn:        'البحث عن مسار',
    searching:        'جارٍ البحث...',
    searchingAddress: 'جارٍ البحث عن العناوين...',
    searchAddressPlaceholder: 'ابحث عن عنوان أو محطة...',
    go:               'ابدأ',
    back:             'رجوع',
    copied:           'تم النسخ!',

    itineraries:      'مسار',
    routesFound:      'عُثر عليه',
    destination:      'الوجهة',
    arriveBefore:     'الوصول قبل',
    estimatedFare:    'السعر التقديري',
    directionShort:   'اتجاه',
    stop:             'محطة',
    stops:            'محطات',
    close:            'إغلاق',

    min:              'د',
    outOfService:     'نهاية الخدمة',
    now:              'الآن',
    remaining:        'متبقية',

    walkMin:          'د مشياً',

    network:          'الشبكة',
    zoomIn:           'تكبير',
    zoomOut:          'تصغير',
    myLocation:       'موقعي',
    loading:          'جاري تحميل الخريطة...',


    from2:            'من',
    saved:            'اختصارات',
    add:              'إضافة',
    savedToast:       'تم الحفظ',
    setPlace:         'تحديد',
    editPlace:        'تعديل',
    removePlaceAction:'حذف هذا المكان',
    removedToast:     'تم الحذف',
    homePlace:        'المنزل',
    workPlace:        'العمل',

    tooClose:         'النقطتان قريبتان جداً.',
    noRoute:          'لم يُعثر على أي مسار لهذه الرحلة.',
    impossible:       'مسار غير ممكن',
    error:            'خطأ',

    walk:             'مشياً',
    metro:            'مترو',
    tram:             'ترامواي',
    station:          'محطة',
    stations:         'محطات',
    terminus:         'المحطة النهائية',
    lines:            'الخطوط',
    onFoot:           'مشياً',
    routeArrow:       '←',
    noRoutesAvailable:'لم يُعثر على مسار',


    allFilter:        'الكل',
    cheapest:         'الأرخص',
    walkVerb:         'امشِ',
    metroStation:     'محطة مترو',
    tramStop:         'محطة ترامواي',
    busStopWord:      'محطة حافلات',
    geoInsecure:      'الموقع غير متاح عبر http. افتح التطبيق عبر https ليعمل نظام تحديد المواقع.',
    progressEstimated:'بدون تحديد الموقع، يعتمد التقدّم على الأوقات المقرّرة.',
    geoDenied:        'تم رفض تحديد الموقع. اسمح به في إعدادات المتصفح.',
    geoUnavailable:   'تعذّر تحديد الموقع حالياً — إشارة GPS ضعيفة.',
    recents:          'الأخيرة',
    direct:           'مباشر',
    tildeNote:        'الأوقات «~» تقديرية: المرور حسب تردد الخط، ومدة الرحلة حسب المسافة بين المحطات — لا توجد مواعيد مفصّلة منشورة.',
    seeNearbyLines:   'عرض الخطوط القريبة من نقطة الانطلاق',
    ctxMetro:         'في المترو',
    ctxTram:          'في الترامواي',
    ctxBus:           'في الحافلة',
    ctxWalk:          'مشياً',
    stopsLeft:        'محطات متبقية',
    nextLabel:        'بعد ذلك',
    quitNav:          'إنهاء التوجيه',
    opensAt:          'يفتح',
    estimatedNote:    'مواعيد «~» تقديرية مبنية على ترددات تقريبية — لا توجد مواعيد مرور منشورة، ولا توقيت فعلي في الجزائر.',
    routeNotMapped:   'المسار الدقيق لهذا المقطع غير مسجّل: الخريطة تصل بين محطاته فقط.',
    routeEstimated:   'المسار مُقدَّر عبر شبكة الطرق — المسار الدقيق لهذا الخط غير مسجَّل.',
    noNearbyLinesExplain: 'لا توجد محطة مسجّلة على بعد أقل من 1,5 كلم من موقعك. الشبكة مرسومة من OpenStreetMap: قد تنقص بعض الخطوط.',
    locating:         'جارٍ تحديد موقعك…',
    navArrived:       'لقد وصلت',
    demoNote:         'مسار محاكى (وضع العرض التجريبي): ليس مساراً محسوباً. الخطوط والمواعيد غير مؤكدة.',
    lessWalking:      'مشي أقل',
    departPrefix:     'انطلاق',
    offlineBanner:    'غير متصل: يمكن تصفّح الخطوط والمحطات، أما حساب المسارات والبحث عن العناوين فغير متاحين.',
    feedbackTitle:    'راسلنا',
    feedbackHint:     'خلل أو اقتراح؟ رسالتك تصل إلى فريق نوري.',
    feedbackPlaceholder: 'رسالتك…',
    feedbackSend:     'الإرسال بالبريد',
    lastDeparture:    'آخر انطلاق',
    open:             'مفتوح',
    closed:           'مغلق',
    filterMode:       'تصفية حسب وسيلة النقل',
    chooseDirection:  'اختيار الاتجاه',

    tabMap:           'الخريطة',
    inService:        'في الخدمة',

    tabLines:         'الخطوط',
    tabRoute:         'المسار',
    busMode:          'حافلة',
    towards:          'نحو',
    noNearbyLines:    'لا توجد خطوط قريبة',
  },

  en: {
    appName:          'Nouri',
    from:             'From',
    to:               'To',
    fromPlaceholder:  'From',
    toPlaceholder:    'Destination',
    searchBtn:        'Find a route',
    searching:        'Searching...',
    searchingAddress: 'Searching addresses...',
    searchAddressPlaceholder: 'Search for an address or station...',
    go:               'Start',
    back:             'Back',
    copied:           'Copied!',

    itineraries:      'route',
    routesFound:      'found',
    destination:      'Destination',
    arriveBefore:     'Arrive before',
    estimatedFare:    'Estimated fare',
    directionShort:   'dir.',
    stop:             'stop',
    stops:            'stops',
    close:            'Close',

    min:              'min',
    outOfService:     'End of service',
    now:              'now',
    remaining:        'remaining',

    walkMin:          'min walk',

    network:          'Network',
    zoomIn:           'Zoom in',
    zoomOut:          'Zoom out',
    myLocation:       'My location',
    loading:          'Loading map...',


    from2:            'From',
    saved:            'Shortcuts',
    add:              'Add',
    savedToast:       'Saved',
    setPlace:         'Set',
    editPlace:        'Edit',
    removePlaceAction:'Remove this place',
    removedToast:     'Removed',
    homePlace:        'Home',
    workPlace:        'Work',

    tooClose:         'Points too close.',
    noRoute:          'No route found for this trip.',
    impossible:       'Route not possible',
    error:            'error',

    walk:             'Walk',
    metro:            'Metro',
    tram:             'Tram',
    station:          'station',
    stations:         'stations',
    terminus:         'Terminus',
    lines:            'Lines',
    onFoot:           'Walk',
    routeArrow:       '→',
    noRoutesAvailable:'No route found',


    allFilter:        'All',
    cheapest:         'cheapest',
    walkVerb:         'Walk',
    metroStation:     'Metro station',
    tramStop:         'Tram stop',
    busStopWord:      'Bus stop',
    geoInsecure:      'Location unavailable over http. Open the app over https for GPS to work.',
    progressEstimated:'Without a position, progress follows the scheduled times.',
    geoDenied:        'Location denied. Allow it in your browser settings.',
    geoUnavailable:   'Can’t find your position right now — weak GPS signal.',
    recents:          'Recent',
    direct:           'direct',
    tildeNote:        '“~” times are estimates: departures from the line’s frequency, on-board time from the distance between stops — no detailed timetable is published.',
    seeNearbyLines:   'See lines near the start',
    ctxMetro:         'On the metro',
    ctxTram:          'On the tram',
    ctxBus:           'On the bus',
    ctxWalk:          'Walking',
    stopsLeft:        'stops left',
    nextLabel:        'Next',
    quitNav:          'Exit navigation',
    opensAt:          'opens',
    estimatedNote:    '“~” times are estimated from approximate frequencies — no published timetable, no real-time data in Algiers.',
    routeNotMapped:   'The exact path of this leg is not mapped: the map only links its stops.',
    routeEstimated:   'Route estimated from the road network — the exact path of this line is not surveyed.',
    noNearbyLinesExplain: 'No stop recorded within 1.5 km of your position. The network is mapped from OpenStreetMap: some lines may be missing.',
    locating:         'Finding your position…',
    navArrived:       'You have arrived',
    demoNote:         'Simulated trip (demo mode): this is not a computed route. Lines and times are unverified.',
    lessWalking:      'less walking',
    departPrefix:     'departs',
    offlineBanner:    'Offline: lines and stops remain available, route planning and address search do not.',
    feedbackTitle:    'Contact us',
    feedbackHint:     'A bug or a suggestion? Your message goes to the Nouri team.',
    feedbackPlaceholder: 'Your message…',
    feedbackSend:     'Send by email',
    lastDeparture:    'last departure',
    open:             'Open',
    closed:           'Closed',
    filterMode:       'Filter by mode',
    chooseDirection:  'Choose direction',

    tabMap:           'Map',
    inService:        'In service',

    tabLines:         'Lines',
    tabRoute:         'Route',
    busMode:          'Bus',
    towards:          'towards',
    noNearbyLines:    'No lines nearby',
  },
} satisfies Record<Locale, Record<string, string>>

export const translations = {
  fr: { ...baseTranslations.fr, ...navStrings.fr, ...itinStrings.fr, ...mapStrings.fr, ...catStrings.fr, ...dataStrings.fr, ...uxStrings.fr, ...pageStrings.fr },
  ar: { ...baseTranslations.ar, ...navStrings.ar, ...itinStrings.ar, ...mapStrings.ar, ...catStrings.ar, ...dataStrings.ar, ...uxStrings.ar, ...pageStrings.ar },
  en: { ...baseTranslations.en, ...navStrings.en, ...itinStrings.en, ...mapStrings.en, ...catStrings.en, ...dataStrings.en, ...uxStrings.en, ...pageStrings.en },
}

export type TranslationKey = keyof (typeof translations)['fr']

/** Familles plurielles : « base » tel que « base_other » existe (ux_stops, ux_stopsLeft…). */
export type PluralBase = {
  [K in TranslationKey]: K extends `${infer B}_other` ? B : never
}[TranslationKey]

export type TranslationVars = Record<string, string | number>

export const LOCALE_STORAGE_KEY = 'locale'

export function isLocale(value: unknown): value is Locale {
  return value === 'fr' || value === 'ar' || value === 'en'
}

/**
 * Langue du téléphone : la première des langues préférées que l'app parle.
 * « ar-DZ, fr » → ar ; « kab, fr » → fr ; « de » → fr (langue par défaut).
 * Même règle que le script inline de layout.tsx, qui l'applique avant
 * l'hydratation : les deux doivent rester d'accord.
 */
export function detectLocale(languages: readonly string[] | undefined): Locale {
  for (const raw of languages ?? []) {
    const code = String(raw || '').toLowerCase()
    if (code.startsWith('ar')) return 'ar'
    if (code.startsWith('fr')) return 'fr'
    if (code.startsWith('en')) return 'en'
  }
  return 'fr'
}

/** Remplacement simple des variables « {nom} ». */
export function formatVars(text: string, vars?: TranslationVars): string {
  if (!vars) return text
  let out = text
  for (const name of Object.keys(vars)) out = out.split(`{${name}}`).join(String(vars[name]))
  return out
}

/** Traduction hors React (modules lib/), avec repli sur le français. */
export function translate(locale: Locale, key: TranslationKey, vars?: TranslationVars): string {
  const text = translations[locale]?.[key] ?? translations.fr[key] ?? key
  return formatVars(text, vars)
}

const pluralRules = new Map<Locale, Intl.PluralRules | null>()

function pluralCategory(locale: Locale, n: number): string {
  if (!pluralRules.has(locale)) {
    let rules: Intl.PluralRules | null = null
    try { rules = new Intl.PluralRules(locale) } catch { rules = null }
    pluralRules.set(locale, rules)
  }
  const rules = pluralRules.get(locale)
  // Vieux moteur sans PluralRules : un / plusieurs, juste en français et en
  // anglais, et lisible en arabe grâce aux formes « one » et « other ».
  return rules ? rules.select(n) : n === 1 ? 'one' : 'other'
}

/**
 * Nombre + nom accordé : pluralize('ar', 'ux_stopsLeft', 2) → « محطتان متبقيتان ».
 * La forme vient d'Intl.PluralRules (zero/one/two/few/many/other) ; une forme
 * absente retombe sur « _other ». « {n} » reçoit le nombre en chiffres latins.
 */
export function pluralize(locale: Locale, base: PluralBase, n: number, vars?: TranslationVars): string {
  const dict = (translations[locale] ?? translations.fr) as Record<string, string>
  const fallback = translations.fr as Record<string, string>
  const cat = pluralCategory(locale, n)
  const text = dict[`${base}_${cat}`] ?? dict[`${base}_other`] ?? fallback[`${base}_other`] ?? base
  return formatVars(text, { n, ...vars })
}

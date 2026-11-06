import { defineStrings } from './define'

// Domaine de l'écran principal (page.tsx et ses écrans extraits : résultats,
// détail, frontière d'erreur de la carte). Variables : « {n} », « {start} »,
// « {end} », « {to} » (remplacement simple, tf()).
//
// Les libellés pour lecteur d'écran (« …Aria ») n'écrivent jamais « ~ » : la
// synthèse vocale le lit « tilde ». L'estimation y est dite en toutes lettres
// (« vers », « حوالي », « around »).
export const pageStrings = defineStrings({
  fr: {
    // ── Écran Résultats ──────────────────────────────────────────────────────
    page_resultsRegion: 'Résultats de la recherche',
    page_detailRegion: 'Détail du trajet',
    // Échec SANS réponse du calculateur (réseau, délai, saturation) : ce n'est
    // pas « aucun itinéraire », la recherche n'a simplement pas abouti.
    page_searchFailed: 'Recherche impossible pour le moment',
    page_walkMinutes: '{n} min à pied',
    page_timesAria: 'départ vers {start}, arrivée vers {end}',
    page_timesExactAria: 'départ {start}, arrivée vers {end}',
    // Feuille du détail sur téléphone : la moitié haute laisse voir le trajet
    // sur la carte ; la poignée l'agrandit ou la réduit.
    page_expandDetail: 'Agrandir le détail',
    page_showMap: 'Réduire le détail pour voir la carte',
    // Bouton flottant au-dessus de la feuille : recadre la carte sur le trajet.
    page_fitRoute: 'Voir tout le trajet sur la carte',

    // ── Bandeaux ─────────────────────────────────────────────────────────────
    page_otpDown: 'Le calculateur d’itinéraires ne répond pas pour l’instant : nouvel essai automatique.',
    page_resumeNavTo: 'Reprendre la navigation vers {to}',

    // ── Frontière d'erreur de la carte ───────────────────────────────────────
    page_mapCrashed: 'La carte n’a pas pu s’afficher. Itinéraires et lignes restent utilisables.',
  },
  ar: {
    page_resultsRegion: 'نتائج البحث',
    page_detailRegion: 'تفاصيل الرحلة',
    page_searchFailed: 'تعذّر البحث في الوقت الحالي',
    page_walkMinutes: '{n} د مشياً',
    page_timesAria: 'الانطلاق حوالي {start}، الوصول حوالي {end}',
    page_timesExactAria: 'الانطلاق {start}، الوصول حوالي {end}',
    page_expandDetail: 'توسيع التفاصيل',
    page_showMap: 'تصغير التفاصيل لرؤية الخريطة',
    page_fitRoute: 'عرض المسار كاملاً على الخريطة',

    page_otpDown: 'خادم حساب المسارات لا يستجيب حالياً: تتم إعادة المحاولة تلقائياً.',
    page_resumeNavTo: 'استئناف التوجيه نحو {to}',

    page_mapCrashed: 'تعذّر عرض الخريطة. يبقى البحث عن المسارات وتصفّح الخطوط متاحاً.',
  },
  en: {
    page_resultsRegion: 'Search results',
    page_detailRegion: 'Trip details',
    page_searchFailed: 'Search unavailable right now',
    page_walkMinutes: '{n} min walk',
    page_timesAria: 'leaves around {start}, arrives around {end}',
    page_timesExactAria: 'leaves {start}, arrives around {end}',
    page_expandDetail: 'Expand details',
    page_showMap: 'Shrink details to see the map',
    page_fitRoute: 'Show the whole route on the map',

    page_otpDown: 'The trip planner is not responding right now: retrying automatically.',
    page_resumeNavTo: 'Resume navigation to {to}',

    page_mapCrashed: 'The map could not be displayed. Routes and lines are still available.',
  },
})

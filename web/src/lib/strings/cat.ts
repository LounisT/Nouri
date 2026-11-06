import { defineStrings } from './define'

// Chaînes du catalogue de lignes (onglet Lignes) et du bloc « Lignes à
// proximité ». Variables : {q}, {name}, {time}, {first}, {last}, {list},
// {d}, {n} (remplacement simple, voir formatVars).
//
// Fréquences : jamais « officielles » — l'ETUSA ne publie pas les siennes
// (modélisées) et celles du métro et du tram ne sont pas publiées sous forme
// d'horaire. Toute heure de passage calculée porte « ~ ».
export const catStrings = defineStrings({
  fr: {
    // Recherche dans le catalogue
    cat_searchLabel: 'Rechercher une ligne',
    cat_searchPlaceholder: 'Numéro, ligne ou arrêt',
    cat_searchClear: 'Effacer la recherche',
    cat_noMatch: 'Aucune ligne relevée ne correspond à « {q} ».',
    // Ligne trouvée par un de ses arrêts : le nom exact de l'arrêt, jamais la saisie.
    cat_passesAt: 'passe à {name}',

    // État de service
    cat_ending: 'Derniers passages',
    cat_endingUntil: 'Derniers passages, jusqu’à ~{time}',
    cat_firstDepartureFrom: 'premier départ de {name} : {time}',
    // Sous le terminus d'origine : départs relevés (pas d'estimation).
    cat_departures: '1er départ {first} · dernier {last}',
    cat_freqModelled: 'fréquence modélisée, non publiée par l’ETUSA',
    cat_freqEstimated: 'fréquence estimée, aucun horaire publié',
    cat_algiersTimeNote: 'Horaires à l’heure d’Alger.',
    cat_railHoursNotice: 'Premiers et derniers départs non confirmés par l’exploitant : vérifiez sur place.',
    cat_ramadanNotice:
      'Ramadan : les horaires du métro et du tramway changent, ceux des bus peuvent changer ; ils ne sont pas intégrés à l’application. Vérifiez sur place.',
    cat_catalogNote:
      '~ Fréquences estimées. L’état de chaque ligne est calculé à l’heure d’Alger d’après ses premiers et derniers départs : aucun horaire de passage n’est publié et il n’y a pas de temps réel à Alger. Bus : amplitude et tarif ETUSA (relevé 2024), fréquences modélisées.',

    // Détail de ligne
    cat_showOnMap: 'Voir le tracé sur la carte',
    cat_connections: 'Autres lignes à moins de 150 m : {list}',

    // Lignes à proximité
    cat_nearbyTitle: 'Lignes à proximité',
    cat_walkEstimate: '~{d} · ~{n} min à pied',
    cat_nearbyMore: 'Autres lignes à moins de 1,5 km : {n}',
    cat_nearbyNote:
      '~ Distance à vol d’oiseau jusqu’à l’arrêt le plus proche ; temps de marche et fréquences estimés, sans temps réel.',
    // Bloc ouvert depuis « Voir les lignes proches du départ » (recherche sans
    // résultat) : le point n'est pas forcément la position de l'usager.
    cat_nearPoint: 'Autour de : {name}',
    cat_noNearbyPointExplain:
      'Aucun arrêt relevé à moins de 1,5 km de ce point. Le réseau est cartographié depuis OpenStreetMap : des lignes peuvent manquer.',
  },
  ar: {
    cat_searchLabel: 'البحث عن خط',
    cat_searchPlaceholder: 'رقم الخط أو اسمه أو محطة',
    cat_searchClear: 'مسح البحث',
    cat_noMatch: 'لا يوجد خط مسجَّل يطابق «{q}».',
    cat_passesAt: 'يمرّ بمحطة {name}',

    cat_ending: 'آخر الرحلات',
    cat_endingUntil: 'آخر الرحلات، حتى ~{time}',
    cat_firstDepartureFrom: 'أول انطلاق من {name}: {time}',
    cat_departures: 'أول انطلاق {first} · آخر انطلاق {last}',
    cat_freqModelled: 'تواتر تقديري، لا تنشره إيتوزا',
    cat_freqEstimated: 'تواتر تقديري، لا توجد مواعيد منشورة',
    cat_algiersTimeNote: 'المواعيد بتوقيت الجزائر.',
    cat_railHoursNotice: 'مواعيد أول وآخر انطلاق غير مؤكَّدة من المشغّل: تحقّق منها في عين المكان.',
    cat_ramadanNotice:
      'رمضان: تتغيّر مواعيد المترو والترامواي، وقد تتغيّر مواعيد الحافلات، وهي غير مُدرجة في التطبيق. تحقّق منها في عين المكان.',
    cat_catalogNote:
      '~ التواترات تقديرية. تُحسب حالة كل خط بتوقيت الجزائر انطلاقاً من أول وآخر انطلاق له: لا توجد مواعيد مرور منشورة ولا معلومات آنية في الجزائر العاصمة. الحافلات: أوقات الخدمة والتعريفة من إيتوزا (معطيات 2024)، والتواترات تقديرية.',

    cat_showOnMap: 'عرض المسار على الخريطة',
    cat_connections: 'خطوط أخرى على بُعد أقل من 150 م: {list}',

    cat_nearbyTitle: 'خطوط قريبة',
    cat_walkEstimate: '~{d} · ~{n} د مشياً',
    cat_nearbyMore: 'خطوط أخرى على بُعد أقل من 1,5 كلم: {n}',
    cat_nearbyNote:
      '~ المسافة في خط مستقيم حتى أقرب محطة؛ مدة المشي والتواتر تقديريان، دون معلومات آنية.',
    cat_nearPoint: 'بالقرب من: {name}',
    cat_noNearbyPointExplain:
      'لا توجد محطة مسجّلة على بعد أقل من 1,5 كلم من هذه النقطة. الشبكة مرسومة من OpenStreetMap: قد تنقص بعض الخطوط.',
  },
  en: {
    cat_searchLabel: 'Search lines',
    cat_searchPlaceholder: 'Number, line or stop',
    cat_searchClear: 'Clear search',
    cat_noMatch: 'No recorded line matches “{q}”.',
    cat_passesAt: 'stops at {name}',

    cat_ending: 'Last runs',
    cat_endingUntil: 'Last runs, until ~{time}',
    cat_firstDepartureFrom: 'first departure from {name}: {time}',
    cat_departures: 'first departure {first} · last {last}',
    cat_freqModelled: 'modelled frequency, not published by ETUSA',
    cat_freqEstimated: 'estimated frequency, no published timetable',
    cat_algiersTimeNote: 'Times are Algiers time.',
    cat_railHoursNotice: 'First and last departures are not confirmed by the operator: check on site.',
    cat_ramadanNotice:
      'Ramadan: metro and tram hours change and bus hours may change; they are not included in the app. Check on site.',
    cat_catalogNote:
      '~ Estimated frequencies. Each line’s status is computed in Algiers time from its first and last departures: no timetable is published and there is no real-time data in Algiers. Buses: hours and fare from ETUSA (2024 survey), modelled frequencies.',

    cat_showOnMap: 'Show route on map',
    cat_connections: 'Other lines within 150 m: {list}',

    cat_nearbyTitle: 'Nearby lines',
    cat_walkEstimate: '~{d} · ~{n} min walk',
    cat_nearbyMore: 'Other lines within 1.5 km: {n}',
    cat_nearbyNote:
      '~ Straight-line distance to the nearest stop; walking times and frequencies are estimates, not real-time.',
    cat_nearPoint: 'Around: {name}',
    cat_noNearbyPointExplain:
      'No stop recorded within 1.5 km of this point. The network is mapped from OpenStreetMap: some lines may be missing.',
  },
})

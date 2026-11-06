import { defineStrings } from './define'

// Domaine itinéraires : erreurs typées du calcul, trajet de nuit, tarifs,
// attentes estimées, géocodage. Variables : « {n} »,
// « {time} », « {stop} », « {duration} » (remplacement simple).
export const itinStrings = defineStrings({
  fr: {
    // ── Erreurs du calcul d'itinéraire (PlanError) ───────────────────────────
    // Rendu APRÈS les replis (plus tard, demain matin) : l'heure n'est pas en cause.
    itin_errNoRoute: 'Aucun trajet en transport trouvé entre ces deux points dans nos données.',
    // Rien pour CE trajet (vérifié par OTP) — jamais « tout le réseau est arrêté ».
    itin_errOutOfService: 'Plus de trajet possible entre ces deux points à cette heure.',
    itin_errNoTransitTimes: 'Les horaires de référence ne couvrent pas cette date.',
    itin_errTooFarFrom: 'Aucun arrêt desservi à distance de marche du point de départ.',
    itin_errTooFarTo: 'Aucun arrêt desservi à distance de marche de la destination.',
    itin_errTooFarBoth: 'Aucun arrêt desservi à distance de marche du départ ni de la destination.',
    itin_errTooClose: 'Le départ et l’arrivée sont presque au même endroit.',
    itin_errOutsideFrom: 'Le point de départ est hors de la zone couverte (Grand Alger).',
    itin_errOutsideTo: 'La destination est hors de la zone couverte (Grand Alger).',
    itin_errOutsideBoth: 'Le départ et la destination sont hors de la zone couverte (Grand Alger).',
    itin_errUnavailable: 'Le calculateur d’itinéraires ne répond pas.',
    itin_errOffline: 'Vous êtes hors ligne : le calcul d’itinéraire a besoin du réseau.',
    itin_errTimeout: 'Le calcul d’itinéraire a pris trop de temps.',
    itin_errBusy: 'Trop de recherches en cours. Réessayez dans quelques secondes.',
    itin_retry: 'Réessayer',

    // ── Trajet de nuit : premier départ suivant ──────────────────────────────
    itin_nextServiceTomorrow: 'Premiers départs demain matin',
    itin_nextServiceThisMorning: 'Premiers départs ce matin',
    itin_tomorrow: 'demain',
    // Replis vérifiés par une seconde requête OTP (NextServiceFallback).
    itin_noDepartureSoon: 'Aucun départ pour ce trajet dans les 2 heures suivant l’heure demandée.',
    itin_nextServiceLaterToday: 'Prochains départs plus tard aujourd’hui',
    itin_departEarlier: 'Pour arriver avant {time}, il faut partir plus tôt.',
    itin_latestArrivalBefore: 'Dernières arrivées possibles avant {time}',
    itin_noArrivalFoundBefore: 'Aucun trajet trouvé pour arriver avant {time}.',
    itin_firstArrivalsAfter: 'Premières arrivées après {time}',
    // « Commencer » refusé pour un trajet qui part bien plus tard : la
    // navigation calculerait une arrivée depuis maintenant (inventée).
    itin_startsLater: 'Départ prévu {time} : revenez à l’heure du départ pour être guidé.',
    // Lieu enregistré (Maison, Travail) supprimé depuis qu'il a été placé dans le formulaire.
    itin_savedPlaceGone: '« {place} » ne fait plus partie de vos lieux enregistrés.',
    // Bus : dernier arrêt relevé du sens ≠ girouette (sans dire si le bus continue).
    itin_traceRecordedTo: 'Tracé relevé jusqu’à {stop}',

    // ── Marche ───────────────────────────────────────────────────────────────
    itin_walkOnly: 'À pied uniquement',

    // ── Qualificatifs des rangées ────────────────────────────────────────────
    itin_badgeEarliest: 'arrivée la plus tôt',
    itin_badgeLatest: 'départ le plus tard',
    itin_badgeShortest: 'le plus court',
    itin_badgeLessWalking: 'moins de marche',
    itin_badgeCheapest: 'le moins cher',

    // ── En-tête de la recherche ──────────────────────────────────────────────
    itin_departNow: 'Départ maintenant',
    itin_departAt: 'Départ {time}',
    itin_arriveBy: 'Arrivée avant {time}',
    itin_algiersTime: 'heure d’Alger',

    // ── Tarifs (fare_rules du GTFS, via OTP) ─────────────────────────────────
    itin_currency: 'DZD',
    itin_fareUnknown: 'Tarif non communiqué pour ce trajet',
    itin_fareSource: 'Tarifs publiés des exploitants · un ticket par montée (changement de quai du métro inclus)',

    // ── Attentes estimées (fréquences, jamais de temps réel) ─────────────────
    itin_frequencyEvery: 'passe ~ toutes les {n} min',
    itin_waitUpTo: 'attente jusqu’à ~{n} min',
    itin_waitIncluded: 'Durée calculée avec l’attente maximale (~{n} min).',

    // ── Unités ───────────────────────────────────────────────────────────────
    itin_unitMin: 'min',
    itin_unitHour: 'h',
    itin_unitM: 'm',
    itin_unitKm: 'km',

    // ── Mode démo (NEXT_PUBLIC_DEMO=1 uniquement) ────────────────────────────
    itin_demoBadge: 'Trajet simulé',
    itin_demoNote: 'Mode démonstration : ce trajet est simulé, ce n’est pas un itinéraire réel.',

    // ── Géocodage ────────────────────────────────────────────────────────────
    itin_geoNoResults: 'Aucune adresse trouvée. Essayez un quartier, une station ou un arrêt.',
    itin_geoSlow: 'Réseau lent : adresses indisponibles, seuls les arrêts sont proposés.',
    itin_geoUnavailable: 'Recherche d’adresses indisponible : seuls les arrêts sont proposés.',
    itin_geoStop: 'arrêt {stop}',
    itin_geoAreaCenter: 'zone étendue, point central',
    itin_geoMetro: 'Métro L1',
    itin_geoTram: 'Tramway L1',
    itin_geoBus: 'Bus',

    // ── Écran Itinéraire (fil du trajet) ─────────────────────────────────────
    // « {duration} » est mis en gras par l'écran (découpé sur la variable).
    itin_walkLeg: '{duration} de marche, {distance}',
    itin_steps_one: '{n} étape',
    itin_steps_two: '{n} étapes',
    itin_steps_few: '{n} étapes',
    itin_steps_many: '{n} étapes',
    itin_steps_other: '{n} étapes',
    itin_stepsHide: 'Masquer',
    // Attente estimée (fréquences) : toujours « ~ », jamais un horaire.
    itin_waitChip: 'Attente ~{n} min',
    // « {dest} » est mis en gras par l'écran.
    itin_rideTowards: '{mode} vers {dest}',
    itin_estimateNote: 'Horaires estimés d’après la fréquence des lignes : ni horaires publiés ni temps réel à Alger.',
    // Trajet entièrement à pied : pas de ligne, donc pas de fréquence à invoquer.
    itin_walkOnlyNote: 'Durée de marche estimée d’après la distance.',
    // Tickets : fare_rules du GTFS via OTP (un ticket par montée).
    itin_tickets_one: '{n} ticket, {price}.',
    itin_tickets_two: '{n} tickets, {price} chacun.',
    itin_tickets_few: '{n} tickets, {price} chacun.',
    itin_tickets_many: '{n} tickets, {price} chacun.',
    itin_tickets_other: '{n} tickets, {price} chacun.',
    itin_ticketsTotal_one: '{n} ticket, {total}.',
    itin_ticketsTotal_two: '{n} tickets, {total} au total.',
    itin_ticketsTotal_few: '{n} tickets, {total} au total.',
    itin_ticketsTotal_many: '{n} tickets, {total} au total.',
    itin_ticketsTotal_other: '{n} tickets, {total} au total.',
  },
  ar: {
    itin_errNoRoute: 'لم يُعثر في بياناتنا على أي رحلة بالنقل العمومي بين هاتين النقطتين.',
    itin_errOutOfService: 'لا توجد رحلة ممكنة بين هاتين النقطتين في هذه الساعة.',
    itin_errNoTransitTimes: 'المواعيد المرجعية لا تشمل هذا التاريخ.',
    itin_errTooFarFrom: 'لا توجد أي محطة مخدومة على مسافة مشي من نقطة الانطلاق.',
    itin_errTooFarTo: 'لا توجد أي محطة مخدومة على مسافة مشي من الوجهة.',
    itin_errTooFarBoth: 'لا توجد أي محطة مخدومة على مسافة مشي من نقطة الانطلاق ولا من الوجهة.',
    itin_errTooClose: 'نقطة الانطلاق والوجهة في المكان نفسه تقريباً.',
    itin_errOutsideFrom: 'نقطة الانطلاق خارج المنطقة المغطاة (الجزائر الكبرى).',
    itin_errOutsideTo: 'الوجهة خارج المنطقة المغطاة (الجزائر الكبرى).',
    itin_errOutsideBoth: 'نقطة الانطلاق والوجهة خارج المنطقة المغطاة (الجزائر الكبرى).',
    itin_errUnavailable: 'خادم حساب المسارات لا يستجيب.',
    itin_errOffline: 'أنت غير متصل: حساب المسار يحتاج إلى الشبكة.',
    itin_errTimeout: 'استغرق حساب المسار وقتاً أطول من اللازم.',
    itin_errBusy: 'عمليات بحث كثيرة جارية حالياً. أعد المحاولة بعد بضع ثوانٍ.',
    itin_retry: 'إعادة المحاولة',

    itin_nextServiceTomorrow: 'أولى الرحلات صباح الغد',
    itin_nextServiceThisMorning: 'أولى الرحلات هذا الصباح',
    itin_tomorrow: 'غداً',
    itin_noDepartureSoon: 'لا توجد أي رحلة لهذا المسار خلال الساعتين التاليتين للوقت المطلوب.',
    itin_nextServiceLaterToday: 'الرحلات التالية لاحقاً اليوم',
    itin_departEarlier: 'للوصول قبل {time}، يجب الانطلاق في وقت أبكر.',
    itin_latestArrivalBefore: 'آخر الرحلات التي تصل قبل {time}',
    itin_noArrivalFoundBefore: 'لم يُعثر على أي رحلة للوصول قبل {time}.',
    itin_firstArrivalsAfter: 'أولى الرحلات التي تصل بعد {time}',
    itin_startsLater: 'الانطلاق المتوقع {time}: عُد في موعد الانطلاق لبدء التوجيه.',
    itin_savedPlaceGone: '«{place}» لم يعد ضمن أماكنك المحفوظة.',
    itin_traceRecordedTo: 'المسار المسجَّل حتى {stop}',

    itin_walkOnly: 'مشياً فقط',

    itin_badgeEarliest: 'أبكر وصول',
    itin_badgeLatest: 'آخر موعد للانطلاق',
    itin_badgeShortest: 'الأقصر مدة',
    itin_badgeLessWalking: 'مشي أقل',
    itin_badgeCheapest: 'الأرخص',

    itin_departNow: 'الانطلاق الآن',
    itin_departAt: 'الانطلاق {time}',
    itin_arriveBy: 'الوصول قبل {time}',
    itin_algiersTime: 'بتوقيت الجزائر',

    itin_currency: 'دج',
    itin_fareUnknown: 'التعريفة غير متوفرة لهذه الرحلة',
    itin_fareSource: 'التعريفات المعلنة من المشغّلين · تذكرة لكل ركوب (تغيير الرصيف في المترو مشمول)',

    itin_frequencyEvery: 'يمر كل {n} د تقريباً',
    itin_waitUpTo: 'انتظار قد يصل إلى {n} د تقريباً',
    itin_waitIncluded: 'المدة محسوبة مع أقصى انتظار (~{n} د).',

    itin_unitMin: 'د',
    itin_unitHour: 'س',
    itin_unitM: 'م',
    itin_unitKm: 'كم',

    itin_demoBadge: 'مسار محاكى',
    itin_demoNote: 'وضع العرض التجريبي: هذا المسار محاكى وليس مساراً حقيقياً.',

    itin_geoNoResults: 'لم يُعثر على أي عنوان. جرّب اسم حي أو محطة أو موقف.',
    itin_geoSlow: 'الشبكة بطيئة: العناوين غير متاحة، تُعرض المحطات فقط.',
    itin_geoUnavailable: 'البحث عن العناوين غير متاح: تُعرض المحطات فقط.',
    itin_geoStop: 'موقف {stop}',
    itin_geoAreaCenter: 'منطقة واسعة، النقطة المركزية',
    itin_geoMetro: 'مترو الخط 1',
    itin_geoTram: 'ترامواي الخط 1',
    itin_geoBus: 'حافلة',

    itin_walkLeg: '{duration} مشياً، {distance}',
    itin_steps_one: 'خطوة واحدة',
    itin_steps_two: 'خطوتان',
    itin_steps_few: '{n} خطوات',
    itin_steps_many: '{n} خطوة',
    itin_steps_other: '{n} خطوة',
    itin_stepsHide: 'إخفاء',
    itin_waitChip: 'انتظار ~{n} د',
    itin_rideTowards: '{mode} نحو {dest}',
    itin_estimateNote: 'الأوقات تقديرية حسب تردد الخطوط: لا مواعيد منشورة ولا توقيت فعلي في الجزائر.',
    itin_walkOnlyNote: 'مدة المشي تقديرية حسب المسافة.',
    itin_tickets_one: 'تذكرة واحدة، {price}.',
    itin_tickets_two: 'تذكرتان، {price} لكل واحدة.',
    itin_tickets_few: '{n} تذاكر، {price} لكل واحدة.',
    itin_tickets_many: '{n} تذكرة، {price} لكل واحدة.',
    itin_tickets_other: '{n} تذكرة، {price} لكل واحدة.',
    itin_ticketsTotal_one: 'تذكرة واحدة، {total}.',
    itin_ticketsTotal_two: 'تذكرتان، {total} في المجموع.',
    itin_ticketsTotal_few: '{n} تذاكر، {total} في المجموع.',
    itin_ticketsTotal_many: '{n} تذكرة، {total} في المجموع.',
    itin_ticketsTotal_other: '{n} تذكرة، {total} في المجموع.',
  },
  en: {
    itin_errNoRoute: 'No public transport trip found between these two points in our data.',
    itin_errOutOfService: 'No trip is possible between these two points at this hour.',
    itin_errNoTransitTimes: 'The reference timetables do not cover this date.',
    itin_errTooFarFrom: 'No served stop within walking distance of the starting point.',
    itin_errTooFarTo: 'No served stop within walking distance of the destination.',
    itin_errTooFarBoth: 'No served stop within walking distance of either the start or the destination.',
    itin_errTooClose: 'Start and destination are almost the same place.',
    itin_errOutsideFrom: 'The starting point is outside the covered area (Greater Algiers).',
    itin_errOutsideTo: 'The destination is outside the covered area (Greater Algiers).',
    itin_errOutsideBoth: 'Both the start and the destination are outside the covered area (Greater Algiers).',
    itin_errUnavailable: 'The trip planner is not responding.',
    itin_errOffline: 'You are offline: route planning needs a network connection.',
    itin_errTimeout: 'Route planning took too long.',
    itin_errBusy: 'Too many searches right now. Try again in a few seconds.',
    itin_retry: 'Try again',

    itin_nextServiceTomorrow: 'First departures tomorrow morning',
    itin_nextServiceThisMorning: 'First departures this morning',
    itin_tomorrow: 'tomorrow',
    itin_noDepartureSoon: 'No departure for this trip within 2 hours of the requested time.',
    itin_nextServiceLaterToday: 'Next departures later today',
    itin_departEarlier: 'To arrive by {time}, you need to leave earlier.',
    itin_latestArrivalBefore: 'Latest possible arrivals before {time}',
    itin_noArrivalFoundBefore: 'No trip found that arrives by {time}.',
    itin_firstArrivalsAfter: 'First arrivals after {time}',
    itin_startsLater: 'Planned departure {time}: come back at departure time to be guided.',
    itin_savedPlaceGone: '“{place}” is no longer one of your saved places.',
    itin_traceRecordedTo: 'Route recorded up to {stop}',

    itin_walkOnly: 'On foot only',

    itin_badgeEarliest: 'earliest arrival',
    itin_badgeLatest: 'latest departure',
    itin_badgeShortest: 'shortest',
    itin_badgeLessWalking: 'less walking',
    itin_badgeCheapest: 'cheapest',

    itin_departNow: 'Leaving now',
    itin_departAt: 'Leave at {time}',
    itin_arriveBy: 'Arrive by {time}',
    itin_algiersTime: 'Algiers time',

    itin_currency: 'DZD',
    itin_fareUnknown: 'Fare not available for this trip',
    itin_fareSource: 'Operators’ published fares · one ticket per boarding (metro platform change included)',

    itin_frequencyEvery: 'runs every ~{n} min',
    itin_waitUpTo: 'wait up to ~{n} min',
    itin_waitIncluded: 'Duration includes the maximum wait (~{n} min).',

    itin_unitMin: 'min',
    itin_unitHour: 'h',
    itin_unitM: 'm',
    itin_unitKm: 'km',

    itin_demoBadge: 'Simulated route',
    itin_demoNote: 'Demo mode: this route is simulated, not a real itinerary.',

    itin_geoNoResults: 'No address found. Try a neighbourhood, a station or a stop.',
    itin_geoSlow: 'Slow network: addresses unavailable, only stops are shown.',
    itin_geoUnavailable: 'Address search unavailable: only stops are shown.',
    itin_geoStop: 'stop {stop}',
    itin_geoAreaCenter: 'large area, central point',
    itin_geoMetro: 'Metro L1',
    itin_geoTram: 'Tramway L1',
    itin_geoBus: 'Bus',

    itin_walkLeg: '{duration} walk, {distance}',
    itin_steps_one: '{n} step',
    itin_steps_two: '{n} steps',
    itin_steps_few: '{n} steps',
    itin_steps_many: '{n} steps',
    itin_steps_other: '{n} steps',
    itin_stepsHide: 'Hide',
    itin_waitChip: 'Wait ~{n} min',
    itin_rideTowards: '{mode} towards {dest}',
    itin_estimateNote: 'Times estimated from line frequencies: no published timetables or real-time data in Algiers.',
    itin_walkOnlyNote: 'Walking time estimated from distance.',
    itin_tickets_one: '{n} ticket, {price}.',
    itin_tickets_two: '{n} tickets, {price} each.',
    itin_tickets_few: '{n} tickets, {price} each.',
    itin_tickets_many: '{n} tickets, {price} each.',
    itin_tickets_other: '{n} tickets, {price} each.',
    itin_ticketsTotal_one: '{n} ticket, {total}.',
    itin_ticketsTotal_two: '{n} tickets, {total} in total.',
    itin_ticketsTotal_few: '{n} tickets, {total} in total.',
    itin_ticketsTotal_many: '{n} tickets, {total} in total.',
    itin_ticketsTotal_other: '{n} tickets, {total} in total.',
  },
})

export type ItinKey = keyof typeof itinStrings.fr

/** Chaîne du domaine, avec remplacement simple des variables « {n} ». */
export function itinText(
  locale: 'fr' | 'ar' | 'en',
  key: ItinKey,
  vars?: Record<string, string | number>,
): string {
  let out: string = (itinStrings[locale] ?? itinStrings.fr)[key] ?? itinStrings.fr[key]
  if (vars) {
    for (const name of Object.keys(vars)) out = out.split(`{${name}}`).join(String(vars[name]))
  }
  return out
}

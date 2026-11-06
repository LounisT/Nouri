import { defineStrings } from './define'

// Domaine UX / i18n / accessibilité / PWA. Variables : « {n} », « {time} »,
// « {name} », « {line} », « {from} », « {to} » (remplacement simple).
//
// PLURIELS : une famille de clés « base_one / _two / _few / _many / _other »
// se lit avec tn('ux_stops', n) (useTranslation) ou pluralize() (i18n.ts),
// qui choisit la forme par Intl.PluralRules. Le français et l'anglais n'ont
// que « one » et « other » : les autres formes y répètent « other ». L'arabe
// accorde le nom selon le nombre — 1 : محطة واحدة, 2 : محطتان (duel),
// 3-10 : محطات (pluriel), 11-99 : محطةً (singulier accusatif), 100+ : محطة.
// Chiffres latins dans les trois langues, comme partout dans l'app.
export const uxStrings = defineStrings({
  fr: {
    // ── Application ──────────────────────────────────────────────────────────
    ux_appTitle: 'Nouri — Métro, tram & bus à Alger',
    ux_mainNav: 'Navigation principale',
    ux_changeLanguage: 'Changer de langue',
    ux_swap: 'Inverser départ et destination',

    // ── Frontière d'erreur ───────────────────────────────────────────────────
    ux_errorTitle: 'Un problème est survenu',
    ux_errorBody: 'Cet écran n’a pas pu s’afficher. Recharger l’application règle généralement le problème.',
    ux_reload: 'Recharger',

    // ── Mise à jour de l'application ─────────────────────────────────────────
    ux_updateReady: 'Une nouvelle version de Nouri est prête.',

    // ── Formulaire d'itinéraire ──────────────────────────────────────────────
    ux_now: 'Maintenant',
    ux_timeField: 'Heure',
    ux_pickPlaces: 'Choisissez un départ et une destination dans les suggestions.',
    ux_myLocationOutside: 'Votre position est à ~{n} km de la zone desservie (Grand Alger) : choisissez un départ.',
    ux_myLocationFound: 'Position trouvée.',

    // ── Signaler une erreur (mailto contextuel) ──────────────────────────────
    ux_reportError: 'Signaler une erreur',
    ux_reportIntro: 'Décrivez ce qui est faux (horaire, arrêt, tracé, sens, nom…) :',
    ux_reportSubjectGeneral: '[Nouri] Retour d’usage',
    ux_reportSubjectLine: '[Nouri] Erreur – ligne {line}',
    ux_reportSubjectStop: '[Nouri] Erreur – arrêt {name}',
    ux_reportSubjectTrip: '[Nouri] Erreur – trajet {from} → {to}',
    ux_reportContextNote: 'Joint au message :',
    ux_reportLine: 'Ligne {line}',
    ux_reportStop: 'Arrêt {name}',
    ux_reportTrip: 'Trajet {from} → {to}',

    // ── Pluriels ─────────────────────────────────────────────────────────────
    ux_stops_one: '{n} arrêt',
    ux_stops_two: '{n} arrêts',
    ux_stops_few: '{n} arrêts',
    ux_stops_many: '{n} arrêts',
    ux_stops_other: '{n} arrêts',

    ux_stopsLeft_one: '{n} arrêt restant',
    ux_stopsLeft_two: '{n} arrêts restants',
    ux_stopsLeft_few: '{n} arrêts restants',
    ux_stopsLeft_many: '{n} arrêts restants',
    ux_stopsLeft_other: '{n} arrêts restants',

    ux_stations_one: '{n} station',
    ux_stations_two: '{n} stations',
    ux_stations_few: '{n} stations',
    ux_stations_many: '{n} stations',
    ux_stations_other: '{n} stations',

    ux_transfers_one: '{n} correspondance',
    ux_transfers_two: '{n} correspondances',
    ux_transfers_few: '{n} correspondances',
    ux_transfers_many: '{n} correspondances',
    ux_transfers_other: '{n} correspondances',

    ux_routesFound_one: '{n} itinéraire trouvé',
    ux_routesFound_two: '{n} itinéraires trouvés',
    ux_routesFound_few: '{n} itinéraires trouvés',
    ux_routesFound_many: '{n} itinéraires trouvés',
    ux_routesFound_other: '{n} itinéraires trouvés',

    ux_lines_one: '{n} ligne',
    ux_lines_two: '{n} lignes',
    ux_lines_few: '{n} lignes',
    ux_lines_many: '{n} lignes',
    ux_lines_other: '{n} lignes',

    ux_suggestions_one: '{n} suggestion',
    ux_suggestions_two: '{n} suggestions',
    ux_suggestions_few: '{n} suggestions',
    ux_suggestions_many: '{n} suggestions',
    ux_suggestions_other: '{n} suggestions',
  },

  ar: {
    ux_appTitle: 'نوري — مترو وترامواي وحافلات الجزائر العاصمة',
    ux_mainNav: 'التنقّل الرئيسي',
    ux_changeLanguage: 'تغيير اللغة',
    ux_swap: 'تبديل نقطة الانطلاق والوجهة',

    ux_errorTitle: 'حدث خلل',
    ux_errorBody: 'تعذّر عرض هذه الشاشة. إعادة تحميل التطبيق تحلّ المشكلة عادةً.',
    ux_reload: 'إعادة التحميل',

    ux_updateReady: 'إصدار جديد من نوري جاهز.',

    ux_now: 'الآن',
    ux_timeField: 'الساعة',
    ux_pickPlaces: 'اختر نقطة الانطلاق والوجهة من الاقتراحات.',
    ux_myLocationOutside: 'موقعك على بُعد ~{n} كلم من المنطقة المخدومة (الجزائر الكبرى): اختر نقطة انطلاق.',
    ux_myLocationFound: 'تم تحديد الموقع.',

    ux_reportError: 'الإبلاغ عن خطأ',
    ux_reportIntro: 'صِف ما هو خاطئ (المواعيد، المحطة، المسار، الاتجاه، الاسم…):',
    ux_reportSubjectGeneral: '[Nouri] ملاحظة',
    ux_reportSubjectLine: '[Nouri] خطأ – الخط {line}',
    ux_reportSubjectStop: '[Nouri] خطأ – المحطة {name}',
    ux_reportSubjectTrip: '[Nouri] خطأ – رحلة من {from} إلى {to}',
    ux_reportContextNote: 'يُرفق بالرسالة:',
    ux_reportLine: 'الخط {line}',
    ux_reportStop: 'المحطة {name}',
    ux_reportTrip: 'رحلة من {from} إلى {to}',

    ux_stops_one: 'محطة واحدة',
    ux_stops_two: 'محطتان',
    ux_stops_few: '{n} محطات',
    ux_stops_many: '{n} محطة',
    ux_stops_other: '{n} محطة',

    ux_stopsLeft_one: 'محطة واحدة متبقية',
    ux_stopsLeft_two: 'محطتان متبقيتان',
    ux_stopsLeft_few: '{n} محطات متبقية',
    ux_stopsLeft_many: '{n} محطة متبقية',
    ux_stopsLeft_other: '{n} محطة متبقية',

    ux_stations_one: 'محطة واحدة',
    ux_stations_two: 'محطتان',
    ux_stations_few: '{n} محطات',
    ux_stations_many: '{n} محطة',
    ux_stations_other: '{n} محطة',

    ux_transfers_one: 'تحويلة واحدة',
    ux_transfers_two: 'تحويلتان',
    ux_transfers_few: '{n} تحويلات',
    ux_transfers_many: '{n} تحويلة',
    ux_transfers_other: '{n} تحويلة',

    ux_routesFound_one: 'مسار واحد',
    ux_routesFound_two: 'مساران',
    ux_routesFound_few: '{n} مسارات',
    ux_routesFound_many: '{n} مسارًا',
    ux_routesFound_other: '{n} مسار',

    ux_lines_one: 'خط واحد',
    ux_lines_two: 'خطان',
    ux_lines_few: '{n} خطوط',
    ux_lines_many: '{n} خطًا',
    ux_lines_other: '{n} خط',

    ux_suggestions_one: 'اقتراح واحد',
    ux_suggestions_two: 'اقتراحان',
    ux_suggestions_few: '{n} اقتراحات',
    ux_suggestions_many: '{n} اقتراحًا',
    ux_suggestions_other: '{n} اقتراح',
  },

  en: {
    ux_appTitle: 'Nouri — Algiers metro, tram & bus',
    ux_mainNav: 'Main navigation',
    ux_changeLanguage: 'Change language',
    ux_swap: 'Swap origin and destination',

    ux_errorTitle: 'Something went wrong',
    ux_errorBody: 'This screen could not be displayed. Reloading the app usually fixes it.',
    ux_reload: 'Reload',

    ux_updateReady: 'A new version of Nouri is ready.',

    ux_now: 'Now',
    ux_timeField: 'Time',
    ux_pickPlaces: 'Choose a start and a destination from the suggestions.',
    ux_myLocationOutside: 'Your position is ~{n} km from the served area (Greater Algiers): choose a starting point.',
    ux_myLocationFound: 'Position found.',

    ux_reportError: 'Report an error',
    ux_reportIntro: 'Describe what is wrong (times, stop, route, direction, name…):',
    ux_reportSubjectGeneral: '[Nouri] Feedback',
    ux_reportSubjectLine: '[Nouri] Error – line {line}',
    ux_reportSubjectStop: '[Nouri] Error – stop {name}',
    ux_reportSubjectTrip: '[Nouri] Error – trip {from} → {to}',
    ux_reportContextNote: 'Attached to the message:',
    ux_reportLine: 'Line {line}',
    ux_reportStop: 'Stop {name}',
    ux_reportTrip: 'Trip {from} → {to}',

    ux_stops_one: '{n} stop',
    ux_stops_two: '{n} stops',
    ux_stops_few: '{n} stops',
    ux_stops_many: '{n} stops',
    ux_stops_other: '{n} stops',

    ux_stopsLeft_one: '{n} stop left',
    ux_stopsLeft_two: '{n} stops left',
    ux_stopsLeft_few: '{n} stops left',
    ux_stopsLeft_many: '{n} stops left',
    ux_stopsLeft_other: '{n} stops left',

    ux_stations_one: '{n} station',
    ux_stations_two: '{n} stations',
    ux_stations_few: '{n} stations',
    ux_stations_many: '{n} stations',
    ux_stations_other: '{n} stations',

    ux_transfers_one: '{n} transfer',
    ux_transfers_two: '{n} transfers',
    ux_transfers_few: '{n} transfers',
    ux_transfers_many: '{n} transfers',
    ux_transfers_other: '{n} transfers',

    ux_routesFound_one: '{n} route found',
    ux_routesFound_two: '{n} routes found',
    ux_routesFound_few: '{n} routes found',
    ux_routesFound_many: '{n} routes found',
    ux_routesFound_other: '{n} routes found',

    ux_lines_one: '{n} line',
    ux_lines_two: '{n} lines',
    ux_lines_few: '{n} lines',
    ux_lines_many: '{n} lines',
    ux_lines_other: '{n} lines',

    ux_suggestions_one: '{n} suggestion',
    ux_suggestions_two: '{n} suggestions',
    ux_suggestions_few: '{n} suggestions',
    ux_suggestions_many: '{n} suggestions',
    ux_suggestions_other: '{n} suggestions',
  },
})

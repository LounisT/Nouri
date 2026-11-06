import { defineStrings } from './define'

// Chaînes du domaine données (métro, tram, fréquences, sources).
// Variables : remplacement simple de {n}, {name}, {first}, {last}, {from}, {to}, {time}.
export const dataStrings = defineStrings({
  fr: {
    // Intervalle d'un sens : une fréquence, jamais un temps d'attente.
    data_everyMin: '~ toutes les {n} min',
    // Onglet de sens quand deux sens ont le même terminus (M1 vers Place des Martyrs).
    data_fromStop: 'depuis {name}',
    // Sous un arrêt : premier et dernier passage estimés (départ du terminus + temps estimé).
    data_stopPasses: '1er ~{first} · dernier ~{last}',
    data_railEstimateNote:
      '~ Estimations : intervalles estimés (non publiés par les exploitants) et temps de parcours calculés sur la longueur des voies (OpenStreetMap). Aucun horaire de passage n’est publié.',
    data_metroBranches:
      'Après Haï El Badr, la ligne se sépare en deux branches : El Harrach Centre et Aïn Naâdja. La répartition des rames n’est pas publiée : on compte une rame sur deux pour chaque branche.',
    data_osmCredit: '© contributeurs OpenStreetMap',
    data_ramadanRailNotice:
      'Ramadan : le métro et le tramway suivent des horaires spéciaux, plus tardifs le soir, qui ne sont pas intégrés à l’application. Vérifiez sur place.',
    // Bus : provenance des chiffres affichés (catalogue, fiche d'arrêt).
    data_busEstimateNote:
      '~ Estimations : l’ETUSA ne publie pas d’horaires détaillés. Fréquences modélisées, temps de parcours calculés sur la longueur du tracé (15 km/h en ville, 35 km/h sur voie rapide). Pas de temps réel à Alger.',
    data_busSource: 'Amplitude et tarif : ETUSA, relevé 2024.',
    data_busHoursNotice:
      'Le vendredi, pendant le Ramadan et les jours fériés, les horaires peuvent changer : ils ne sont pas intégrés à l’application.',
    data_ramadanBusNotice:
      'Ramadan : les bus peuvent suivre des horaires différents, qui ne sont pas intégrés à l’application. Vérifiez sur place.',
    // Ligne dont un seul sens est relevé (oneDirection) : jamais « A → B » dans le titre.
    data_oneDirection: 'Seul le sens {from} → {to} est relevé dans nos données : le trajet retour n’y figure pas.',
    // Provenance du tracé d'un sens (shapeSource).
    data_shapeAbsent: 'Tracé non relevé dans ce sens : seuls les arrêts sont connus.',
    data_shapeDeduced: 'Tracé en partie déduit des rues entre les arrêts (relevé OpenStreetMap incomplet).',
    // Dernier départ, rattaché au terminus d'origine du sens.
    data_lastDepartureFrom: 'dernier départ de {name} : {time}',
    // Tarif d'une ligne (fare_attributes.txt), unité dans la langue de l'interface.
    data_fare: '{n} DA',
    // Recherche en arabe sans résultat : les noms d'arrêts de bus ne sont pas tous traduits.
    data_searchArabicStops: 'Les noms d’arrêts de bus ne sont pas tous relevés en arabe : essayez en caractères latins.',
  },
  ar: {
    data_everyMin: 'كل {n} د تقريباً',
    data_fromStop: 'من {name}',
    data_stopPasses: 'أول مرور ~{first} · آخر مرور ~{last}',
    data_railEstimateNote:
      '~ تقديرات: الفواصل الزمنية تقديرية (لا ينشرها المشغّلون)، ومدة الرحلة محسوبة من طول السكة (OpenStreetMap). لا توجد مواعيد مرور منشورة.',
    data_metroBranches:
      'بعد حي البدر ينقسم الخط إلى فرعين: الحراش وسط وعين النعجة. توزيع القطارات بين الفرعين غير منشور، لذا نحتسب قطاراً من كل اثنين لكل فرع.',
    data_osmCredit: '© مساهمو OpenStreetMap',
    data_ramadanRailNotice:
      'رمضان: يعمل المترو والترامواي بمواقيت خاصة تمتد إلى وقت متأخر من الليل، وهي غير مُدرجة في التطبيق. تحقّق منها في عين المكان.',
    data_busEstimateNote:
      '~ تقديرات: لا تنشر إيتوزا مواعيد مفصّلة. الفواصل الزمنية تقديرية، ومدة الرحلة محسوبة من طول المسار (15 كم/سا في المدينة، 35 كم/سا على الطرق السريعة). لا توجد معلومات آنية في الجزائر العاصمة.',
    data_busSource: 'أوقات الخدمة والتعريفة: إيتوزا، معطيات سنة 2024.',
    data_busHoursNotice:
      'قد تتغيّر المواعيد يوم الجمعة وفي رمضان وأيام العطل، وهي غير مُدرجة في التطبيق.',
    data_ramadanBusNotice:
      'رمضان: قد تعمل الحافلات بمواقيت مختلفة غير مُدرجة في التطبيق. تحقّق منها في عين المكان.',
    data_oneDirection: 'الاتجاه من {from} إلى {to} هو وحده المسجَّل في بياناتنا، ورحلة العودة غير متوفرة فيها.',
    data_shapeAbsent: 'مسار هذا الاتجاه غير مسجَّل: المحطات وحدها معروفة.',
    data_shapeDeduced: 'المسار مستنتَج جزئياً من الشوارع بين المحطات (بيانات OpenStreetMap غير مكتملة).',
    data_lastDepartureFrom: 'آخر انطلاق من {name}: {time}',
    data_fare: '{n} دج',
    data_searchArabicStops: 'أسماء محطات الحافلات ليست كلها مسجَّلة بالعربية: جرّب البحث بالحروف اللاتينية.',
  },
  en: {
    data_everyMin: 'every ~{n} min',
    data_fromStop: 'from {name}',
    data_stopPasses: 'first ~{first} · last ~{last}',
    data_railEstimateNote:
      '~ Estimates: estimated intervals (not published by the operators), and travel times computed from track length (OpenStreetMap). No timetable is published.',
    data_metroBranches:
      'After Haï El Badr the line splits into two branches: El Harrach Centre and Aïn Naâdja. The split of trains is not published; we count every other train for each branch.',
    data_osmCredit: '© OpenStreetMap contributors',
    data_ramadanRailNotice:
      'Ramadan: the metro and tram run special hours, later in the evening, which are not included in the app. Check on site.',
    data_busEstimateNote:
      '~ Estimates: ETUSA publishes no detailed timetable. Modelled frequencies; travel times computed from route length (15 km/h in town, 35 km/h on expressways). No real-time data in Algiers.',
    data_busSource: 'Hours and fare: ETUSA, 2024 survey.',
    data_busHoursNotice:
      'On Fridays, during Ramadan and on public holidays, hours may differ; they are not included in the app.',
    data_ramadanBusNotice:
      'Ramadan: buses may run different hours, which are not included in the app. Check on site.',
    data_oneDirection: 'Only the {from} → {to} direction is recorded in our data; the return trip is not included.',
    data_shapeAbsent: 'Route not mapped in this direction: only the stops are known.',
    data_shapeDeduced: 'Route partly inferred from the streets between stops (incomplete OpenStreetMap data).',
    data_lastDepartureFrom: 'last departure from {name}: {time}',
    data_fare: '{n} DZD',
    data_searchArabicStops: 'Not all bus stop names are recorded in Arabic: try searching in Latin letters.',
  },
})

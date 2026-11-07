# Fiche Play Store — Nouri (`dev.lounis.nouri`)

Textes prêts à coller dans Play Console, section **Présence sur Google Play > Fiche Play Store principale**
(et **Traductions** pour `en-US` et `ar`). Les nombres de caractères sont comptés par script (points de code Unicode,
comme Play Console) et respectent les limites : nom 30, description courte 80, description complète 4 000.

Les chiffres cités (37 lignes de bus ETUSA, ligne 1 du métro, ligne 1 du tramway) viennent de
`web/src/lib/generated-lines.json` (37 lignes) et de `data/gtfs/routes.txt` (37 bus, 1 métro, 1 tram).
Le README du dépôt annonce encore « 38 lignes » : il est en retard sur les données, pas la fiche.

## Informations générales

| Champ | Valeur |
|---|---|
| Catégorie de l'application | **Cartes et navigation** (`Maps & Navigation`). Alternative : « Voyages et infos locales ». Je recommande la première : c'est celle des applications de transport public. |
| Type | Application (pas un jeu), gratuite |
| E-mail de contact (public) | `contact@lounis.dev` (déjà l'adresse du bouton « Signaler une erreur », `web/src/lib/report.ts:17`) |
| Site web | https://nouri.lounis.dev |
| Politique de confidentialité | https://nouri.lounis.dev/privacy — vérifiée le 2026-11-07 : **HTTP 200**, `text/html`, sans redirection |
| Téléphone | Facultatif, non renseigné |
| Langue par défaut | Français |

## Textes

### Français (fr-FR) — langue par défaut

**Nom de l'application** — 26 / 30

```text
Nouri – Transports d’Alger
```

**Description courte** — 78 / 80

```text
Métro, tram et bus d’Alger : itinéraires et horaires estimés, sans temps réel.
```

**Description complète** — 2090 / 4 000

```text
Nouri vous aide à vous déplacer à Alger en métro, en tramway et en bus, dans une seule application.

Indiquez d’où vous partez et où vous allez : Nouri propose des itinéraires qui combinent métro, tramway, bus ETUSA et marche, classés et sans doublons.

CE QUE VOUS POUVEZ FAIRE
• Chercher un itinéraire entre deux adresses, deux stations, ou depuis votre position.
• Suivre votre trajet pas à pas : la navigation s’appuie sur votre position GPS ; l’horloge ne sert que de repli, et l’application vous l’indique.
• Parcourir toutes les lignes : horaires, tarif et état de service (ouvert ou fermé) calculé à partir des amplitudes horaires relevées.
• Explorer la carte : arrêts, stations et tracé d’une ligne à la demande.
• Enregistrer vos lieux Maison et Travail et retrouver vos recherches récentes.
• Utiliser l’application en français, en arabe (affichage de droite à gauche) ou en anglais.

L’HONNÊTETÉ AVANT TOUT
Il n’existe aucune donnée en temps réel à Alger, et Nouri n’en invente pas :
• chaque durée ou horaire estimé est précédé de « ~ » et indique sa source ;
• pas de compte à rebours, pas de véhicule fictif ;
• quand une information manque, l’application le dit simplement ;
• quand un mécanisme est dégradé (position indisponible, calculateur injoignable), vous en êtes informé.
Les lignes de bus ne sont affichées qu’après vérification de leur tracé sur la carte : un tracé douteux est écarté plutôt qu’approximé.

RÉSEAU COUVERT
Ligne 1 du métro, ligne 1 du tramway et 37 lignes de bus ETUSA du Grand Alger. Les données viennent d’OpenStreetMap et d’horaires publiés. Certaines lignes ou certains sens ne sont pas encore cartographiés : vous pouvez signaler une erreur depuis l’application.

VIE PRIVÉE
Pas de compte, pas de publicité, pas de statistiques d’usage. Votre position n’est utilisée que si vous l’autorisez. Les adresses que vous recherchez sont envoyées à des services de cartographie ouverts, détaillés dans la politique de confidentialité : https://nouri.lounis.dev/privacy

Nouri est une application indépendante, développée à partir de données ouvertes.
```

### English (en-US)

**Nom de l'application** — 23 / 30

```text
Nouri – Algiers Transit
```

**Description courte** — 75 / 80

```text
Algiers metro, tram and bus: routes and estimated times, no real-time data.
```

**Description complète** — 1802 / 4 000

```text
Nouri helps you get around Algiers by metro, tram and bus, in a single app.

Tell it where you are leaving from and where you are going: Nouri suggests routes that combine the metro, the tram, ETUSA buses and walking, ranked and without duplicates.

WHAT YOU CAN DO
• Search a route between two addresses, two stations, or from your location.
• Follow your trip step by step: navigation relies on your GPS position; the clock is only a fallback, and the app tells you when it is used.
• Browse every line: timetable, fare and service status (open or closed) computed from the recorded service hours.
• Explore the map: stops, stations and the route of a line on demand.
• Save your Home and Work places and find your recent searches.
• Use the app in French, Arabic (right-to-left layout) or English.

HONESTY FIRST
There is no real-time data in Algiers, and Nouri does not make any up:
• every estimated duration or time is marked with “~” and states its source;
• no countdowns, no made-up vehicles;
• when a piece of information is missing, the app simply says so;
• when something is degraded (position unavailable, route planner unreachable), you are told.
Bus lines are shown only once their route has been checked against the map: a doubtful route is dropped rather than approximated.

NETWORK COVERED
Metro line 1, tram line 1 and 37 ETUSA bus lines in Greater Algiers. The data comes from OpenStreetMap and published timetables. Some lines or directions are not mapped yet: you can report an error from within the app.

PRIVACY
No account, no ads, no usage analytics. Your location is used only if you allow it. The addresses you search for are sent to open mapping services, described in the privacy policy: https://nouri.lounis.dev/privacy

Nouri is an independent app, built from open data.
```

### العربية (ar)

**Nom de l'application** — 22 / 30

```text
نوري – مواصلات الجزائر
```

**Description courte** — 76 / 80

```text
مترو وترامواي وحافلات الجزائر العاصمة: مسارات ومواعيد تقديرية دون زمن حقيقي.
```

**Description complète** — 1612 / 4 000

```text
يساعدك «نوري» على التنقل في الجزائر العاصمة بالمترو والترامواي والحافلات، في تطبيق واحد.

حدّد نقطة انطلاقك ووجهتك، فيقترح عليك «نوري» مسارات تجمع بين المترو والترامواي وحافلات إيتوزا والمشي، مرتّبة ودون تكرار.

ماذا يمكنك أن تفعل؟
• البحث عن مسار بين عنوانين أو محطتين، أو انطلاقًا من موقعك.
• متابعة رحلتك خطوة بخطوة: تعتمد الملاحة على موقعك عبر GPS، ولا تُستخدم الساعة إلا كحلّ بديل يُعلمك التطبيق به.
• تصفّح جميع الخطوط: المواعيد والتعرفة وحالة الخدمة (مفتوح أو مغلق) محسوبة انطلاقًا من ساعات التشغيل المسجَّلة.
• استكشاف الخريطة: المحطات والتوقفات ومسار أي خط عند الطلب.
• حفظ مكاني «البيت» و«العمل» والعثور على عمليات بحثك الأخيرة.
• استعمال التطبيق بالعربية (مع واجهة من اليمين إلى اليسار) أو بالفرنسية أو بالإنجليزية.

الصدق أولًا
لا توجد في الجزائر العاصمة أي بيانات في الزمن الحقيقي، و«نوري» لا يختلق منها شيئًا:
• كل مدة أو موعد تقديري مسبوق بعلامة «~» مع ذكر مصدره؛
• لا عدّ تنازلي ولا مركبات وهمية؛
• حين تنقص معلومة، يقول التطبيق ذلك ببساطة؛
• وحين تتعطل آلية ما (الموقع غير متاح، حاسب المسارات لا يستجيب)، يتم إعلامك.
لا تُعرض خطوط الحافلات إلا بعد التحقق من مسارها على الخريطة: يُستبعد المسار المشكوك فيه بدل تقريبه.

الشبكة المغطاة
الخط 1 للمترو، والخط 1 للترامواي، و37 خطًا لحافلات إيتوزا في الجزائر الكبرى. البيانات مصدرها OpenStreetMap ومواعيد منشورة. بعض الخطوط أو الاتجاهات لم تُرسم بعد على الخريطة، ويمكنك الإبلاغ عن أي خطأ من داخل التطبيق.

الخصوصية
بلا حساب، بلا إعلانات، بلا إحصاءات استخدام. لا يُستخدم موقعك إلا إذا سمحت بذلك. تُرسل العناوين التي تبحث عنها إلى خدمات خرائط مفتوحة، مشروحة في سياسة الخصوصية: https://nouri.lounis.dev/privacy

«نوري» تطبيق مستقل، مبني على بيانات مفتوحة.
```

## Éléments graphiques

| Élément | Exigence Play | État dans le dépôt |
|---|---|---|
| Icône | PNG 512 × 512, ≤ 1 Mo | `web/public/icons/icon-512x512.png` (512 × 512) : prête. C'est aussi l'icône de `android/store_icon.png`. |
| Image de présentation | PNG ou JPEG 1024 × 500 | **Absente** : à créer. |
| Captures d'écran téléphone | 2 à 8, côté long ≤ 2 × côté court | `web/public/screenshots/accueil.png` et `lignes.png` font 1080 × 2340 (rapport **2,17**) : **trop allongées**, Play les refusera. À refaire en 1080 × 2160 (rapport 2) ou plus carré. |

## À confirmer avant de coller

- La dernière phrase de chaque description (« application indépendante ») : à garder seulement si c'est exact. Les noms ETUSA, SETRAM et Métro d'Alger sont des marques d'opérateurs ; seul « ETUSA » est cité, comme nom de réseau, jamais comme éditeur.
- Le titre : « Nouri – Transports d'Alger ». Les titres Play ne doivent pas contenir de mots-clés promotionnels ; celui-ci décrit simplement l'app.
- L'adresse e-mail publique et un éventuel numéro de téléphone.

# Formulaire « Sécurité des données » — Nouri (`dev.lounis.nouri`)

Réponses déduites du code au 2026-11-07 (commit `06ca59d`). Chaque réponse cite le `fichier:ligne` qui la justifie.
Les numéros de ligne sont ceux de ce commit : ils glissent si le fichier change.

## Comment lire ce document

Google distingue :

- **Collecté** = donnée qui quitte l'appareil vers le serveur du développeur **ou** qu'il conserve. Les données
  traitées **de façon éphémère** (en mémoire, juste le temps de répondre à la requête, jamais conservées) n'ont
  pas à être déclarées comme collectées.
- **Partagé** = donnée transmise à un tiers. Un prestataire qui traite la donnée pour le compte du développeur
  n'est pas du « partage » au sens strict ; la limite entre « prestataire » et « tiers » est une question
  d'interprétation, signalée plus bas quand elle compte.

Faits établis (vérifiés, pas supposés) :

| Fait | Preuve |
|---|---|
| Aucun SDK publicitaire, d'analytique, de plantage ni de compte | `android/app/build.gradle:209-213` (seules dépendances : `androidbrowserhelper` et `locationdelegation`) ; recherche `analytics`, `gtag`, `sentry`, `firebase`, `admob`, `doubleclick`, `document.cookie` dans `web/src` : seules occurrences : le texte de la politique (`web/src/app/privacy/page.tsx:14,163`), aucune dans le code exécuté |
| Aucun cookie posé | même recherche ; aucun `Set-Cookie` dans `web/src/app/api/otp/[...path]/route.ts` |
| Le serveur ne journalise pas les requêtes | `Caddyfile` : aucune directive `log` (Caddy n'écrit alors que ses journaux de service) ; `route.ts` : aucun `console.*` ; `docker logs` des trois conteneurs (`alger-caddy`, `alger-web`, `alger-otp`) relus le 2026-11-07 : aucune ligne de requête, aucune coordonnée d'utilisateur |
| Permissions Android déclarées | `aapt2 dump permissions` sur l'APK construit : `ACCESS_FINE_LOCATION` et `ACCESS_COARSE_LOCATION` seulement (ajoutées par la dépendance `locationdelegation`, `android/app/build.gradle:211`, activée par `android/twa-manifest.json:30`). Pas de `ACCESS_BACKGROUND_LOCATION`, pas de `INTERNET` déclaré (c'est Chrome qui charge le site) |
| Notifications désactivées | `android/twa-manifest.json:14`, `android/app/build.gradle:36` |

## 1. Collecte et partage : réponse à la première question

> « Votre application collecte-t-elle ou partage-t-elle l'un des types de données utilisateur requis ? »

**Réponse recommandée : Oui** (à cause du **partage** avec des services de cartographie tiers, détaillé ci-dessous).
Si tu retiens la lecture stricte (voir § 3), la réponse peut devenir « Non » ; la lecture prudente évite tout risque
de rejet pour sous-déclaration.

## 2. Flux de données réels

| # | Destinataire | Ce qui part | Déclencheur | Preuve |
|---|---|---|---|---|
| A | **Notre serveur** `nouri.lounis.dev` (proxy `/api/otp` puis OpenTripPlanner, réseau Docker interne) | Coordonnées de départ et d'arrivée (le départ peut être la position GPS si l'usager choisit « Ma position »), heure demandée ; l'IP sert au limiteur de débit | Recherche d'un itinéraire | `web/src/lib/otp.ts:19` (appel via `/api/otp`) et `:455` (`fetch`) ; `route.ts:253-259` (appel amont, `cache: 'no-store'`) ; `docker-compose.yml:33` (OTP interne) |
| B | **Photon** (`photon.komoot.io`, Komoot) | Texte tapé + centre fixe d'Alger comme biais (`36.7538, 3.0588`) + zone d'Alger. **Pas** la position de l'usager. | Saisie dans la recherche d'adresse | `web/src/lib/geocoding.ts:218` (biais fixe), `:386-392` (paramètres), `:403` (`fetch`) |
| C | **Nominatim** (`nominatim.openstreetmap.org`, Fondation OSM) | Latitude et longitude **du point touché sur la carte** (appui long), langue | Appui long sur la carte | `web/src/components/MapView.tsx:1243` (déclenchement) ; `web/src/lib/geocoding.ts:477-491` |
| D | **OpenFreeMap** (`tiles.openfreemap.org`) | Requêtes de tuiles, style, polices : l'adresse IP de l'appareil et les zones de carte consultées | Affichage de la carte | `web/src/components/MapView.tsx:52` ; origine autorisée dans la CSP, `Caddyfile:24` |
| E | **Rien** (stockage local) | Langue, lieux Maison/Travail, 5 recherches récentes, session de navigation (itinéraire et position, reprise sous 30 min) | Usage normal | `web/src/components/I18nProvider.tsx:28,37` ; `web/src/hooks/useSavedPlaces.ts:24,44,67,76` ; `web/src/hooks/useRecentSearches.ts:42,95,108` ; `web/src/hooks/useNavigationSession.ts:112,124,136` ; reprise 30 min : `:114` |
| F | **Rien** (cache hors ligne du service worker) | Pages, données de lignes, tuiles déjà vues (800 max, 30 jours) | Navigation | `web/next.config.js` : règles `cacheName` de `apis` (l.79, jamais mis en cache) à `cross-origin` (l.166) |
| G | **Messagerie de l'usager** | Courriel pré-rempli (ligne ou arrêt, coordonnées, trajet) vers `contact@lounis.dev`, envoyé **seulement si l'usager valide** | Bouton « Signaler une erreur » | `web/src/lib/report.ts:132`, `web/src/lib/map-report.ts:40` (`mailto:`) |

La position GPS elle-même : lue par `navigator.geolocation` (`web/src/hooks/useUserPosition.ts:142`,
`web/src/hooks/useGeolocation.ts:85`), utilisée sur l'appareil pour la carte, les arrêts proches et le suivi de trajet.
Elle ne part vers le serveur (flux A) que si l'usager la choisit comme départ.

## 3. Réponses type par type

« Collecté » = quitte l'appareil et reste chez nous. « Partagé » = envoyé à un tiers.

### Localisation

| Type | Collecté | Partagé | Finalité | Facultatif | Justification |
|---|---|---|---|---|---|
| **Position précise** | **Non** (traitement éphémère côté serveur) | **Oui, lecture prudente** : les coordonnées du point touché partent chez Nominatim (flux C) | Fonctionnalités de l'application | Oui : on peut ne jamais toucher la carte longuement | Flux A et C. Serveur : aucun journal (tableau « Faits »). |
| **Position approximative** | **Non** | **Oui, lecture prudente** : zones de carte vues par OpenFreeMap (flux D) | Fonctionnalités de l'application | Non, la carte est le cœur de l'app ; mais la position de l'usager n'y est pas envoyée | Flux D, `MapView.tsx:52`. |

Lecture stricte : un point choisi sur une carte n'est pas la localisation physique de l'usager, et une tuile
n'identifie pas l'usager ; Nominatim et OpenFreeMap peuvent aussi être vus comme des prestataires de rendu. On peut
alors ne rien déclarer pour la localisation. **Je recommande la lecture prudente** : elle est cohérente avec la
politique de confidentialité, qui nomme ces services, et ne coûte que deux lignes dans la fiche.

### Activité dans l'application

| Type | Collecté | Partagé | Finalité | Facultatif | Justification |
|---|---|---|---|---|---|
| **Historique de recherche dans l'appli** | **Non** | **Oui** : le texte tapé part chez Photon (flux B) | Fonctionnalités de l'application | Oui | `geocoding.ts:386-403`. Les « recherches récentes » restent sur l'appareil (flux E). |

### Types sans aucune donnée (tous « Non », ni collectés ni partagés)

| Type | Justification |
|---|---|
| Informations personnelles (nom, e-mail, adresse, téléphone, identifiants, origine, orientation…) | Pas de compte : aucun formulaire ni champ de ce type dans `web/src` ; l'e-mail de `report.ts:17` est celui du développeur |
| Informations financières | Aucun paiement ; les tarifs sont des informations (`web/src/lib/generated-lines.json`, champ `fareDzd`) |
| Santé et forme physique | Aucune |
| Messages (SMS, e-mails, autres) | Le courriel de signalement part de la messagerie de l'usager (flux G), pas de l'app |
| Photos, vidéos, fichiers, audio | Aucune permission ni API correspondante |
| Contacts, agenda | Aucune |
| Navigation sur le Web | Aucune : l'app n'ouvre que son propre domaine |
| Infos et performances de l'appli (plantages, diagnostics) | Aucun SDK ; `web/src/app/error.tsx` n'écrit que dans la console de l'appareil |
| Appareil ou autres ID | Aucun identifiant d'appareil ni de publicité (aucune dépendance ni API). L'IP vue par les serveurs tiers et par le limiteur de débit n'est pas un « ID » au sens du formulaire |

## 4. Pratiques de sécurité

| Question | Réponse | Justification |
|---|---|---|
| Données chiffrées en transit | **Oui** | Tous les appels de l'appareil sont en HTTPS : `Caddyfile:1` (certificat Let's Encrypt automatique pour `{$DOMAIN}`), HSTS `Caddyfile:38`, `https://` en dur pour les trois tiers (`geocoding.ts:403,491` ; `MapView.tsx:52`), CSP `connect-src` limité à des origines HTTPS (`Caddyfile:24`), aucun `http://` hors localhost dans `web/src`. Pas de trafic en clair autorisé côté Android : ni `usesCleartextTraffic` ni `networkSecurityConfig` dans `android/app/src/main/AndroidManifest.xml`. **Précision** : le saut interne proxy → OpenTripPlanner est en HTTP (`docker-compose.yml:33`) mais reste sur le réseau Docker privé du serveur ; il ne sort jamais. |
| Possibilité de demander la suppression des données | **« Non »** si le formulaire le permet : rien n'est conservé côté serveur. Les données locales s'effacent en vidant les données de l'app (Android) ou en la désinstallant. Si Play impose une réponse « Oui » pour des données partagées, renvoyer vers la section « Données enregistrées sur votre téléphone » de `https://nouri.lounis.dev/privacy` | Flux E ; politique de confidentialité |
| URL de suppression de compte | **Sans objet** : pas de compte | Aucune création de compte dans `web/src` |
| Validation indépendante de la sécurité | Non | Aucun audit externe |
| Conforme à la politique Familles de Google Play | Non (app non destinée aux enfants, voir `classification-public.md`) | |

## 5. Écarts avec la politique de confidentialité (`https://nouri.lounis.dev/privacy`)

À corriger dans `web/src/app/privacy/page.tsx`, puis redéployer, **avant** de soumettre le formulaire :

1. ~~**Contradiction « ne partage pas »**~~ **Corrigée** (2026-11-07) — constat d'origine : — `page.tsx:41` (FR), `:102` (AR), `:163` (EN) : « Nous ne vendons ni ne
   partageons de données personnelles », alors que le formulaire déclare un **partage** avec Photon, Nominatim et
   OpenFreeMap (flux B, C, D), que la même page décrit aux lignes 54-56, 115-117, 176-178. Proposition : « Nous ne
   vendons aucune donnée. Seules les requêtes techniques décrites plus bas partent vers des services tiers. »
2. ~~Adresse IP non mentionnée côté serveur~~ **Corrigé** (2026-11-07) : `route.ts:162-213` garde l'IP de chaque client
   **en mémoire vive** pour le limiteur de débit. Attention, correction d'une erreur de ce document : les entrées
   ne sont **pas** purgées au bout de 120 s ; `pruneBuckets` (`route.ts:208-214`) ne s'exécute que lorsque la table atteint
   20 000 entrées (`route.ts:177,195`). Une IP reste donc en mémoire jusqu'à cette purge ou au redémarrage du serveur.
   Jamais écrite sur disque ni dans un journal : compatible avec « non collecté » (traitement éphémère). La politique
   le dit désormais, avec ce vocabulaire exact.
3. **Courriel de signalement** — la politique dit qu'il est « pré-rempli » (`page.tsx:88` FR, `:149` AR, `:210` EN). Elle ne dit pas qu'il peut
   contenir des coordonnées (arrêt, départ et arrivée : `report.ts:21`, `:132`). À ajouter, avec la mention que
   l'usager le relit avant l'envoi.
4. **Session de navigation** — la politique cite « l'état d'une navigation en cours » ; il contient en réalité
   l'itinéraire complet avec coordonnées et la position (`useNavigationSession.ts:104-110,136`), reprise possible pendant
   10 à 30 min (`:114-116`). Reste sur l'appareil, donc pas d'écart de fond, mais « itinéraire en cours » est plus clair.
5. **Position** — la politique est exacte (position sur l'appareil ; envoyée au serveur seulement comme départ). Rien à changer.
6. **Sauvegarde Android** — `android/app/src/main/AndroidManifest.xml:35` a `allowBackup="true"`. L'app TWA ne stocke
   rien elle-même (les données du site sont dans Chrome), donc pas d'impact sur la politique ; à garder en tête si l'app
   stocke un jour quelque chose en natif.

Aucun écart dans l'autre sens : tout ce que la politique déclare existe bien dans le code.

## 6. À confirmer par toi

- Lecture **prudente** (déclarer le partage de localisation et d'historique de recherche) ou **stricte** (rien).
- Réponse à la question sur la suppression, selon ce que le formulaire affiche réellement.
- Les corrections de politique du § 5 (je peux les faire et redéployer sur ton accord).
- Que Komoot/Photon et Nominatim sont bien utilisés comme **services publics gratuits** (sans contrat) : leurs conditions
  d'usage limitent le volume ; à surveiller si l'app prend de l'ampleur.

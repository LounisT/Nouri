# Classification, public cible, publicités, accès — Nouri (`dev.lounis.nouri`)

Réponses pour les rubriques **Contenu de l'application** de Play Console, déduites du code au 2026-11-07
(commit `06ca59d`). Le résultat de la classification est calculé par l'IARC à partir de tes réponses : les notes
indiquées ici sont **attendues**, pas garanties.

## 1. Questionnaire de classification du contenu (IARC)

| Question | Réponse | Justification |
|---|---|---|
| Adresse e-mail pour le certificat | `contact@lounis.dev` | `web/src/lib/report.ts:17` |
| Catégorie | **Utilitaire, productivité, communication ou autre** (ni jeu, ni réseau social, ni actualités) | App de transport public ; aucun contenu éditorial |
| Violence | Non | Aucun contenu de ce type dans `web/src` ; l'app n'affiche que des lignes, arrêts et horaires |
| Sexualité et nudité | Non | Idem |
| Langage grossier | Non | Idem |
| Substances réglementées (drogue, alcool, tabac) | Non | Idem |
| Humour vulgaire, jeux d'argent, peur | Non | Idem |
| Les utilisateurs peuvent-ils interagir ou échanger du contenu ? | **Non** | Pas de compte, pas de messagerie, pas de contenu publié par les usagers (`android/app/build.gradle:209-213` : aucun SDK social). Le bouton de partage d'un trajet (`web/src/components/ItineraryPanel.tsx:506-516`) passe par le menu de partage du système ou le presse-papiers : c'est un lien, pas un échange dans l'app |
| L'app partage-t-elle la position de l'utilisateur avec d'autres utilisateurs ? | **Non** | La position n'est utilisée que sur l'appareil et, comme départ, envoyée à notre serveur pour calculer l'itinéraire (voir `securite-donnees.md`, flux A). Un lien partagé contient un itinéraire que l'usager choisit d'envoyer, pas sa position en continu |
| Achats numériques | Non | Aucun paiement ni SDK de facturation |
| Accès à Internet sans restriction (navigateur, liens externes) | **Non** | L'app n'ouvre que son propre domaine (TWA sur `nouri.lounis.dev`, `android/twa-manifest.json:3`) ; aucun lien externe dans `web/src` ; `frame-src 'none'` et origines fermées dans la CSP, `Caddyfile:24` |

Classements attendus : **IARC 3+**, PEGI 3, ESRB « Everyone », USK 0. Attention : la mention « Partage de la position »
et « Interaction entre utilisateurs » ne doit pas apparaître ; si elle apparaît, relis les deux réponses ci-dessus.

## 2. Public cible et contenu

| Question | Réponse recommandée | Justification |
|---|---|---|
| Tranches d'âge visées | **13–15 ans, 16–17 ans, 18 ans et plus** (rien en dessous de 13 ans) | App utilitaire sans compte ni contenu sensible : tout public, mais non conçue pour les enfants. Ne pas cocher « 12 ans et moins » évite d'entrer dans la politique « Familles » de Google (exigences supplémentaires sur le SDK, les données et le ciblage). Alternative plus simple : **18 ans et plus** seulement |
| L'app attire-t-elle les enfants (apparence, personnages, mascotte) ? | Non | Interface sobre (`web/src/app/globals.css`), aucun personnage ni gamification |
| Programme « Familles » | Non | Voir ci-dessus |

## 3. Publicités

| Question | Réponse | Justification |
|---|---|---|
| L'application contient-elle des publicités ? | **Non** | Aucun SDK publicitaire : `android/app/build.gradle:209-213` ; aucune origine publicitaire dans la CSP (`Caddyfile:24`) ; aucune occurrence de `admob` ou `doubleclick` dans `web/src` |
| Utilise-t-elle l'identifiant publicitaire (Android 13+) ? | **Non** | Aucune dépendance qui le lit. Dans la déclaration, choisir « Mon appli n'utilise pas l'ID de publicité » |

## 4. Accès à l'application

| Question | Réponse | Justification |
|---|---|---|
| Des fonctionnalités sont-elles restreintes (connexion, abonnement, géolocalisation du pays, mot de passe) ? | **Non : toutes les fonctionnalités sont accessibles sans identifiants** | Pas de compte (aucun écran de connexion dans `web/src`). Aucune instruction d'accès à fournir aux examinateurs |
| Faut-il autoriser la position ? | Non, facultatif | L'app marche en saisissant les adresses ; la position n'est demandée que sur action de l'usager (`web/src/hooks/useUserPosition.ts:142`, `web/src/hooks/useGeolocation.ts:85`) |
| Réseau requis | Oui pour calculer un itinéraire (serveur) | `web/src/lib/otp.ts:19` ; l'app annonce l'indisponibilité si le calculateur ne répond pas |

## 5. Déclarations de type d'application

| Déclaration | Réponse | Justification |
|---|---|---|
| **Application d'actualités** | **Non** | Aucun article ni flux d'information. L'état de service d'une ligne (ouvert/fermé) est calculé à partir d'horaires relevés (`web/src/lib/generated-lines.json`, champs `hours`, `source`), pas une actualité. |
| **Application de santé** (Health Connect, suivi médical, COVID-19) | **Non** | Aucune fonction de santé, aucune API Health Connect ; pas d'application de traçage de contacts |
| **Fonctionnalités financières** (paiement, prêt, crypto, banque) | **Non** | Aucun paiement. Les tarifs (20 à 50 DZD, champ `fare` de `generated-lines.json`) sont affichés à titre d'information ; l'app ne vend pas de titre de transport |
| **Application gouvernementale** | **Non** | Application indépendante, sans lien déclaré avec un organisme public (voir « à confirmer ») |
| Jeux d'argent / casino social | Non | |
| Application VPN / service d'accessibilité / SMS-appels | Non | Aucune permission correspondante : `aapt2 dump permissions` ne liste que la localisation |
| Permissions sensibles | Localisation **au premier plan seulement** (fine et approximative) | Ajoutées par `locationdelegation` (`android/app/build.gradle:211`) ; **pas** de localisation en arrière-plan, donc pas de formulaire de déclaration spécifique |
| Services au premier plan, alarmes exactes, accès à toutes les photos, installation de paquets | Non utilisés | Aucune de ces permissions dans l'APK |
| Application destinée aux enfants (ciblée) | Non | § 2 |

## 6. À confirmer par toi

- **Tranches d'âge** : 13+ (recommandé) ou 18+ seulement.
- **Indépendance** : « application indépendante, sans lien avec ETUSA, SETRAM ou Métro d'Alger », exact ? Si Nouri a un accord avec
  un opérateur, la réponse « application gouvernementale » et la fiche changent.
- **Catégorie IARC** : « Utilitaire… » ; l'IARC peut te proposer une autre rubrique selon l'interface du jour.
- **Contenu à venir** : toute future fonction de compte, de commentaires d'usagers ou de publicité change ces réponses.

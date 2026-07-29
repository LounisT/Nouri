<p align="center">
  <img src="docs/logo.png" width="112" alt="Logo Nouri" />
</p>

<h1 align="center">Nouri&nbsp;·&nbsp;نوري</h1>

<p align="center">
  <strong>Métro, tramway et bus à Alger — dans une seule application.</strong><br />
  Progressive Web App trilingue (Français · العربية · English), pensée mobile d'abord.
</p>

---

**Nouri** aide à se déplacer dans le Grand Alger : recherche d'itinéraires
multimodaux (métro, tramway, bus, marche), catalogue complet des lignes avec état
de service, et carte interactive. Conçue autant pour les habitants que pour les
visiteurs et la diaspora qui ne connaissent pas encore le réseau.

## L'honnêteté des données

Alger ne dispose d'**aucun flux temps réel**. Nouri n'en invente pas :

- Toute estimation porte sa mention « ~ » et sa source (« d'après les fréquences officielles »).
- Jamais de compte à rebours, de véhicule fictif, ni de donnée inventée.
- Une donnée manquante s'affiche sobrement, avec une phrase factuelle.
- Quand un mécanisme se dégrade (position indisponible, calculateur injoignable), l'application le dit.

## Fonctionnalités

- **Trois onglets** : Itinéraire (l'accueil), Carte, Lignes.
- Itinéraires multimodaux métro + tram + bus + marche, résultats dédupliqués et classés.
- Navigation pas-à-pas qui suit la **position GPS** projetée sur le tracé (l'horloge n'est qu'un repli, annoncé).
- Catalogue de lignes avec horaires, tarif et état de service (ouvert/fermé) calculé sur les amplitudes officielles.
- Carte interactive : arrêts en badges de ligne, tracé affiché à la demande.
- **Trilingue** Français · العربية · English, avec RTL complet en arabe.
- Installable (PWA) sur Android et iOS ; favoris Maison/Travail, recherches récentes, géolocalisation.

## Réseau couvert

| Mode | Détail |
|---|---|
| **Métro — ligne 1** | 16 stations |
| **Tramway — ligne 1** | 20 stations (23 km) |
| **Bus ETUSA** | 38 lignes |
| **Total** | ~562 arrêts |

Les lignes de bus ne sont retenues qu'après vérification cartographique : une
ligne au tracé douteux (arrêts non localisés, discontinuités) est **écartée**
plutôt qu'approximée.

## Pile technique

| Brique | Choix |
|---|---|
| Front | Next.js 14 (App Router, TypeScript), Tailwind CSS |
| Carte | MapLibre GL JS, tuiles vectorielles OpenFreeMap |
| Routage | OpenTripPlanner 2.5 (Docker) |
| Données | GTFS croisé depuis OpenStreetMap et les horaires officiels ETUSA |

Le navigateur n'appelle **jamais** OpenTripPlanner directement : tout transite
par le proxy Next `/api/otp`. Le calculateur reste ainsi privé derrière un seul
domaine public.

## Démarrage rapide

Le GTFS versionné dans `data/gtfs/` est la source de vérité. OpenTripPlanner
attend deux fichiers non versionnés (trop lourds) qu'il faut produire une fois :

```bash
# 1. GTFS zippé — à refaire après toute modification de data/gtfs/
cd data/gtfs && zip ../gtfs-alger.zip *.txt && cd ../..

# 2. Extrait OpenStreetMap de l'Algérie (~300 Mo), sous le nom attendu
#    par data/build-config.json
curl -L -o data/algeria-260228.osm.pbf \
  https://download.geofabrik.de/africa/algeria-latest.osm.pbf

# 3. OpenTripPlanner (1er lancement : quelques minutes de construction du graphe)
docker compose up -d

# 4. Front en développement
cd web && npm install && npm run dev
```

Ouvrir **http://localhost:3000**.

> Après toute modification du GTFS : régénérer `data/gtfs-alger.zip`, supprimer
> `data/graph.obj`, puis redémarrer OTP (le graphe se reconstruit).

## Configuration — `web/.env.local`

```env
# OpenTripPlanner, côté serveur (appelé par le proxy /api/otp).
# Dans Docker, viser le nom du service, pas localhost.
OTP_INTERNAL_URL=http://otp:8080
NEXT_PUBLIC_OTP_URL=http://localhost:8080

# Fond de carte vectoriel (gratuit, sans clé).
NEXT_PUBLIC_TILE_URL=https://tiles.openfreemap.org/styles/positron
```

Sans variable OTP renseignée, l'application bascule d'elle-même en mode démo :
l'interface et le catalogue de lignes fonctionnent, les itinéraires sont simulés.

## Structure

```
nouri/
├── data/
│   ├── gtfs/          ← GTFS (source de vérité pour OTP et le front)
│   └── *.json         ← configuration d'OpenTripPlanner
└── web/
    └── src/
        ├── app/page.tsx        ← orchestrateur : onglets, recherche, résultats, navigation
        ├── components/
        │   ├── MapView.tsx      ← carte MapLibre (couches, badges, tracé)
        │   ├── SearchBar.tsx    ← accueil : départ/destination, raccourcis, contact
        │   ├── LineView.tsx     ← catalogue de lignes et détail
        │   └── ItineraryPanel.tsx ← détail pas-à-pas d'un itinéraire
        └── lib/
            ├── otp.ts           ← client OTP, post-traitement des itinéraires
            ├── navigation.ts    ← progression par projection GPS
            ├── lines.ts         ← source unifiée métro / tram / bus
            └── i18n.ts          ← traductions FR / AR / EN
```

## Déploiement

Un seul VPS suffit : le `docker compose` (front + OpenTripPlanner) derrière un
frontal **Caddy** pour le HTTPS automatique. Comme le front proxifie déjà OTP via
`/api/otp`, un domaine unique suffit et le calculateur reste privé. Le HTTPS
débloque aussi la géolocalisation, le service worker et l'installation sur
l'écran d'accueil.

OpenTripPlanner charge un graphe d'environ 225 Mo : prévoir 2 à 4 Go de RAM.

## Contact

Un bug, une suggestion ? La section **« Nous écrire »** de l'accueil, ou
directement [contact@lounis.dev](mailto:contact@lounis.dev).

## Licence & données

**Code — tous droits réservés.** © 2026 LounisT. Ce dépôt est publié en
consultation seule : aucun droit d'utilisation, de modification ou de
redistribution n'est accordé. Pour toute autorisation, écrire à
[contact@lounis.dev](mailto:contact@lounis.dev). Détail dans [LICENSE](LICENSE).

**Données — libres.** Le répertoire `data/` est dérivé d'**OpenStreetMap**
(© les contributeurs OpenStreetMap) et reste sous licence **ODbL** : la réserve
de droits ci-dessus ne s'y applique pas. Horaires et tarifs issus des
informations publiques de l'**ETUSA**. Fond de carte **OpenFreeMap**.

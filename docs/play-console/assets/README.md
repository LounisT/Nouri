# Visuels Play Store — Nouri

Générés le 2026-11-07 à partir de `https://nouri.lounis.dev` (Chrome headless, `assets/outils/captures.cjs`).

| Fichier | Format Play | Usage |
|---|---|---|
| `image-presentation-1024x500.png` | PNG 24 bits, sans alpha, 1024 × 500 | Image de présentation (la même pour toutes les langues) |
| `captures/fr/01…04-*.png` | PNG 24 bits, sans alpha, 1080 × 2160 (rapport 2:1) | Captures téléphone, fiche **française** (par défaut) |
| `captures/ar/…` | idem | Fiche **arabe** (interface en RTL) |
| `captures/en/…` | idem | Fiche **anglaise** |

Ordre conseillé dans Play Console : `01-accueil`, `02-itineraire`, `03-lignes`, `04-carte`.

## Ce que montrent les captures (à savoir avant de les publier)

- **Horloge simulée** : dimanche 8 novembre 2026, 08:30 heure d'Alger, pour planifier un trajet en pleine journée.
  Les horaires affichés (« ~08:37 – ~08:53 », « Ouvert ») sont ceux que l'app calcule vraiment pour cette heure.
- **Position simulée** : le point bleu des écrans « carte » est une position GPS fictive près de Tafourah, accordée
  au navigateur de test. Ce n'est la position de personne.
- **Trajet de démonstration** : Hamma → El Harrach Centre en métro M1 (9 arrêts, ~15 min, 50 DZD). Les noms passent par le
  lien de l'app, donc ils restent en caractères latins sur l'écran arabe.
- Aucune donnée inventée : tout vient de l'app en production. L'écran « itinéraire » garde la mention « Horaires
  estimés… ni horaires publiés ni temps réel à Alger ».

## Retouche à connaître : écran « itinéraire »

Sur ce rendu de test, la carte ne dessine pas ses ~93 premiers pixels CSS en haut de l'écran de détail d'itinéraire
(un bandeau gris uni, quelle que soit la taille de fenêtre, avec ou sans l'horloge simulée ; aucune erreur dans la
console, aucune requête de tuile en échec). La carte « plein écran » et les autres écrans se dessinent entièrement.
J'ai donc capturé une fenêtre plus haute (360 × 813 px, ×3) et **recadré le bandeau** pour obtenir 1080 × 2160 : le
marqueur de départ est coupé en haut de l'image. Je n'ai pas pu établir si ce bandeau apparaît aussi sur un vrai
téléphone Android ; à vérifier sur un appareil (écran détail d'un itinéraire, ouvert depuis un résultat de recherche).

## Régénérer

```bash
# captures : horloge simulée, position simulée, 3 langues (voir les variables VW/VH/DSF/NOSHIM en tête du script)
node assets/outils/captures.cjs fr,ar,en accueil,lignes,carte
VH=813 node assets/outils/captures.cjs fr,ar,en itineraire      # puis recadrer à 1080 × 2160
```
Le script cherche Chrome dans `~/tools/browser` et écrit dans `shots/` ; il n'est pas prévu pour tourner ailleurs sans adaptation.

#!/usr/bin/env python3
"""Bus ETUSA : partie bus du GTFS, reconstruite depuis une référence figée et OpenStreetMap.

Rejouable : `python3 data/scripts/build_bus.py` depuis la racine du dépôt
(dépendance : `pip install osmium`). Réécrit UNIQUEMENT les lignes de bus
(route_id ETUSA-*) de stops, routes, trips, stop_times, shapes, frequencies,
fare_rules et translations ; les lignes rail (build_rail.py) sont recopiées
telles quelles. Idempotent. Ensuite : build_front_data.py (front) et
validate_gtfs.py (contrôles, aussi lancés en fin de build).

Chaîne complète (environ 1 min, dont ~35 s de lecture du PBF ; --cache
FICHIER.pkl pour les relances) :
  python3 data/scripts/build_rail.py
  python3 data/scripts/build_bus.py
  python3 data/scripts/build_front_data.py
  python3 data/scripts/validate_gtfs.py
  (cd data/gtfs && rm -f ../gtfs-alger.zip && zip -q ../gtfs-alger.zip *.txt)
puis, après reconstruction du graphe OTP (supprimer data/graph.obj) :
  python3 data/scripts/otp_bus_smoke.py <URL OTP directe> 2026-11-09
  python3 data/scripts/otp_rail_smoke.py <URL OTP directe> 2026-11-09
  python3 data/scripts/otp_e2e_trips.py --staging <URL OTP directe> --all-patterns
(OTP de recette sans toucher à la production : voir crop_osm_alger.py.)

Entrées
  data/bus-reference.json    GTFS bus d'origine figé (lignes, sens, arrêts,
                             tarifs, amplitudes, fréquences) : le générateur
                             build_etusa_gtfs.py qui l'avait produit est perdu.
                             Ne pas l'éditer : les corrections sont ci-dessous
                             (CORRECTIONS), documentées une par une.
  data/algeria-260228.osm.pbf  relations de ligne ETUSA (une par sens, figées
                             dans la référence : osm_relation) et voirie.

Ce qui vient d'OSM (© contributeurs OpenStreetMap, ODbL)
  - coordonnées des arrêts : nœud OSM de même identifiant (stop_id = « B » +
    id du nœud), jamais un rapprochement par nom ;
  - noms arabes des arrêts : tag name:ar du même nœud, gardé seulement s'il
    est en écriture arabe (translations.txt) ;
  - tracés : plus court chemin, arrêt par arrêt, dans le graphe formé par les
    SEULS ways de la relation du sens (sens uniques respectés). L'ordre des
    membres de la relation n'est pas utilisé : les relations mal rangées
    (16/88 sens 1, relation 8006787) donnaient des allers-retours fantômes.
    Le tracé commence au premier arrêt et finit au dernier (plus de
    débordement après le terminus : 50, 82, 105, 606…).
    Quand la relation a un trou (ways manquants), le trou est comblé par la
    voirie OSM générale, pénalisée (PENALTY_ROAD) pour ne servir qu'en dernier
    recours ; un tel tracé est marqué « deduit » (shape_id …-deduit) dès que
    la part hors relation dépasse DEDUCED_MIN_M. Un sens dont le tracé échoue
    aux contrôles (détour sur voirie déduite, demi-tour, arrêt loin de la
    voie) est ÉCARTÉ (pas de shape_id) plutôt qu'approximé.

Ce qui est ESTIMÉ (jamais présenté comme officiel ; l'app l'affiche avec « ~ »)
  - Temps de parcours : longueur du tracé entre arrêts ÷ BUS_SPEED_KMH, arrêts
    compris, cumul arrondi à la minute (pas de fausse précision à la seconde).
    Aucune vitesse commerciale n'est publiée pour l'ETUSA (recherche du
    05/11/2026 : ni site de l'ETUSA, ni plan de transport accessible).
    Hypothèses, par classe de voie OSM et non par quartier :
      * rues : 15 km/h, en deçà des 18 km/h retenus pour le tramway en site
        propre (build_rail.py) : le bus roule dans la circulation générale,
        dans une ville où l'ETUSA attribue elle-même ses retards aux
        embouteillages. Choix prudent : mieux vaut annoncer un trajet un peu
        long qu'une correspondance impossible ;
      * voies rapides (highway=motorway/trunk et bretelles) : 35 km/h,
        embouteillages compris ; sans cela, la navette de l'aéroport (100) ou
        les lignes de Sidi Abdellah (731, 732), surtout sur autoroute,
        auraient été annoncées deux fois plus longues qu'en réalité.
    L'ancien générateur comptait 17 km/h À VOL D'OISEAU, soit jusqu'à 34 km/h
    (et 190 km/h sur certains tronçons) le long des rues réelles.
    Quand le tracé est écarté (pas assez sûr pour être dessiné), les temps
    viennent quand même du meilleur chemin trouvé ; sans aucun chemin, de la
    distance à vol d'oiseau × NO_SHAPE_DETOUR à la vitesse des rues.
  - Fréquences : celles de la référence (gabarit de l'ancien générateur :
    20/40 min, 40/60 min pour les 6xx/7xx, 60 min pour 100/178, 10 min pour
    la 12). AUCUNE source ETUSA ne les étaye : l'app doit les présenter comme
    des fréquences estimées, pas « officielles ».
  - Amplitude : « HH:MM–HH:MM (source 2024) » de route_desc = premier et
    dernier départ, appliqués à chaque terminus d'origine. Le dernier départ
    officiel est TOUJOURS un départ généré (constats K51/K73 : l'app ne
    peut plus annoncer « en service » quand le calculateur n'a plus de bus).
  - Phase des départs : aucun horaire n'est publié. Les fréquences sont
    développées en départs explicites (premier départ à l'ouverture, puis
    tous les intervalles), comme pour le rail. Avec un seul trip par sens et
    exact_times=0, OTP 2.5 proposait des départs 20 à 37 min après l'heure
    demandée puis espacés de la durée du trajet (constat K42) ; exact_times=1
    ne corrige pas ce défaut. Les heures de départ qui en résultent sont des
    conventions : l'app les préfixe de « ~ » et affiche l'intervalle.
"""
from __future__ import annotations

import argparse
import collections
import csv
import heapq
import io
import json
import math
import os
import pickle
import re
import subprocess
import sys
import unicodedata

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
GTFS = os.path.join(ROOT, 'data', 'gtfs')
PBF_DEFAULT = os.path.join(ROOT, 'data', 'algeria-260228.osm.pbf')
REFERENCE = os.path.join(ROOT, 'data', 'bus-reference.json')
REPORT_OUT = os.path.join(ROOT, 'data', 'bus-report.json')

SERVICE_ID = 'all-week'
BUS_SPEED_KMH = 15.0           # rues (voir l'en-tête)
BUS_SPEED_FAST_KMH = 35.0      # voies rapides : highway=motorway/trunk d'OSM
FAST_HIGHWAYS = {'motorway', 'motorway_link', 'trunk', 'trunk_link'}
NO_SHAPE_DETOUR = 1.3          # aucun chemin : vol d'oiseau × 1,3 (signalé)
BBOX = (36.55, 2.75, 36.90, 3.45)  # sud, ouest, nord, est (voirie chargée)

# Routage
DENSIFY_M = 20.0        # points intermédiaires sur les ways de la relation
BRIDGE_M = 30.0         # raccord entre deux ways de la relation non reliés
SNAP_M = 40.0           # arrêt (quai) → voie
SNAP_FAR_M = 150.0      # terminus dans une gare routière (Ben Aknoun)
PENALTY_ROAD = 4.0      # voirie hors relation : coût × 4 (dernier recours)
DEDUCED_MIN_M = 150.0   # au-delà, le tracé est annoncé « déduit »
DETOUR_RATIO = 2.5      # chemin / vol d'oiseau entre deux arrêts…
DETOUR_MIN_M = 800.0    # … au-delà de cette longueur : détour suspect

ROAD_TYPES = {
    'motorway', 'motorway_link', 'trunk', 'trunk_link', 'primary', 'primary_link', 'secondary',
    'secondary_link', 'tertiary', 'tertiary_link', 'unclassified', 'residential', 'living_street',
    'service', 'road', 'busway', 'bus_guideway',
}

# ── Corrections de la référence (chacune justifiée) ──────────────────────────
# Lignes écartées (« une ligne au tracé douteux est écartée plutôt
# qu'approximée »).
EXCLUDED_LINES = {
    # Relation 2847141 « تافورة - وادي قريش » : PTv1 qui mélange les deux sens
    # (El Kettar → Tunnel des Facultés → El Kettar dans un même trajet), arrêts
    # en double (Barreaux Rouges ×2 + « Baro Roudj »), terminus Tafourah sans
    # nom, jamais Grande Poste ni Oued Koriche. Retour possible quand OSM aura
    # deux relations PTv2 propres (constats K45, K60).
    'ETUSA-37': 'relation OSM 2847141 incohérente (PTv1, sens mélangés, terminus sans nom)',
}

# Séquences d'arrêts corrigées (trip_id → liste complète).
STOP_SEQUENCE_FIXES = {
    # Relation 7608188 « ساحة الشهداء -> المطار » : ses 2 arrêts sont listés
    # dans l'ordre inverse de ses propres ways (ville → aéroport). Le sens
    # « vers l'aéroport » partait donc de l'aéroport (constats K21/K26/K43).
    'ETUSA-100-dir0': ['B3429799436', 'B5130875391'],
}

# Déplacements d'un arrêt : (trip_id, stop_id, placé juste après stop_id).
STOP_MOVES = [
    # Relation 7980628 : le stop_position 5387204319 « LOTISSEMENT MICHEL » est
    # entre les deux « STATION HAI EL BADR » ; seul son quai (4880009222) était
    # rangé en fin de relation, après le terminus (constats K43/K61).
    ('ETUSA-66-dir1', 'B4880009222', 'B5387257359'),
]

# Arrêts ajoutés (trip_id → [(stop_id, nœud OSM, nom), position]) : uniquement
# des membres « stop » de la relation du sens, perdus par l'ancien générateur.
STOP_ADDITIONS = {
    # Relation 7982528 : terminus « GARE ROUTIERE DE BARAKI » (stop_exit_only,
    # nœud 5422040731, sans quai) perdu ; la girouette l'annonce et la ligne y
    # va (constat K61) : sans lui, 1,7 km de marche depuis « Foyer ».
    'ETUSA-105-dir0': [('B5422040731', 5422040731, 'Gare Routière de Baraki', 'end')],
    # Terminus perdus (constat R46) : membres stop_entry_only / stop_exit_only
    # des relations, SUR les ways de la relation (0 m), sans quai. Sans eux,
    # la 12 « vers Staouéli » finissait 3,4 km avant Staouéli, et 643/701
    # partaient ou finissaient 0,7 à 0,95 km avant leur gare routière.
    # Relation 2881745 (to=سطاوالي) : stop_exit_only « Staouali », nœud
    # 5375889198, déjà premier arrêt du sens retour (12-dir1).
    'ETUSA-12-dir0': [('B5375889198', 5375889198, 'Staouéli', 'end')],
    # Relations 8186188 / 8186196 : stop_entry_only / stop_exit_only « GARE
    # ROUTIERE DE BARAKI » (même nœud que la 105).
    'ETUSA-643-dir0': [('B5422040731', 5422040731, 'Gare Routière de Baraki', 'start')],
    'ETUSA-643-dir1': [('B5422040731', 5422040731, 'Gare Routière de Baraki', 'end')],
    # Relations 8001650 / 8001677 : stop_entry_only / stop_exit_only « Gare
    # Routière de Zéralda », nœud 5398740349.
    'ETUSA-701-dir0': [('B5398740349', 5398740349, 'Gare Routière de Zéralda', 'start')],
    'ETUSA-701-dir1': [('B5398740349', 5398740349, 'Gare Routière de Zéralda', 'end')],
    # Écartées VOLONTAIREMENT : 731 et 732 (« SIDI ABD ALLAH », nœud
    # 5397813391, stop_entry_only / stop_exit_only). Le nœud est à ~283 m des
    # ways de la relation : l'ajouter ferait tracer un bout de chemin non
    # relevé. Le premier / dernier arrêt reste « Cité AADL Sidi Abdallah »
    # (~0,5 km) ; validate_gtfs.py les tolère (TERMINUS_ECART_ACCEPTE).
}

# Sens dont le premier / dernier arrêt est à plus de 150 m du membre
# stop_entry_only / stop_exit_only de leur relation, ACCEPTÉS (voir
# ci-dessus) : validate_gtfs.py n'en fait pas un avertissement.
TERMINUS_ECART_ACCEPTE = {
    'ETUSA-731-dir0': 'SIDI ABD ALLAH (n5397813391) à ~283 m des ways : départ à Cité AADL Sidi Abdallah, ~0,5 km',
    'ETUSA-731-dir1': 'SIDI ABD ALLAH (n5397813391) à ~283 m des ways : terminus à Cité AADL Sidi Abdallah, ~0,5 km',
    'ETUSA-732-dir0': 'SIDI ABD ALLAH (n5397813391) à ~283 m des ways : départ à Cité AADL Sidi Abdallah, ~0,5 km',
    'ETUSA-732-dir1': 'SIDI ABD ALLAH (n5397813391) à ~283 m des ways : terminus à Cité AADL Sidi Abdallah, ~0,5 km',
}

# Sens dont la girouette (tag « to » de la relation : ce qu'affiche le bus)
# nomme un terminus que le tracé relevé n'atteint pas (constat R16). La
# girouette n'est PAS modifiée (le bus l'affiche, elle sert de clé) ; aucun
# arrêt n'est inventé : la relation OSM s'arrête avant, sans nœud au terminus
# nommé. L'app dit « Tracé relevé jusqu'à … » sur un tronçon qui y descend ;
# validate_gtfs.py ne signale que les NOUVEAUX écarts. Non listés : 19-dir0
# (« Les Hotels » est le stop_exit_only de la relation, à Bab Ezzouar) et
# 15-dir0 (Tunnel des Facultés, à moins de 300 m de Tafourah - Grande Poste).
TERMINUS_NON_RELEVE = {
    'ETUSA-100-dir1': 'dernier arrêt relevé : Hôtel Es-Safir, ~0,94 km de Place des Martyrs (relation sans autre membre)',
    'ETUSA-6-dir0': 'dernier arrêt relevé : Port Saïd, ~0,54 km de Place des Martyrs (dernier membre de la relation)',
    'ETUSA-72-dir1': 'dernier arrêt relevé : Port Saïd, ~0,54 km de Place des Martyrs (dernier membre de la relation)',
    'ETUSA-74-dir1': 'dernier arrêt relevé : Port Saïd, ~0,54 km de Place des Martyrs (dernier membre de la relation)',
    'ETUSA-113-dir0': 'dernier arrêt relevé : Port Saïd, ~0,54 km de Place des Martyrs (dernier membre de la relation)',
}

# Arrêts retirés d'un sens : (trip_id, stop_id).
STOP_REMOVALS = [
    # « Chevalley » (quai B960842059) à 6 m et 1 s de « Station de Bus
    # Chevalley » (B1468894839) : le même arrêt compté deux fois (constat K66).
    ('ETUSA-731-dir1', 'B960842059'),
]

# Girouettes : français (trip_headsign, ce que lisent OTP et le front) et
# arabe (translations.txt). Les girouettes d'origine en arabe seul ou
# malformées (« 1er Mai => Bouzareah ») sont remplacées par le terminus de la
# relation OSM (tags from/to). L'arabe vient d'OSM : tags from/to de la
# relation, name:ar du nœud terminus, ou name:ar du lieu (place=town/suburb/
# quarter, gare routière) de l'extrait du 28/02/2026 ; « 1er Mai », « Grande
# Poste », « Bachdjarah », « Aïn Naâdja », « El Harrach » reprennent les noms
# arabes relus des stations de métro (build_rail.py). Sans source, pas de
# traduction : l'app affiche le français.
HEADSIGNS = {
    'ETUSA-3-dir0': ('Souidania', 'السويدانية'),
    'ETUSA-3-dir1': ('Chevalley', 'شوفالي'),
    'ETUSA-6-dir0': ('Place des Martyrs', 'ساحة الشهداء'),
    'ETUSA-6-dir1': ('Vieux Kouba', 'القبة القديمة'),
    'ETUSA-10-dir0': ('Bouzaréah', 'بوزريعة'),
    'ETUSA-10-dir1': ('1er Mai', 'أول ماي'),
    'ETUSA-12-dir0': ('Staouéli', 'سطاوالي'),
    'ETUSA-12-dir1': ('Place des Martyrs', 'ساحة الشهداء'),
    'ETUSA-14-dir0': ('Bir Mourad Raïs', 'بئر مراد رايس'),
    'ETUSA-14-dir1': ('1er Mai', 'أول ماي'),
    'ETUSA-15-dir0': ('Grande Poste', 'البريد المركزي'),
    'ETUSA-15-dir1': ('1er Mai', 'أول ماي'),
    'ETUSA-16-dir0': ('1er Mai', 'أول ماي'),
    'ETUSA-16-dir1': ('El Madania', 'المدنية'),
    'ETUSA-18-dir0': ('Hôpital Militaire', 'المستشفى العسكري'),
    'ETUSA-19-dir0': ('Bab Ezzouar', 'باب الزوار'),
    'ETUSA-19-dir1': ('Place Aïssat Idir', 'ساحة عيسات إيدير'),
    'ETUSA-21-dir0': ('Sidi Youcef', 'سيدي يوسف'),
    'ETUSA-21-dir1': ('Bouzaréah', 'بوزريعة'),
    'ETUSA-27-dir0': ('Palais de la Culture (Diar El Afia)', None),
    'ETUSA-27-dir1': ('1er Mai', 'أول ماي'),
    'ETUSA-31-dir0': ('Place Audin', 'ساحة موريس أودان'),
    'ETUSA-31-dir1': ('Hydra', 'حيدرة'),
    'ETUSA-34-dir0': ('Birkhadem', 'بئر خادم'),
    'ETUSA-34-dir1': ('1er Mai', 'أول ماي'),
    'ETUSA-45-dir0': ('Place des Martyrs', 'ساحة الشهداء'),
    'ETUSA-45-dir1': ('Bouzaréah', 'بوزريعة'),
    'ETUSA-50-dir0': ('Ben Aknoun', 'بن عكنون'),
    'ETUSA-50-dir1': ('Place des Martyrs', 'ساحة الشهداء'),
    'ETUSA-54-dir0': ('Place Audin', 'ساحة موريس أودان'),
    'ETUSA-54-dir1': ('El Mouradia', 'المرادية'),
    'ETUSA-58-dir0': ('Chevalley', 'شوفالي'),
    'ETUSA-58-dir1': ('Place des Martyrs', 'ساحة الشهداء'),
    'ETUSA-66-dir0': ('Aïssat Idir', 'عيسات إيدير'),
    'ETUSA-66-dir1': ('Bachdjarah', 'باش جراح'),
    'ETUSA-72-dir0': ('Rouiba', 'الرويبة'),
    'ETUSA-72-dir1': ('Place des Martyrs', 'ساحة الشهداء'),
    'ETUSA-74-dir0': ('Bachdjarah', 'باش جراح'),
    'ETUSA-74-dir1': ('Place des Martyrs', 'ساحة الشهداء'),
    'ETUSA-82-dir0': ('Aïn Naâdja', 'عين النعجة'),
    'ETUSA-82-dir1': ('Bachdjarah', 'باش جراح'),
    'ETUSA-88-dir0': ('1er Mai', 'أول ماي'),
    'ETUSA-88-dir1': ('Hydra', 'حيدرة'),
    'ETUSA-90-dir0': ('Bab El Oued (Ali Basta)', None),
    'ETUSA-90-dir1': ('1er Mai', 'أول ماي'),
    'ETUSA-98-dir0': ('Place Ferhani', None),
    'ETUSA-98-dir1': ('Cité 5 Juillet', None),
    'ETUSA-99-dir0': ('Aïn Benian', 'عين البنيان'),
    'ETUSA-100-dir0': ("Aéroport d'Alger", 'المطار'),
    'ETUSA-100-dir1': ('Place des Martyrs', 'ساحة الشهداء'),
    'ETUSA-101-dir0': ('Birtouta', 'بئر توتة'),
    'ETUSA-105-dir0': ('Gare Routière de Baraki', 'محطة النقل البري براقي'),
    'ETUSA-113-dir0': ('Place des Martyrs', 'ساحة الشهداء'),
    # Relation 8086569 : to=« Gare Routiere », sans nom au terminus ; le sens
    # retour (8086568) part de « Gare Routière du Caroubier » (stop_entry_only
    # 5387463214, à ~0,3 km). « Gare Routière » seul était ambigu (Baraki,
    # Bachdjerrah, Zéralda, Aïn Benian…). Pas d'arabe sourcé.
    'ETUSA-113-dir1': ('Gare Routière du Caroubier', None),
    'ETUSA-178-dir0': ("Aéroport d'Alger", 'المطار'),
    'ETUSA-604-dir0': ('El Kerrouche Reghaïa', None),
    'ETUSA-606-dir0': ('Aïn Taya', 'عين طاية'),
    'ETUSA-643-dir0': ('El Harrach', 'الحراش'),
    # Relation 8186196 sans tag « to » : la girouette était le nom du dernier
    # arrêt relevé. Le terminus (stop_exit_only, STOP_ADDITIONS) est désormais
    # la gare routière de Baraki (« Baraki » du tag from du sens aller) ;
    # arabe identique à celui de la 105, même lieu.
    'ETUSA-643-dir1': ('Gare Routière de Baraki', 'محطة النقل البري براقي'),
    'ETUSA-701-dir0': ('Chevalley', 'شوفالي'),
    'ETUSA-701-dir1': ('Zéralda', None),
    'ETUSA-707-dir0': ('Aïn Benian', 'عين البنيان'),
    'ETUSA-731-dir0': ('Chevalley', 'شوفالي'),
    'ETUSA-731-dir1': ('Sidi Abdellah', 'سيدي عبد الله'),
    'ETUSA-732-dir0': ('Station 2 Mai', 'محطة 2 مايو'),
    'ETUSA-732-dir1': ('Sidi Abdellah', 'سيدي عبد الله'),
}

# Noms d'arrêts : corrections d'après les tags du même nœud OSM (name,
# name:fr). Sigles rendus tels qu'OSM les écrit (l'ancien générateur
# mettait tout en « Title Case » : « Sntp », « Itfc »).
STOP_NAME_FIXES = {
    'B1669297522': 'ITFC',
    'B3033268912': 'SNTP',
    'B3093959442': 'SNTP',
    'B3042180460': 'CNR',
    'B3111110407': 'CNR',
    'B5390507849': 'Bouchaoui CNR',
    'B5390579067': 'Bouchaoui CNR',
    'B3784295302': 'Bir Mourad Raïs - CNAS',
    'B3784295304': 'Bir Mourad Raïs - CNAS',
    'B5387523814': 'AOTU.A',
    'B3321711393': 'DG Protection Civile',
    'B5294612035': 'TVC (ISFF)',
    'B5459784854': 'TVC (ISFF)',
    'B5394374640': 'CEM Abdelhamid Ben Badis',
    'B5398740340': 'CEM Les Frères Boudouara',
    'B5398805096': 'CEM Les Frères Boudouara',
    'B5448314674': 'Cité DNC',
    'B5397813390': 'Cité AADL Sidi Abdallah',
    'B5397854228': 'Cité AADL Sidi Abdallah',
    'B3123720671': 'Remilla B.E.O',              # name:fr
    'B5387523816': 'Aïn Naâdja',                 # name / name:fr
    'B5393884871': 'Place El Qods',              # name / name:fr
    'B5394260865': 'Oued Kniss',                 # name / name:fr
    'B3791449222': 'Lycée Zineb Oum El Massakine',  # name / name:fr
    'B5460285375': 'Sacré-Cœur',                 # name:fr
    'B3156575567': 'Colonne Voirol',             # name (lieu-dit Colonne Voirol)
    'B5367765906': 'Colonne Voirol',
    'B5396439170': 'Bibliothèque',               # « Bibiothéque » : coquille
    # « Plateau, Bologhine » à Aïn Benian, à 9 km de Bologhine : OSM ne
    # donne que « Plateau » à ce nœud (constat K66).
    'B5448423937': 'Plateau',
    # OSM name « STATION 1 MAI », mais name:ar « محطة 2 مايو », relation 732
    # to=« Station 2 Mai », et le quai « Station 2 Mai » (B5387463211) de la
    # même gare est à côté : coquille du name OSM.
    'B5448089871': 'Station 2 Mai',
    # OSM name « MARCHER AIN NAADJA » (sans name:fr) : coquille de « marché »,
    # vue dans la recette de bout en bout du 05/11/2026 (consignes OTP).
    'B4314129592': 'Marché Aïn Naâdja',
    'B5388889199': 'Marché Aïn Naâdja',
    # Constat R47 (relus dans l'extrait OSM du 28/02/2026) :
    # name « Station 1 mai », mais name:ar « محطة 2 مايو », à 91 m du quai
    # « Station 2 Mai » (B5387463211) et stop_position de la relation 8086283
    # « Station 2 Mai محطة 2 ماي » : coquille, comme B5448089871.
    'B5387397605': 'Station 2 Mai',
    # name:fr « Raïs Hamidou 2 », mais name et name:ar « الرئيس حميدو 1 », et
    # stop_position voisin « RAÏS HAMIDOU -1- » : la 12 et la 99 affichaient
    # deux « Raïs Hamidou 2 » consécutifs à 423 m.
    'B4237361609': 'Raïs Hamidou 1',
    # Même place que B5393884871 « Place El Qods » (même name:ar ساحة القدس).
    'B991957515': 'Place El Qods',
    # Coquilles d'OSM (name seul, pas de name:fr).
    'B3130910490': 'Carrefour Souidani Boudjemaa',
    'B3300695711': 'Carrefour Souidani Boudjemaa',
    'B2398209884': 'Résidence',
    # « Cite Mer Soleil », à 6 m de la station de métro M09 « Cité Mer et Soleil ».
    'B5387257361': 'Cité Mer et Soleil',
    # « Staouali » : graphie de la commune alignée sur la girouette et le nom
    # de ligne (« Staouéli », HEADSIGNS / LONG_NAME_FIXES).
    'B5375889198': 'Staouéli',
    # « Gare routière Bachdjerrah 2 -ETUSA- » : tiret orphelin.
    'B2274503073': 'Gare Routière de Bachdjerrah 2 (ETUSA)',
    'B5387463220': 'Gare Routière de Bachdjerrah 2 (ETUSA)',
}

# Noms arabes corrigés (translations.txt), quand le name:ar d'OSM est faux.
STOP_NAME_AR_FIXES = {
    # name:ar « باب الزوار » (la commune) pour l'arrêt « Cité 5 juillet » :
    # nom arabe de la station de tram voisine du même nom (T15, name:ar OSM
    # relu, build_rail.py).
    'B2355935987': 'حي 5 جويلية',
}

# Fusion de graphies pour les terminus « 1e Mai » / « Bach Djarah » : faite
# dans HEADSIGNS ci-dessus (une seule graphie : « 1er Mai », « Bachdjarah »).


def log(*a):
    print(*a, file=sys.stderr)


# ── Géométrie ────────────────────────────────────────────────────────────────
def hav(a, b):
    r = 6371008.8
    la1, lo1, la2, lo2 = map(math.radians, (a[0], a[1], b[0], b[1]))
    h = math.sin((la2 - la1) / 2) ** 2 + math.cos(la1) * math.cos(la2) * math.sin((lo2 - lo1) / 2) ** 2
    return 2 * r * math.asin(math.sqrt(h))


def simplify(line, tol_m, keep=()):
    """Douglas-Peucker en mètres ; les indices de `keep` sont conservés."""
    if len(line) < 3:
        return list(range(len(line)))
    lat0 = math.radians(line[0][0])
    kx, ky = 111320.0 * math.cos(lat0), 110574.0
    xy = [(p[1] * kx, p[0] * ky) for p in line]
    flag = [False] * len(line)
    flag[0] = flag[-1] = True
    for k in keep:
        flag[k] = True
    anchors = [i for i, f in enumerate(flag) if f]
    stack = list(zip(anchors, anchors[1:]))
    while stack:
        a, b = stack.pop()
        if b - a < 2:
            continue
        ax, ay = xy[a]
        bx, by = xy[b]
        dx, dy = bx - ax, by - ay
        l2 = dx * dx + dy * dy
        best, bi = -1.0, -1
        for i in range(a + 1, b):
            px, py = xy[i]
            if l2 == 0:
                d = math.hypot(px - ax, py - ay)
            else:
                t = max(0.0, min(1.0, ((px - ax) * dx + (py - ay) * dy) / l2))
                d = math.hypot(px - ax - t * dx, py - ay - t * dy)
            if d > best:
                best, bi = d, i
        if best > tol_m:
            flag[bi] = True
            stack += [(a, bi), (bi, b)]
    return [i for i, f in enumerate(flag) if f]


# ── Lecture OSM ──────────────────────────────────────────────────────────────
def in_bbox(lat, lon):
    s, w, n, e = BBOX
    return s <= lat <= n and w <= lon <= e


def extract(pbf: str, rel_ids: set, extra_nodes: set) -> dict:
    import osmium  # pip install osmium
    from osmium.filter import IdFilter, KeyFilter

    rels = {}
    for r in osmium.FileProcessor(pbf, osmium.osm.RELATION).with_filter(IdFilter(rel_ids)):
        rels[r.id] = {'tags': dict(r.tags), 'members': [(m.type, m.ref, m.role) for m in r.members]}
    missing = rel_ids - set(rels)
    if missing:
        sys.exit(f'Relations absentes de {pbf} : {sorted(missing)}')
    rel_ways = {ref for r in rels.values() for t, ref, _ in r['members'] if t == 'w'}
    need_nodes = set(extra_nodes) | {ref for r in rels.values() for t, ref, _ in r['members'] if t == 'n'}

    # Voirie du Grand Alger (et ways des relations), avec coordonnées.
    ways, coords = {}, {}
    fp = osmium.FileProcessor(pbf).with_locations().with_filter(KeyFilter('highway'))
    for o in fp:
        if not o.is_way():
            continue
        hw = o.tags.get('highway')
        if o.id not in rel_ways and hw not in ROAD_TYPES:
            continue
        locs = [(n.ref, n.location.lat, n.location.lon) for n in o.nodes if n.location.valid()]
        if not locs:
            continue
        if o.id not in rel_ways and not in_bbox(locs[0][1], locs[0][2]):
            continue
        for ref, la, lo in locs:
            coords[ref] = (la, lo)
        ways[o.id] = {'nodes': [ref for ref, _, _ in locs], 'tags': dict(o.tags), 'rel': o.id in rel_ways}
    lost = rel_ways - set(ways)
    if lost:
        log(f'  {len(lost)} ways de relation sans tag highway ou absents (ignorés)')
    nodes = {}
    for n in osmium.FileProcessor(pbf, osmium.osm.NODE).with_filter(IdFilter(need_nodes)):
        nodes[n.id] = {'lat': n.location.lat, 'lon': n.location.lon, 'tags': dict(n.tags)}
    return {'rels': rels, 'ways': ways, 'coords': coords, 'nodes': nodes}


def load_osm(pbf: str, cache: str | None, rel_ids: set, extra_nodes: set) -> dict:
    if cache and os.path.exists(cache):
        with open(cache, 'rb') as f:
            osm = pickle.load(f)
        if rel_ids <= set(osm['rels']) and extra_nodes <= set(osm['nodes']):
            return osm
        log('  cache incomplet : relecture du PBF')
    osm = extract(pbf, rel_ids, extra_nodes)
    if cache:
        with open(cache, 'wb') as f:
            pickle.dump(osm, f)
    return osm


# ── Graphe routier ───────────────────────────────────────────────────────────
def bus_directions(tags: dict, role: str = ''):
    """(sens du way, sens inverse) autorisés à un bus."""
    if tags.get('oneway:bus') == 'no' or tags.get('oneway:psv') == 'no' or tags.get('busway') == 'opposite_lane':
        return True, True
    ow = tags.get('oneway')
    if ow in ('yes', 'true', '1'):
        f, b = True, False
    elif ow in ('-1', 'reverse'):
        f, b = False, True
    elif ow == 'no':
        f, b = True, True
    elif tags.get('junction') in ('roundabout', 'circular') or tags.get('highway') == 'motorway':
        f, b = True, False
    else:
        f, b = True, True
    if role == 'forward':
        b = False
    elif role == 'backward':
        f = False
    return f, b


def bus_allowed(tags: dict) -> bool:
    if tags.get('bus') in ('yes', 'designated') or tags.get('psv') in ('yes', 'designated'):
        return True
    if tags.get('access') in ('no', 'private') or tags.get('motor_vehicle') in ('no', 'private'):
        return False
    if tags.get('highway') == 'service' and tags.get('service') in ('parking_aisle', 'driveway', 'drive-through'):
        return False
    return tags.get('area') != 'yes'


class RoadNet:
    """Voirie générale (dirigée), pour combler les trous d'une relation."""

    def __init__(self, osm):
        self.co = osm['coords']
        self.adj = collections.defaultdict(list)
        self.uadj = collections.defaultdict(list)   # sens uniques ignorés
        self.fast = set()                           # arêtes de voie rapide
        for w in osm['ways'].values():
            if not bus_allowed(w['tags']) or w['tags'].get('highway') not in ROAD_TYPES:
                continue
            f, b = bus_directions(w['tags'])
            ids = w['nodes']
            fast = w['tags'].get('highway') in FAST_HIGHWAYS
            for x, y in zip(ids, ids[1:]):
                if fast:
                    self.fast.update(((x, y), (y, x)))
                d = hav(self.co[x], self.co[y])
                if f:
                    self.adj[x].append((y, d))
                if b:
                    self.adj[y].append((x, d))
                self.uadj[x].append((y, d))
                self.uadj[y].append((x, d))


class RelationGraph:
    """Ways d'une relation de ligne, densifiés (accroche précise des arrêts)."""

    def __init__(self, osm, rel_id, roads: RoadNet):
        rel = osm['rels'][rel_id]
        self.roads = roads
        self.co = {}
        self.adj = collections.defaultdict(list)
        self.uadj = collections.defaultdict(list)
        self.node_way = {}
        self.bridges = set()
        self.fast = set()
        for ty, ref, role in rel['members']:
            if ty != 'w' or role.startswith('platform') or role.startswith('stop'):
                continue
            w = osm['ways'].get(ref)
            if not w:
                continue
            f, b = bus_directions(w['tags'], role)
            fast = w['tags'].get('highway') in FAST_HIGHWAYS
            prev = None
            for k, nid in enumerate(w['nodes']):
                self.co.setdefault(nid, osm['coords'][nid])
                self.node_way.setdefault(nid, ref)
                if prev is not None:
                    a, c = self.co[prev], self.co[nid]
                    n = max(1, int(math.ceil(hav(a, c) / DENSIFY_M)))
                    chain = [prev]
                    for j in range(1, n):
                        vk = ('v', ref, k, j)
                        t = j / n
                        self.co[vk] = (a[0] + t * (c[0] - a[0]), a[1] + t * (c[1] - a[1]))
                        self.node_way[vk] = ref
                        chain.append(vk)
                    chain.append(nid)
                    for x, y in zip(chain, chain[1:]):
                        d = hav(self.co[x], self.co[y])
                        if fast:
                            self.fast.update(((x, y), (y, x)))
                        if f:
                            self.adj[x].append((y, d))
                        if b:
                            self.adj[y].append((x, d))
                        self.uadj[x].append((y, d))
                        self.uadj[y].append((x, d))
                prev = nid
        self.grid = collections.defaultdict(list)
        for k, (la, lo) in self.co.items():
            self.grid[(int(la / 0.0005), int(lo / 0.0005))].append(k)
        # Raccords courts (≤ BRIDGE_M) entre une extrémité de way libre et un
        # autre way de la relation : nœuds non partagés d'un carrefour.
        deg = collections.Counter({x: len(v) for x, v in self.uadj.items()})
        for x in list(self.co):
            if isinstance(x, tuple) or deg[x] > 1:
                continue
            best = None
            for y in self.near(self.co[x], BRIDGE_M):
                if y != x and self.node_way.get(y) != self.node_way.get(x):
                    d = hav(self.co[x], self.co[y])
                    if best is None or d < best[0]:
                        best = (d, y)
            if best:
                d, y = best
                for g in (self.adj, self.uadj):
                    g[x].append((y, d))
                    g[y].append((x, d))
                self.bridges.add((x, y))
                self.bridges.add((y, x))

    def near(self, p, r):
        ci, cj = int(p[0] / 0.0005), int(p[1] / 0.0005)
        span = int(r / 50) + 1
        return [k for i in range(ci - span, ci + span + 1) for j in range(cj - span, cj + span + 1)
                for k in self.grid.get((i, j), ()) if hav(p, self.co[k]) <= r]

    def candidates(self, p):
        cand, far = self.near(p, SNAP_M), False
        if not cand:
            cand, far = self.near(p, SNAP_FAR_M), True
        by_way = {}
        for k in cand:
            d = hav(p, self.co[k])
            w = self.node_way[k]
            if w not in by_way or d < by_way[w][0]:
                by_way[w] = (d, k)
        out = sorted(by_way.values(), key=lambda v: v[0])[:6]
        return (out[:1] if far else out), far

    def edges(self, x, mode):
        """mode 'rel' : relation seule ; 'road' : + voirie (sens uniques
        respectés) ; 'road_any' : + voirie, sens uniques ignorés (dernier
        recours, signalé)."""
        for y, d in self.adj.get(x, ()):
            yield y, d, d, 'rel'
        if mode != 'rel' and not isinstance(x, tuple):
            adj = self.roads.adj if mode == 'road' else self.roads.uadj
            for y, d in adj.get(x, ()):
                yield y, d * PENALTY_ROAD, d, mode

    def coord(self, k):
        return self.co[k] if k in self.co else self.roads.co[k]

    def dijkstra(self, src, targets, limit, mode):
        dist = {src: 0.0}
        prev = {}
        pq = [(0.0, src)]
        left = set(targets)
        while pq and left:
            d, x = heapq.heappop(pq)
            if d > dist.get(x, 1e18):
                continue
            if d > limit:
                break
            left.discard(x)
            for y, cost, length, kind in self.edges(x, mode):
                nd = d + cost
                if nd < dist.get(y, 1e18):
                    dist[y] = nd
                    prev[y] = (x, length, kind)
                    heapq.heappush(pq, (nd, y))
        return dist, prev


def route_direction(osm, rel_id, pts, roads):
    """Tracé arrêt par arrêt (Viterbi sur les accroches candidates).
    Renvoie (résultat | None, anomalies)."""
    g = RelationGraph(osm, rel_id, roads)
    issues = []
    cands = []
    for i, p in enumerate(pts):
        c, far = g.candidates(p)
        if not c:
            return None, [f'arrêt {i + 1} à plus de {SNAP_FAR_M:.0f} m des voies de la relation']
        if far:
            issues.append(f'arrêt {i + 1} à {c[0][0]:.0f} m de la voie')
        cands.append(c)
    best = [{k: (2 * d, None, None) for d, k in cands[0]}]
    for i in range(len(pts) - 1):
        crow = hav(pts[i], pts[i + 1])
        targets = [k for _, k in cands[i + 1]]
        nxt, fallback = {}, {}
        for mode in ('rel', 'road', 'road_any'):
            nxt = {}
            limit = max(6000.0, 4 * crow + 3000) * (1 if mode == 'rel' else PENALTY_ROAD)
            for k, (cost, _, _) in best[i].items():
                dist, prev = g.dijkstra(k, targets, limit, mode)
                for d2, t in cands[i + 1]:
                    if t in dist:
                        c = cost + dist[t] + 2 * d2
                        if t not in nxt or c < nxt[t][0]:
                            nxt[t] = (c, k, prev)
            if not nxt or mode == 'rel':
                if nxt:
                    break
                continue
            # Trou de la relation comblé par la voirie : si cela impose un
            # détour (boucle due à un sens unique mal décrit ?), on tente la
            # voirie sans sens unique ; le détour éventuel reste rejeté par
            # les contrôles ci-dessous.
            t = min(nxt, key=lambda k: nxt[k][0])
            src, prev = nxt[t][1], nxt[t][2]
            length, x = 0.0, t
            while x != src:
                x, ln, _ = prev[x]
                length += ln
            if mode == 'road' and length > DETOUR_MIN_M and length > DETOUR_RATIO * crow:
                fallback = nxt
                continue
            break
        nxt = nxt or fallback
        if not nxt:
            return None, issues + [f'aucun chemin entre les arrêts {i + 1} et {i + 2} ({crow:.0f} m)']
        best.append(nxt)
    end = min(best[-1], key=lambda k: best[-1][k][0])
    stop_node = [None] * len(pts)
    segs = []
    cur = end
    for i in range(len(pts) - 1, 0, -1):
        stop_node[i] = cur
        _, src, prev = best[i][cur]
        seg = []
        x = cur
        while x != src:
            px, length, kind = prev[x]
            seg.append((x, length, 'bridge' if (px, x) in g.bridges else kind,
                        (px, x) in g.fast or (px, x) in roads.fast))
            x = px
        segs.append(list(reversed(seg)))
        cur = src
    stop_node[0] = cur
    segs.reverse()
    path = [cur]
    kinds = []
    lengths = []
    fasts = []
    stop_at = [0]
    for seg in segs:
        for x, length, kind, fast in seg:
            path.append(x)
            kinds.append(kind)
            lengths.append(length)
            fasts.append(fast)
        stop_at.append(len(path) - 1)
    coords = [g.coord(k) for k in path]
    acc = [0.0]
    for ln in lengths:
        acc.append(acc[-1] + ln)
    # Temps estimé (s) depuis le premier arrêt, voie par voie.
    tacc = [0.0]
    for ln, fast in zip(lengths, fasts):
        tacc.append(tacc[-1] + ln / ((BUS_SPEED_FAST_KMH if fast else BUS_SPEED_KMH) / 3.6))
    road_m = sum(ln for ln, k in zip(lengths, kinds) if k in ('road', 'road_any'))
    oneway_ignored_m = sum(ln for ln, k in zip(lengths, kinds) if k == 'road_any')
    bridge_m = sum(ln for ln, k in zip(lengths, kinds) if k == 'bridge')
    # Contrôles
    reject = []
    for i in range(len(pts) - 1):
        a, b = stop_at[i], stop_at[i + 1]
        seg_m = acc[b] - acc[a]
        crow = hav(pts[i], pts[i + 1])
        if seg_m > DETOUR_MIN_M and seg_m > DETOUR_RATIO * crow:
            seg_road = sum(lengths[j] for j in range(a, b) if kinds[j] in ('road', 'road_any'))
            msg = f'détour arrêts {i + 1}→{i + 2} : {seg_m:.0f} m pour {crow:.0f} m à vol d\'oiseau'
            if seg_road > DEDUCED_MIN_M:
                reject.append(msg + ' (sur voirie déduite)')
            else:
                issues.append(msg + ' (voies de la relation)')
    for j in range(1, len(path) - 1):
        if path[j - 1] == path[j + 1]:
            at_stop = min(hav(coords[j], p) for p in pts) <= 30.0
            # Demi-tour à un arrêt, sur les voies de la relation : entrée et
            # sortie d'une gare routière ou d'une impasse desservie (Chéraga).
            # Ailleurs, ou sur voirie déduite : tracé douteux.
            if at_stop and not {kinds[j - 1], kinds[j]} & {'road', 'road_any'}:
                issues.append(f'demi-tour à l\'arrêt (point {j}), voies de la relation')
            else:
                where = 'voirie déduite' if {kinds[j - 1], kinds[j]} & {'road', 'road_any'} else 'relation'
                reject.append(f'demi-tour sur {where} au point {j}')
    snaps = [hav(pts[i], coords[stop_at[i]]) for i in range(len(pts))]
    return {
        'coords': coords, 'acc': acc, 'stop_at': stop_at, 'snap': snaps,
        'stop_secs': [tacc[k] for k in stop_at],
        'fast_m': sum(ln for ln, fast in zip(lengths, fasts) if fast),
        'road_m': road_m, 'bridge_m': bridge_m, 'oneway_ignored_m': oneway_ignored_m, 'reject': reject,
    }, issues


# ── Référence corrigée ───────────────────────────────────────────────────────
def load_reference():
    with open(REFERENCE, encoding='utf-8') as f:
        ref = json.load(f)
    lines = []
    for line in ref['lines']:
        if line['route_id'] in EXCLUDED_LINES:
            continue
        for d in line['directions']:
            tid = d['trip_id']
            seq = list(STOP_SEQUENCE_FIXES.get(tid, d['stops']))
            for t, sid in STOP_REMOVALS:
                if t == tid:
                    seq.remove(sid)
            for t, sid, after in STOP_MOVES:
                if t == tid:
                    seq.remove(sid)
                    seq.insert(seq.index(after) + 1, sid)
            for sid, node, name, where in STOP_ADDITIONS.get(tid, []):
                ref['stops'].setdefault(sid, {'name': name, 'osm_node': node})
                seq = seq + [sid] if where == 'end' else [sid] + seq
            d['stops'] = seq
            d['headsign'], d['headsign_ar'] = HEADSIGNS[tid]
        lines.append(line)
    stops = {}
    for sid, s in ref['stops'].items():
        stops[sid] = {'name': STOP_NAME_FIXES.get(sid, s['name'])}
    return lines, stops


def osm_node_id(stop_id: str) -> int:
    if not re.fullmatch(r'B\d+', stop_id):
        sys.exit(f'Identifiant d\'arrêt inattendu : {stop_id}')
    return int(stop_id[1:])


ARABIC = re.compile('[؀-ۿ]')
LATIN = re.compile('[A-Za-zÀ-ÿ]')


def stop_name_ar(tags: dict) -> str | None:
    """name:ar du nœud s'il est en écriture arabe ; sinon la partie arabe d'un
    nom bilingue « Descartes ديكارت ». Jamais de traduction inventée."""
    v = (tags.get('name:ar') or '').strip()
    if v and ARABIC.search(v) and not LATIN.search(v):
        return v
    name = tags.get('name') or ''
    parts = [p.strip() for p in re.split(r';', name)]
    for p in parts:
        if ARABIC.search(p) and not LATIN.search(p):
            return p
    m = re.search(r'([؀-ۿ][؀-ۿ\s\d()\-]*)$', name)
    if m and LATIN.search(name[:m.start()]):
        return m.group(1).strip()
    return None


# Noms longs : coquilles de l'ancien générateur (accents, graphies des
# communes alignées sur les girouettes). Le « ↔ » reste : la ligne réelle
# fonctionne dans les deux sens, même quand un seul est relevé.
LONG_NAME_FIXES = {
    'ETUSA-12': 'Bus 12 Place des Martyrs ↔ Staouéli',
    'ETUSA-19': 'Bus 19 Place Aïssat Idir ↔ Bab Ezzouar',
    'ETUSA-21': 'Bus 21 Bouzaréah ↔ Sidi Youcef',
    'ETUSA-100': "Bus 100 Place des Martyrs ↔ Aéroport d'Alger",
    'ETUSA-101': 'Bus 101 Place des Martyrs ↔ Birtouta',
    'ETUSA-113': 'Bus 113 Gare routière ↔ Place des Martyrs',
    'ETUSA-178': "Bus 178 Gare routière ↔ Aéroport d'Alger",
    # Casse et accents seulement (mêmes lieux, mêmes extrémités) : le nom long
    # est affiché tel quel par l'app (lineDisplayName), « Place 1er mai ↔ EL
    # Madania » ou « Sidi Abd Allah » à côté de la girouette « Sidi Abdellah »
    # faisaient négligé. Graphies alignées sur les girouettes (HEADSIGNS).
    'ETUSA-6': 'Bus 6 Place des Martyrs ↔ Station Kouba/Place 1er Mai',
    'ETUSA-10': 'Bus 10 Place 1er Mai ↔ Bouzaréah Chevalley',
    'ETUSA-14': 'Bus 14 Place 1er Mai ↔ Station Kouba/Bir Mourad Raïs',
    'ETUSA-15': 'Bus 15 Place 1er Mai ↔ Grande Poste',
    'ETUSA-16': 'Bus 16 Place 1er Mai ↔ El Madania',
    'ETUSA-18': 'Bus 18 Bachdjarah ↔ Hôpital Militaire/H. Badr',
    'ETUSA-27': 'Bus 27 Place 1er Mai ↔ Station Kouba/El Afia et Garidi',
    'ETUSA-34': 'Bus 34 Place 1er Mai ↔ Birkhadem',
    'ETUSA-50': 'Bus 50 Ben Aknoun ↔ Place des Martyrs',
    'ETUSA-66': 'Bus 66 Bachdjarah ↔ Place Aïssat Idir',
    'ETUSA-72': 'Bus 72 Rouiba ↔ Place des Martyrs',
    'ETUSA-82': 'Bus 82 El Harrach ↔ Station Kouba/Aïn Naâdja',
    'ETUSA-88': 'Bus 88 Place 1er Mai ↔ Hydra',
    'ETUSA-90': 'Bus 90 Place 1er Mai ↔ Basta Ali',
    'ETUSA-99': 'Bus 99 Place 1er Mai ↔ Aïn Benian',
    'ETUSA-604': 'Bus 604 Dergana ↔ El Kerrouche/Reghaïa',
    'ETUSA-606': 'Bus 606 Dergana ↔ Aïn Taya/Bordj El Bahri',
    'ETUSA-643': 'Bus 643 Baraki ↔ El Harrach/Hôpital Zmirli',
    'ETUSA-701': 'Bus 701 Zéralda Gare routière ↔ Chevalley',
    'ETUSA-707': 'Bus 707 Chevalley ↔ Aïn Benian/Plateau',
    'ETUSA-731': 'Bus 731 Sidi Abdellah ↔ Chevalley',
    'ETUSA-732': 'Bus 732 Sidi Abdellah ↔ Station 2 Mai',
}
# Texte des pastilles : noir sur l'ambre des bus (6,6:1), le blanc d'origine
# n'atteignait que 3,2:1 (WCAG AA : 4,5:1). La couleur de ligne ne change pas.
BUS_TEXT_COLOR = '000000'
FARE_AGENCY = {'metro_flat': 'metro-alger', 'tram_flat': 'tram-alger'}
# fare_attributes.txt est une SOURCE (relue ici, seul agency_id est réécrit).
# metro_flat : transfers=1, transfer_duration=5400 — le changement de branche
# du M1 à quai (Haï El Badr) ne fait pas repayer (un ticket à 50 DA) ; jamais
# « illimité » (GTFS v1 ne distingue pas une sortie suivie d'une nouvelle
# entrée). tram_flat et tarifs ETUSA : transfers=0 (un ticket par montée).


# ── Horaires ────────────────────────────────────────────────────────────────
def secs(hhmm: str) -> int:
    h, m = hhmm.split(':')[:2]
    return int(h) * 3600 + int(m) * 60


def hms(t: int) -> str:
    return f'{t // 3600:02d}:{t % 3600 // 60:02d}:{t % 60:02d}'


def amplitude(desc: str):
    """« ETUSA — 30 DA, 06:00–19:20 (source 2024) » → (06:00, 19:20) en s ;
    un dernier départ après minuit passe au-delà de 24:00."""
    m = re.search(r'(\d{1,2}:\d{2})\s*[–-]\s*(\d{1,2}:\d{2})', desc)
    if not m:
        sys.exit(f'Amplitude introuvable dans « {desc} »')
    first, last = secs(m.group(1)), secs(m.group(2))
    if last <= first:
        last += 24 * 3600
    return first, last


def departures(windows, first, last):
    """Départs du terminus d'origine : premier à l'ouverture, puis tous les
    intervalles de la plage en cours ; le dernier départ officiel est
    toujours inclus. windows : [[début, fin exclue, intervalle s], …]."""
    win = [(secs(a), secs(b), h) for a, b, h in windows]
    if win[0][0] != first or win[-1][1] != last:
        sys.exit(f'Fréquences {windows} incohérentes avec l\'amplitude {hms(first)}–{hms(last)}')
    out, t = [], first
    while t < last:
        out.append(t)
        h = next(h for a, b, h in win if a <= t < b)
        t += h
    out.append(last)
    return out


# ── Construction ─────────────────────────────────────────────────────────────
def build(osm, lines, stops):
    roads = RoadNet(osm)
    report = {'speed_kmh': BUS_SPEED_KMH, 'speed_fast_kmh': BUS_SPEED_FAST_KMH, 'excluded_lines': EXCLUDED_LINES,
              'directions': []}
    for sid, s in stops.items():
        node = osm['nodes'].get(osm_node_id(sid))
        if node is None:
            sys.exit(f'Nœud OSM absent pour l\'arrêt {sid}')
        s['lat'], s['lon'] = node['lat'], node['lon']
        s['name_ar'] = STOP_NAME_AR_FIXES.get(sid) or stop_name_ar(node['tags'])
    v = BUS_SPEED_KMH / 3.6
    for line in lines:
        first, last = amplitude(line['desc'])
        line['first'], line['last'] = first, last
        for d in line['directions']:
            pts = [(stops[sid]['lat'], stops[sid]['lon']) for sid in d['stops']]
            res, issues = route_direction(osm, d['osm_relation'], pts, roads)
            entry = {'trip_id': d['trip_id'], 'osm_relation': d['osm_relation'], 'stops': len(pts)}
            entry.update(relation_termini(osm, d, stops))
            if res is None or res['reject']:
                reasons = issues if res is None else res['reject']
                entry.update(shape='absent', reasons=reasons)
                d['shape'] = None
                d['stop_dist'] = None
                if res is None:
                    secs_ = [0.0]
                    for a, b in zip(pts, pts[1:]):
                        secs_.append(secs_[-1] + hav(a, b) * NO_SHAPE_DETOUR / v)
                    entry['times'] = 'vol d\'oiseau'
                else:
                    secs_ = res['stop_secs']
                    entry['times'] = 'chemin écarté'
                log(f"  {d['trip_id']:16s} tracé ÉCARTÉ : {'; '.join(reasons)}")
            else:
                keep = simplify(res['coords'], 1.0, keep=res['stop_at'])
                pos = {k: i for i, k in enumerate(keep)}
                shape = [res['coords'][k] for k in keep]
                acc = [0.0]
                for a, b in zip(shape, shape[1:]):
                    acc.append(acc[-1] + hav(a, b))
                dist = [acc[pos[k]] for k in res['stop_at']]
                secs_ = res['stop_secs']
                deduced = res['road_m'] > DEDUCED_MIN_M
                d['shape'] = shape
                d['shape_acc'] = acc
                d['stop_dist'] = dist
                d['shape_id'] = f"{d['trip_id']}-{'deduit' if deduced else 'osm'}"
                entry.update(shape='deduit' if deduced else 'osm', length_m=round(acc[-1]),
                             outside_relation_m=round(res['road_m']), oneway_ignored_m=round(res['oneway_ignored_m']),
                             fast_road_m=round(res['fast_m']),
                             max_stop_snap_m=round(max(res['snap'])), notes=issues)
            # Cumul arrondi à la minute : aucune précision à la seconde.
            d['offsets'] = [int(round(x / 60.0)) * 60 for x in secs_]
            d['departures'] = departures(line['windows'], first, last)
            entry['minutes'] = d['offsets'][-1] // 60
            report['directions'].append(entry)
    return report


def relation_termini(osm, d, stops):
    """Membres stop_entry_only / stop_exit_only de la relation (contrôle des
    terminus par validate_gtfs.py) et membres « stop » nommés absents du sens
    (à plus de 60 m de tout arrêt du sens, sans homonyme à moins de 300 m) :
    listés comme ÉCARTÉS plutôt qu'insérés à un rang incertain."""
    rel = osm['rels'][d['osm_relation']]
    out = {}
    pts = [(stops[sid]['lat'], stops[sid]['lon']) for sid in d['stops']]
    norm = lambda v: re.sub(r'[^a-z0-9]', '', unicodedata.normalize('NFD', v or '').encode('ascii', 'ignore').decode().lower())
    names = [norm(stops[sid]['name']) for sid in d['stops']]
    missing = []
    for t, ref, role in rel['members']:
        node = osm['nodes'].get(ref) if t == 'n' else None
        if node is None:
            continue
        p = (node['lat'], node['lon'])
        nm = node['tags'].get('name:fr') or node['tags'].get('name')
        if 'entry_only' in role and 'relation_entry' not in out:
            out['relation_entry'] = {'node': ref, 'name': nm, 'lat': round(p[0], 7), 'lon': round(p[1], 7)}
        if 'exit_only' in role:
            out['relation_exit'] = {'node': ref, 'name': nm, 'lat': round(p[0], 7), 'lon': round(p[1], 7)}
        if role != 'stop' or not nm or f'B{ref}' in d['stops']:
            continue
        dist = min(hav(p, q) for q in pts)
        key = norm(nm)
        near_same = any(hav(p, q) < 300 and (key[:6] in names[i] or names[i][:6] in key) for i, q in enumerate(pts))
        if dist > 60 and not near_same:
            missing.append({'node': ref, 'name': nm, 'distance_m': round(dist)})
    if missing:
        out['missing_named_stops'] = missing
    return out


# ── Écriture GTFS (le rail est recopié tel quel) ────────────────────────────
def read_csv(name):
    path = os.path.join(GTFS, name)
    if not os.path.exists(path):
        return None, []
    with open(path, newline='', encoding='utf-8') as f:
        rows = list(csv.reader(f))
    return rows[0], rows[1:]


def write_csv(name, header, rows):
    buf = io.StringIO()
    w = csv.writer(buf, lineterminator='\n')
    w.writerow(header)
    w.writerows(rows)
    with open(os.path.join(GTFS, name), 'w', encoding='utf-8', newline='') as f:
        f.write(buf.getvalue())


def is_bus_route(route_id: str) -> bool:
    return route_id.startswith('ETUSA-')


def is_bus_stop(stop_id: str) -> bool:
    return bool(re.fullmatch(r'B\d+', stop_id))


def with_column(header, rows, col):
    if col in header:
        return header, rows
    return header + [col], [r + [''] for r in rows]


def write_gtfs(lines, stops):
    used = []
    for line in lines:
        for d in line['directions']:
            used += [s for s in d['stops'] if s not in used]

    # stops.txt
    h, rows = read_csv('stops.txt')
    ix = {c: i for i, c in enumerate(h)}
    rows = [r for r in rows if not is_bus_stop(r[ix['stop_id']])]
    for sid in sorted(used, key=lambda x: int(x[1:])):
        s = stops[sid]
        r = [''] * len(h)
        r[ix['stop_id']] = sid
        r[ix['stop_name']] = s['name']
        r[ix['stop_lat']] = f"{s['lat']:.6f}"
        r[ix['stop_lon']] = f"{s['lon']:.6f}"
        r[ix['stop_desc']] = 'Bus ETUSA'
        r[ix['location_type']] = '0'
        rows.append(r)
    write_csv('stops.txt', h, rows)

    # routes.txt
    h, rows = read_csv('routes.txt')
    ix = {c: i for i, c in enumerate(h)}
    rows = [r for r in rows if not is_bus_route(r[ix['route_id']])]
    for line in lines:
        r = [''] * len(h)
        r[ix['route_id']] = line['route_id']
        r[ix['agency_id']] = 'etusa'
        r[ix['route_short_name']] = line['short_name']
        r[ix['route_long_name']] = LONG_NAME_FIXES.get(line['route_id'], line['long_name'])
        r[ix['route_type']] = '3'
        r[ix['route_color']] = line['color']
        r[ix['route_text_color']] = BUS_TEXT_COLOR
        r[ix['route_desc']] = (f"{line['desc']}. Fréquences et temps de parcours estimés (~), "
                               'voir data/scripts/build_bus.py')
        rows.append(r)
    write_csv('routes.txt', h, rows)

    # trips.txt, stop_times.txt, frequencies.txt
    th, trows = read_csv('trips.txt')
    tix = {c: i for i, c in enumerate(th)}
    old = {r[tix['trip_id']] for r in trows if is_bus_route(r[tix['route_id']])}
    trows = [r for r in trows if not is_bus_route(r[tix['route_id']])]
    sh, srows = read_csv('stop_times.txt')
    sh, srows = with_column(sh, srows, 'shape_dist_traveled')
    six = {c: i for i, c in enumerate(sh)}
    srows = [r for r in srows if r[six['trip_id']] not in old]
    for line in lines:
        for d in line['directions']:
            for dep in d['departures']:
                trip_id = f"{d['trip_id']}-{dep // 3600:02d}{dep % 3600 // 60:02d}"
                r = [''] * len(th)
                r[tix['route_id']] = line['route_id']
                r[tix['service_id']] = SERVICE_ID
                r[tix['trip_id']] = trip_id
                r[tix['trip_headsign']] = d['headsign']
                r[tix['trip_short_name']] = line['short_name']
                r[tix['direction_id']] = str(d['direction_id'])
                r[tix['shape_id']] = d.get('shape_id', '') if d['shape'] else ''
                trows.append(r)
                for seq, (sid, off) in enumerate(zip(d['stops'], d['offsets']), start=1):
                    st = [''] * len(sh)
                    st[six['trip_id']] = trip_id
                    st[six['arrival_time']] = st[six['departure_time']] = hms(dep + off)
                    st[six['stop_id']] = sid
                    st[six['stop_sequence']] = str(seq)
                    st[six['pickup_type']] = '0'
                    st[six['drop_off_type']] = '0'
                    if d['stop_dist']:
                        st[six['shape_dist_traveled']] = f"{d['stop_dist'][seq - 1]:.1f}"
                    st[six['timepoint']] = '0'  # temps estimés
                    srows.append(st)
    write_csv('trips.txt', th, trows)
    write_csv('stop_times.txt', sh, srows)
    h, rows = read_csv('frequencies.txt')
    if h:
        ix = {c: i for i, c in enumerate(h)}
        write_csv('frequencies.txt', h, [r for r in rows if not r[ix['trip_id']].startswith('ETUSA-')])

    # shapes.txt
    h, rows = read_csv('shapes.txt')
    h, rows = with_column(h, rows, 'shape_dist_traveled')
    ix = {c: i for i, c in enumerate(h)}
    rows = [r for r in rows if not r[ix['shape_id']].startswith('ETUSA-')]
    for line in lines:
        for d in line['directions']:
            if not d['shape']:
                continue
            for i, ((la, lo), m) in enumerate(zip(d['shape'], d['shape_acc'])):
                r = [''] * len(h)
                r[ix['shape_id']] = d['shape_id']
                r[ix['shape_pt_lat']] = f'{la:.6f}'
                r[ix['shape_pt_lon']] = f'{lo:.6f}'
                r[ix['shape_pt_sequence']] = str(i)
                r[ix['shape_dist_traveled']] = f'{m:.1f}'
                rows.append(r)
    write_csv('shapes.txt', h, rows)

    # fare_rules.txt (lignes écartées) et fare_attributes.txt (agency_id :
    # obligatoire quand le flux a plusieurs agences).
    h, rows = read_csv('fare_rules.txt')
    ix = {c: i for i, c in enumerate(h)}
    kept = {l['route_id'] for l in lines}
    rows = [r for r in rows if not is_bus_route(r[ix['route_id']]) or r[ix['route_id']] in kept]
    write_csv('fare_rules.txt', h, rows)
    h, rows = read_csv('fare_attributes.txt')
    h, rows = with_column(h, rows, 'agency_id')
    ix = {c: i for i, c in enumerate(h)}
    for r in rows:
        r[ix['agency_id']] = FARE_AGENCY.get(r[ix['fare_id']], 'etusa')
    write_csv('fare_attributes.txt', h, rows)

    # translations.txt : arabe des arrêts de bus (name:ar OSM) et des girouettes.
    # Les lignes rail (stations M**/T**, girouettes rail) sont écrites par
    # build_rail.py : on les garde telles quelles, quel que soit l'ordre des
    # deux scripts.
    th2 = ['table_name', 'field_name', 'language', 'translation', 'record_id', 'record_sub_id', 'field_value']
    bus_headsigns = {d['headsign'] for line in lines for d in line['directions']}
    rail_headsigns = {r[tix['trip_headsign']] for r in trows if not is_bus_route(r[tix['route_id']])}
    tr = []
    h0, rows0 = read_csv('translations.txt')
    for r in rows0 if h0 else []:
        rec = dict(zip(h0, r))
        if rec.get('table_name') == 'stops' and not is_bus_stop(rec.get('record_id', '')):
            tr.append([rec.get(c, '') for c in th2])
        elif (rec.get('table_name') == 'trips' and rec.get('field_value') in rail_headsigns
              and rec.get('field_value') not in bus_headsigns):
            tr.append([rec.get(c, '') for c in th2])
    for sid in sorted(used, key=lambda x: int(x[1:])):
        if stops[sid].get('name_ar'):
            tr.append(['stops', 'stop_name', 'ar', stops[sid]['name_ar'], sid, '', ''])
    seen = set()
    for line in lines:
        for d in line['directions']:
            if d.get('headsign_ar') and d['headsign'] not in seen:
                seen.add(d['headsign'])
                tr.append(['trips', 'trip_headsign', 'ar', d['headsign_ar'], '', '', d['headsign']])
    write_csv('translations.txt', th2, tr)
    return used


def main():
    ap = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    ap.add_argument('--pbf', default=PBF_DEFAULT)
    ap.add_argument('--cache', help='cache pickle des données OSM extraites (accélère les relances)')
    ap.add_argument('--no-check', action='store_true')
    a = ap.parse_args()
    lines, stops = load_reference()
    rel_ids = {d['osm_relation'] for l in lines for d in l['directions']}
    extra = {osm_node_id(s) for s in stops}
    log('lecture OSM…')
    osm = load_osm(a.pbf, a.cache, rel_ids, extra)
    report = build(osm, lines, stops)
    used = write_gtfs(lines, stops)
    report['stops'] = len(used)
    with open(REPORT_OUT, 'w', encoding='utf-8') as f:
        json.dump(report, f, ensure_ascii=False, indent=1)
        f.write('\n')
    counts = collections.Counter(e['shape'] for e in report['directions'])
    log(f"{len(lines)} lignes, {len(report['directions'])} sens, {len(used)} arrêts ; tracés : "
        f"{counts['osm']} relevés OSM, {counts['deduit']} déduits, {counts['absent']} écartés")
    for line in lines:
        for d in line['directions']:
            log(f"  {d['trip_id']:16s} {len(d['stops']):2d} arrêts ~{d['offsets'][-1] // 60:3d} min "
                f"{len(d['departures']):3d} départs {hms(d['departures'][0])[:5]}–{hms(d['departures'][-1])[:5]}")
    if not a.no_check:
        here = os.path.dirname(os.path.abspath(__file__))
        subprocess.run([sys.executable, os.path.join(here, 'validate_gtfs.py'), '--skip-front'], check=True)


if __name__ == '__main__':
    main()

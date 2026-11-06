#!/usr/bin/env python3
"""Métro M1 et tramway T1 d'Alger : GTFS et données du front, depuis OpenStreetMap.

Rejouable : `python3 data/scripts/build_rail.py` depuis la racine du dépôt
(dépendance : `pip install osmium`). Le script lit l'extrait OSM que charge
déjà OpenTripPlanner (data/algeria-260228.osm.pbf), puis réécrit UNIQUEMENT la
partie rail du GTFS ; les lignes de bus sont recopiées telles quelles.

Sorties
  data/gtfs/stops.txt, routes.txt, trips.txt, stop_times.txt, shapes.txt,
  frequencies.txt (lignes rail retirées : les départs sont explicites)
  data/rail-reference.json         référence OSM figée (contrôle sans le PBF)
  web/src/lib/generated-rail.json  stations, sens, temps et tracés du front
Contrôle : `python3 data/scripts/check_rail.py` (aussi lancé en fin de build).

Source et licence : © contributeurs OpenStreetMap, ODbL. Les relations
utilisées sont figées ci-dessous (RELATIONS) ; les stations sont rapprochées
par IDENTIFIANT de nœud OSM, jamais par nom. Une station présente dans une
relation mais absente des tables ci-dessous fait échouer le script : une
nouvelle station doit être ajoutée à la main, avec ses noms relus.

Ce qui vient d'OSM
  - liste et ordre des stations (membres « stop » des relations de ligne) ;
  - coordonnées : nœud railway=station pour le métro (une station = un point,
    pas les stop_position par sens), nœud tram_stop du sens aller pour le tram ;
  - tracés : ways des relations, chaînés puis coupés au premier et au dernier
    arrêt (les voies de garage et le chantier vers Bab El Oued, way
    600318996 taguée construction, sortent ainsi du tracé exploité).
Ce qui est curé à la main (tables ci-dessous)
  - noms FR et AR : name:fr / name:ar d'OSM relus ; écarts signalés en
    commentaire (orthographes divergentes entre relations, arabe relu) ;
  - identifiants GTFS : les anciens (M01…, T01…) sont conservés pour les
    stations existantes ; les nouvelles prennent des numéros jamais utilisés
    (M10, M11 — stations inventées retirées — et M17-M25 — extensions sans
    source — ne sont PAS réattribués).

Ce qui est ESTIMÉ (jamais présenté comme officiel ; l'app l'affiche avec « ~ »)
  - Temps de parcours : proportionnels à la longueur de voie OSM entre arrêts,
    à une vitesse commerciale constante (arrêts compris) :
      * métro 34 km/h : « de la station d'El Harrach à Tafourah (Grande Poste)
        en 20 minutes » (Maghreb Emergent, 14/06/2015, annonce de l'extension
        El Harrach) ; 11,35 km de voie OSM / 20 min = 34 km/h ;
      * tram 18 km/h : aucune vitesse publiée pour Alger. 18 km/h est le bas de
        la fourchette 18-22 km/h de la brochure ministérielle « Le renouveau du
        tramway en France » (MEDDE) ; bas de fourchette car la vitesse maximale
        des rames à Alger est limitée à 30 km/h (algerie360, mai 2011).
  - Amplitude, PAR SENS (SERVICE ci-dessous, sources citées) :
      * métro 05:00-23:00 : opening_hours « Mo-Su 05:00-23:00 » des 4
        relations OSM du M1 (amplitude identique sur Wikipédia FR) ; dernier
        départ des terminus à 23:00 inclus ;
      * tram, depuis Ruisseau (T1-0) 05:30-22:20, depuis Dergana Centre (T1-1)
        05:30-22:00 : SETRAM, horaires en vigueur du 14/09/2025 puis du
        11/11/2025 (algerie360) — premiers départs 05:30 aux deux terminus,
        derniers départs 22:00 de Dergana et 22:20 de Ruisseau ; OSM relation
        6545828 opening_hours « Mo-Su 05:30-22:00 ». L'ancien 05:00-23:00 du
        dépôt n'avait aucune source (constat R45 : l'app disait « Ouvert ·
        dernier départ 23:00 » et OTP proposait des trams à 22:51).
  - Intervalles : ceux du dépôt, SANS source publiée (l'app les présente comme
    « intervalles estimés, non publiés ») : toutes les 5 min de 07 à 09 h et
    de 17 à 21 h, toutes les 10 min sinon. Sources contradictoires connues,
    NON appliquées (décision produit à prendre) : métro, Wikipédia FR 3 min 20 s
    en pointe et 5 min en creux ; tram, Wikipédia FR une rame toutes les 7 min
    en pointe, Railway Gazette (04/2014) 7 à 8 min.
  - Branches du métro : la répartition des rames entre El Harrach Centre et
    Aïn Naâdja n'est publiée nulle part. Hypothèse documentée : les rames
    ALTERNENT sur le tronc commun. Le tronc garde donc l'intervalle du dépôt et
    chaque branche reçoit le double (10 min en pointe, 20 min sinon). Ne
    jamais donner l'intervalle du tronc à chaque branche : OTP verrait deux
    fois plus de rames qu'il n'en existe.
  - Phase des départs : aucun horaire publié ; les fréquences sont développées
    en départs explicites (premier départ à l'ouverture, puis tous les
    intervalles). Avec un seul trip par sens et exact_times=0, OTP 2.5
    proposait des départs espacés de la durée du trajet (constat K42).
"""
from __future__ import annotations

import argparse
import csv
import io
import json
import math
import os
import subprocess
import sys
from dataclasses import dataclass, field

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
GTFS = os.path.join(ROOT, 'data', 'gtfs')
PBF_DEFAULT = os.path.join(ROOT, 'data', 'algeria-260228.osm.pbf')
REFERENCE_OUT = os.path.join(ROOT, 'data', 'rail-reference.json')
FRONT_OUT = os.path.join(ROOT, 'web', 'src', 'lib', 'generated-rail.json')

# ── Relations OSM (Algérie, extrait Geofabrik du 28/02/2026) ────────────────
RELATIONS = {
    'M1-HAR-0': 289331,   # Metro L1     Place des Martyrs → El-Harrach Centre
    'M1-HAR-1': 6545466,  # Metro L1R    El-Harrach Centre → Place des Martyrs
    'M1-AIN-0': 8210887,  # Metro L1-2   Place des Martyrs → Aïn Naâdja
    'M1-AIN-1': 8210886,  # Metro L1R-2  Aïn Naâdja → Place des Martyrs
    'T1-0': 548496,       # T1 A         Ruisseau → Dergana Centre
    'T1-1': 6545828,      # T1 R         Dergana Centre → Ruisseau
}

# ── Stations du métro ───────────────────────────────────────────────────────
# (stop_id, nœud OSM railway=station, nom FR, nom AR, autres nœuds OSM de la
#  même station : stop_position par sens cités dans les relations)
METRO = [
    ('M26', 966535035, 'Place des Martyrs', 'ساحة الشهداء', []),
    ('M27', 966535048, 'Ali Boumendjel', 'علي بومنجل', []),
    ('M01', 532001382, 'Tafourah - Grande Poste', 'تافورة - البريد المركزي', [13901796904, 13901796903]),
    ('M02', 3603933963, 'Khelifa Boukhalfa', 'خليفة بوخالفة', []),
    ('M03', 532001411, '1er Mai', 'أول ماي', []),
    # OSM : « عيسات إدير » ; graphie usuelle du nom propre : « عيسات إيدير ».
    ('M04', 532001427, 'Aïssat Idir', 'عيسات إيدير', []),
    ('M05', 532001439, 'Hamma', 'الحامة', []),
    ('M06', 532001464, "Jardin d'Essai", 'حديقة التجارب', []),
    # OSM name:ar, identique à l'arrêt de tram voisin (l'ancien « لي فوزيي »
    # n'était qu'une translittération du français).
    ('M07', 532001481, 'Les Fusillés', 'المعدومين', []),
    ('M08', 532001496, 'Cité Amirouche', 'حي عميروش', []),
    # OSM name:fr « Mer et Soleil » ; « Cité » conservé (nom du quartier, « حي »).
    ('M09', 3590827124, 'Cité Mer et Soleil', 'حي البحر والشمس', []),
    ('M12', 5571463482, 'Haï El Badr', 'حي البدر', [5571463484, 5571463483, 5571463485]),
    ('M13', 6673464969, 'Bachdjarah - Tennis', 'باش جراح - تنس', [820595864, 6535079822]),
    # OSM name:fr « Bachdjerrah » ; aligné sur « Bachdjarah - Tennis ».
    ('M14', 6673464972, 'Bachdjarah', 'باش جراح', [966506935, 6535079834]),
    ('M15', 6673464971, 'El Harrach Gare', 'الحراش - المحطة', [3600451972, 6535079851]),
    ('M16', 6673464970, 'El Harrach Centre', 'الحراش وسط', [966506919, 6535079859]),
    # OSM : name « Station des Ateliers », name:ar « وقف ورش العمل » (traduction
    # littérale bancale) ; arabe relu : « الورشات ».
    ('M28', 3589500559, 'Les Ateliers', 'الورشات', []),
    ('M29', 2208811165, 'Gué de Constantine', 'جسر قسنطينة', []),
    ('M30', 3589518209, 'Aïn Naâdja', 'عين النعجة', []),
]

# ── Arrêts du tramway ───────────────────────────────────────────────────────
# (stop_id, nœud tram_stop sens aller [548496], nœud sens retour [6545828],
#  nom FR, nom AR). Coordonnées : nœud du sens aller (les deux quais sont à
#  quelques mètres). OSM tague « name » en arabe : on part de name:fr.
TRAM = [
    ('T01', 956392789, 7301592855, 'Ruisseau', 'العناصر'),  # retour : nœud sans tag
    ('T02', 472089428, 3512265690, 'Les Fusillés', 'المعدومين'),
    ('T03', 2402077544, 3513729589, 'Tripoli - Thaâlibia', 'طرابلس - الثعالبية'),
    ('T04', 472089416, 3513729802, 'Tripoli - Mosquée', 'طرابلس - المسجد'),
    ('T05', 472089415, 3513727274, 'Tripoli - Hamadèche', 'طرابلس - حمداش'),
    ('T06', 472089412, 3513726622, 'Tripoli - Makaria', 'طرابلس - المقرية'),
    ('T07', 2253518671, 3513715693, 'Caroubier', 'الخروبة'),
    ('T08', 2253518514, 3513712819, 'La Glacière', 'الهواء الجميل'),
    ('T09', 472089401, 3513698842, 'Pont El Harrach', 'جسر الحراش'),
    ('T21', 2253518723, 3513693753, 'Bellevue', 'المنظر الجميل'),
    ('T10', 472089389, 3513689110, 'Bekri Bouguerra', 'بكري بوقرة'),
    ('T11', 472089383, 3513668361, 'Cinq Maisons', 'الديار الخمس'),
    ('T12', 472084301, 3513651506, "Foire d'Alger", 'قصر المعارض'),
    ('T13', 472084293, 3513613882, 'Les Pins', 'الصنوبر'),
    ('T14', 472084291, 3513616950, 'Tamaris', 'حي المندرين'),
    ('T22', 452418787, 3513613686, 'Cité Mokhtar Zerhouni', 'حي مختار زرهوني'),
    ('T23', 472084279, 3513576791, 'Cité Rabia', 'حي رابية'),
    ('T24', 472084274, 3513604611, 'Université de Bab Ezzouar', 'جامعة باب الزوار'),
    ('T15', 1626899500, 3513576390, 'Cité 5 Juillet', 'حي 5 جويلية'),
    ('T25', 472084262, 3513574204, 'Bab Ezzouar - Le Pont', 'باب الزوار - الجسر'),
    ('T26', 472084248, 3513575500, 'Cité Universitaire - CUB 1', 'الإقامة الجامعية - ح ج ب 1'),
    ('T27', 689997781, 3513573388, 'Cité 8 Mai 1945', 'حي 8 ماي 1945'),
    # name:fr « Cité Claire Matin » (aller) / « Cité Clair Matin » (retour).
    ('T28', 689997751, 3513571593, 'Cité Clair Matin', 'حي الصباح'),
    ('T16', 689997745, 3513552990, 'Bordj El Kiffan - Lycée', 'برج الكيفان - الثانوية'),
    ('T29', 689997724, 3513552242, 'Bordj El Kiffan - Centre', 'برج الكيفان - وسط'),
    ('T17', 689997704, 3513552241, 'Bordj El Kiffan - Polyclinique', 'برج الكيفان - العيادة'),
    ('T30', 1929028675, 3513537666, 'Mouhous', 'موحوس'),
    # name:fr « Mimouni Hamoudi » (aller) / « Mimouni Mahmoud » (retour) ;
    # name:ar « ميموني محمود » dans les deux sens : on suit la graphie cohérente.
    ('T31', 3009232878, 3513529208, 'Mimouni Mahmoud', 'ميموني محمود'),
    ('T32', 3102187300, 3513540400, 'Ben Mrabet', 'بن مرابط'),
    ('T33', 8292893942, 8292893940, 'Ben Redouan', 'بن رضوان'),
    ('T18', 3376367448, 3513492377, 'Ben Mered', 'بن مراد'),
    # « Sidi Dris » / « Sidi Driss », « سيدي ادريس » / « سيدي دريس » : graphie
    # usuelle retenue.
    ('T34', 3220011165, 3513534789, 'Sidi Driss', 'سيدي إدريس'),
    ('T35', 2951946502, 3513532150, 'Ben Zerga', 'بن زرقة'),
    ('T19', 3220011760, 3513515526, 'Café Chergui', 'مقهى شرقي'),
    ('T36', 3694495413, 4377305016, 'Faculté Biomédicale', 'جامعة درقانة'),
    ('T37', 3694495396, 4377305014, 'Cité Diplomatique', 'الحي الدبلوماسي'),
    # name:ar « درڨانة وسط » (ڨ algérien, mal rendu par certaines polices).
    ('T20', 3694495400, 4377305015, 'Dergana Centre', 'درقانة وسط'),
]

# ── Exploitation (voir l'en-tête) ──────────────────────────────────────────
# Premier et dernier départ du terminus d'origine, inclus, par sens.
SERVICE = {
    'M1-HAR-0': ('05:00', '23:00'),
    'M1-HAR-1': ('05:00', '23:00'),
    'M1-AIN-0': ('05:00', '23:00'),
    'M1-AIN-1': ('05:00', '23:00'),
    'T1-0': ('05:30', '22:20'),  # depuis Ruisseau
    'T1-1': ('05:30', '22:00'),  # depuis Dergana Centre
}
SERVICE_SOURCES = {
    'metro': 'OSM : opening_hours « Mo-Su 05:00-23:00 » des relations 289331, 6545466, 8210887, 8210886',
    'tram': ('SETRAM, horaires du 14/09/2025 et du 11/11/2025 (algerie360) : premiers départs 05:30, '
             'derniers départs 22:20 de Ruisseau et 22:00 de Dergana ; OSM relation 6545828 '
             'opening_hours « Mo-Su 05:30-22:00 »'),
    'headways': 'intervalles du dépôt, non publiés par les exploitants (estimation)',
}
# Intervalles (fin exclue, intervalle du tronc en s). Le tram ouvre à 05:30
# et ferme plus tôt : sa première fenêtre commence à 05:30, la dernière
# s'arrête à son dernier départ (tram_windows).
WINDOWS = [
    ('05:00', '07:00', 600),
    ('07:00', '09:00', 300),
    ('09:00', '17:00', 600),
    ('17:00', '21:00', 300),
    ('21:00', '23:00', 600),
]


def mode_service(mode: str):
    """(premier départ le plus tôt, dernier départ le plus tard) des sens du mode."""
    spans = [SERVICE[pid] for pid, m, _ in PATTERNS if m == mode]
    return min(a for a, _ in spans), max(b for _, b in spans)


def mode_windows(mode: str):
    """Fenêtres d'intervalle bornées à l'amplitude du mode (fin exclue = dernier départ + 1 min)."""
    first, last = mode_service(mode)
    end = f'{(secs(last) + 60) // 3600:02d}:{(secs(last) + 60) % 3600 // 60:02d}'
    out = []
    for a, b, h in WINDOWS:
        a2, b2 = max(a, first), min(b, end)
        if a2 < b2:
            out.append((a2, b2, h))
    return out
SPEED_KMH = {'metro': 34.0, 'tram': 18.0}
SERVICE_ID = 'all-week'

ROUTES = {
    'metro': dict(route_id='L1-metro', agency_id='metro-alger', route_short_name='M1',
                  route_long_name='Métro Ligne 1', route_type='1', route_color='1E3A8A',
                  route_text_color='FFFFFF',
                  route_desc='Place des Martyrs ↔ El Harrach Centre / Aïn Naâdja. Stations et '
                             'tracé : OpenStreetMap. Temps de parcours et répartition entre '
                             'branches estimés (~), voir data/scripts/build_rail.py'),
    'tram': dict(route_id='L1-tram', agency_id='tram-alger', route_short_name='T1',
                 route_long_name='Tramway Ligne 1', route_type='0', route_color='059669',
                 route_text_color='FFFFFF',
                 route_desc='Ruisseau ↔ Dergana Centre. Arrêts et tracé : OpenStreetMap. '
                            'Temps de parcours estimés (~), voir data/scripts/build_rail.py'),
}

# Sens exploités : (motif = shape_id GTFS, mode, direction_id).
PATTERNS = [
    ('M1-HAR-0', 'metro', 0),
    ('M1-HAR-1', 'metro', 1),
    ('M1-AIN-0', 'metro', 0),
    ('M1-AIN-1', 'metro', 1),
    ('T1-0', 'tram', 0),
    ('T1-1', 'tram', 1),
]

MAX_STOP_TO_SHAPE_M = 30.0
MAX_SHAPE_GAP_M = 200.0
FRONT_SIMPLIFY_M = 1.0


# ── Géométrie ───────────────────────────────────────────────────────────────
def hav(a, b):
    """Distance en mètres entre deux (lat, lon)."""
    r = 6371008.8
    la1, lo1, la2, lo2 = map(math.radians, (a[0], a[1], b[0], b[1]))
    h = math.sin((la2 - la1) / 2) ** 2 + math.cos(la1) * math.cos(la2) * math.sin((lo2 - lo1) / 2) ** 2
    return 2 * r * math.asin(math.sqrt(h))


def cumulative(line):
    acc = [0.0]
    for i in range(1, len(line)):
        acc.append(acc[-1] + hav(line[i - 1], line[i]))
    return acc


def project(pt, line, acc, from_m=0.0):
    """(distance au tracé, abscisse curviligne) du point projeté, en mètres.
    from_m : ne cherche qu'à partir de cette abscisse (ordre des arrêts)."""
    lat0 = math.radians(pt[0])
    kx, ky = 111320.0 * math.cos(lat0), 110574.0
    best = (float('inf'), 0.0)
    for i in range(len(line) - 1):
        if acc[i + 1] < from_m:
            continue
        ax, ay = (line[i][1] - pt[1]) * kx, (line[i][0] - pt[0]) * ky
        bx, by = (line[i + 1][1] - pt[1]) * kx, (line[i + 1][0] - pt[0]) * ky
        dx, dy = bx - ax, by - ay
        l2 = dx * dx + dy * dy
        t = 0.0 if l2 == 0 else max(0.0, min(1.0, -(ax * dx + ay * dy) / l2))
        d = math.hypot(ax + t * dx, ay + t * dy)
        along = acc[i] + t * (acc[i + 1] - acc[i])
        if along < from_m:
            continue
        if d < best[0] - 1e-9:
            best = (d, along)
    return best


def point_at(line, acc, m):
    for i in range(len(line) - 1):
        if acc[i + 1] >= m:
            seg = acc[i + 1] - acc[i]
            t = 0.0 if seg == 0 else (m - acc[i]) / seg
            return (line[i][0] + t * (line[i + 1][0] - line[i][0]),
                    line[i][1] + t * (line[i + 1][1] - line[i][1]))
    return line[-1]


def cut(line, acc, m0, m1):
    """Portion du tracé entre deux abscisses (points de coupe interpolés)."""
    out = [point_at(line, acc, m0)]
    for i, p in enumerate(line):
        if m0 < acc[i] < m1:
            out.append(p)
    out.append(point_at(line, acc, m1))
    dedup = [out[0]]
    for p in out[1:]:
        if hav(dedup[-1], p) > 0.01:
            dedup.append(p)
    return dedup


def simplify(line, tol_m):
    """Douglas-Peucker en mètres (projection locale)."""
    if len(line) < 3:
        return list(line)
    lat0 = math.radians(line[0][0])
    kx, ky = 111320.0 * math.cos(lat0), 110574.0
    xy = [(p[1] * kx, p[0] * ky) for p in line]
    keep = [False] * len(line)
    keep[0] = keep[-1] = True
    stack = [(0, len(line) - 1)]
    while stack:
        a, b = stack.pop()
        ax, ay = xy[a]
        bx, by = xy[b]
        dx, dy = bx - ax, by - ay
        l2 = dx * dx + dy * dy
        best, idx = -1.0, -1
        for i in range(a + 1, b):
            px, py = xy[i]
            t = 0.0 if l2 == 0 else max(0.0, min(1.0, ((px - ax) * dx + (py - ay) * dy) / l2))
            d = math.hypot(px - (ax + t * dx), py - (ay + t * dy))
            if d > best:
                best, idx = d, i
        if best > tol_m:
            keep[idx] = True
            stack += [(a, idx), (idx, b)]
    return [p for p, k in zip(line, keep) if k]


# ── Extraction OSM ──────────────────────────────────────────────────────────
def extract(pbf: str) -> dict:
    import osmium  # pip install osmium
    from osmium.filter import IdFilter

    rel_ids = set(RELATIONS.values())
    rels = {}
    for r in osmium.FileProcessor(pbf, osmium.osm.RELATION).with_filter(IdFilter(rel_ids)):
        rels[r.id] = {'tags': dict(r.tags), 'members': [(m.type, m.ref, m.role) for m in r.members]}
    missing = rel_ids - set(rels)
    if missing:
        sys.exit(f'Relations absentes de {pbf} : {sorted(missing)}')

    way_ids = {ref for r in rels.values() for t, ref, _ in r['members'] if t == 'w'}
    ways = {}
    for w in osmium.FileProcessor(pbf, osmium.osm.WAY).with_filter(IdFilter(way_ids)):
        ways[w.id] = {'nodes': [n.ref for n in w.nodes], 'tags': dict(w.tags)}

    node_ids = {n for w in ways.values() for n in w['nodes']}
    node_ids |= {ref for r in rels.values() for t, ref, _ in r['members'] if t == 'n'}
    node_ids |= {row[1] for row in METRO} | {n for row in METRO for n in row[4]}
    node_ids |= {row[1] for row in TRAM} | {row[2] for row in TRAM}
    nodes = {}
    for n in osmium.FileProcessor(pbf, osmium.osm.NODE).with_filter(IdFilter(node_ids)):
        nodes[n.id] = {'lat': n.location.lat, 'lon': n.location.lon, 'tags': dict(n.tags)}
    return {'rels': rels, 'ways': ways, 'nodes': nodes}


def load_osm(pbf: str, cache: str | None) -> dict:
    if cache and os.path.exists(cache):
        raw = json.load(open(cache))
        return {
            'rels': {int(k): {'tags': v['tags'], 'members': [tuple(m) for m in v['members']]} for k, v in raw['rels'].items()},
            'ways': {int(k): v for k, v in raw['ways'].items()},
            'nodes': {int(k): v for k, v in raw['nodes'].items()},
        }
    osm = extract(pbf)
    if cache:
        json.dump({k: {str(i): v for i, v in osm[k].items()} for k in osm}, open(cache, 'w'))
    return osm


def chain_ways(osm, rel_id):
    """Ordonne et oriente les ways d'une relation en un tracé continu.
    Les membres ne sont pas toujours rangés (relation 6545828 : trois premiers
    ways permutés) : on suit les extrémités communes, en partant de
    l'extrémité libre la plus proche du premier arrêt."""
    rel = osm['rels'][rel_id]
    wids = [ref for t, ref, _ in rel['members'] if t == 'w']
    segs = [list(osm['ways'][w]['nodes']) for w in wids]
    ends = {}
    for i, s in enumerate(segs):
        for n in (s[0], s[-1]):
            ends.setdefault(n, []).append(i)
    free = [n for n, lst in ends.items() if len(lst) == 1]
    if len(free) != 2:
        sys.exit(f'Relation {rel_id} : tracé non linéaire (extrémités libres : {len(free)})')
    first_stop = next(ref for t, ref, role in rel['members'] if t == 'n' and role.startswith('stop'))
    fs = osm['nodes'][first_stop]
    start = min(free, key=lambda n: hav((fs['lat'], fs['lon']), (osm['nodes'][n]['lat'], osm['nodes'][n]['lon'])))
    used, seq, seg_way, cur = set(), [start], [], start
    while len(used) < len(segs):
        # Le way suivant doit PARTAGER le nœud courant : aucun raccord par
        # proximité, donc aucun saut possible entre deux ways.
        nxt = [i for i in ends.get(cur, []) if i not in used]
        if len(nxt) != 1:
            sys.exit(f'Relation {rel_id} : chaînage ambigu ou rompu au nœud {cur}')
        i = nxt[0]
        used.add(i)
        s = segs[i] if segs[i][0] == cur else segs[i][::-1]
        seq += s[1:]
        seg_way += [wids[i]] * (len(s) - 1)
        cur = s[-1]
    return [(osm['nodes'][n]['lat'], osm['nodes'][n]['lon']) for n in seq], seg_way


# ── Données ─────────────────────────────────────────────────────────────────
@dataclass
class Station:
    id: str
    name: str
    name_ar: str
    lat: float
    lon: float
    mode: str
    osm_node: int
    aliases: set = field(default_factory=set)


@dataclass
class Pattern:
    id: str
    mode: str
    direction_id: int
    stop_ids: list
    shape: list            # [(lat, lon)] coupé aux terminus
    stop_m: list           # abscisse de chaque arrêt sur le tracé
    long_segments: list = field(default_factory=list)
    offsets: list = field(default_factory=list)   # secondes depuis le départ
    departures: list = field(default_factory=list)  # secondes depuis minuit


def hms(s: int) -> str:
    return f'{s // 3600:02d}:{s % 3600 // 60:02d}:{s % 60:02d}'


def secs(hhmm: str) -> int:
    h, m = hhmm.split(':')[:2]
    return int(h) * 3600 + int(m) * 60


def build_stations(osm):
    stations = {}
    for sid, node, name, ar, aliases in METRO:
        n = osm['nodes'][node]
        stations[sid] = Station(sid, name, ar, n['lat'], n['lon'], 'metro', node, {node, *aliases})
    for sid, fwd, back, name, ar in TRAM:
        n = osm['nodes'][fwd]
        stations[sid] = Station(sid, name, ar, n['lat'], n['lon'], 'tram', fwd, {fwd, back})
    return stations


def build_pattern(osm, stations, pid, mode, direction_id):
    rel_id = RELATIONS[pid]
    rel = osm['rels'][rel_id]
    by_node = {}
    for s in stations.values():
        if s.mode == mode:
            for n in s.aliases:
                by_node[n] = s.id
    stop_ids = []
    for t, ref, role in rel['members']:
        if t != 'n' or not role.startswith('stop'):
            continue
        if ref not in by_node:
            tags = osm['nodes'].get(ref, {}).get('tags', {})
            sys.exit(f'Relation {rel_id} : arrêt OSM {ref} ({tags.get("name:fr") or tags.get("name")}) '
                     'absent des tables METRO/TRAM — le relire et l’ajouter à la main.')
        stop_ids.append(by_node[ref])
    if len(set(stop_ids)) != len(stop_ids):
        sys.exit(f'Relation {rel_id} : station en double {stop_ids}')

    full, seg_way = chain_ways(osm, rel_id)
    acc = cumulative(full)
    # Projection de chaque arrêt, dans l'ordre (abscisses croissantes).
    pos, last = [], 0.0
    for sid in stop_ids:
        s = stations[sid]
        d, m = project((s.lat, s.lon), full, acc, last)
        if d > MAX_STOP_TO_SHAPE_M:
            sys.exit(f'{pid} : {s.name} à {d:.0f} m du tracé OSM (max {MAX_STOP_TO_SHAPE_M:.0f} m)')
        pos.append(m)
        last = m
    shape = cut(full, acc, pos[0], pos[-1])
    sacc = cumulative(shape)
    stop_m, last = [], 0.0
    for sid in stop_ids:
        s = stations[sid]
        d, m = project((s.lat, s.lon), shape, sacc, last)
        stop_m.append(m)
        last = m
    # Segments de plus de MAX_SHAPE_GAP_M : ce ne sont pas des sauts mais des
    # alignements droits d'un même way OSM (tunnels du métro surtout). On le
    # prouve en retrouvant le way qui porte chacun, pour check_rail.py.
    long_segments = []
    for i in range(len(shape) - 1):
        length = sacc[i + 1] - sacc[i]
        if length <= MAX_SHAPE_GAP_M:
            continue
        owner = None
        for j in range(len(full) - 1):
            if (project(shape[i], full[j:j + 2], acc[j:j + 2])[0] < 0.5
                    and project(shape[i + 1], full[j:j + 2], acc[j:j + 2])[0] < 0.5):
                owner = seg_way[j]
                break
        if owner is None:
            sys.exit(f'{pid} : segment de {length:.0f} m hors des ways OSM (saut)')
        long_segments.append({'from': [round(shape[i][0], 7), round(shape[i][1], 7)],
                              'to': [round(shape[i + 1][0], 7), round(shape[i + 1][1], 7)],
                              'lengthM': round(length, 1), 'osmWay': owner})
    return Pattern(pid, mode, direction_id, stop_ids, shape, stop_m, long_segments=long_segments)


def running_times(p: Pattern):
    v = SPEED_KMH[p.mode] / 3.6
    p.offsets = [int(round((m - p.stop_m[0]) / v)) for m in p.stop_m]


def headway_at(t: int) -> int:
    for a, b, h in WINDOWS:
        if secs(a) <= t < secs(b):
            return h
    return WINDOWS[-1][2]


def grid(start: int, end: int):
    """Départs de start à end inclus, au pas des fenêtres."""
    out, t = [], start
    while t <= end:
        out.append(t)
        t += headway_at(t)
    return out


def schedule(patterns):
    # Tram : une grille par terminus, chacun avec son amplitude (SETRAM).
    for pid in ('T1-0', 'T1-1'):
        patterns[pid].departures = grid(secs(SERVICE[pid][0]), secs(SERVICE[pid][1]))
    first, last = (secs(t) for t in mode_service('metro'))
    # Métro, sens aller : grille du tronc à Place des Martyrs, rames alternées.
    for k, t in enumerate(grid(first, last)):
        patterns['M1-HAR-0' if k % 2 == 0 else 'M1-AIN-0'].departures.append(t)
    # Métro, sens retour : alternance au point de jonction (Haï El Badr), pour
    # que le tronc reste régulier ; départ du terminus = passage − trajet.
    har, ain = patterns['M1-HAR-1'], patterns['M1-AIN-1']
    junction = 'M12'
    rt = {'M1-HAR-1': har.offsets[har.stop_ids.index(junction)],
          'M1-AIN-1': ain.offsets[ain.stop_ids.index(junction)]}
    t, k = first + rt['M1-HAR-1'], 0
    while True:
        pid = 'M1-HAR-1' if k % 2 == 0 else 'M1-AIN-1'
        dep = int(round((t - rt[pid]) / 60.0)) * 60
        if dep > last and t - max(rt.values()) > last:
            break
        if first <= dep <= last:
            patterns[pid].departures.append(dep)
        t += headway_at(t - rt['M1-HAR-1'])
        k += 1
    for p in patterns.values():
        p.departures = sorted(set(p.departures))


def pattern_headways(p: Pattern):
    """Intervalle effectif du motif par fenêtre (min), mesuré sur ses départs."""
    out = []
    for a, b, _ in mode_windows(p.mode):
        deps = [d for d in p.departures if secs(a) <= d < secs(b)]
        gaps = sorted(deps[i + 1] - deps[i] for i in range(len(deps) - 1))
        if gaps:
            out.append({'start': a, 'end': b, 'min': round(gaps[len(gaps) // 2] / 60)})
    return out


# ── Écriture GTFS (le bus est recopié tel quel) ─────────────────────────────
def read_csv(name):
    with open(os.path.join(GTFS, name), newline='', encoding='utf-8') as f:
        rows = list(csv.reader(f))
    return rows[0], rows[1:]


def write_csv(name, header, rows):
    buf = io.StringIO()
    w = csv.writer(buf, lineterminator='\n')
    w.writerow(header)
    w.writerows(rows)
    with open(os.path.join(GTFS, name), 'w', encoding='utf-8', newline='') as f:
        f.write(buf.getvalue())


def is_rail_stop(stop_id: str) -> bool:
    return len(stop_id) == 3 and stop_id[0] in 'MT' and stop_id[1:].isdigit()


def write_gtfs(stations, patterns):
    # stops.txt
    h, rows = read_csv('stops.txt')
    ix = {c: i for i, c in enumerate(h)}
    rows = [r for r in rows if not is_rail_stop(r[ix['stop_id']])]
    rail = []
    for s in sorted(stations.values(), key=lambda s: (s.mode != 'metro', s.id)):
        r = [''] * len(h)
        r[ix['stop_id']] = s.id
        r[ix['stop_name']] = s.name
        r[ix['stop_lat']] = f'{s.lat:.6f}'
        r[ix['stop_lon']] = f'{s.lon:.6f}'
        r[ix['stop_desc']] = ('Métro L1' if s.mode == 'metro' else 'Tramway L1') + f' (OSM n{s.osm_node})'
        r[ix['location_type']] = '0'
        # wheelchair_boarding laissé vide : aucune source (l'ancien « 1 » n'en avait pas).
        rail.append(r)
    write_csv('stops.txt', h, rail + rows)

    # routes.txt
    h, rows = read_csv('routes.txt')
    ix = {c: i for i, c in enumerate(h)}
    rail_routes = {v['route_id'] for v in ROUTES.values()}
    rows = [r for r in rows if r[ix['route_id']] not in rail_routes]
    rail = [[ROUTES[m][c] for c in h] for m in ('metro', 'tram')]
    write_csv('routes.txt', h, rail + rows)

    # trips.txt + stop_times.txt
    th, trows = read_csv('trips.txt')
    tix = {c: i for i, c in enumerate(th)}
    old_rail_trips = {r[tix['trip_id']] for r in trows if r[tix['route_id']] in rail_routes}
    trows = [r for r in trows if r[tix['route_id']] not in rail_routes]
    sh, srows = read_csv('stop_times.txt')
    six = {c: i for i, c in enumerate(sh)}
    srows = [r for r in srows if r[six['trip_id']] not in old_rail_trips]
    new_trips, new_st = [], []
    for p in patterns.values():
        route = ROUTES[p.mode]
        headsign = stations[p.stop_ids[-1]].name
        for dep in p.departures:
            trip_id = f'{p.id}-{dep // 3600:02d}{dep % 3600 // 60:02d}'
            r = [''] * len(th)
            r[tix['route_id']] = route['route_id']
            r[tix['service_id']] = SERVICE_ID
            r[tix['trip_id']] = trip_id
            r[tix['trip_headsign']] = headsign
            r[tix['trip_short_name']] = route['route_short_name']
            r[tix['direction_id']] = str(p.direction_id)
            r[tix['shape_id']] = p.id
            new_trips.append(r)
            for seq, (sid, off) in enumerate(zip(p.stop_ids, p.offsets), start=1):
                s = [''] * len(sh)
                s[six['trip_id']] = trip_id
                s[six['arrival_time']] = s[six['departure_time']] = hms(dep + off)
                s[six['stop_id']] = sid
                s[six['stop_sequence']] = str(seq)
                s[six['pickup_type']] = '0'
                s[six['drop_off_type']] = '0'
                # Temps estimés (vitesse commerciale × longueur de voie) : approximatifs.
                s[six['timepoint']] = '0'
                new_st.append(s)
    write_csv('trips.txt', th, new_trips + trows)
    write_csv('stop_times.txt', sh, new_st + srows)

    # frequencies.txt : plus aucune ligne rail (départs développés).
    h, rows = read_csv('frequencies.txt')
    ix = {c: i for i, c in enumerate(h)}
    write_csv('frequencies.txt', h, [r for r in rows if r[ix['trip_id']] not in old_rail_trips])

    # shapes.txt
    h, rows = read_csv('shapes.txt')
    ix = {c: i for i, c in enumerate(h)}
    rows = [r for r in rows if r[ix['shape_id']] not in patterns]
    rail = []
    for p in patterns.values():
        for i, (la, lo) in enumerate(p.shape):
            r = [''] * len(h)
            r[ix['shape_id']] = p.id
            r[ix['shape_pt_lat']] = f'{la:.7f}'
            r[ix['shape_pt_lon']] = f'{lo:.7f}'
            r[ix['shape_pt_sequence']] = str(i)
            rail.append(r)
    write_csv('shapes.txt', h, rail + rows)

    # translations.txt : noms arabes des stations et girouettes rail (noms
    # relus des tables METRO/TRAM). Le fichier est créé par build_bus.py
    # (arabe des arrêts de bus) ; on n'y remplace que les lignes rail, de
    # façon idempotente (quel que soit l'ordre des deux scripts).
    th2 = ['table_name', 'field_name', 'language', 'translation', 'record_id', 'record_sub_id', 'field_value']
    path = os.path.join(GTFS, 'translations.txt')
    kept = []
    if os.path.exists(path):
        h, rows = read_csv('translations.txt')
        ix = {c: i for i, c in enumerate(h)}
        rail_headsigns = {stations[p.stop_ids[-1]].name for p in patterns.values()}
        bus_headsigns = {r[tix['trip_headsign']] for r in trows}
        for r in rows:
            rec = dict(zip(h, r))
            if rec['table_name'] == 'stops' and is_rail_stop(rec['record_id']):
                continue
            if (rec['table_name'] == 'trips' and rec['field_value'] in rail_headsigns
                    and rec['field_value'] not in bus_headsigns):
                continue
            kept.append([rec.get(c, '') for c in th2])
    # Lignes rail d'abord (même ordre que build_bus.py, qui les recopie en tête).
    tr = []
    for s in sorted(stations.values(), key=lambda s: (s.mode != 'metro', s.id)):
        if s.name_ar:
            tr.append(['stops', 'stop_name', 'ar', s.name_ar, s.id, '', ''])
    bus_headsigns = {r[tix['trip_headsign']] for r in trows}
    seen = set()
    for p in patterns.values():
        terminus = stations[p.stop_ids[-1]]
        # Une girouette partagée avec un bus (« Place des Martyrs ») garde sa
        # traduction de bus : même lieu, une seule ligne par libellé.
        if terminus.name in seen or terminus.name in bus_headsigns or not terminus.name_ar:
            continue
        seen.add(terminus.name)
        tr.append(['trips', 'trip_headsign', 'ar', terminus.name_ar, '', '', terminus.name])
    write_csv('translations.txt', th2, tr + kept)


def write_front(stations, patterns):
    def station_json(s):
        return {'id': s.id, 'name': s.name, 'nameAr': s.name_ar, 'lat': round(s.lat, 6),
                'lon': round(s.lon, 6), 'type': s.mode, 'osmNode': s.osm_node}

    def pattern_json(p):
        simple = simplify(p.shape, FRONT_SIMPLIFY_M)
        return {
            'id': p.id,
            'directionId': p.direction_id,
            'headsign': stations[p.stop_ids[-1]].name,
            'stopIds': p.stop_ids,
            'offsetsSec': p.offsets,
            'firstDeparture': hms(p.departures[0])[:5],
            'lastDeparture': hms(p.departures[-1])[:5],
            'headways': pattern_headways(p),
            'shape': [[round(lo, 5), round(la, 5)] for la, lo in simple],
        }

    def network(*parts):
        # Tracé de fond de carte : un trait par portion de voie, sans doublon
        # (tronc + branche pour le métro, le seul sens aller pour le tram).
        out = []
        for pid, from_stop in parts:
            p = patterns[pid]
            shape = p.shape
            if from_stop:
                acc = cumulative(shape)
                shape = cut(shape, acc, p.stop_m[p.stop_ids.index(from_stop)], acc[-1])
            out.append([[round(lo, 5), round(la, 5)] for la, lo in simplify(shape, FRONT_SIMPLIFY_M)])
        return out

    metro = [s for s in stations.values() if s.mode == 'metro']
    tram = [s for s in stations.values() if s.mode == 'tram']
    # Ordre d'affichage : tronc puis branche, puis tram dans l'ordre de la ligne.
    order = patterns['M1-HAR-0'].stop_ids + [i for i in patterns['M1-AIN-0'].stop_ids
                                             if i not in patterns['M1-HAR-0'].stop_ids]
    order += patterns['T1-0'].stop_ids
    assert len(order) == len(metro) + len(tram)
    data = {
        '_generated': 'data/scripts/build_rail.py — NE PAS ÉDITER À LA MAIN',
        'source': {
            'osm': os.path.basename(PBF_DEFAULT),
            'license': 'ODbL — © contributeurs OpenStreetMap',
            'relations': RELATIONS,
        },
        'estimates': {
            'speedKmh': SPEED_KMH,
            'speedSources': {
                'metro': 'El Harrach → Tafourah en 20 min (Maghreb Emergent, 14/06/2015) sur 11,35 km de voie OSM',
                'tram': 'bas de la fourchette 18-22 km/h (MEDDE, « Le renouveau du tramway en France »)',
            },
            'branchSplit': 'alternance supposée sur le tronc commun (répartition non publiée)',
        },
        # Amplitude par ligne (sourcée, voir SERVICE_SOURCES) ; premier et
        # dernier départ PAR SENS dans chaque motif (firstDeparture /
        # lastDeparture). first/last/trunkHeadways au premier niveau : métro
        # (compatibilité).
        'service': {
            'first': mode_service('metro')[0],
            'last': mode_service('metro')[1],
            'trunkHeadways': [{'start': a, 'end': b, 'min': h // 60} for a, b, h in mode_windows('metro')],
            'headwaysSource': SERVICE_SOURCES['headways'],
            'byLine': {
                ROUTES[mode]['route_id']: {
                    'first': mode_service(mode)[0],
                    'last': mode_service(mode)[1],
                    'trunkHeadways': [{'start': a, 'end': b, 'min': h // 60} for a, b, h in mode_windows(mode)],
                    'source': SERVICE_SOURCES[mode],
                }
                for mode in ('metro', 'tram')
            },
        },
        'stations': [station_json(stations[i]) for i in order],
        'lines': [
            {'id': ROUTES['metro']['route_id'],
             'patterns': [pattern_json(patterns[k]) for k in ('M1-HAR-0', 'M1-HAR-1', 'M1-AIN-0', 'M1-AIN-1')],
             'network': network(('M1-HAR-0', None), ('M1-AIN-0', 'M12'))},
            {'id': ROUTES['tram']['route_id'],
             'patterns': [pattern_json(patterns[k]) for k in ('T1-0', 'T1-1')],
             'network': network(('T1-0', None))},
        ],
    }
    with open(FRONT_OUT, 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False, separators=(',', ':'))
        f.write('\n')


def write_reference(stations, patterns):
    ref = {
        '_generated': 'data/scripts/build_rail.py — référence OSM figée pour check_rail.py',
        'osm': os.path.basename(PBF_DEFAULT),
        'relations': RELATIONS,
        'osmStopCount': {pid: len(p.stop_ids) for pid, p in patterns.items()},
        'stations': {s.id: {'osmNode': s.osm_node, 'lat': s.lat, 'lon': s.lon, 'mode': s.mode,
                            'name': s.name, 'nameAr': s.name_ar}
                     for s in stations.values()},
        'trackLengthM': {pid: round(cumulative(p.shape)[-1], 1) for pid, p in patterns.items()},
        'longSegments': {pid: p.long_segments for pid, p in patterns.items()},
    }
    with open(REFERENCE_OUT, 'w', encoding='utf-8') as f:
        json.dump(ref, f, ensure_ascii=False, indent=1)
        f.write('\n')


def main():
    ap = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    ap.add_argument('--pbf', default=PBF_DEFAULT)
    ap.add_argument('--cache', help='JSON intermédiaire (évite de relire le PBF)')
    ap.add_argument('--no-check', action='store_true')
    args = ap.parse_args()

    osm = load_osm(args.pbf, args.cache)
    stations = build_stations(osm)
    patterns = {}
    for pid, mode, direction_id in PATTERNS:
        patterns[pid] = build_pattern(osm, stations, pid, mode, direction_id)
        running_times(patterns[pid])
    used = {s for p in patterns.values() for s in p.stop_ids}
    unused = set(stations) - used
    if unused:
        sys.exit(f'Stations des tables absentes des relations OSM : {sorted(unused)}')
    schedule(patterns)

    write_gtfs(stations, patterns)
    write_front(stations, patterns)
    write_reference(stations, patterns)

    for pid, p in patterns.items():
        L = cumulative(p.shape)[-1]
        print(f'{pid:9s} {len(p.stop_ids):2d} arrêts  {L / 1000:5.2f} km  ~{p.offsets[-1] / 60:4.1f} min  '
              f'{len(p.departures):3d} départs {hms(p.departures[0])[:5]}–{hms(p.departures[-1])[:5]}')
    if not args.no_check:
        subprocess.run([sys.executable, os.path.join(os.path.dirname(__file__), 'check_rail.py')], check=True)


if __name__ == '__main__':
    main()

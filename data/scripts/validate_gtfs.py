#!/usr/bin/env python3
"""Contrôles du GTFS d'Alger (data/gtfs) et des données du front qui en dérivent.

  python3 data/scripts/validate_gtfs.py [--skip-front] [--gtfs DIR] [--today AAAAMMJJ]

Sans dépendance. Code de sortie 1 au premier ensemble d'erreurs ; les
avertissements sont affichés sans faire échouer. À lancer avant chaque
reconstruction du graphe OTP (build_bus.py et build_rail.py le lancent aussi).

Erreurs
  - intégrité référentielle (routes, agences, services, tracés, arrêts,
    tarifs, traductions) ; trajet de moins de deux arrêts ;
  - stop_times : séquences strictement croissantes, heures croissantes,
    shape_dist_traveled croissant ; vitesse entre arrêts plausible ;
  - arrêts : même arrêt répété dans un trajet, deux arrêts consécutifs à
    moins de 30 m (doublon physique) ;
  - deux sens d'une même ligne avec la même suite d'arrêts (ligne 100) ;
  - girouette vide, malformée (« => ») ou sans lettre latine ;
  - tracés : arrêt à plus de MAX_STOP_SHAPE_M de son tracé, projection des
    arrêts non monotone (sens inversé, arrêt mal rangé), débordement après le
    dernier arrêt ou avant le premier (bus), saut droit avec virage brusque
    ou retour sur un point déjà parcouru (artefact d'assemblage) ;
  - calendrier : service qui expire dans moins de 180 jours ;
  - fréquences : frequencies.txt doit être vide (départs explicites, voir
    build_bus.py / build_rail.py) ;
  - front : generated-lines.json et line-shapes.json identiques au GTFS
    (arrêts, noms, girouettes, temps, départs, intervalles, tracés).

Avertissements de qualité (bus), qui n'arrêtent pas le build
  - girouette sans arrêt du même nom à moins de 300 m du dernier arrêt (sauf
    sens listés dans build_bus.TERMINUS_NON_RELEVE, et l'inverse : exception
    devenue inutile) ;
  - premier / dernier arrêt à plus de 150 m du membre stop_entry_only /
    stop_exit_only de la relation OSM (bus-report.json), sauf
    build_bus.TERMINUS_ECART_ACCEPTE ;
  - chiffres différents entre le nom français et sa traduction arabe ;
  - deux arrêts distincts consécutifs portant le même nom ;
  - tarif du métro sans correspondance à quai (metro_flat, transfers=1).
"""
from __future__ import annotations

import argparse
import collections
import csv
import datetime as dt
import json
import math
import os
import re
import sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
GTFS_DEFAULT = os.path.join(ROOT, 'data', 'gtfs')
FRONT_LINES = os.path.join(ROOT, 'web', 'src', 'lib', 'generated-lines.json')
FRONT_SHAPES = os.path.join(ROOT, 'web', 'public', 'data', 'line-shapes.json')
FRONT_RAIL = os.path.join(ROOT, 'web', 'src', 'lib', 'generated-rail.json')

MIN_CALENDAR_DAYS = 180
MAX_STOP_SHAPE_M = 150.0      # erreur (terminus en gare routière : ~100 m)
WARN_STOP_SHAPE_M = 60.0
BACKTRACK_M = 50.0            # recul toléré de la projection d'un arrêt
OVERHANG_M = 300.0            # tracé au-delà du premier/dernier arrêt (bus)
ARTIFACT_SEG_M = 300.0
ARTIFACT_TURN_DEG = 120.0     # un angle droit après un long alignement est une rue réelle
REVISIT_M = 150.0
DUP_STOP_M = 30.0
MAX_SPEED_KMH = {'bus': 60.0, 'rail': 90.0}

errors, warnings = [], []


def err(msg):
    errors.append(msg)


def warn(msg):
    warnings.append(msg)


def read(gtfs, name, required=True):
    path = os.path.join(gtfs, name)
    if not os.path.exists(path):
        if required:
            err(f'{name} absent')
        return []
    with open(path, newline='', encoding='utf-8') as f:
        return list(csv.DictReader(f))


def secs(t):
    h, m, s = t.split(':')
    return int(h) * 3600 + int(m) * 60 + int(s)


def hav(a, b):
    r = 6371008.8
    la1, lo1, la2, lo2 = map(math.radians, (a[0], a[1], b[0], b[1]))
    h = math.sin((la2 - la1) / 2) ** 2 + math.cos(la1) * math.cos(la2) * math.sin((lo2 - lo1) / 2) ** 2
    return 2 * r * math.asin(math.sqrt(h))


def cumulative(line):
    acc = [0.0]
    for a, b in zip(line, line[1:]):
        acc.append(acc[-1] + hav(a, b))
    return acc


def project(pt, line, acc, from_m=0.0):
    """(distance au tracé, abscisse) du premier meilleur point après from_m."""
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
        along = acc[i] + t * (acc[i + 1] - acc[i])
        if along < from_m:
            continue
        d = math.hypot(ax + t * dx, ay + t * dy)
        if d < best[0] - 1e-9:
            best = (d, along)
    return best


def bearing(a, b):
    lat0 = math.radians(a[0])
    return math.degrees(math.atan2((b[0] - a[0]) * 110574.0, (b[1] - a[1]) * 111320.0 * math.cos(lat0)))


def turn(b1, b2):
    d = abs(b2 - b1) % 360
    return 360 - d if d > 180 else d


def shape_artifacts(sid, line):
    """Sauts d'assemblage : segment long + virage brusque, ou retour sur un
    point déjà parcouru (constat K29). Les longs alignements droits d'une
    voie rapide ou d'un tunnel ne sont pas visés."""
    out = []
    grid = collections.defaultdict(list)
    for i, p in enumerate(line):
        grid[(int(p[0] / 0.002), int(p[1] / 0.002))].append(i)
    for i in range(len(line) - 1):
        seg = hav(line[i], line[i + 1])
        if seg <= ARTIFACT_SEG_M:
            continue
        b = bearing(line[i], line[i + 1])
        for j in (i - 1, i + 1):
            if 0 <= j < len(line) - 1 and j != i:
                a1, a2 = (line[j], line[j + 1])
                if hav(a1, a2) < 1:
                    continue
                if turn(b, bearing(a1, a2)) > ARTIFACT_TURN_DEG and hav(a1, a2) > 30:
                    out.append(f'{sid} : segment de {seg:.0f} m (point {i}) avec virage de plus de {ARTIFACT_TURN_DEG:.0f}°')
                    break
        end = line[i + 1]
        ci, cj = int(end[0] / 0.002), int(end[1] / 0.002)
        for gi in (ci - 1, ci, ci + 1):
            for gj in (cj - 1, cj, cj + 1):
                for k in grid.get((gi, gj), ()):
                    if k < i - 5 and hav(end, line[k]) < REVISIT_M and seg > ARTIFACT_SEG_M:
                        out.append(f'{sid} : segment de {seg:.0f} m (point {i}) qui revient sur le point {k}')
                        break
    return sorted(set(out))


def check_gtfs(gtfs, today):
    agency = {a['agency_id']: a for a in read(gtfs, 'agency.txt')}
    routes = {r['route_id']: r for r in read(gtfs, 'routes.txt')}
    stops = {s['stop_id']: s for s in read(gtfs, 'stops.txt')}
    calendar = {c['service_id']: c for c in read(gtfs, 'calendar.txt')}
    trips = {t['trip_id']: t for t in read(gtfs, 'trips.txt')}
    st = collections.defaultdict(list)
    for r in read(gtfs, 'stop_times.txt'):
        st[r['trip_id']].append(r)
    shapes = collections.defaultdict(list)
    shape_dist = collections.defaultdict(list)
    for r in read(gtfs, 'shapes.txt'):
        shapes[r['shape_id']].append((int(r['shape_pt_sequence']), float(r['shape_pt_lat']), float(r['shape_pt_lon']),
                                      r.get('shape_dist_traveled', '')))
    for k, v in list(shapes.items()):
        v.sort()
        shapes[k] = [(la, lo) for _, la, lo, _ in v]
        shape_dist[k] = [float(d) if d else None for _, _, _, d in v]
    fares = {f['fare_id']: f for f in read(gtfs, 'fare_attributes.txt')}
    fare_rules = read(gtfs, 'fare_rules.txt')
    freq = read(gtfs, 'frequencies.txt', required=False)
    translations = read(gtfs, 'translations.txt', required=False)
    feed_info = read(gtfs, 'feed_info.txt', required=False)

    # Intégrité
    for rid, r in routes.items():
        if r['agency_id'] not in agency:
            err(f'routes {rid} : agence {r["agency_id"]} inconnue')
        if not r.get('route_text_color'):
            warn(f'routes {rid} : route_text_color vide')
    for f in fares.values():
        if len(agency) > 1 and f.get('agency_id', '') not in agency:
            err(f'fare_attributes {f["fare_id"]} : agency_id manquant ou inconnu ({len(agency)} agences)')
    for r in fare_rules:
        if r['fare_id'] not in fares:
            err(f'fare_rules : tarif {r["fare_id"]} inconnu')
        if r.get('route_id') and r['route_id'] not in routes:
            err(f'fare_rules : ligne {r["route_id"]} inconnue')
    for rid in routes:
        if not any(r.get('route_id') == rid for r in fare_rules):
            warn(f'{rid} : aucun tarif')
    used_routes = set()
    for tid, t in trips.items():
        used_routes.add(t['route_id'])
        if t['route_id'] not in routes:
            err(f'trips {tid} : ligne {t["route_id"]} inconnue')
        if t['service_id'] not in calendar:
            err(f'trips {tid} : service {t["service_id"]} inconnu')
        if t['shape_id'] and t['shape_id'] not in shapes:
            err(f'trips {tid} : tracé {t["shape_id"]} inconnu')
        if tid not in st or len(st[tid]) < 2:
            err(f'trips {tid} : moins de deux arrêts')
        h = t['trip_headsign'].strip()
        if not h or '=>' in h or not re.search('[A-Za-z]', h):
            err(f'trips {tid} : girouette « {h} » vide, malformée ou sans libellé latin')
    for rid in routes:
        if rid not in used_routes:
            err(f'routes {rid} : aucun trajet')
    for tid in st:
        if tid not in trips:
            err(f'stop_times : trajet {tid} inconnu')
    used_stops = {r['stop_id'] for rows in st.values() for r in rows}
    for sid in used_stops - set(stops):
        err(f'stop_times : arrêt {sid} inconnu')
    for sid in set(stops) - used_stops:
        if stops[sid].get('location_type', '0') in ('', '0'):
            warn(f'stops {sid} « {stops[sid]["stop_name"]} » : jamais desservi')
    for t in translations:
        if t['table_name'] == 'stops' and t['record_id'] not in stops:
            err(f'translations : arrêt {t["record_id"]} inconnu')
        if t['table_name'] == 'trips' and t['field_value'] and not any(x['trip_headsign'] == t['field_value'] for x in trips.values()):
            err(f'translations : girouette « {t["field_value"]} » inconnue')
        if t['language'] == 'ar' and not re.search('[؀-ۿ]', t['translation']):
            err(f'translations : « {t["translation"]} » n\'est pas en arabe')

    # Calendrier
    limit = today + dt.timedelta(days=MIN_CALENDAR_DAYS)
    for sid, c in calendar.items():
        end = dt.datetime.strptime(c['end_date'], '%Y%m%d').date()
        if end < limit:
            err(f'calendar {sid} : expire le {end} (moins de {MIN_CALENDAR_DAYS} jours après le {today})')
    for fi in feed_info:
        if fi.get('feed_end_date'):
            end = dt.datetime.strptime(fi['feed_end_date'], '%Y%m%d').date()
            if end < limit:
                err(f'feed_info : feed_end_date {end} trop proche')
    if freq:
        err(f'frequencies.txt : {len(freq)} lignes ; les départs doivent être explicites (OTP 2.5 et exact_times=0, constat K42)')

    # Trajets : séquences, heures, doublons, vitesses
    patterns = {}
    for tid, rows in st.items():
        if tid not in trips:
            continue
        rows.sort(key=lambda r: int(r['stop_sequence']))
        t = trips[tid]
        mode = 'bus' if routes.get(t['route_id'], {}).get('route_type') == '3' else 'rail'
        seqs = [int(r['stop_sequence']) for r in rows]
        if len(set(seqs)) != len(seqs):
            err(f'{tid} : stop_sequence en double')
        times = [secs(r['departure_time']) for r in rows]
        for r in rows:
            if secs(r['arrival_time']) > secs(r['departure_time']):
                err(f'{tid} : arrivée après départ à {r["stop_id"]}')
        if any(b < a for a, b in zip(times, times[1:])):
            err(f'{tid} : heures décroissantes')
        dists = [r.get('shape_dist_traveled') or '' for r in rows]
        if all(dists):
            dd = [float(x) for x in dists]
            if any(b < a for a, b in zip(dd, dd[1:])):
                err(f'{tid} : shape_dist_traveled décroissant')
        ids = [r['stop_id'] for r in rows]
        key = (t['route_id'], t['direction_id'], t['shape_id'], tuple(ids), tuple(b - a for a, b in zip(times, times[1:])))
        patterns.setdefault(key, (tid, mode, t))
    by_route_dir = collections.defaultdict(set)
    for (rid, did, shape_id, ids, gaps), (tid, mode, t) in patterns.items():
        by_route_dir[rid].add((did, ids))
        pts = [(float(stops[s]['stop_lat']), float(stops[s]['stop_lon'])) for s in ids]
        counts = collections.Counter(ids)
        for s, n in counts.items():
            if n > 1 and not (n == 2 and ids[0] == ids[-1] == s):
                err(f'{tid} : arrêt {s} « {stops[s]["stop_name"]} » répété dans le trajet')
        for i, (a, b) in enumerate(zip(pts, pts[1:])):
            d = hav(a, b)
            if d < DUP_STOP_M:
                err(f'{tid} : arrêts {ids[i]} et {ids[i + 1]} à {d:.0f} m (doublon physique)')
            # Heures arrondies à la minute (bus) : ±30 s à chaque bout.
            slack = 60 if mode == 'bus' else 0
            v = d / max(1, gaps[i] + slack) * 3.6
            if v > MAX_SPEED_KMH[mode]:
                err(f'{tid} : {v:.0f} km/h à vol d\'oiseau entre {ids[i]} et {ids[i + 1]}')
        # Tracé
        if not shape_id:
            if mode == 'bus':
                warn(f'{tid} : sens sans tracé (annoncé « tracé non relevé » par le front)')
            continue
        line = shapes[shape_id]
        acc = cumulative(line)
        pos, positions = 0.0, []
        for s, p in zip(ids, pts):
            d, m = project(p, line, acc, max(0.0, pos - BACKTRACK_M))
            if d > MAX_STOP_SHAPE_M:
                d0, m0 = project(p, line, acc, 0.0)
                if d0 <= MAX_STOP_SHAPE_M:
                    err(f'{tid} ({shape_id}) : arrêt {s} « {stops[s]["stop_name"]} » hors d\'ordre sur le tracé '
                        f'({m0:.0f} m, après {pos:.0f} m)')
                else:
                    err(f'{tid} ({shape_id}) : arrêt {s} « {stops[s]["stop_name"]} » à {d0:.0f} m du tracé')
                continue
            if d > WARN_STOP_SHAPE_M:
                warn(f'{shape_id} : arrêt {s} « {stops[s]["stop_name"]} » à {d:.0f} m du tracé')
            positions.append(m)
            pos = max(pos, m)
        if mode == 'bus' and positions:
            if positions[0] > OVERHANG_M:
                err(f'{shape_id} : le tracé commence {positions[0]:.0f} m avant le premier arrêt')
            if acc[-1] - positions[-1] > OVERHANG_M:
                err(f'{shape_id} : le tracé continue {acc[-1] - positions[-1]:.0f} m après le dernier arrêt')
            sd = shape_dist[shape_id]
            if all(x is not None for x in sd):
                if any(b < a for a, b in zip(sd, sd[1:])):
                    err(f'{shape_id} : shape_dist_traveled décroissant')
                if abs(sd[-1] - acc[-1]) > max(5.0, acc[-1] * 0.002):
                    err(f'{shape_id} : shape_dist_traveled final {sd[-1]:.0f} m ≠ longueur {acc[-1]:.0f} m')
        if mode == 'bus':
            for a in shape_artifacts(shape_id, line):
                err(a)
    for rid, dirs in by_route_dir.items():
        seen = collections.Counter(ids for _, ids in dirs)
        for ids, n in seen.items():
            dids = {d for d, i in dirs if i == ids}
            if len(dids) > 1:
                err(f'{rid} : deux sens avec la même suite d\'arrêts ({ids[0]} → {ids[-1]})')
        if len({d for d, _ in dirs}) < 2 and routes[rid].get('route_type') == '3':
            warn(f'{rid} : un seul sens relevé (champ oneDirection côté front)')
    return {'routes': routes, 'trips': trips, 'st': st, 'stops': stops, 'shapes': shapes}


HEADSIGN_NEAR_M = 300.0
TERMINUS_RELATION_M = 150.0
BUS_REPORT = os.path.join(ROOT, 'data', 'bus-report.json')
AR_DIGITS = str.maketrans('٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹', '01234567890123456789')


def norm_name(v):
    import unicodedata
    v = unicodedata.normalize('NFD', v or '').encode('ascii', 'ignore').decode().lower()
    return re.sub(r'[^a-z0-9]', '', v)


GENERIC_WORDS = {'place', 'gare', 'routiere', 'station', 'cite', 'centre', 'arret', 'avenue', 'boulevard'}


def headsign_tokens(v):
    import unicodedata
    v = unicodedata.normalize('NFD', v or '').encode('ascii', 'ignore').decode().lower()
    words = [w for w in re.split(r'[^a-z0-9]+', v) if len(w) >= 4 and w not in GENERIC_WORDS]
    return words or [norm_name(v)]


def check_bus_quality(gtfs, model):
    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    import build_bus as B
    stops, trips, st = model['stops'], model['trips'], model['st']
    try:
        with open(BUS_REPORT, encoding='utf-8') as f:
            report = json.load(f)
    except FileNotFoundError:
        report = {'directions': []}
    exits = {e['trip_id']: e.get('relation_exit') for e in report.get('directions', [])}
    pts = {sid: (float(s['stop_lat']), float(s['stop_lon'])) for sid, s in stops.items()}
    # Un trajet par sens (ETUSA-12-dir0-0600 → ETUSA-12-dir0).
    by_dir = {}
    for tid, t in trips.items():
        if not t['route_id'].startswith('ETUSA-'):
            continue
        by_dir.setdefault(tid.rsplit('-', 1)[0], tid)
    for key, tid in sorted(by_dir.items()):
        ids = [r['stop_id'] for r in sorted(st[tid], key=lambda r: int(r['stop_sequence']))]
        last = pts[ids[-1]]
        near = [norm_name(s['stop_name']) for sid, s in stops.items() if hav(pts[sid], last) <= HEADSIGN_NEAR_M]
        # Girouette retrouvée près du dernier arrêt (mot significatif), ou
        # dernier arrêt = stop_exit_only de la relation : la girouette nomme
        # alors le quartier où la relation elle-même finit (Hydra, Garidi 2).
        ok = any(tok in n for tok in headsign_tokens(trips[tid]['trip_headsign']) for n in near)
        rel_exit = exits.get(key)
        if rel_exit and hav(last, (rel_exit['lat'], rel_exit['lon'])) <= TERMINUS_RELATION_M:
            ok = True
        if not ok and key not in B.TERMINUS_NON_RELEVE:
            warn(f'{key} : girouette « {trips[tid]["trip_headsign"]} » sans arrêt du même nom à moins de '
                 f'{HEADSIGN_NEAR_M:.0f} m du dernier arrêt « {stops[ids[-1]]["stop_name"]} » '
                 '(terminus non relevé ? l\'ajouter à build_bus.TERMINUS_NON_RELEVE ou STOP_ADDITIONS)')
        if ok and key in B.TERMINUS_NON_RELEVE:
            warn(f'{key} : listé dans TERMINUS_NON_RELEVE mais le dernier arrêt porte la girouette (exception à retirer)')
        # Deux arrêts distincts consécutifs du même nom.
        for a, b in zip(ids, ids[1:]):
            if a != b and stops[a]['stop_name'] == stops[b]['stop_name']:
                warn(f'{key} : deux arrêts consécutifs « {stops[a]["stop_name"]} » ({a}, {b}, '
                     f'{hav(pts[a], pts[b]):.0f} m)')
    # Terminus ↔ membres entry/exit de la relation OSM (bus-report.json).
    for e in report.get('directions', []):
        key = e['trip_id']
        tid = by_dir.get(key)
        if not tid or key in B.TERMINUS_ECART_ACCEPTE:
            continue
        ids = [r['stop_id'] for r in sorted(st[tid], key=lambda r: int(r['stop_sequence']))]
        for field, sid in (('relation_entry', ids[0]), ('relation_exit', ids[-1])):
            m = e.get(field)
            if not m:
                continue
            d = hav(pts[sid], (m['lat'], m['lon']))
            if d > TERMINUS_RELATION_M:
                warn(f'{key} : {"premier" if field == "relation_entry" else "dernier"} arrêt « {stops[sid]["stop_name"]} » '
                     f'à {d:.0f} m du {"stop_entry_only" if field == "relation_entry" else "stop_exit_only"} '
                     f'« {m.get("name")} » (n{m["node"]}) de la relation {e["osm_relation"]}')
    # Chiffres FR ↔ AR (« Station 1 Mai » / « محطة 2 مايو »).
    for t in read(gtfs, 'translations.txt', required=False):
        if t['table_name'] != 'stops' or t['record_id'] not in stops:
            continue
        fr = sorted(int(x) for x in re.findall(r'\d+', stops[t['record_id']]['stop_name']))
        ar = [int(x) for x in re.findall(r'\d+', t['translation'].translate(AR_DIGITS))]
        if re.search(r'(^|\s)أول(\s|$)', t['translation']):  # « 1er Mai » / « أول ماي »
            ar.append(1)
        if fr != sorted(ar):
            warn(f'{t["record_id"]} : chiffres différents entre « {stops[t["record_id"]]["stop_name"]} » et « {t["translation"]} »')
    # Tarif du métro : changement de branche à quai couvert par le même ticket.
    for f in read(gtfs, 'fare_attributes.txt'):
        if f['fare_id'] == 'metro_flat' and (f.get('transfers') != '1' or not f.get('transfer_duration')):
            warn('fare_attributes metro_flat : transfers=1 et transfer_duration attendus (changement de branche du M1 à quai)')


def check_front(gtfs, model):
    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    import build_front_data as F
    F.GTFS = gtfs
    want_lines, want_shapes = F.build()
    try:
        with open(FRONT_LINES, encoding='utf-8') as f:
            have_lines = json.load(f)
        with open(FRONT_SHAPES, encoding='utf-8') as f:
            have_shapes = json.load(f)
    except FileNotFoundError as e:
        err(f'front : {e.filename} absent (lancer build_front_data.py)')
        return
    if have_lines != json.loads(json.dumps(want_lines)):
        hv = {l['id']: l for l in have_lines}
        for l in want_lines:
            h = hv.get(l['id'])
            if h is None:
                err(f'front : ligne {l["id"]} absente de generated-lines.json')
            elif h != json.loads(json.dumps(l)):
                keys = [k for k in set(h) | set(l) if h.get(k) != json.loads(json.dumps(l)).get(k)]
                err(f'front : ligne {l["id"]} différente du GTFS ({", ".join(sorted(keys))}) — relancer build_front_data.py')
        for lid in set(hv) - {l['id'] for l in want_lines}:
            err(f'front : ligne {lid} absente du GTFS')
    if have_shapes != json.loads(json.dumps(want_shapes)):
        err('front : line-shapes.json différent du GTFS — relancer build_front_data.py')
    if any('shape' in d for l in have_lines for d in l['directions']):
        err('front : generated-lines.json embarque encore des tracés (bundle)')
    # Ordre des sens rail : identique à generated-rail.json (lines.ts).
    with open(FRONT_RAIL, encoding='utf-8') as f:
        rail = json.load(f)
    for l in rail['lines']:
        if len(have_shapes.get(l['id'], [])) != len(l['patterns']):
            err(f'front : {l["id"]} : {len(l["patterns"])} sens, {len(have_shapes.get(l["id"], []))} tracés')


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--gtfs', default=GTFS_DEFAULT)
    ap.add_argument('--skip-front', action='store_true')
    ap.add_argument('--today', help='AAAAMMJJ (par défaut : aujourd\'hui)')
    ap.add_argument('-v', '--verbose', action='store_true', help='afficher tous les avertissements')
    a = ap.parse_args()
    today = dt.datetime.strptime(a.today, '%Y%m%d').date() if a.today else dt.date.today()
    model = check_gtfs(a.gtfs, today)
    check_bus_quality(a.gtfs, model)
    if not a.skip_front:
        check_front(a.gtfs, model)
    if warnings:
        print(f'{len(warnings)} avertissement(s)')
        for w in (warnings if a.verbose else warnings[:15]):
            print('  ⚠', w)
        if not a.verbose and len(warnings) > 15:
            print('  … (-v pour tout voir)')
    if errors:
        print(f'{len(errors)} ERREUR(S)')
        for e in errors[:80]:
            print('  ✗', e)
        sys.exit(1)
    print(f'OK : {a.gtfs} ({len(model["routes"])} lignes, {len(model["trips"])} trajets, {len(model["stops"])} arrêts)'
          + ('' if a.skip_front else ' et données du front cohérents.'))


if __name__ == '__main__':
    main()

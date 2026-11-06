#!/usr/bin/env python3
"""Données du front, générées depuis le GTFS (source unique, celle d'OTP).

Rejouable : `python3 data/scripts/build_front_data.py` depuis la racine du
dépôt (aucune dépendance). À relancer après build_bus.py ou build_rail.py.

Sorties
  web/src/lib/generated-lines.json   lignes de BUS, sans tracés : arrêts (id,
                                     noms FR/AR, coordonnées), girouettes FR/AR,
                                     temps estimés par arrêt, premier/dernier
                                     départ, intervalles par plage horaire,
                                     tarif, provenance du tracé.
  web/public/data/line-shapes.json   tracés de TOUTES les lignes (bus, métro,
                                     tram) : shapes[line.id][directionIndex] =
                                     [[lon, lat], …], chargés à la demande par
                                     web/src/lib/line-shapes.ts (hors bundle).
Le métro et le tram gardent leurs métadonnées dans generated-rail.json
(build_rail.py) ; l'ordre de leurs sens y est repris pour line-shapes.json.

Intervalles : déduits des départs EXPLICITES du GTFS (écart entre deux départs
consécutifs du terminus), donc identiques à ce que voit le calculateur. Le
dernier départ officiel est toujours un départ du GTFS : l'écart plus court
qui le précède éventuellement n'est pas présenté comme une fréquence (il est
rattaché à la plage précédente).
Contrôle : `python3 data/scripts/validate_gtfs.py` vérifie la cohérence
front ↔ GTFS.
"""
from __future__ import annotations

import collections
import csv
import json
import math
import os
import re
import sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
GTFS = os.path.join(ROOT, 'data', 'gtfs')
LINES_OUT = os.path.join(ROOT, 'web', 'src', 'lib', 'generated-lines.json')
SHAPES_OUT = os.path.join(ROOT, 'web', 'public', 'data', 'line-shapes.json')
RAIL_FRONT = os.path.join(ROOT, 'web', 'src', 'lib', 'generated-rail.json')

# Tracés du front : Douglas-Peucker à 1 m et 5 décimales (≈ 1,1 m). Au-delà
# (3 m), l'écart avec le tracé d'un itinéraire OTP se voit au zoom maximal.
FRONT_SIMPLIFY_M = 1.0
FRONT_DECIMALS = 5
BUS_SOURCE = 'ETUSA (amplitude et tarif : relevé 2024)'


def read(name):
    path = os.path.join(GTFS, name)
    if not os.path.exists(path):
        return []
    with open(path, newline='', encoding='utf-8') as f:
        return list(csv.DictReader(f))


def secs(t: str) -> int:
    h, m, s = (t.split(':') + ['0', '0'])[:3]
    return int(h) * 3600 + int(m) * 60 + int(s)


def hhmm(t: int) -> str:
    """Heure d'Alger « HH:MM », ramenée dans la journée (00:20 et non 24:20)."""
    t = (t // 60) % 1440
    return f'{t // 60:02d}:{t % 60:02d}'


def hav(a, b):
    r = 6371008.8
    la1, lo1, la2, lo2 = map(math.radians, (a[0], a[1], b[0], b[1]))
    h = math.sin((la2 - la1) / 2) ** 2 + math.cos(la1) * math.cos(la2) * math.sin((lo2 - lo1) / 2) ** 2
    return 2 * r * math.asin(math.sqrt(h))


def simplify(line, tol_m):
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
        if b - a < 2:
            continue
        ax, ay = xy[a]
        bx, by = xy[b]
        dx, dy = bx - ax, by - ay
        l2 = dx * dx + dy * dy
        best, bi = -1.0, -1
        for i in range(a + 1, b):
            px, py = xy[i]
            t = 0.0 if l2 == 0 else max(0.0, min(1.0, ((px - ax) * dx + (py - ay) * dy) / l2))
            d = math.hypot(px - ax - t * dx, py - ay - t * dy)
            if d > best:
                best, bi = d, i
        if best > tol_m:
            keep[bi] = True
            stack += [(a, bi), (bi, b)]
    return [p for p, k in zip(line, keep) if k]


def headway_windows(deps):
    """Départs (s, triés) → [{start, end, min}] : plages d'écart constant,
    fin exclue. L'écart final plus court (dernier départ officiel ajouté hors
    grille) est rattaché à la plage précédente."""
    if len(deps) < 2:
        return []
    gaps = [b - a for a, b in zip(deps, deps[1:])]
    if len(gaps) >= 2 and gaps[-1] < gaps[-2]:
        gaps[-1] = gaps[-2]
    out = []
    for i, g in enumerate(gaps):
        m = int(round(g / 60))
        if out and out[-1]['min'] == m:
            out[-1]['_end'] = deps[i + 1]
        else:
            out.append({'_start': deps[i], '_end': deps[i + 1], 'min': m})
    return [{'start': hhmm(w['_start']), 'end': hhmm(w['_end']), 'min': w['min']} for w in out]


def gtfs_model():
    """Lit le GTFS : par route, par motif (sens), arrêts, temps et départs."""
    routes = {r['route_id']: r for r in read('routes.txt')}
    stops = {s['stop_id']: s for s in read('stops.txt')}
    trips = {t['trip_id']: t for t in read('trips.txt')}
    st = collections.defaultdict(list)
    for r in read('stop_times.txt'):
        st[r['trip_id']].append(r)
    fares = {f['fare_id']: f for f in read('fare_attributes.txt')}
    fare_of = {r['route_id']: fares[r['fare_id']] for r in read('fare_rules.txt') if r['fare_id'] in fares}
    ar_stop, ar_headsign = {}, {}
    for t in read('translations.txt'):
        if t['language'] != 'ar':
            continue
        if t['table_name'] == 'stops' and t['field_name'] == 'stop_name':
            ar_stop[t['record_id']] = t['translation']
        elif t['table_name'] == 'trips' and t['field_name'] == 'trip_headsign':
            ar_headsign[t['field_value']] = t['translation']
    shapes = collections.defaultdict(list)
    for r in read('shapes.txt'):
        shapes[r['shape_id']].append((int(r['shape_pt_sequence']), float(r['shape_pt_lat']), float(r['shape_pt_lon'])))
    shapes = {k: [(la, lo) for _, la, lo in sorted(v)] for k, v in shapes.items()}

    patterns = collections.OrderedDict()
    for tid, rows in st.items():
        t = trips[tid]
        rows.sort(key=lambda r: int(r['stop_sequence']))
        key = (t['route_id'], t['direction_id'], t['trip_headsign'], t['shape_id'], tuple(r['stop_id'] for r in rows))
        dep = secs(rows[0]['departure_time'])
        offs = tuple(secs(r['departure_time']) - dep for r in rows)
        p = patterns.setdefault(key, {'route_id': t['route_id'], 'direction_id': int(t['direction_id']),
                                      'headsign': t['trip_headsign'], 'shape_id': t['shape_id'],
                                      'stops': list(key[4]), 'offsets': set(), 'deps': []})
        p['offsets'].add(offs)
        p['deps'].append(dep)
    return routes, stops, patterns, fare_of, ar_stop, ar_headsign, shapes


def shape_source(shape_id: str) -> str:
    if not shape_id:
        return 'absent'
    return 'deduit' if shape_id.endswith('-deduit') else 'osm'


def front_shape(coords):
    pts = simplify(coords, FRONT_SIMPLIFY_M)
    return [[round(lo, FRONT_DECIMALS), round(la, FRONT_DECIMALS)] for la, lo in pts]


def build():
    routes, stops, patterns, fare_of, ar_stop, ar_headsign, shapes = gtfs_model()
    by_route = collections.defaultdict(list)
    for p in patterns.values():
        if len(p['offsets']) != 1:
            sys.exit(f"{p['route_id']} sens {p['direction_id']} : temps de parcours variables selon le départ, non prévu")
        by_route[p['route_id']].append(p)

    def num(short):
        m = re.match(r'(\d+)', short)
        return (int(m.group(1)) if m else 10 ** 6, short)

    bus_lines, line_shapes = [], {}
    for rid in sorted((r for r in routes if r.startswith('ETUSA-')), key=lambda r: num(routes[r]['route_short_name'])):
        r = routes[rid]
        pats = sorted(by_route[rid], key=lambda p: p['direction_id'])
        if len({p['direction_id'] for p in pats}) != len(pats):
            sys.exit(f'{rid} : plusieurs motifs pour un même sens, non prévu')
        directions, dir_shapes = [], []
        for p in pats:
            deps = sorted(p['deps'])
            offs = next(iter(p['offsets']))
            d = {
                'headsign': p['headsign'],
                'directionId': p['direction_id'],
                'shapeSource': shape_source(p['shape_id']),
                'stops': [],
                'offsetsMin': [o // 60 for o in offs],
                'firstDeparture': hhmm(deps[0]),
                'lastDeparture': hhmm(deps[-1]),
                'headways': headway_windows(deps),
            }
            if p['headsign'] in ar_headsign:
                d['headsignAr'] = ar_headsign[p['headsign']]
            for sid in p['stops']:
                s = stops[sid]
                stop = {'id': sid, 'name': s['stop_name'], 'lat': round(float(s['stop_lat']), 6),
                        'lon': round(float(s['stop_lon']), 6)}
                if sid in ar_stop:
                    stop['nameAr'] = ar_stop[sid]
                d['stops'].append(stop)
            directions.append(d)
            dir_shapes.append(front_shape(shapes[p['shape_id']]) if p['shape_id'] else [])
        fare = fare_of.get(rid)
        first = min(pats, key=lambda p: min(p['deps']))
        last = max(pats, key=lambda p: max(p['deps']))
        line = {
            'id': rid,
            'mode': 'bus',
            'shortName': r['route_short_name'],
            'longName': r['route_long_name'],
            'color': '#' + r['route_color'],
            'textColor': '#' + (r['route_text_color'] or 'FFFFFF'),
        }
        if fare:
            price = float(fare['price'])
            line['fare'] = f'{price:g} DZD'
            line['fareDzd'] = price
        line['hours'] = {'first': hhmm(min(first['deps'])), 'last': hhmm(max(last['deps']))}
        line['headways'] = directions[0]['headways']
        line['source'] = BUS_SOURCE
        line['timesEstimated'] = True
        if len(directions) == 1:
            line['oneDirection'] = True
        line['directions'] = directions
        bus_lines.append(line)
        line_shapes[rid] = dir_shapes

    # Rail : ordre des sens de generated-rail.json (= lines.ts).
    with open(RAIL_FRONT, encoding='utf-8') as f:
        rail = json.load(f)
    for l in rail['lines']:
        line_shapes[l['id']] = [front_shape(shapes[p['id']]) for p in l['patterns']]
    return bus_lines, line_shapes


def dump(obj, path, indent=None):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, 'w', encoding='utf-8') as f:
        if indent is None:
            json.dump(obj, f, ensure_ascii=False, separators=(',', ':'))
        else:
            json.dump(obj, f, ensure_ascii=False, indent=indent)
        f.write('\n')


def main():
    bus_lines, line_shapes = build()
    dump(bus_lines, LINES_OUT, indent=1)
    dump(line_shapes, SHAPES_OUT)
    n_dir = sum(len(l['directions']) for l in bus_lines)
    print(f'{len(bus_lines)} lignes de bus, {n_dir} sens → {os.path.relpath(LINES_OUT, ROOT)} '
          f'({os.path.getsize(LINES_OUT) // 1024} Ko)')
    print(f'{len(line_shapes)} lignes, tracés → {os.path.relpath(SHAPES_OUT, ROOT)} '
          f'({os.path.getsize(SHAPES_OUT) // 1024} Ko)')


if __name__ == '__main__':
    main()

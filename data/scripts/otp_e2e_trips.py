#!/usr/bin/env python3
"""Recette de bout en bout : trajets réels d'Alger, OTP de recette contre production.

  python3 data/scripts/otp_e2e_trips.py --staging http://127.0.0.1:8090/otp \\
      [--prod https://nouri.lounis.dev/api/otp --prod-gtfs DOSSIER_GTFS_DE_PROD] \\
      [--dates 2026-11-09,2027-06-14] [--times 06:00,09:00,22:30] \\
      [--all-patterns] [--only TEXTE] [--json sortie.json]

Stdlib seule. Mêmes paramètres que l'app (web/src/lib/otp.ts : 8 itinéraires,
marche 1,2 m/s, walkReluctance 4, fenêtre 2 h, locale fr). Le proxy public
limite à 60 requêtes/min : les appels à --prod sont espacés d'une seconde.
Construire l'OTP de recette : voir crop_osm_alger.py.

Pour chaque trajet, date et heure, on relève la ligne attendue (trajet direct),
l'heure de départ, l'attente avant de partir, la durée, la marche, et pour
chaque tronçon en transport : vitesse le long du tracé, nombre de points et
plus long segment de legGeometry. Anomalies :
  - droite de plus de 1 km qui n'est PAS un segment du tracé GTFS (les
    alignements réels, Rocade Nord ou RN5, sont des segments du tracé simplifié
    à 1 m) ; un tracé qui n'a pas plus de points que d'arrêts (schématique).
    Les sens sans tracé (shape_id vide : 701 sens 0, 731, 732) sont notés
    « tracé non relevé, annoncé » : le front les signale (isUnmappedShape) ;
  - vitesse hors bornes (SPEED_KMH) ; attente de plus d'une heure ;
  - premier départ de la ligne attendue différent du premier départ du GTFS
    que l'usager peut attraper (attentes fictives d'exact_times=0, K42).

La disponibilité attendue vient de data/gtfs (stop_times) : la ligne doit être
proposée si un de ses départs relie les deux arrêts dans la fenêtre de
recherche. Ainsi, à 22:30, un bus dont le dernier départ est 19:30 ne doit
PAS apparaître, et le métro (dernier départ 23:00) doit apparaître. Si OTP ne
la propose pas parce qu'une autre option arrive plus tôt (66 battue par le
métro), on la redemande seule par son mode : elle doit exister et ne pas
arriver avant la meilleure proposition. Sur la production (ancien GTFS),
seules les anomalies sont signalées.

--all-patterns : en plus, chaque sens de chaque ligne, du premier au dernier
arrêt à 10:00, doit être proposé en direct (arrêts reliés à la voirie).

Code de sortie 1 si la recette (--staging) échoue.
"""
from __future__ import annotations

import argparse
import collections
import csv
import json
import math
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone

ALGIERS = timezone(timedelta(hours=1))
ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
GTFS = os.path.join(ROOT, 'data', 'gtfs')
SEARCH_WINDOW_S = 7200
MAX_SEGMENT_M = 1000.0        # au-delà : droite aberrante dans legGeometry
MAX_WAIT_MIN = 60
SPEED_KMH = {'BUS': (6.0, 45.0), 'SUBWAY': (15.0, 60.0), 'TRAM': (10.0, 40.0)}
LINE_MODE = {'M1': 'SUBWAY', 'T1': 'TRAM'}
CENTRE = (36.7856, 3.0607)    # Place des Martyrs (consigne de recette)
AIRPORT = (36.6910, 3.2154)   # aérogare


def read(name, gtfs=GTFS):
    with open(os.path.join(gtfs, name), newline='', encoding='utf-8') as f:
        return list(csv.DictReader(f))


def shape_segments(gtfs):
    """Paires de points consécutifs des tracés GTFS, à 1e-5° près (précision
    de legGeometry). Un long segment droit qui en fait partie est une voie
    réellement rectiligne (tracé OSM simplifié à 1 m par build_bus.py :
    Route moutonnière, autoroute de l'Est), pas un raccourci schématique."""
    pts = collections.defaultdict(list)
    for r in read('shapes.txt', gtfs):
        pts[r['shape_id']].append((int(r['shape_pt_sequence']),
                                   round(float(r['shape_pt_lat']) * 1e5), round(float(r['shape_pt_lon']) * 1e5)))
    segs = set()
    for v in pts.values():
        v.sort()
        for a, b in zip(v, v[1:]):
            segs.add((a[1:], b[1:]))
            segs.add((b[1:], a[1:]))
    return segs


STOPS = {s['stop_id']: s for s in read('stops.txt')}
ROUTES = {r['route_id']: r for r in read('routes.txt')}
TRIPS = {t['trip_id']: t for t in read('trips.txt')}
_ST = collections.defaultdict(list)
for _r in read('stop_times.txt'):
    _ST[_r['trip_id']].append(_r)
for _rows in _ST.values():
    _rows.sort(key=lambda r: int(r['stop_sequence']))


def sec(hms: str) -> int:
    h, m, s = map(int, hms.split(':'))
    return h * 3600 + m * 60 + s


def coord(ref):
    if isinstance(ref, tuple):
        return ref
    s = STOPS[ref]
    return float(s['stop_lat']), float(s['stop_lon'])


def gtfs_departures(short, board, alight):
    """Heures de passage (s depuis minuit) de `short` à `board` sur un trajet
    qui atteint ensuite `alight`. Une liste vide = la ligne ne relie pas les deux arrêts."""
    out = []
    for tid, rows in _ST.items():
        if ROUTES[TRIPS[tid]['route_id']]['route_short_name'] != short:
            continue
        ids = [r['stop_id'] for r in rows]
        if board in ids and alight in ids and ids.index(board) < ids.index(alight):
            out.append(sec(rows[ids.index(board)]['departure_time']))
    return sorted(out)


# (nom, origine, destination, ligne attendue en direct, arrêt de montée, arrêt de descente)
# Origine/destination : identifiant d'arrêt GTFS (coordonnées du GTFS) ou (lat, lon).
# Ligne attendue None : aucune ligne directe n'est modélisée (sens non relevé).
CASES = [
    ('M1 Place des Martyrs → El Harrach Centre', 'M26', 'M16', 'M1', 'M26', 'M16'),
    ('M1 Grande Poste → Aïn Naâdja (branche)', 'M01', 'M30', 'M1', 'M01', 'M30'),
    ('T1 Ruisseau → Université Bab Ezzouar', 'T01', 'T24', 'T1', 'T01', 'T24'),
    ('T1 Ruisseau → Dergana Centre', 'T01', 'T20', 'T1', 'T01', 'T20'),
    # Le point « aéroport » de la consigne (36.6910, 3.2154) tombe côté pistes,
    # au centroïde de l'aérodrome : aucune voirie publique à distance de marche
    # (OTP : LOCATION_NOT_ACCESSIBLE en recette, PATH_NOT_FOUND en production).
    # L'app vise l'arrêt desservi le plus proche dans l'emprise (geocoding.ts,
    # LARGE_EXTENT_M) : c'est ce point-là que l'on teste pour la ligne 100.
    ('Centre → Aéroport, aérogare (100)', CENTRE, 'B5130875391', '100', 'B3429799436', 'B5130875391'),
    ('Aéroport, aérogare → Centre (100)', 'B5130875391', CENTRE, '100', 'B5130875391', 'B3429799436'),
    ('Centre → centroïde de l\'aérodrome (côté pistes)', CENTRE, AIRPORT, None, None, None),
    ('Birtouta → Centre', 'B4527029581', CENTRE, None, None, None),
    ('Centre → Birtouta (101)', CENTRE, 'B4527029581', '101', 'B2709436847', 'B4527029581'),
    ('16 1er Mai → El Madania', 'B287469933', 'B319619368', '16', 'B287469933', 'B319619368'),
    ('16 El Madania → 1er Mai', 'B319619368', 'B287469933', '16', 'B319619368', 'B287469933'),
    ('88 1er Mai → Hydra (Place Al Smaa)', 'B287469933', 'B1337246343', '88', 'B287469933', 'B1337246343'),
    ('88 Hydra (Place Al Smaa) → 1er Mai', 'B1337246343', 'B287469933', '88', 'B1337246343', 'B287469933'),
    ('66 Bachdjarah → Aïssat Idir', 'B2274503073', 'B5387202986', '66', 'B2274503073', 'B5387202986'),
    ('66 Aïssat Idir → Bachdjarah', 'B5387202986', 'B2274503073', '66', 'B5387202986', 'B2274503073'),
    ('105 Bachdjarah → Baraki', 'B2274503073', 'B5422040731', '105', 'B2274503073', 'B5422040731'),
    ('Baraki → Bachdjarah (105 sens non relevé)', 'B5422040731', 'B2274503073', None, None, None),
    ('Ben Aknoun → Grande Poste', 'B5358485987', 'B3780772966', None, None, None),
]


class Otp:
    def __init__(self, base: str, throttle: float, gtfs: str = GTFS):
        self.base = base.rstrip('/')
        self.known = shape_segments(gtfs)
        # Trajets sans tracé (shape_id vide) : OTP les dessine d'arrêt à arrêt
        # et le front les annonce « tracé non relevé » (isUnmappedShape).
        self.unmapped = {t['trip_id'] for t in read('trips.txt', gtfs) if not t.get('shape_id')}
        self.throttle = throttle
        self.last = 0.0

    def plan(self, frm, to, day, hhmm, mode='TRANSIT,WALK'):
        q = {
            'fromPlace': f'{frm[0]:.6f},{frm[1]:.6f}', 'toPlace': f'{to[0]:.6f},{to[1]:.6f}',
            'date': day, 'time': hhmm, 'mode': mode, 'numItineraries': '8',
            'walkSpeed': '1.2', 'walkReluctance': '4', 'searchWindow': str(SEARCH_WINDOW_S),
            'showIntermediateStops': 'true', 'arriveBy': 'false', 'locale': 'fr',
        }
        url = f'{self.base}/routers/default/plan?{urllib.parse.urlencode(q)}'
        for attempt in range(6):
            wait = self.throttle - (time.monotonic() - self.last)
            if wait > 0:
                time.sleep(wait)
            self.last = time.monotonic()
            try:
                req = urllib.request.Request(url, headers={'User-Agent': 'nouri-e2e-recette'})
                with urllib.request.urlopen(req, timeout=120) as r:
                    return json.load(r)
            except urllib.error.HTTPError as e:
                if e.code in (429, 503) and attempt < 5:
                    time.sleep(float(e.headers.get('Retry-After') or 3))
                    continue
                return {'error': {'message': f'HTTP {e.code}'}}
            except (urllib.error.URLError, TimeoutError) as e:
                if attempt < 2:
                    time.sleep(3)
                    continue
                return {'error': {'message': f'réseau : {e}'}}
        return {'error': {'message': 'abandon'}}


def decode(poly):
    pts, i, lat, lon = [], 0, 0, 0
    while i < len(poly):
        for k in range(2):
            shift = result = 0
            while True:
                b = ord(poly[i]) - 63
                i += 1
                result |= (b & 0x1f) << shift
                shift += 5
                if b < 0x20:
                    break
            d = ~(result >> 1) if result & 1 else result >> 1
            if k == 0:
                lat += d
            else:
                lon += d
        pts.append((lat / 1e5, lon / 1e5))
    return pts


def hav(a, b):
    r = 6371008.8
    la1, lo1, la2, lo2 = map(math.radians, (a[0], a[1], b[0], b[1]))
    h = math.sin((la2 - la1) / 2) ** 2 + math.cos(la1) * math.cos(la2) * math.sin((lo2 - lo1) / 2) ** 2
    return 2 * r * math.asin(math.sqrt(h))


def hm(ms):
    return datetime.fromtimestamp(ms / 1000, ALGIERS).strftime('%H:%M')


def transit(it):
    return [l for l in it['legs'] if l['mode'] != 'WALK']


def in_shape(a, b, known):
    ka = (round(a[0] * 1e5), round(a[1] * 1e5))
    kb = (round(b[0] * 1e5), round(b[1] * 1e5))
    near = [(i, j) for i in (-1, 0, 1) for j in (-1, 0, 1)]
    return any(((ka[0] + i, ka[1] + j), (kb[0] + k, kb[1] + m)) in known for i, j in near for k, m in near)


def leg_info(leg, known, unmapped=frozenset()):
    pts = decode(leg['legGeometry']['points'])
    length = sum(hav(a, b) for a, b in zip(pts, pts[1:]))
    seg = max((hav(a, b) for a, b in zip(pts, pts[1:])), default=0.0)
    # Droite aberrante : long segment qui n'est pas un segment du tracé GTFS
    # (à ±1e-5° près : arrondis de l'encodage polyline aux demi-unités).
    off_shape = max((hav(a, b) for a, b in zip(pts, pts[1:])
                     if hav(a, b) > MAX_SEGMENT_M and not in_shape(a, b, known)), default=0.0)
    n_stops = len(leg.get('intermediateStops') or []) + 2
    minutes = (leg['endTime'] - leg['startTime']) / 60000
    speed = length / 1000 / (minutes / 60) if minutes > 0 else float('inf')
    issues, notes = [], []
    trip = (leg.get('tripId') or '').split(':', 1)[-1]
    if trip in unmapped:
        notes.append(f'{leg.get("routeShortName")} : tracé non relevé, annoncé (droite max {seg:.0f} m)')
    else:
        if off_shape:
            issues.append(f'droite hors tracé {off_shape:.0f} m')
        if len(pts) <= n_stops + 1:
            issues.append('tracé schématique')
    lo, hi = SPEED_KMH.get(leg['mode'], (5.0, 80.0))
    if not lo <= speed <= hi:
        issues.append(f'vitesse {speed:.0f} km/h')
    return {
        'line': leg.get('routeShortName') or leg['mode'], 'mode': leg['mode'],
        'headsign': leg.get('headsign'), 'from': leg['from'].get('name'), 'to': leg['to'].get('name'),
        'dep': hm(leg['startTime']), 'arr': hm(leg['endTime']), 'min': round(minutes),
        'stops': n_stops, 'points': len(pts), 'km': round(length / 1000, 2),
        'max_seg_m': round(seg), 'kmh': round(speed, 1), 'issues': issues, 'notes': notes,
    }


def summarize(it, req_ms, known, unmapped=frozenset()):
    legs = transit(it)
    first = legs[0]
    walk_before = sum(l['duration'] for l in it['legs'][:it['legs'].index(first)]) * 1000
    wait = (first['startTime'] - walk_before - req_ms) / 60000
    infos = [leg_info(l, known, unmapped) for l in legs]
    return {
        'lines': '+'.join(i['line'] for i in infos), 'dep': infos[0]['dep'], 'wait_min': round(wait),
        'duration_min': round(it['duration'] / 60), 'walk_m': round(it.get('walkDistance', 0)),
        'transfers': len(legs) - 1, 'legs': infos,
        'issues': [x for i in infos for x in i['issues']],
        'notes': [x for i in infos for x in i['notes']],
    }


def run_case(otp, case, day, hhmm, gtfs=True, mode='TRANSIT,WALK'):
    known = otp.known
    name, frm, to, line, board, alight = case
    req_ms = int(datetime.strptime(f'{day} {hhmm}', '%Y-%m-%d %H:%M').replace(tzinfo=ALGIERS).timestamp() * 1000)
    res = otp.plan(coord(frm), coord(to), day, hhmm, mode)
    its = (res.get('plan') or {}).get('itineraries') or []
    err = (res.get('error') or {})
    with_transit = [it for it in its if transit(it)]
    direct = [it for it in with_transit if line and [l.get('routeShortName') for l in transit(it)] == [line]]
    best = min(direct or with_transit, key=lambda it: it['endTime'], default=None)
    out = {
        'n_itineraries': len(its), 'walk_only': len(its) - len(with_transit),
        'error': err.get('message') or err.get('msg') or (err.get('id') and str(err['id'])) or None,
        'direct_found': bool(direct), 'best': summarize(best, req_ms, known, otp.unmapped) if best else None,
        'issues': [], 'first_departure': None,
        'lines_seen': sorted({'+'.join(l.get('routeShortName') or l['mode'] for l in transit(it)) for it in with_transit}),
    }
    # Géométrie et vitesse : sur toutes les propositions (une droite dans la
    # 5e proposition reste une droite affichée).
    for it in with_transit:
        sm = summarize(it, req_ms, known, otp.unmapped)
        out['issues'] += [x for x in sm['issues'] if x not in out['issues']]
        out.setdefault('notes', [])
        out['notes'] += [x for x in sm['notes'] if x not in out['notes']]
    if best and out['best']['wait_min'] > MAX_WAIT_MIN:
        out['issues'].append(f'attente {out["best"]["wait_min"]} min')
    # Premier départ de la ligne attendue = premier départ du GTFS que l'usager
    # peut attraper (marche + 30 s de boardSlack) : c'est le contrôle des
    # attentes fictives d'exact_times=0 (constat K42), arrêt par arrêt.
    if direct and gtfs:
        it = min(direct, key=lambda it: transit(it)[0]['startTime'])
        leg = transit(it)[0]
        at_stop = (leg['startTime'] - req_ms) / 1000
        walk_s = sum(l['duration'] for l in it['legs'][:it['legs'].index(leg)])
        b, a = (leg['from'].get('stopId') or '').split(':')[-1], (leg['to'].get('stopId') or '').split(':')[-1]
        h, m = map(int, hhmm.split(':'))
        t0 = h * 3600 + m * 60
        deps = [d for d in gtfs_departures(line, b, a) if d >= t0 + walk_s + 30]
        expected = deps[0] if deps else None
        got = t0 + at_stop
        out['first_departure'] = {'board': leg['from'].get('name'), 'got': hm(leg['startTime']),
                                  'expected': f'{expected // 3600 % 24:02d}:{expected % 3600 // 60:02d}' if expected is not None else None}
        if expected is None or abs(got - expected) > 60:
            out['issues'].append(f'1er départ {out["first_departure"]["got"]} ≠ GTFS {out["first_departure"]["expected"]}')
    return out


def expected_available(case, hhmm):
    _, _, _, line, board, alight = case
    if not line:
        return False
    h, m = map(int, hhmm.split(':'))
    t0 = h * 3600 + m * 60
    # marche jusqu'à l'arrêt comprise : un départ jusqu'à la fin de la fenêtre
    return any(t0 <= d <= t0 + SEARCH_WINDOW_S for d in gtfs_departures(line, board, alight))


def all_patterns(otp, day):
    """Chaque sens relevé, du premier au dernier arrêt : la ligne doit être
    proposée en direct (arrêts bien reliés à la voirie, montée et descente
    possibles), avec un tracé sans droite hors GTFS."""
    seen, fails = {}, []
    for tid, rows in _ST.items():
        t = TRIPS[tid]
        key = (t['route_id'], tuple(r['stop_id'] for r in rows))
        seen.setdefault(key, t)
    print(f'\nTous les sens ({len(seen)} motifs), {day} 10:00 :')
    for (rid, ids), t in sorted(seen.items(), key=lambda kv: (kv[0][0], kv[1]['direction_id'])):
        short = ROUTES[rid]['route_short_name']
        case = (f'{short} → {t["trip_headsign"]}', ids[0], ids[-1], short, ids[0], ids[-1])
        r = run_case(otp, case, day, '10:00', mode=f'{LINE_MODE.get(short, "BUS")},WALK')
        bad = (not r['direct_found']) or r['issues']
        b = r['best']
        note = b and b['notes'] and f'  ({"; ".join(b["notes"])})' or ''
        print(f'{"ÉCHEC" if bad else "OK   "} {short:>4} → {t["trip_headsign"]:<36} {len(ids):>2} arrêts | '
              + (f'{b["lines"]} {b["dep"]} {b["duration_min"]} min, {b["legs"][0]["points"]} points, segment max {b["legs"][0]["max_seg_m"]} m'
                 if b else (r['error'] or 'aucun trajet'))
              + note + (f'  ← {", ".join(r["issues"]) or "ligne absente"}' if bad else ''), flush=True)
        if bad:
            fails.append(f'motif {short} → {t["trip_headsign"]} : {", ".join(r["issues"]) or "ligne absente"}')
    return fails


def cell(r, line):
    if r['best'] is None:
        return (r['error'] or 'aucun trajet') + (f' ({r["walk_only"]} marche seule)' if r['walk_only'] else '')
    b = r['best']
    tag = '' if (not line or r['direct_found']) else f'sans {line} : '
    return f'{tag}{b["lines"]} {b["dep"]} att.{b["wait_min"]} {b["duration_min"]}min' + (' ⚠' if b['issues'] else '')


def main():
    ap = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    ap.add_argument('--staging', required=True)
    ap.add_argument('--prod')
    ap.add_argument('--prod-gtfs', default=GTFS,
                    help='GTFS servi par la production (ses tracés), pour juger ses droites')
    ap.add_argument('--dates', default='2026-11-09,2027-06-14')
    ap.add_argument('--times', default='06:00,09:00,22:30')
    ap.add_argument('--json')
    ap.add_argument('--only', help='ne garder que les trajets dont le nom contient ce texte')
    ap.add_argument('--all-patterns', action='store_true',
                    help='en plus : chaque sens de chaque ligne, du premier au dernier arrêt, à 10:00 (recette seule)')
    args = ap.parse_args()
    # Le proxy public (https) limite le débit ; un OTP local, non. Après la
    # reconstruction du graphe de production, la recette passe par le proxy :
    # --staging https://nouri.lounis.dev/api/otp (seul /plan est utilisé).
    envs = {'recette': Otp(args.staging, 1.05 if args.staging.startswith('https://') else 0.0)}
    if args.prod:
        envs['production'] = Otp(args.prod, 1.05, args.prod_gtfs)
    results, failures = [], []
    for case in CASES:
        name, line = case[0], case[3]
        if args.only and args.only.lower() not in name.lower():
            continue
        for day in args.dates.split(','):
            for hhmm in args.times.split(','):
                row = {'case': name, 'line': line, 'date': day, 'time': hhmm,
                       'expected': expected_available(case, hhmm)}
                for env, otp in envs.items():
                    # La production tourne sur l'ancien GTFS : pas de comparaison aux départs actuels.
                    row[env] = run_case(otp, case, day, hhmm, gtfs=(env == 'recette'))
                r = row['recette']
                verdict = []
                if row['expected'] and not r['direct_found']:
                    # Absente des propositions : OTP l'a-t-il écartée parce qu'une
                    # autre option arrive plus tôt (métro plus rapide que le bus) ?
                    # On la redemande seule, par son mode : elle doit exister et
                    # arriver au plus tôt en même temps que la meilleure proposition.
                    alone = run_case(envs['recette'], case, day, hhmm, mode=f'{LINE_MODE.get(line, "BUS")},WALK')
                    row['line_alone'] = alone
                    best_end = r['best'] and r['best']['legs'][-1]['arr']
                    alone_end = alone['best'] and alone['direct_found'] and alone['best']['legs'][-1]['arr']
                    if not alone_end:
                        verdict.append(f'{line} attendue (GTFS) mais introuvable, même seule')
                    elif best_end and alone_end < best_end:
                        verdict.append(f'{line} arrive à {alone_end}, avant la meilleure proposition ({best_end}), mais omise')
                    else:
                        r['dominated'] = f'{line} seule : {cell(alone, line)}'
                        verdict += [f'{line} seule : ' + x for x in alone['issues']]
                if line and not row['expected'] and r['direct_found']:
                    verdict.append(f'{line} proposée hors des départs du GTFS')
                if r['issues']:
                    verdict.append('anomalies : ' + ', '.join(r['issues']))
                if r['error'] and 'NO_TRANSIT' in str(r['error']).upper():
                    verdict.append('calendrier : ' + r['error'])
                row['verdict'] = verdict
                if verdict:
                    failures.append(f'{name} {day} {hhmm} : {"; ".join(verdict)}')
                results.append(row)
                print(f'{"ÉCHEC" if verdict else "OK   "} {name:<44} {day} {hhmm} '
                      f'| attendu {"oui" if row["expected"] else "non"} '
                      f'| recette : {cell(r, line)}'
                      + (f' | prod : {cell(row["production"], line)}' if 'production' in row else '')
                      + (f' | dominée — {r["dominated"]}' if r.get('dominated') else '')
                      + (f'  ← {"; ".join(verdict)}' if verdict else ''), flush=True)
    if args.all_patterns:
        failures += all_patterns(envs['recette'], args.dates.split(',')[0])
    if args.json:
        with open(args.json, 'w', encoding='utf-8') as f:
            json.dump(results, f, ensure_ascii=False, indent=1)
    print(f'\n{len(failures)} échec(s)' if failures else '\nRecette de bout en bout OK.')
    for f_ in failures:
        print('  - ' + f_)
    sys.exit(1 if failures else 0)


if __name__ == '__main__':
    main()

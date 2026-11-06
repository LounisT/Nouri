#!/usr/bin/env python3
"""Recette des bus ETUSA dans un OpenTripPlanner déjà construit.

  python3 data/scripts/otp_bus_smoke.py [URL_OTP] [AAAA-MM-JJ]

URL_OTP : racine OTP (défaut http://localhost:8080/otp), ou le proxy public
(https://nouri.lounis.dev/api/otp). La date doit être un jour ouvert du
calendrier (défaut : lundi 2026-11-09). Stdlib seule. Lit data/gtfs pour
connaître arrêts, sens et départs attendus.

À lancer après chaque reconstruction du graphe : chaque cas reprend un défaut
constaté par l'audit (navette 100 dans un seul sens, attentes fictives de
20 à 37 min avec exact_times=0, dernier départ introuvable, terminus perdu,
tracés rejetés, ligne 37 incohérente, calendrier expiré).
"""
from __future__ import annotations

import collections
import csv
import json
import math
import os
import sys
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone

BASE = (sys.argv[1] if len(sys.argv) > 1 else 'http://localhost:8080/otp').rstrip('/')
DAY = sys.argv[2] if len(sys.argv) > 2 else '2026-11-09'
ALGIERS = timezone(timedelta(hours=1))
ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
GTFS = os.path.join(ROOT, 'data', 'gtfs')

failures: list[str] = []


def read(name):
    with open(os.path.join(GTFS, name), newline='', encoding='utf-8') as f:
        return list(csv.DictReader(f))


STOPS = {s['stop_id']: s for s in read('stops.txt')}
TRIPS = {t['trip_id']: t for t in read('trips.txt')}
FIRST_STOP, DEPS = {}, collections.defaultdict(list)
_st = collections.defaultdict(list)
for r in read('stop_times.txt'):
    _st[r['trip_id']].append(r)
PATTERN_STOPS = {}
for tid, rows in _st.items():
    rows.sort(key=lambda r: int(r['stop_sequence']))
    t = TRIPS[tid]
    key = tid.rsplit('-', 1)[0] if t['route_id'].startswith('ETUSA-') else t['shape_id']
    PATTERN_STOPS[key] = [r['stop_id'] for r in rows]
    h, m, s = map(int, rows[0]['departure_time'].split(':'))
    DEPS[key].append(h * 3600 + m * 60 + s)


def pos(sid):
    return f'{STOPS[sid]["stop_lat"]},{STOPS[sid]["stop_lon"]}'


def get(path, **q):
    url = f'{BASE}{path}' + (f'?{urllib.parse.urlencode(q)}' if q else '')
    req = urllib.request.Request(url, headers={'User-Agent': 'nouri-bus-smoke'})
    with urllib.request.urlopen(req, timeout=90) as r:
        return json.load(r)


def plan(frm, to, time='09:00', day=DAY, **extra):
    q = {
        'fromPlace': frm, 'toPlace': to, 'date': day, 'time': time,
        'mode': 'TRANSIT,WALK', 'numItineraries': '8', 'walkSpeed': '1.2',
        'searchWindow': '7200', 'showIntermediateStops': 'true', 'arriveBy': 'false',
        'locale': 'fr', **extra,
    }
    return get('/routers/default/plan', **q)


def hm(ms):
    return datetime.fromtimestamp(ms / 1000, ALGIERS).strftime('%H:%M')


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


def check(name, ok, detail=''):
    print(f'{"OK " if ok else "ÉCHEC"} {name}{" — " + detail if detail else ""}')
    if not ok:
        failures.append(name)


def transit(it):
    return [l for l in it['legs'] if l['mode'] != 'WALK']


def direct(res, short):
    """Itinéraires dont le seul tronçon en transport est la ligne `short`."""
    its = (res.get('plan') or {}).get('itineraries') or []
    return [it for it in its if [l.get('routeShortName') for l in transit(it)] == [short]]


def stop_id(place):
    return (place.get('stopId') or '').split(':')[-1]


def boarding_wait_ok(short, pattern, frm, to, time):
    """Le premier départ proposé n'attend pas plus d'un intervalle (au lieu
    des 20 à 37 min fictifs d'exact_times=0) et figure dans le GTFS."""
    res = plan(pos(frm), pos(to), time)
    its = direct(res, short)
    if not its:
        return False, 'aucun trajet direct'
    leg = min((transit(it)[0] for it in its), key=lambda l: l['startTime'])
    deps = sorted(DEPS[pattern])
    h, m = map(int, time.split(':'))
    t0 = h * 3600 + m * 60
    offset = PATTERN_STOPS[pattern].index(frm)
    expected = None
    for d in deps:
        # départ du terminus + temps estimé jusqu'à l'arrêt (stop_times)
        tid = f'{pattern}-{d // 3600:02d}{d % 3600 // 60:02d}'
        row = next(r for r in _st[tid] if r['stop_id'] == frm)
        hh, mm, ss = map(int, row['departure_time'].split(':'))
        at = hh * 3600 + mm * 60 + ss
        if at >= t0:
            expected = at
            break
    got = datetime.fromtimestamp(leg['startTime'] / 1000, ALGIERS)
    got_s = got.hour * 3600 + got.minute * 60
    return (expected is not None and got_s <= expected + 60), f'départ {hm(leg["startTime"])} (attendu ≤ {expected // 3600:02d}:{expected % 3600 // 60:02d})' if expected else 'aucun départ attendu'


def main():
    print(f'OTP {BASE} — {DAY}')
    # 1. Navette 100 dans les deux sens (constats K21/K26/K43/K56/K68).
    safir, airport = 'B3429799436', 'B5130875391'
    for frm, to, label in ((safir, airport, 'Es-Safir → Aéroport'), (airport, safir, 'Aéroport → Es-Safir')):
        res = plan(pos(frm), pos(to), '09:00')
        its = direct(res, '100')
        best = min((it['duration'] for it in its), default=None)
        check(f'100 direct {label}', bool(its), f'{best // 60} min' if best else 'absent')
    # 2. Géométrie de la 100 acceptée par OTP (plus de droite de 15 km).
    try:
        get('/routers/default/index/routes')
        index = True
    except urllib.error.HTTPError as e:
        index = False  # le proxy public n'expose que /plan : contrôles d'index sautés
        print(f'(API /index indisponible : HTTP {e.code} — contrôles de motifs sautés ; interroger OTP directement)')
    pats = get('/routers/default/index/routes/alger:ETUSA-100/patterns') if index else []
    npts = []
    for p in pats:
        g = get(f'/routers/default/index/patterns/{urllib.parse.quote(p["id"])}/geometry')
        npts.append(len(decode(g['points'])))
    if index:
        check('100 : tracés acceptés par OTP', len(pats) == 2 and min(npts) > 100, f'{len(pats)} motifs, points {npts}')
    # 3. Attente bornée par l'intervalle (constat K42).
    for short, pattern, frm, to, time in (
        ('12', 'ETUSA-12-dir0', PATTERN_STOPS['ETUSA-12-dir0'][0], PATTERN_STOPS['ETUSA-12-dir0'][5], '10:00'),
        ('3', 'ETUSA-3-dir0', PATTERN_STOPS['ETUSA-3-dir0'][2], PATTERN_STOPS['ETUSA-3-dir0'][8], '11:05'),
        ('100', 'ETUSA-100-dir1', airport, safir, '12:00'),
        ('604', 'ETUSA-604-dir0', PATTERN_STOPS['ETUSA-604-dir0'][0], PATTERN_STOPS['ETUSA-604-dir0'][6], '10:10'),
    ):
        ok, detail = boarding_wait_ok(short, pattern, frm, to, time)
        check(f'{short} à {time} : premier départ du GTFS', ok, detail)
    # 4. Dernier départ officiel trouvé (constats K51/K73) : 643, 18:00.
    p643 = PATTERN_STOPS['ETUSA-643-dir1']
    res = plan(pos(p643[0]), pos(p643[-1]), '17:45')
    its = direct(res, '643')
    check('643 : dernier départ 18:00 encore proposé à 17:45', any(hm(transit(it)[0]['startTime']) == '18:00' for it in its),
          ', '.join(sorted({hm(transit(it)[0]['startTime']) for it in its})) or 'aucun')
    # 5. Terminus de la 105 retrouvé (constat K61).
    p105 = PATTERN_STOPS['ETUSA-105-dir0']
    res = plan(pos(p105[0]), pos('B5422040731'), '09:00')
    its = direct(res, '105')
    ok = any(stop_id(transit(it)[0]['to']) == 'B5422040731' for it in its)
    check('105 jusqu\'à la Gare Routière de Baraki', ok)
    # 6. 16 sens 1 : plus d'aller-retour fantôme ni de coupe droite (constat K29).
    p16 = PATTERN_STOPS['ETUSA-16-dir1']
    res = plan(pos(p16[0]), pos(p16[-1]), '09:00')
    its = direct(res, '16')
    seg = max((hav(a, b) for it in its for l in transit(it) for a, b in zip(decode(l['legGeometry']['points']),
                                                                          decode(l['legGeometry']['points'])[1:])), default=None)
    check('16 sens El Madania : géométrie continue', bool(its) and seg is not None and seg < 300,
          f'segment max {seg:.0f} m' if seg is not None else 'aucun trajet')
    # 7. Ligne 37 écartée (constats K45/K60).
    routes = get('/routers/default/index/routes') if index else []
    if index:
        check('ligne 37 absente', not any(r.get('shortName') == '37' for r in routes))
    # 8. Calendrier : service au-delà du 31/12/2026 (constats K15/K40/K55/K67).
    res = plan(pos(safir), pos(airport), '09:00', day='2027-01-04')
    check('2027-01-04 : bus proposés', bool(direct(res, '100')), (res.get('error') or {}).get('message', ''))
    # 9. Tous les motifs bus : géométrie exposée, et suivie (plus de points que d'arrêts).
    bad, unmapped = [], []
    for r in routes:
        if not r['id'].startswith('alger:ETUSA-'):
            continue
        for p in get(f'/routers/default/index/routes/{urllib.parse.quote(r["id"])}/patterns'):
            pid = urllib.parse.quote(p['id'])
            stops = get(f'/routers/default/index/patterns/{pid}/stops')
            trip = get(f'/routers/default/index/patterns/{pid}/trips')[0]
            has_shape = bool(TRIPS[trip['id'].split(':', 1)[1]]['shape_id'])
            try:
                n = len(decode(get(f'/routers/default/index/patterns/{pid}/geometry')['points']))
            except urllib.error.HTTPError:
                n = 0  # OTP 2.5 répond 500 pour un motif sans géométrie
            if has_shape and n <= len(stops) + 1:
                bad.append(p['id'])
            if not has_shape:
                unmapped.append(p['id'])
    if index:
        check('motifs bus avec tracé : géométrie OTP = tracé (pas de droites)', not bad, ', '.join(bad))
    print(f'    (sens sans tracé, annoncés par le front : {", ".join(unmapped) or "aucun"})')
    print(f'\n{len(failures)} échec(s)' if failures else '\nTout est OK.')
    sys.exit(1 if failures else 0)


if __name__ == '__main__':
    main()

#!/usr/bin/env python3
"""Contrôles du GTFS rail (métro M1, tramway T1) et de sa copie côté front.

`python3 data/scripts/check_rail.py` depuis la racine du dépôt (stdlib seule).
Sort en erreur au premier lot de défauts. Lancé en fin de build_rail.py ; à
relancer avant tout zip du GTFS et toute reconstruction du graphe OTP.

Référence : data/rail-reference.json (figée par build_rail.py depuis OSM,
rapprochement par identifiant de nœud, jamais par nom).

Contrôles
  - stations : mêmes identifiants, noms et coordonnées que la référence OSM ;
    autant d'arrêts par sens que dans les relations OSM ;
  - tracés : chaque arrêt à moins de 30 m du tracé de son trajet, dans l'ordre
    (abscisses strictement croissantes) ; aucun segment de plus de 200 m qui ne
    soit un alignement droit d'un way OSM recensé (pas de saut) ;
  - horaires : temps croissants, vitesses plausibles, départs dans l'amplitude,
    intervalles conformes aux fenêtres (tronc du métro et tram) ;
  - flux : calendrier valide au moins 180 jours, aucun arrêt rail orphelin,
    aucune fréquence rail résiduelle ;
  - front : web/src/lib/generated-rail.json identique au GTFS (arrêts, ordre,
    temps, tracés à moins de 2 m).
"""
from __future__ import annotations

import csv
import json
import math
import os
import sys
from datetime import date, timedelta

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
GTFS = os.path.join(ROOT, 'data', 'gtfs')
REFERENCE = os.path.join(ROOT, 'data', 'rail-reference.json')
FRONT = os.path.join(ROOT, 'web', 'src', 'lib', 'generated-rail.json')

RAIL_ROUTES = {'L1-metro', 'L1-tram'}
MAX_STOP_TO_SHAPE_M = 30.0
MAX_SHAPE_GAP_M = 200.0
MIN_CALENDAR_DAYS = 180
SPEED_RANGE_KMH = (10.0, 80.0)
# Amplitude PAR SENS (premier, dernier départ du terminus, inclus), comme
# build_rail.SERVICE : métro 05:00-23:00 (OSM, 4 relations du M1) ; tram
# 05:30-22:20 depuis Ruisseau et 05:30-22:00 depuis Dergana Centre (SETRAM
# 09/2025 et 11/2025, OSM relation 6545828). Dupliquée ici exprès : le
# contrôle ne doit pas relire les constantes qu'il contrôle.
H = 3600
AMPLITUDE = {
    'M1-HAR-0': (5 * H, 23 * H), 'M1-HAR-1': (5 * H, 23 * H),
    'M1-AIN-0': (5 * H, 23 * H), 'M1-AIN-1': (5 * H, 23 * H),
    'T1-0': (5 * H + 30 * 60, 22 * H + 20 * 60),
    'T1-1': (5 * H + 30 * 60, 22 * H),
}
WINDOWS = [(5, 7, 600), (7, 9, 300), (9, 17, 600), (17, 21, 300), (21, 23, 600)]

errors: list[str] = []


def fail(msg: str):
    errors.append(msg)


def hav(a, b):
    r = 6371008.8
    la1, lo1, la2, lo2 = map(math.radians, (a[0], a[1], b[0], b[1]))
    h = math.sin((la2 - la1) / 2) ** 2 + math.cos(la1) * math.cos(la2) * math.sin((lo2 - lo1) / 2) ** 2
    return 2 * r * math.asin(math.sqrt(h))


def project(pt, line, from_m=0.0):
    lat0 = math.radians(pt[0])
    kx, ky = 111320.0 * math.cos(lat0), 110574.0
    best, acc = (float('inf'), 0.0), 0.0
    for i in range(len(line) - 1):
        seg = hav(line[i], line[i + 1])
        ax, ay = (line[i][1] - pt[1]) * kx, (line[i][0] - pt[0]) * ky
        bx, by = (line[i + 1][1] - pt[1]) * kx, (line[i + 1][0] - pt[0]) * ky
        dx, dy = bx - ax, by - ay
        l2 = dx * dx + dy * dy
        t = 0.0 if l2 == 0 else max(0.0, min(1.0, -(ax * dx + ay * dy) / l2))
        along = acc + t * seg
        d = math.hypot(ax + t * dx, ay + t * dy)
        if along >= from_m and d < best[0] - 1e-9:
            best = (d, along)
        acc += seg
    return best


def secs(t: str) -> int:
    h, m, s = map(int, t.split(':'))
    return h * 3600 + m * 60 + s


def rows(name):
    path = os.path.join(GTFS, name)
    if not os.path.exists(path):
        return []
    with open(path, newline='', encoding='utf-8') as f:
        return list(csv.DictReader(f))


def main():
    ref = json.load(open(REFERENCE, encoding='utf-8'))
    stops = {r['stop_id']: r for r in rows('stops.txt')}
    trips = [r for r in rows('trips.txt') if r['route_id'] in RAIL_ROUTES]
    trip_ids = {t['trip_id'] for t in trips}
    st = {}
    for r in rows('stop_times.txt'):
        if r['trip_id'] in trip_ids:
            st.setdefault(r['trip_id'], []).append(r)
    for v in st.values():
        v.sort(key=lambda r: int(r['stop_sequence']))
    shapes = {}
    for r in rows('shapes.txt'):
        shapes.setdefault(r['shape_id'], []).append(
            (int(r['shape_pt_sequence']), float(r['shape_pt_lat']), float(r['shape_pt_lon'])))
    shapes = {k: [(la, lo) for _, la, lo in sorted(v)] for k, v in shapes.items()}

    # ── Stations ↔ référence OSM ──────────────────────────────────────────
    rail_stops = {k: v for k, v in stops.items() if len(k) == 3 and k[0] in 'MT' and k[1:].isdigit()}
    if set(rail_stops) != set(ref['stations']):
        fail(f'stations GTFS ≠ référence : en trop {sorted(set(rail_stops) - set(ref["stations"]))}, '
             f'manquantes {sorted(set(ref["stations"]) - set(rail_stops))}')
    for sid, rs in ref['stations'].items():
        s = rail_stops.get(sid)
        if not s:
            continue
        d = hav((float(s['stop_lat']), float(s['stop_lon'])), (rs['lat'], rs['lon']))
        if d > 1.0:
            fail(f'{sid} {s["stop_name"]} : {d:.1f} m de son nœud OSM {rs["osmNode"]}')
        if s['stop_name'] != rs['name']:
            fail(f'{sid} : nom « {s["stop_name"]} » ≠ référence « {rs["name"]} »')
    counts = {m: sum(1 for v in ref['stations'].values() if v['mode'] == m) for m in ('metro', 'tram')}
    print(f'stations : métro {counts["metro"]}, tram {counts["tram"]} (référence OSM)')

    # ── Motifs, tracés, ordre ─────────────────────────────────────────────
    patterns = {}
    for t in trips:
        seq = tuple(r['stop_id'] for r in st.get(t['trip_id'], []))
        p = patterns.setdefault(t['shape_id'], {'seq': seq, 'trips': [], 'route': t['route_id'],
                                                'direction': t['direction_id'], 'headsign': t['trip_headsign']})
        if p['seq'] != seq:
            fail(f'{t["trip_id"]} : séquence différente des autres trajets du tracé {t["shape_id"]}')
        p['trips'].append(t)
    if set(patterns) != set(ref['osmStopCount']):
        fail(f'tracés rail {sorted(patterns)} ≠ relations OSM {sorted(ref["osmStopCount"])}')
    for pid, p in patterns.items():
        if len(p['seq']) != ref['osmStopCount'].get(pid):
            fail(f'{pid} : {len(p["seq"])} arrêts, OSM en compte {ref["osmStopCount"].get(pid)}')
        if p['headsign'] != stops[p['seq'][-1]]['stop_name']:
            fail(f'{pid} : headsign « {p["headsign"]} » ≠ terminus « {stops[p["seq"][-1]]["stop_name"]} »')
        shape = shapes.get(pid)
        if not shape:
            fail(f'{pid} : aucun tracé dans shapes.txt')
            continue
        last, worst = -1.0, 0.0
        for sid in p['seq']:
            s = stops[sid]
            d, m = project((float(s['stop_lat']), float(s['stop_lon'])), shape, max(last, 0.0))
            worst = max(worst, d)
            if d > MAX_STOP_TO_SHAPE_M:
                fail(f'{pid} : {s["stop_name"]} à {d:.0f} m du tracé')
            if m <= last:
                fail(f'{pid} : ordre non monotone à {s["stop_name"]} ({m:.0f} m ≤ {last:.0f} m)')
            last = m
        known = ref['longSegments'].get(pid, [])
        for i in range(len(shape) - 1):
            length = hav(shape[i], shape[i + 1])
            if length <= MAX_SHAPE_GAP_M:
                continue
            ok = any(hav(shape[i], k['from']) < 1 and hav(shape[i + 1], k['to']) < 1 for k in known)
            if not ok:
                fail(f'{pid} : saut de {length:.0f} m (points {i}-{i + 1}) hors des ways OSM')
        total = sum(hav(shape[i], shape[i + 1]) for i in range(len(shape) - 1))
        print(f'{pid:9s} {len(p["seq"]):2d} arrêts, tracé {total / 1000:5.2f} km, '
              f'{len(shape)} points, écart max arrêt↔tracé {worst:4.1f} m, {len(known)} alignements > 200 m (ways OSM)')

        # ── Horaires ──────────────────────────────────────────────────────
        deps = []
        for t in p['trips']:
            times = [secs(r['departure_time']) for r in st[t['trip_id']]]
            if any(b < a for a, b in zip(times, times[1:])):
                fail(f'{t["trip_id"]} : temps décroissants')
            deps.append(times[0])
            first, last = AMPLITUDE.get(pid, (5 * H, 23 * H))
            if not first <= times[0] <= last:
                fail(f'{t["trip_id"]} : départ {times[0] // 3600:02d}:{times[0] % 3600 // 60:02d} hors amplitude')
        t0 = p['trips'][0]['trip_id']
        times = [secs(r['departure_time']) for r in st[t0]]
        for a, b, x, y in zip(p['seq'], p['seq'][1:], times, times[1:]):
            dist = hav((float(stops[a]['stop_lat']), float(stops[a]['stop_lon'])),
                       (float(stops[b]['stop_lat']), float(stops[b]['stop_lon'])))
            if y == x:
                fail(f'{pid} : temps nul entre {a} et {b}')
                continue
            kmh = dist / (y - x) * 3.6
            # Vitesse à vol d'oiseau, donc ≤ vitesse sur voie : borne basse large.
            if not (SPEED_RANGE_KMH[0] * 0.5 <= kmh <= SPEED_RANGE_KMH[1]):
                fail(f'{pid} : {a}→{b} à {kmh:.0f} km/h à vol d\'oiseau')
        p['deps'] = sorted(deps)
        # Tram : chaque terminus ouvre à l'heure sourcée (le métro alterne ses
        # branches sur le tronc : seule l'amplitude du tronc est vérifiée).
        if pid.startswith('T1') and p['deps'] and p['deps'][0] != AMPLITUDE[pid][0]:
            fail(f'{pid} : premier départ {p["deps"][0] // 3600:02d}:{p["deps"][0] % 3600 // 60:02d} ≠ amplitude sourcée')
        if pid.startswith('T1') and p['deps'] and AMPLITUDE[pid][1] - p['deps'][-1] > 600:
            fail(f'{pid} : dernier départ {p["deps"][-1] // 3600:02d}:{p["deps"][-1] % 3600 // 60:02d} '
                 'trop tôt avant la fin d\'amplitude sourcée')

    def check_gaps(label, deps, factor=1, slack=60):
        def window(t):
            return next((hw for s, e, hw in WINDOWS if s * 3600 <= t < e * 3600), 600)

        for a, b in zip(deps, deps[1:]):
            # À la bascule pointe → creux, l'écart peut prendre le pas de la
            # fenêtre suivante (alternance des branches).
            h = max(window(a), window(b)) * factor
            if b - a > h + slack:
                fail(f'{label} : {b - a} s entre {a // 3600:02d}:{a % 3600 // 60:02d} et le départ suivant (attendu ≤ {h} s)')

    if all(k in patterns for k in ('M1-HAR-0', 'M1-AIN-0', 'M1-HAR-1', 'M1-AIN-1', 'T1-0', 'T1-1')):
        trunk_out = sorted(patterns['M1-HAR-0']['deps'] + patterns['M1-AIN-0']['deps'])
        check_gaps('M1 tronc (Place des Martyrs)', trunk_out)
        # Retour : passages à Haï El Badr (M12), point de jonction des branches.
        heb = []
        for pid in ('M1-HAR-1', 'M1-AIN-1'):
            for t in patterns[pid]['trips']:
                r = next(r for r in st[t['trip_id']] if r['stop_id'] == 'M12')
                heb.append(secs(r['departure_time']))
        heb.sort()
        check_gaps('M1 tronc retour (Haï El Badr)', heb, slack=120)
        for pid in ('M1-HAR-0', 'M1-AIN-0', 'M1-HAR-1', 'M1-AIN-1'):
            check_gaps(pid, patterns[pid]['deps'], factor=2, slack=120)
        for pid in ('T1-0', 'T1-1'):
            check_gaps(pid, patterns[pid]['deps'])
        if len(trunk_out) != len(set(trunk_out)):
            fail('M1 : deux départs simultanés de Place des Martyrs')

    # ── Flux ──────────────────────────────────────────────────────────────
    served = {r['stop_id'] for v in st.values() for r in v}
    orphan = set(rail_stops) - served
    if orphan:
        fail(f'arrêts rail sans aucun passage : {sorted(orphan)}')
    if any(r['trip_id'] in trip_ids for r in rows('frequencies.txt')):
        fail('frequencies.txt contient encore des trajets rail')
    used_services = {r['service_id'] for r in rows('trips.txt')}
    horizon = date.today() + timedelta(days=MIN_CALENDAR_DAYS)
    for c in rows('calendar.txt'):
        if c['service_id'] in used_services:
            end = date(int(c['end_date'][:4]), int(c['end_date'][4:6]), int(c['end_date'][6:]))
            if end < horizon:
                fail(f'calendar.txt : {c["service_id"]} expire le {end} (< aujourd\'hui + {MIN_CALENDAR_DAYS} j)')
    for s in used_services - {c['service_id'] for c in rows('calendar.txt')}:
        fail(f'service {s} utilisé mais absent de calendar.txt')

    # ── Front ─────────────────────────────────────────────────────────────
    front = json.load(open(FRONT, encoding='utf-8'))
    fst = {s['id']: s for s in front['stations']}
    if set(fst) != set(rail_stops):
        fail('generated-rail.json : stations différentes du GTFS')
    for sid, s in fst.items():
        g = rail_stops.get(sid)
        if g and (s['name'] != g['stop_name']
                  or hav((s['lat'], s['lon']), (float(g['stop_lat']), float(g['stop_lon']))) > 0.5):
            fail(f'generated-rail.json : {sid} diffère de stops.txt')
        if not s.get('nameAr'):
            fail(f'generated-rail.json : {sid} sans nom arabe')
    # Amplitude par ligne côté front (lines.ts : « Ouvert · dernier départ »).
    by_line = front.get('service', {}).get('byLine', {})
    for lid, pids in (('L1-metro', ('M1-HAR-0', 'M1-HAR-1', 'M1-AIN-0', 'M1-AIN-1')), ('L1-tram', ('T1-0', 'T1-1'))):
        svc = by_line.get(lid)
        if not svc:
            fail(f'generated-rail.json : service.byLine.{lid} absent')
            continue
        lo = min(AMPLITUDE[p][0] for p in pids)
        hi = max(AMPLITUDE[p][1] for p in pids)
        want = (f'{lo // 3600:02d}:{lo % 3600 // 60:02d}', f'{hi // 3600:02d}:{hi % 3600 // 60:02d}')
        if (svc.get('first'), svc.get('last')) != want:
            fail(f'generated-rail.json : amplitude {lid} {svc.get("first")}–{svc.get("last")} ≠ {want[0]}–{want[1]}')
        if not svc.get('source'):
            fail(f'generated-rail.json : amplitude {lid} sans source')
    # Noms arabes du rail dans translations.txt (flux publié trilingue).
    tr = {r['record_id']: r['translation'] for r in rows('translations.txt') if r['table_name'] == 'stops'}
    missing_ar = sorted(sid for sid in rail_stops if sid in fst and fst[sid].get('nameAr') and tr.get(sid) != fst[sid]['nameAr'])
    if missing_ar:
        fail(f'translations.txt : nom arabe absent ou différent pour {missing_ar[:6]}{"…" if len(missing_ar) > 6 else ""}')
    for line in front['lines']:
        for fp in line['patterns']:
            p = patterns.get(fp['id'])
            if not p:
                fail(f'generated-rail.json : motif {fp["id"]} absent du GTFS')
                continue
            if tuple(fp['stopIds']) != p['seq']:
                fail(f'generated-rail.json : {fp["id"]} ordre des arrêts ≠ GTFS')
            t0 = p['trips'][0]['trip_id']
            times = [secs(r['departure_time']) for r in st[t0]]
            if [x - times[0] for x in times] != fp['offsetsSec']:
                fail(f'generated-rail.json : {fp["id"]} temps ≠ stop_times')
            shape = shapes[fp['id']]
            off = max(project((la, lo), shape)[0] for lo, la in fp['shape'])
            if off > 2.0:
                fail(f'generated-rail.json : tracé {fp["id"]} à {off:.1f} m du GTFS')
            first = f'{p["deps"][0] // 3600:02d}:{p["deps"][0] % 3600 // 60:02d}'
            last = f'{p["deps"][-1] // 3600:02d}:{p["deps"][-1] % 3600 // 60:02d}'
            if (fp['firstDeparture'], fp['lastDeparture']) != (first, last):
                fail(f'generated-rail.json : {fp["id"]} premier/dernier départ ≠ GTFS')

    if errors:
        print(f'\n{len(errors)} défaut(s) :', file=sys.stderr)
        for e in errors[:60]:
            print('  - ' + e, file=sys.stderr)
        sys.exit(1)
    print('OK : GTFS rail et generated-rail.json cohérents avec OSM.')


if __name__ == '__main__':
    main()

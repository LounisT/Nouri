#!/usr/bin/env python3
"""Recette du métro et du tram dans un OpenTripPlanner déjà construit.

  python3 data/scripts/otp_rail_smoke.py [URL_OTP] [AAAA-MM-JJ]

URL_OTP : racine OTP (défaut http://localhost:8080/otp), ou le proxy public
(https://nouri.lounis.dev/api/otp). La date doit être un jour ouvert du
calendrier (défaut : lundi 2026-11-09). Stdlib seule.

À lancer après chaque reconstruction du graphe : chaque cas reprend un défaut
constaté par l'audit (stations inventées, branche absente, tram en droites,
départs espacés de la durée du trajet, calendrier expiré).
"""
from __future__ import annotations

import json
import math
import os
import sys
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone

BASE = (sys.argv[1] if len(sys.argv) > 1 else 'http://localhost:8080/otp').rstrip('/')
DAY = sys.argv[2] if len(sys.argv) > 2 else '2026-11-09'
ALGIERS = timezone(timedelta(hours=1))
ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
REF = json.load(open(os.path.join(ROOT, 'data', 'rail-reference.json'), encoding='utf-8'))
ST = REF['stations']

failures: list[str] = []


def pos(sid):
    return f'{ST[sid]["lat"]},{ST[sid]["lon"]}'


def plan(frm, to, time='09:00', day=DAY, **extra):
    q = {
        'fromPlace': frm, 'toPlace': to, 'date': day, 'time': time,
        'mode': 'TRANSIT,WALK', 'numItineraries': '8', 'walkSpeed': '1.2',
        'searchWindow': '7200', 'showIntermediateStops': 'true', 'arriveBy': 'false',
        'locale': 'fr', **extra,
    }
    url = f'{BASE}/routers/default/plan?{urllib.parse.urlencode(q)}'
    req = urllib.request.Request(url, headers={'User-Agent': 'nouri-rail-smoke'})
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.load(r)


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


def transit_legs(it):
    return [l for l in it['legs'] if l['mode'] != 'WALK']


def first_transit(res, mode):
    """Premier itinéraire dont le premier tronçon en transport est `mode`."""
    for it in res.get('plan', {}).get('itineraries', []):
        legs = transit_legs(it)
        if legs and legs[0]['mode'] == mode:
            return it, legs[0]
    return None, None


def check(label, cond, detail=''):
    print(('OK   ' if cond else 'ÉCHEC') + f' {label}' + (f' — {detail}' if detail else ''))
    if not cond:
        failures.append(label)


def access_walk(it):
    legs = it['legs']
    return legs[0]['distance'] if legs and legs[0]['mode'] == 'WALK' else 0.0


def main():
    print(f'OTP {BASE}, {DAY}')

    # 1. Place des Martyrs : la station existe (avant : 1,7 km à pied jusqu'à Tafourah).
    it, leg = first_transit(plan(pos('M26'), pos('M16')), 'SUBWAY')
    check('Place des Martyrs → El Harrach Centre : montée à Place des Martyrs',
          bool(leg) and leg['from']['name'] == ST['M26']['name'] and access_walk(it) < 100,
          f'{leg["from"]["name"]}, marche {access_walk(it):.0f} m' if leg else 'aucun métro')

    # 2. Branche Aïn Naâdja desservie (avant : 3,3 km à pied jusqu'à Haï El Badr).
    it, leg = first_transit(plan(pos('M30'), pos('M01')), 'SUBWAY')
    check('Aïn Naâdja → Tafourah : M1 direct depuis Aïn Naâdja',
          bool(leg) and leg['from']['name'] == ST['M30']['name'] and leg['to']['name'] == ST['M01']['name'],
          f'{leg["from"]["name"]} → {leg["to"]["name"]}' if leg else 'aucun métro')

    # 3. Plus de station fantôme « El Magharia ».
    res = plan('36.7285,3.1025', pos('M01'))
    names = {l['from']['name'] for i in res.get('plan', {}).get('itineraries', []) for l in i['legs']}
    names |= {s['name'] for i in res.get('plan', {}).get('itineraries', []) for l in i['legs']
              for s in l.get('intermediateStops') or []}
    check('Aucune station « El Magharia » ni « Mohamed Belouizdad »',
          not ({'El Magharia', 'Mohamed Belouizdad'} & names))

    # 4. Les Fusillés → El Harrach Gare : 5 arrêts intermédiaires (avant : 7, dont 2 inventés).
    it, leg = first_transit(plan(pos('M07'), pos('M15')), 'SUBWAY')
    inter = [s['name'] for s in (leg or {}).get('intermediateStops') or []]
    check('Les Fusillés → El Harrach Gare : 5 arrêts intermédiaires', len(inter) == 5, ', '.join(inter))

    # 5. Départs au pas de l'intervalle, pas de la durée du trajet (constat K42).
    res = plan(pos('M01'), pos('M16'))
    deps = sorted({transit_legs(i)[0]['startTime'] for i in res.get('plan', {}).get('itineraries', [])
                   if transit_legs(i) and transit_legs(i)[0]['mode'] == 'SUBWAY'
                   and transit_legs(i)[0]['to']['name'] == ST['M16']['name']})
    gaps = [(b - a) / 60000 for a, b in zip(deps, deps[1:])]
    check('Tafourah → El Harrach Centre à 09:00 : 1er départ ≤ 09:25, puis ~20 min (branche)',
          bool(deps) and hm(deps[0]) <= '09:25' and all(g <= 21 for g in gaps),
          f'départs {[hm(d) for d in deps]}')

    # 6. Tram : l'arrêt de l'USTHB existe.
    it, leg = first_transit(plan(pos('T24'), pos('T02')), 'TRAM')
    check('Université de Bab Ezzouar → Les Fusillés : montée directe',
          bool(leg) and leg['from']['name'] == ST['T24']['name'] and access_walk(it) < 100,
          f'{leg["from"]["name"]}, marche {access_walk(it):.0f} m' if leg else 'aucun tram')

    # 7. Tram : Polyclinique → Ben Mered = 4 arrêts intermédiaires, tracé sur la voie.
    it, leg = first_transit(plan(pos('T17'), pos('T18')), 'TRAM')
    inter = [s['name'] for s in (leg or {}).get('intermediateStops') or []]
    check('Polyclinique → Ben Mered : 4 arrêts intermédiaires', len(inter) == 4, ', '.join(inter))

    # 8. Tram de bout en bout : géométrie qui suit la voie (aucun segment > 1600 m,
    #    seuil « tracé non relevé » du front ; chaque point à < 30 m des arrêts suivis).
    it, leg = first_transit(plan(pos('T01'), pos('T20')), 'TRAM')
    if leg:
        pts = decode(leg['legGeometry']['points'])
        longest = max(hav(a, b) for a, b in zip(pts, pts[1:]))
        check('Ruisseau → Dergana Centre : géométrie de voie (segment max < 1600 m)',
              longest < 1600 and len(pts) > 200, f'{len(pts)} points, segment max {longest:.0f} m')
        far = max(min(hav((ST[s]['lat'], ST[s]['lon']), p) for p in pts)
                  for s in ST if s.startswith('T'))
        check('Tous les arrêts du tram à < 30 m de la géométrie OTP', far < 30, f'max {far:.1f} m')
    else:
        check('Ruisseau → Dergana Centre en tram', False)

    # 9. Ben Mrabet (absent avant) : marche courte.
    it, leg = first_transit(plan(pos('T32'), pos('T14')), 'TRAM')
    check('Ben Mrabet → Tamaris : montée à Ben Mrabet', bool(leg) and access_walk(it) < 100,
          f'{leg["from"]["name"]}, marche {access_walk(it):.0f} m' if leg else 'aucun tram')

    # 10. Entre branches : correspondance à Haï El Badr.
    res = plan(pos('M29'), pos('M15'))
    it = next((i for i in res.get('plan', {}).get('itineraries', [])
               if [l['mode'] for l in transit_legs(i)] == ['SUBWAY', 'SUBWAY']), None)
    check('Gué de Constantine → El Harrach Gare : correspondance à Haï El Badr',
          bool(it) and transit_legs(it)[0]['to']['name'] == ST['M12']['name'],
          ' → '.join(f'{l["from"]["name"]}>{l["to"]["name"]}' for l in transit_legs(it)) if it else 'pas de M1+M1')

    # 11. Calendrier : le service continue après le 31/12/2026 (constat K15/K40).
    res = plan(pos('M01'), pos('M16'), day='2027-01-04')
    it, leg = first_transit(res, 'SUBWAY')
    check('4 janvier 2027 : métro toujours proposé', bool(leg),
          (res.get('error') or {}).get('message', '') if not leg else hm(leg['startTime']))

    # 12. Dernier départ des terminus à 23:00 inclus (avant : 22:50), rien après.
    res = plan(pos('M26'), pos('M16'), time='22:45', searchWindow='3600')
    deps = sorted({hm(l['startTime']) for i in res.get('plan', {}).get('itineraries', [])
                   for l in transit_legs(i) if l['mode'] == 'SUBWAY' and l['from']['name'] == ST['M26']['name']})
    check('Place des Martyrs après 22:45 : dernier métro à 23:00', bool(deps) and deps[-1] == '23:00',
          f'départs {deps}')

    # 13. Tarif M1 ↔ M1 : le changement de branche à quai (Haï El Badr) ne fait
    #     pas repayer — un seul ticket (50 DA), pas deux (constat R14 ;
    #     fare_attributes metro_flat transfers=1). Un produit qui couvre
    #     plusieurs tronçons (legIndices) n'est compté qu'une fois.
    res = plan(pos('M29'), pos('M15'))
    it = next((i for i in res.get('plan', {}).get('itineraries', [])
               if [l['mode'] for l in transit_legs(i)] == ['SUBWAY', 'SUBWAY']), None)
    if it:
        products = [p for e in (it.get('fare') or {}).get('legProducts') or [] for p in e.get('products') or [] if e.get('legIndices')]
        seen, cents = set(), 0
        for e in (it.get('fare') or {}).get('legProducts') or []:
            for p in e.get('products') or []:
                key = (p.get('id'), tuple(e.get('legIndices') or ()))
                if key not in seen and e.get('legIndices'):
                    seen.add(key)
                    cents += p['amount']['cents']
        metro = [p for p in products if 'metro_flat' in p.get('id', '')]
        check('Gué de Constantine → El Harrach Gare (M1 + M1) : un seul ticket, 5000 centimes',
              cents == 5000 and len({tuple(e.get('legIndices') or ()) for e in it['fare']['legProducts']
                                     if any('metro_flat' in p.get('id', '') for p in e.get('products') or [])}) == 1,
              f'{cents} centimes, {len(metro)} produit(s) metro_flat')
    else:
        check('Gué de Constantine → El Harrach Gare (M1 + M1) : itinéraire', False, 'pas de M1+M1')

    # 14. Tram : amplitude SETRAM — dernier départ 22:20 de Ruisseau, 22:00 de
    #     Dergana Centre (constat R45 ; avant : trams jusqu'à 23:00).
    res = plan(pos('T02'), pos('T11'), time='22:00', searchWindow='7200', mode='TRAM,WALK')
    deps = sorted({hm(l['startTime']) for i in res.get('plan', {}).get('itineraries', [])
                   for l in transit_legs(i) if l['mode'] == 'TRAM'})
    check('Les Fusillés → Cinq Maisons après 22:00 : aucun tram après ~22:25 (dernier départ 22:20 de Ruisseau, ~2 min avant)',
          all(d <= '22:25' for d in deps), f'départs {deps}')

    if failures:
        print(f'\n{len(failures)} échec(s)', file=sys.stderr)
        sys.exit(1)
    print('\nRecette rail OK')


if __name__ == '__main__':
    main()

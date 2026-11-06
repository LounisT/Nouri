#!/usr/bin/env python3
"""Extrait OSM réduit au Grand Alger, pour construire un OTP de recette léger.

  python3 data/scripts/crop_osm_alger.py data/algeria-260228.osm.pbf /tmp/otp/alger.osm.pbf [MARGE_KM]

(dépendance : pip install osmium ; ~5 min, ~30 Mo en sortie). Le graphe de
production reste construit sur l'Algérie entière ; cet extrait sert seulement
à vérifier un GTFS modifié SANS toucher au conteneur de production. Mesuré le
05/11/2026 : construire l'Algérie entière dans un second conteneur, à côté de
la production (2,8 Go) et des builds Next, provoque un OOM global ; l'extrait
se construit en ~3 min avec -Xmx2g.

  cp data/{router-config,otp-config}.json data/start-otp.sh /tmp/otp/
  jq '.osm=[{"source":"alger.osm.pbf"}]' data/build-config.json > /tmp/otp/build-config.json
  (cd data/gtfs && zip -q -X /tmp/otp/gtfs-alger.zip *.txt)
  docker run -d --name otp-recette -p 127.0.0.1:18080:8080 -v /tmp/otp:/var/opentripplanner \
    --memory=2600m --oom-score-adj=1000 -e JAVA_OPTS=-Xmx2g \
    --entrypoint /bin/sh opentripplanner/opentripplanner:2.5.0 /var/opentripplanner/start-otp.sh
  python3 data/scripts/otp_rail_smoke.py http://127.0.0.1:18080/otp
  python3 data/scripts/otp_bus_smoke.py http://127.0.0.1:18080/otp
  python3 data/scripts/otp_e2e_trips.py --staging http://127.0.0.1:18080/otp

--oom-score-adj=1000 : en cas de manque de mémoire, c'est la recette que le
noyau tue, jamais l'OTP de production.

Emprise : rectangle englobant TOUS les arrêts de data/gtfs/stops.txt, élargi
de MARGE_KM (défaut 5 km). L'ancien rectangle fixe (2.85–3.35 E) coupait les
arrêts de Zéralda (2.841 E) et de Reghaïa (3.381 E) : OTP ne pouvait plus les
relier à la voirie et la recette passait à côté. Les ways à cheval sur la
limite sont écartés (nœuds hors zone) : sans effet à 5 km des arrêts. Les
relations ne sont pas reprises (restrictions de tourner, multipolygones) :
la marche à pied et le réseau de transport n'en dépendent pas.
"""
import csv
import math
import os
import sys

import osmium
import osmium.index

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
STOPS = os.path.join(ROOT, 'data', 'gtfs', 'stops.txt')


def bbox_from_stops(margin_km: float):
    with open(STOPS, newline='', encoding='utf-8') as f:
        rows = list(csv.DictReader(f))
    lats = [float(r['stop_lat']) for r in rows]
    lons = [float(r['stop_lon']) for r in rows]
    dlat = margin_km / 111.2
    dlon = margin_km / (111.2 * math.cos(math.radians(sum(lats) / len(lats))))
    return min(lats) - dlat, min(lons) - dlon, max(lats) + dlat, max(lons) + dlon


def main(src: str, dst: str, margin_km: float = 5.0):
    south, west, north, east = bbox_from_stops(margin_km)
    print(f'emprise : {south:.4f},{west:.4f} → {north:.4f},{east:.4f} (marge {margin_km} km)')
    # IdSet (bitmap) plutôt qu'un set Python : quelques Mo au lieu de ~300.
    keep = osmium.index.IdSet()
    counts = {'nodes': 0, 'ways': 0}
    writer = osmium.SimpleWriter(dst)

    class Crop(osmium.SimpleHandler):
        def node(self, n):
            loc = n.location
            if loc.valid() and south <= loc.lat <= north and west <= loc.lon <= east:
                keep.set(n.id)
                counts['nodes'] += 1
                writer.add_node(n)

        def way(self, w):
            refs = [nd.ref for nd in w.nodes]
            if refs and all(keep.get(r) for r in refs):
                counts['ways'] += 1
                writer.add_way(w)

    Crop().apply_file(src)
    writer.close()
    print(f'{counts["nodes"]} nœuds, {counts["ways"]} ways conservés → {dst}')


if __name__ == '__main__':
    if len(sys.argv) not in (3, 4):
        sys.exit(__doc__)
    main(sys.argv[1], sys.argv[2], float(sys.argv[3]) if len(sys.argv) == 4 else 5.0)

#!/usr/bin/env bash
# Vérifie le domaine itinéraires (lib/otp.ts, lib/geocoding.ts, proxy /api/otp)
# contre un OTP RÉEL, sans build Next : transpile les modules dans un dossier
# temporaire puis lance les contrôles sous plusieurs fuseaux (diaspora).
#
# Usage : OTP=http://172.18.0.2:8080 web/scripts/itin/check.sh [--no-photon]
#   OTP : URL du serveur OTP (sans /otp). En prod : IP du conteneur alger-otp
#         (sudo docker inspect -f '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}' alger-otp).
set -euo pipefail
HERE=$(cd "$(dirname "$0")" && pwd)
WEB=$(cd "$HERE/../.." && pwd)
OUT=$(mktemp -d)
trap 'rm -rf "$OUT"' EXIT

cat > "$OUT/tsconfig.json" <<EOF
{
  "compilerOptions": {
    "target": "es2020", "module": "commonjs", "esModuleInterop": true, "resolveJsonModule": true,
    "skipLibCheck": true, "strict": true, "outDir": "$OUT/build", "rootDir": "$WEB/src",
    "lib": ["es2020", "dom"], "types": ["node"], "typeRoots": ["$WEB/node_modules/@types"]
  },
  "files": ["$WEB/src/lib/otp.ts", "$WEB/src/lib/geocoding.ts", "$WEB/src/app/api/otp/[...path]/route.ts"]
}
EOF
(cd "$WEB" && npx tsc -p "$OUT/tsconfig.json" >/dev/null) || true   # erreurs d'autres fichiers en cours : on teste ce qui est émis

export BUILD="$OUT/build" NODE_PATH="$WEB/node_modules" OTP="${OTP:-http://localhost:8080}"
for tz in Africa/Algiers America/Montreal Asia/Dubai; do
  echo "### TZ=$tz"
  TZ=$tz node "$HERE/check-search.js"
done
node "$HERE/check-failures.js"
node "$HERE/check-proxy.js"
if [ "${1:-}" != "--no-photon" ]; then node "$HERE/check-geocoding.js"; fi

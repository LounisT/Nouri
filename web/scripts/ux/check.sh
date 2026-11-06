#!/usr/bin/env bash
# Contrôles du domaine UX / i18n (sans build Next) : transpile les modules purs
# dans un dossier temporaire puis lance check-i18n.js sous plusieurs fuseaux.
# Usage : web/scripts/ux/check.sh
set -euo pipefail
HERE=$(cd "$(dirname "$0")" && pwd)
WEB=$(cd "$HERE/../.." && pwd)
OUT=$(mktemp -d)
trap 'rm -rf "$OUT"' EXIT

cat > "$OUT/tsconfig.json" <<JSON
{
  "compilerOptions": {
    "target": "es2020", "module": "commonjs", "esModuleInterop": true, "resolveJsonModule": true,
    "skipLibCheck": true, "strict": true, "outDir": "$OUT/build", "rootDir": "$WEB/src",
    "lib": ["es2020", "dom"], "types": ["node"], "typeRoots": ["$WEB/node_modules/@types"],
    "jsx": "react-jsx", "baseUrl": "$WEB", "paths": { "@/*": ["src/*"] }
  },
  "files": [
    "$WEB/src/lib/i18n.ts", "$WEB/src/lib/locale-script.ts", "$WEB/src/lib/report.ts",
    "$WEB/src/lib/service-area.ts", "$WEB/src/hooks/useRecentSearches.ts"
  ]
}
JSON
(cd "$WEB" && npx tsc -p "$OUT/tsconfig.json" >/dev/null) || true
# Alias « @/ » → dossier émis.
cat > "$OUT/alias.js" <<JS
const Module = require('module')
const orig = Module._resolveFilename
Module._resolveFilename = function (request, ...rest) {
  if (request.startsWith('@/')) request = '$OUT/build/' + request.slice(2)
  return orig.call(this, request, ...rest)
}
JS
export BUILD="$OUT/build" NODE_PATH="$WEB/node_modules"
for tz in Africa/Algiers America/Montreal Asia/Dubai; do
  echo "### TZ=$tz"
  TZ=$tz node -r "$OUT/alias.js" "$HERE/check-i18n.js"
done

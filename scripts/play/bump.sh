#!/usr/bin/env bash
# Incrémente le versionCode (et, si demandé, le versionName) de l'app Android.
#
#   scripts/play/bump.sh                 # versionCode +1, versionName inchangé
#   scripts/play/bump.sh --name 1.0.1    # versionCode +1 et versionName 1.0.1
#   scripts/play/bump.sh --dry-run       # montre ce qui changerait, n'écrit rien
#
# Fichiers modifiés (ils doivent toujours rester d'accord entre eux) :
#   android/twa-manifest.json   appVersionCode, appVersion (= versionName)
#   android/app/build.gradle    versionCode, versionName
#   android/manifest-checksum.txt  empreinte SHA-1 de twa-manifest.json : sans
#       elle, « bubblewrap build » croit le manifeste modifié et réclame un
#       « bubblewrap update » avant de construire.
#
# Ne construit rien, n'envoie rien, n'appelle aucune API. Google Play refuse un
# versionCode déjà utilisé, même par une version supprimée : on ne le baisse jamais.
#
# ANDROID_DIR permet de viser une copie du dossier android/ (tests).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
ANDROID_DIR="${ANDROID_DIR:-$ROOT/android}"
MANIFEST="$ANDROID_DIR/twa-manifest.json"
GRADLE="$ANDROID_DIR/app/build.gradle"
CHECKSUM="$ANDROID_DIR/manifest-checksum.txt"

NEW_NAME=""
DRY_RUN=0
while [ $# -gt 0 ]; do
  case "$1" in
    --name)
      [ $# -ge 2 ] || { echo "ERREUR : --name attend une valeur (ex. 1.0.1)" >&2; exit 2; }
      NEW_NAME="$2"; shift 2 ;;
    --dry-run) DRY_RUN=1; shift ;;
    -h|--help) sed -n '2,19p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "ERREUR : option inconnue « $1 » (voir --help)" >&2; exit 2 ;;
  esac
done

if [ -n "$NEW_NAME" ] && ! printf '%s' "$NEW_NAME" | grep -Eq '^[0-9]+(\.[0-9]+){1,3}([-+][0-9A-Za-z.]+)?$'; then
  echo "ERREUR : versionName « $NEW_NAME » invalide (attendu : 1.0.1, 1.2, 2.0.0-beta1…)" >&2
  exit 2
fi
for f in "$MANIFEST" "$GRADLE" "$CHECKSUM"; do
  [ -f "$f" ] || { echo "ERREUR : fichier introuvable : $f" >&2; exit 1; }
done

# Valeurs actuelles, lues dans chaque fichier.
M_CODE="$(sed -nE 's/^[[:space:]]*"appVersionCode":[[:space:]]*([0-9]+).*/\1/p' "$MANIFEST")"
M_NAME="$(sed -nE 's/^[[:space:]]*"appVersion":[[:space:]]*"([^"]*)".*/\1/p' "$MANIFEST")"
G_CODE="$(sed -nE 's/^[[:space:]]*versionCode[[:space:]]+([0-9]+)[[:space:]]*$/\1/p' "$GRADLE")"
G_NAME="$(sed -nE 's/^[[:space:]]*versionName[[:space:]]+"([^"]*)"[[:space:]]*$/\1/p' "$GRADLE")"

# Chaque valeur doit exister une seule fois, et les deux fichiers concorder.
[ "$(printf '%s\n' "$M_CODE" | grep -c .)" = 1 ] || { echo "ERREUR : appVersionCode introuvable ou multiple dans $MANIFEST" >&2; exit 1; }
[ "$(printf '%s\n' "$M_NAME" | grep -c .)" = 1 ] || { echo "ERREUR : appVersion introuvable ou multiple dans $MANIFEST" >&2; exit 1; }
[ "$(printf '%s\n' "$G_CODE" | grep -c .)" = 1 ] || { echo "ERREUR : versionCode introuvable ou multiple dans $GRADLE" >&2; exit 1; }
[ "$(printf '%s\n' "$G_NAME" | grep -c .)" = 1 ] || { echo "ERREUR : versionName introuvable ou multiple dans $GRADLE" >&2; exit 1; }
if [ "$M_CODE" != "$G_CODE" ] || [ "$M_NAME" != "$G_NAME" ]; then
  echo "ERREUR : les fichiers ne concordent pas (manifest $M_CODE/$M_NAME, gradle $G_CODE/$G_NAME)." >&2
  echo "Corrige-les à la main avant de continuer." >&2
  exit 1
fi

OLD_CODE="$M_CODE"
NEW_CODE=$((OLD_CODE + 1))
TARGET_NAME="${NEW_NAME:-$M_NAME}"

echo "versionCode : $OLD_CODE -> $NEW_CODE"
echo "versionName : $M_NAME -> $TARGET_NAME"
if [ "$DRY_RUN" = 1 ]; then
  echo "(simulation : aucun fichier modifié)"
  exit 0
fi

# Écritures dans des fichiers temporaires, puis remplacement : un échec en cours
# de route ne laisse pas deux fichiers à moitié modifiés.
TMP_M="$(mktemp)"; TMP_G="$(mktemp)"
trap 'rm -f "$TMP_M" "$TMP_G"' EXIT

sed -E \
  -e "s/^([[:space:]]*\"appVersionCode\":[[:space:]]*)[0-9]+/\1$NEW_CODE/" \
  -e "s/^([[:space:]]*\"appVersion\":[[:space:]]*\")[^\"]*(\")/\1$TARGET_NAME\2/" \
  "$MANIFEST" > "$TMP_M"
sed -E \
  -e "s/^([[:space:]]*versionCode[[:space:]]+)[0-9]+/\1$NEW_CODE/" \
  -e "s/^([[:space:]]*versionName[[:space:]]+\")[^\"]*(\")/\1$TARGET_NAME\2/" \
  "$GRADLE" > "$TMP_G"

# Relecture avant d'écraser quoi que ce soit.
grep -Eq "^[[:space:]]*\"appVersionCode\":[[:space:]]*$NEW_CODE\b" "$TMP_M" || { echo "ERREUR : écriture du manifeste non vérifiée" >&2; exit 1; }
grep -Eq "^[[:space:]]*versionCode[[:space:]]+$NEW_CODE[[:space:]]*$" "$TMP_G" || { echo "ERREUR : écriture de build.gradle non vérifiée" >&2; exit 1; }

cat "$TMP_M" > "$MANIFEST"
cat "$TMP_G" > "$GRADLE"
# Même algorithme que bubblewrap (SHA-1 du contenu), sans retour à la ligne final.
printf '%s' "$(sha1sum "$MANIFEST" | cut -d' ' -f1)" > "$CHECKSUM"

echo "Fichiers mis à jour : twa-manifest.json, app/build.gradle, manifest-checksum.txt"
echo "Rien n'est construit. Suite : « bubblewrap build » dans android/ (clé d'import : /etc/nouri/upload-keystore.env), puis scripts/play/publish.py."

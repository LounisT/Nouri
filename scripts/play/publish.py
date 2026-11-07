#!/usr/bin/env python3
"""Envoie l'AAB de Nouri sur une piste Google Play, en BROUILLON.

Par défaut : piste « alpha » (test fermé), statut « draft », et SIMULATION —
l'AAB est bien envoyé dans une édition et la piste est préparée, l'édition est
validée par Google, puis SUPPRIMÉE : rien n'est enregistré. Seul --commit
enregistre l'édition. Même avec --commit, la version reste un brouillon : elle
n'est jamais envoyée à l'examen d'ici (il faut la « Déployer » dans Play
Console, ou changer exprès le statut avec --status).

    # simulation (ne change rien côté Play)
    ~/tools/play-venv/bin/python scripts/play/publish.py

    # enregistre le brouillon sur la piste alpha
    ~/tools/play-venv/bin/python scripts/play/publish.py --commit

La clé de service est lue dans GOOGLE_APPLICATION_CREDENTIALS
(/etc/nouri/play-service-account.json par défaut) ; elle n'est jamais affichée.
Le package est fixé à dev.lounis.nouri : une autre fiche ne peut pas être visée.
"""
import argparse
import json
import os
import sys
from pathlib import Path

from google.oauth2 import service_account
from googleapiclient.discovery import build
from googleapiclient.errors import HttpError
from googleapiclient.http import MediaFileUpload

PACKAGE = 'dev.lounis.nouri'  # définitif, volontairement non paramétrable
ROOT = Path(__file__).resolve().parents[2]
DEFAULT_AAB = ROOT / 'android' / 'app-release-bundle.aab'
TWA_MANIFEST = ROOT / 'android' / 'twa-manifest.json'
KEY = os.environ.get('GOOGLE_APPLICATION_CREDENTIALS', '/etc/nouri/play-service-account.json')

# Texte « Nouveautés » par langue (500 caractères maximum chacune). Honnête :
# c'est une version de test, sans promesse de temps réel.
DEFAULT_NOTES = {
    'fr-FR': 'Première version de test de Nouri : métro, tramway et bus d’Alger, avec des horaires estimés (~) et sans temps réel.',
    'ar': 'النسخة التجريبية الأولى من «نوري»: مترو وترامواي وحافلات الجزائر العاصمة، بمواعيد تقديرية (~) ودون زمن حقيقي.',
    'en-US': 'First test version of Nouri: Algiers metro, tram and buses, with estimated times (~) and no real-time data.',
}


def fail(message: str) -> None:
    print(f'ERREUR : {message}', file=sys.stderr)
    sys.exit(1)


def http_error(e: HttpError) -> str:
    try:
        err = json.loads(e.content.decode())['error']
        return f"HTTP {e.resp.status} {err.get('status', '')} - {err.get('message', '')}"
    except Exception:
        return f'HTTP {e.resp.status}'


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('--aab', type=Path, default=DEFAULT_AAB, help='AAB à envoyer')
    parser.add_argument('--track', default='alpha', help='piste (alpha = test fermé ; internal, beta, production)')
    parser.add_argument('--status', default='draft', choices=['draft', 'completed', 'inProgress', 'halted'],
                        help='statut de la version (draft par défaut : pas d’examen)')
    parser.add_argument('--commit', action='store_true', help='enregistre l’édition (sinon : simulation)')
    args = parser.parse_args()

    if args.track == 'production' and args.status != 'draft':
        fail('refus de publier en production par ce script : garde --status draft et déploie depuis Play Console.')
    if not args.aab.is_file():
        fail(f'AAB introuvable : {args.aab}')
    version_code = json.loads(TWA_MANIFEST.read_text())['appVersionCode']
    version_name = json.loads(TWA_MANIFEST.read_text()).get('appVersion', '')

    creds = service_account.Credentials.from_service_account_file(
        KEY, scopes=['https://www.googleapis.com/auth/androidpublisher'])
    service = build('androidpublisher', 'v3', credentials=creds, cache_discovery=False)
    edits = service.edits()

    mode = 'ENREGISTREMENT' if args.commit else 'SIMULATION'
    print(f'{mode} — {PACKAGE} versionCode {version_code} ({version_name}) -> piste « {args.track} », statut {args.status}')

    edit_id = None
    try:
        edit_id = edits.insert(packageName=PACKAGE, body={}).execute()['id']

        media = MediaFileUpload(str(args.aab), mimetype='application/octet-stream', resumable=True)
        bundle = edits.bundles().upload(packageName=PACKAGE, editId=edit_id, media_body=media).execute()
        uploaded = bundle['versionCode']
        print(f'AAB envoyé : versionCode {uploaded}, sha256 {bundle.get("sha256", "?")[:16]}…')
        if uploaded != version_code:
            fail(f'versionCode de l’AAB ({uploaded}) différent de twa-manifest.json ({version_code}).')

        release = {
            'name': f'{version_code} ({version_name})',
            'versionCodes': [str(uploaded)],
            'status': args.status,
            'releaseNotes': [{'language': lang, 'text': text} for lang, text in DEFAULT_NOTES.items()],
        }
        edits.tracks().update(
            packageName=PACKAGE, editId=edit_id, track=args.track,
            body={'track': args.track, 'releases': [release]}).execute()
        print(f'Piste « {args.track} » préparée.')

        edits.validate(packageName=PACKAGE, editId=edit_id).execute()
        print('Validation Google : OK')

        if args.commit:
            # Pas de changesNotSentForReview ici : une version « draft » n'est de
            # toute façon pas envoyée à l'examen.
            edits.commit(packageName=PACKAGE, editId=edit_id).execute()
            edit_id = None  # commité : plus rien à supprimer
            print('Édition enregistrée. Ouvre Play Console > Tests fermés pour la relire et la déployer.')
        else:
            print('Simulation terminée : l’édition va être supprimée, rien n’est enregistré.')
    except HttpError as e:
        fail(http_error(e))
    finally:
        if edit_id:
            try:
                edits.delete(packageName=PACKAGE, editId=edit_id).execute()
            except HttpError:
                pass


if __name__ == '__main__':
    main()

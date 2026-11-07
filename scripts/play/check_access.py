#!/usr/bin/env python3
"""Vérifie en lecture seule que la clé de service peut ouvrir une édition Play.

edits.insert puis edits.delete sur dev.lounis.nouri : rien n'est validé (pas de
commit), aucune donnée de la fiche n'est modifiée. N'affiche jamais la clé.

    ~/tools/play-venv/bin/python scripts/play/check_access.py
"""
import json
import os
import sys

from google.oauth2 import service_account
from googleapiclient.discovery import build
from googleapiclient.errors import HttpError

PACKAGE = 'dev.lounis.nouri'
KEY = os.environ.get('GOOGLE_APPLICATION_CREDENTIALS', '/etc/nouri/play-service-account.json')

creds = service_account.Credentials.from_service_account_file(
    KEY, scopes=['https://www.googleapis.com/auth/androidpublisher'])
service = build('androidpublisher', 'v3', credentials=creds, cache_discovery=False)

try:
    edit = service.edits().insert(packageName=PACKAGE, body={}).execute()
    print('edits.insert OK, id =', edit['id'])
    service.edits().delete(packageName=PACKAGE, editId=edit['id']).execute()
    print('edits.delete OK (aucune modification enregistrée)')
except HttpError as e:
    try:
        err = json.loads(e.content.decode())['error']
        print('HTTP', e.resp.status, err.get('status'), '-', err.get('message'))
    except Exception:
        print('HTTP', e.resp.status)
    sys.exit(1)

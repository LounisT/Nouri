# Intégrité et signature — Nouri (`dev.lounis.nouri`)

Vérifié le 2026-11-07. Aucun mot de passe n'apparaît ici : le keystore a été lu avec les mots de passe de
`/etc/nouri/upload-keystore.env` chargés dans l'environnement, sans les afficher. Les empreintes de certificat
sont publiques.

## 1. Clé d'import (upload key)

Fichier : `/etc/nouri/upload.keystore` (PKCS12, alias `nouri-upload`, RSA 4096, SHA384withRSA, valide jusqu'au 2054-03-25).

| Algorithme | Empreinte du certificat |
|---|---|
| **SHA-256** | `49:42:05:87:7C:19:8A:59:8C:28:2D:EF:4D:7D:56:09:40:0E:97:55:06:A8:22:4B:B4:8E:3B:ED:2D:01:BE:65` |
| SHA-1 | `D0:7A:66:9B:0C:05:5A:E9:3C:13:32:27:71:93:88:3A:D4:61:92:B3` |

L'AAB `android/app-release-bundle.aab` (versionCode 1, SHA-256 du fichier `96f083218e6fd6cc…4974988`) est signé par
ce certificat : `keytool -printcert -jarfile` donne exactement les deux empreintes ci-dessus. C'est celle que Play
Console affiche dans **Configuration > Intégrité de l'appli > Signature d'application > Certificat de la clé d'import**
(où l'on retrouve aussi le SHA-1).

## 2. Empreintes servies par `assetlinks.json`

`https://nouri.lounis.dev/.well-known/assetlinks.json` : HTTP 200, `application/json; charset=UTF-8`, sans redirection.
Paquet : `dev.lounis.nouri`. Deux empreintes SHA-256 :

| # | Empreinte | Correspond à |
|---|---|---|
| 1 | `31:56:8D:07:A9:72:31:F9:71:2E:31:24:E5:7C:D9:78:38:CF:F1:FD:9E:04:00:7A:52:11:E6:AE:B1:FE:FB:F6` | **Clé de signature Play (App Signing)**. Ce n'est pas celle du keystore : elle ne correspond ni à l'empreinte du § 1 ni à celle de l'AAB |
| 2 | `49:42:05:87:7C:19:8A:59:8C:28:2D:EF:4D:7D:56:09:40:0E:97:55:06:A8:22:4B:B4:8E:3B:ED:2D:01:BE:65` | **Clé d'import** : identique, caractère pour caractère, à l'empreinte SHA-256 du keystore (§ 1) |

Conclusion : l'empreinte n° 2 est la clé d'import ; l'empreinte n° 1 est donc, par élimination, la clé de signature Play.
Elle vient de ton relevé dans Play Console (message du 2026-11-07), que **je ne peux pas revérifier d'ici** : aucune API
Play publique ne renvoie l'empreinte de la clé de signature.

## 3. À quoi servent les deux empreintes

- **Application installée depuis Google Play** : Google la re-signe avec la clé de signature Play (n° 1). C'est cette
  empreinte qui valide le lien site ↔ app, donc l'ouverture en plein écran sans barre d'adresse Chrome.
- **APK ou AAB de test installé directement** (adb, `app-release-signed.apk`) : il porte la signature de la clé d'import
  (n° 2). Sans cette seconde ligne, ces builds de test afficheraient la barre d'adresse.
- Supprimer l'empreinte n° 2 plus tard est possible, sans effet sur les utilisateurs du Play Store.

## 4. Contrôles à faire dans Play Console

1. **Configuration > Intégrité de l'appli > Signature d'application** : le SHA-256 du « Certificat de la clé de
   signature de l'application » doit être `31:56:8D:07:…:FB:F6`. Sinon, remplacer la ligne n° 1 de
   `web/public/.well-known/assetlinks.json` et redéployer.
2. Même page, « Certificat de la clé d'import » : SHA-256 `49:42:05:87:…:BE:65`. Sinon, la clé d'import enregistrée n'est pas
   celle de ce keystore, et le prochain AAB sera refusé.
3. Après la première installation depuis le Play Store, ouvrir l'app : aucune barre d'adresse ne doit apparaître. Si elle
   apparaît, la vérification Digital Asset Links échoue (empreinte ou paquet faux, ou fichier inaccessible). Le contrôleur
   `digitalassetlinks.googleapis.com` a renvoyé 404 à ma requête de test : je n'ai donc pas de confirmation côté Google.

## 5. Sauvegarde

`/etc/nouri/upload.keystore` et `/etc/nouri/upload-keystore.env` doivent exister **hors du VPS**. Perdre la clé d'import
n'est pas fatal (Google peut la réinitialiser sur demande, avec délai), mais empêche de signer de nouveaux AAB entre-temps.

## 6. À confirmer par toi

- Le SHA-256 de la « clé de signature de l'application » affiché dans Play Console (§ 4, point 1).
- Le SHA-256 de la « clé d'import » affiché dans Play Console (§ 4, point 2).

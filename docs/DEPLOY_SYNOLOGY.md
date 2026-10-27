# Déploiement Synology / Docker

L’enrichissement TMDB nécessite l’API Node et son volume SQLite; une extraction
du seul dossier `dist/` reste un mode PWA statique sans enrichissement. Ces deux
livrables ne sont pas interchangeables.

## Construire et démarrer

À la racine du projet :

```bash
cp .env.example .env
# renseigner TMDB_ACCESS_TOKEN et ADMIN_TOKEN avec deux secrets différents
docker compose up -d --build
```

Compose publie le port HTTP `8080`, conserve SQLite dans `./data` et vérifie
simultanément `/tv/` et `/tv/api/v1/health`. Pour le NAS, monter de préférence un
dossier persistant tel que `/volume1/docker/mon-guide-tv/data` sur `/data`, puis
restreindre ses permissions à l’utilisateur du conteneur. Le port Node `3000`
n’est jamais publié.

Pour transférer une image préconstruite sans registre Docker :

```bash
docker build -t mon-guide-tv:latest .
docker save -o mon-guide-tv.tar mon-guide-tv:latest
```

Copier `mon-guide-tv.tar` et `.env` vers le NAS, charger l’image avec
`docker load -i mon-guide-tv.tar`, puis créer un conteneur `mon-guide-tv:latest`
avec les variables de `.env`, un volume `/volume1/docker/mon-guide-tv/data:/data`
et un port local (par exemple `8080:80`). L’image Node 24 est multi-architecture
pour les plateformes prises en charge par Node et SQLite natif; vérifier
l’architecture du NAS avant le chargement.

## Reverse proxy HTTPS Synology

Créer une règle HTTPS pour le domaine et faire pointer le chemin `/tv/` vers le
port local du conteneur, en conservant le chemin `/tv/`. Le conteneur gère lui-même
la priorité `/tv/api/` et son réécriture interne vers `/api/`; ne pas exposer
directement le port `3000`. Le certificat HTTPS doit être valide pour que le
service worker PWA fonctionne.

La PWA appelle l’API avec un chemin relatif à sa propre origine (`./api/v1`).
Le reverse proxy doit conserver le préfixe de déploiement, par exemple servir
la PWA sous `/tv/` et transmettre `/tv/api/` vers l’API du conteneur.

## Secrets et persistance

- `TMDB_ACCESS_TOKEN` est le jeton v3 d’accès en lecture TMDB. Il est lu
  exclusivement au démarrage côté serveur.
- `ADMIN_TOKEN` protège `/api/v1/search` et les routes de correspondance forcée.
  Il doit être indépendant du jeton TMDB; la V1 n’expose pas d’interface admin.
- Ne pas placer ces valeurs dans une variable `VITE_*`, un dépôt, un navigateur,
  une image statique ou les journaux.
- Sauvegarder la base via les mécanismes SQLite compatibles WAL ou après arrêt
  propre du conteneur; une copie du seul fichier `.sqlite` à chaud peut omettre
  les dernières écritures du WAL.

Contrôler la santé avec `GET /tv/api/v1/health`. Les réponses indiquent si le
fournisseur est configuré, sans révéler de secret. Si aucun backend n’est lancé,
la PWA conserve le guide XMLTV mais affiche un message discret dans les fiches
admissibles. Les mises à jour Docker remplacent le conteneur sans supprimer le
volume `/data`; un retour arrière consiste à redéployer l’image précédente avec
le même volume.

## Mode statique sans API

Pour une installation simple qui accepte l’absence de compléments TMDB :

```bash
npm ci
npm run build:web
tar -czf mon-guide-tv-static.tar.gz -C dist .
```

Extraire le contenu directement dans le dossier servi sous `/tv/`. Cette archive
ne contient ni serveur Node ni base SQLite. Après mise à jour, remplacer
l’intégralité du contenu de `dist/` sans mélanger les versions.

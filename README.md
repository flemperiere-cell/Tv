# Mon Guide TV

PWA mobile pour consulter le guide XMLTV de la TNT française. Le guide continue de
se télécharger directement dans le navigateur, d’être analysé côté client et
stocké dans IndexedDB pendant 24 h. Les préférences et favoris restent locaux.

Lorsqu’une fiche de film ou de série est ouverte, l’application peut demander un
complément TMDB au serveur. Cette fonction est facultative : sans serveur ou sans
jeton TMDB, le guide XMLTV reste disponible et les informations de la fiche ne
sont pas remplacées.

## Développement

Prérequis : Node.js 24 et npm.

```bash
npm ci
npm run dev
npm test
npm run lint
npm run build
```

Pour démarrer l’API locale avec une seule commande, copiez `.env.example` vers
`.env`, renseignez les paramètres souhaités, puis lancez dans un terminal :

```bash
npm run start:server
```

Cette commande compile le serveur puis le démarre en chargeant `.env` si ce
fichier existe. L’API est disponible sur `http://127.0.0.1:3000`; lancez
`npm run dev` dans un autre terminal pour utiliser l’interface.
Pour forcer une recherche TMDB à chaque appel pendant les tests, désactivez le
cache du backend avec `MEDIA_CACHE_ENABLED=false npm run start:server` (ou
`MEDIA_CACHE_ENABLED=false` dans `.env`), puis redémarrez-le. Les caches des
fiches, correspondances et épisodes ne seront alors ni lus ni écrits.
Activez `TMDB_TRACE=true` pour journaliser chaque requête sortante TMDB
(méthode, URL, `body: null` et statut); le jeton d’accès n’est jamais journalisé.

Le build compile l’application statique dans `dist/` et l’API Node dans
`server/dist/`. Pour ne construire que la PWA :

```bash
npm run build:web
```

La PWA peut être installée statiquement sous un sous-répertoire, mais cette
installation ne fournit **pas** l’API TMDB. L’API est toujours appelée avec un
chemin relatif (`./api/v1`) sur la même origine que la PWA. En développement,
Vite relaie ces appels au backend local via `proxy.conf.ts`. Le jeton TMDB est
exclusivement une variable serveur et ne doit jamais être préfixé par `VITE_`.

## Déploiement Docker

Copier `.env.example` vers `.env`, puis saisir un jeton d’accès TMDB v3 et un
secret administrateur distinct. Ne pas versionner `.env`.

```bash
cp .env.example .env
# modifier .env avec des secrets réels
docker compose up -d --build
```

L’application répond sur `http://NAS:8080/tv/` (à publier derrière HTTPS via le
reverse proxy Synology). Le serveur Node écoute uniquement sur `127.0.0.1:3000`
dans le conteneur; seul Nginx est publié. Les données SQLite sont persistées dans
`./data`. Pour transférer l’image à un NAS sans accès au registre :

```bash
docker build -t mon-guide-tv:latest .
docker save -o mon-guide-tv.tar mon-guide-tv:latest
```

Sur le NAS, charger l’image avec `docker load -i mon-guide-tv.tar`, puis créer un
conteneur basé sur `mon-guide-tv:latest` avec les variables de `.env`, un volume
persistant monté sur `/data` et le port HTTP du conteneur publié derrière le
reverse proxy. L’archive `dist/` seule est un déploiement statique sans backend;
ne pas la confondre avec l’image Docker.

Voir le [guide Synology](docs/DEPLOY_SYNOLOGY.md), l’[architecture](docs/ARCHITECTURE.md),
la [source EPG](docs/EPG_SOURCES.md) et le [guide utilisateur](docs/USER_GUIDE.md).

## TMDB et confidentialité

Le jeton TMDB est utilisé uniquement par le serveur. Le serveur stocke un cache
partagé des métadonnées et correspondances dans SQLite; aucune donnée de favoris
ou de préférence n’est envoyée. L’utilisation de l’API et de ses images dépend
des conditions et obligations d’attribution TMDB, qui doivent être vérifiées
avant tout déploiement public ou commercial.

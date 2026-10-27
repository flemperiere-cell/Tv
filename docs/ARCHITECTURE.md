# Architecture

## PWA et guide XMLTV

React et Vite produisent l’application web dans `dist/`. `provider.ts` télécharge
le guide XMLTV GZIP; le navigateur le décompresse progressivement et
`xmltv.ts` le traite avec un parseur SAX. Seuls les programmes TNT et les
métadonnées disponibles sont conservés. Le cache IndexedDB a un TTL de 24 h et
reste désactivable. Une erreur réseau conserve l’ancien guide.

Les préférences versionnées et les favoris restent dans `localStorage`. Le
service worker précache l’application et ne met pas en cache les routes `/api/`.
Le guide, les favoris et les fiches XMLTV restent utilisables sans API
d’enrichissement. L’API n’est sollicitée qu’à l’ouverture d’une fiche admissible,
jamais depuis la liste ou la grille.

## API d’enrichissement

`server/src` contient l’API Fastify sur Node 24, servie sous `/api/v1`. Le
conteneur Nginx sert la PWA sous `/tv/` et réécrit `/tv/api/` vers l’API locale.
Node écoute uniquement sur `127.0.0.1:3000`. Un jeton `TMDB_ACCESS_TOKEN` est
conservé côté serveur; la recherche est limitée aux films/séries. Les films
peuvent être associés à partir de 80/100 avec une marge de 10 points si le titre
est exact et si des preuves indépendantes concordent (durée et genre correspondant
pour un film, preuves non liées au titre pour un téléfilm). Pour les films, un
créneau XMLTV plus long que la durée TMDB peut être expliqué par les publicités :
12 minutes au maximum pour une diffusion d'une heure, puis 9 minutes par heure
en moyenne pour les diffusions plus longues, calculées sur la durée du créneau.
La durée TMDB ne peut jamais dépasser le créneau XMLTV.
Les correspondances incertaines restent ambiguës et ne remplacent pas les
informations XMLTV.
Pour les séries, le titre et les détails de l’épisode TMDB sont comparés au
titre et au résumé XMLTV avant de confirmer une correspondance. Les épisodes
sont testés pour les trois meilleurs candidats. Si le numéro XMLTV ne confirme
pas l’épisode, les voisins immédiats (-1 et +1) sont également vérifiés; une
correspondance conserve le numéro TMDB réel. Une fiche d’épisode ne suffit pas
sur son numéro seul : son titre ou son résumé doit apporter une preuve
concordante, sans résumé disponible contradictoire. Les titres homonymes ne sont
pas départagés par popularité seule; une année, plusieurs acteurs concordants ou
une preuve d’épisode discriminante sont nécessaires. En l’absence de ces indices,
la correspondance reste ambiguë, mais une série peut être retenue sans fiche
d’épisode si des preuves indépendantes identifient l’œuvre. Les preuves sont
renvoyées par l’API et conservées avec la correspondance. Les titres et résumés
TMDB sont aussi consultés en anglais lorsque la version française ne suffit pas
à la comparaison.

SQLite (`/data/media.sqlite`) utilise WAL, les clés étrangères, des migrations
idempotentes et un volume persistant. Les identités de correspondance reposent
sur type, titre normalisé et année, indépendamment de la chaîne et de l’horaire.
Les métadonnées des séries et les données d’épisodes ont des caches distincts;
les épisodes, y compris les numéros voisins testés, sont indexés par série,
saison et numéro. La méthode de matching et les preuves sont conservées avec la
correspondance. La route de recherche/correction est
protégée par `ADMIN_TOKEN`, distinct du secret TMDB. Le service worker ne met pas
en cache les réponses API; le serveur renvoie `Cache-Control: no-store`.

En développement, Vite relaie `/tv/api/` (application sous `/tv/`) et `/api/`
(application à la racine) vers le serveur local `127.0.0.1:3000`. Démarrer
l’API séparément avec `npm run start:server`. Le navigateur appelle l’API via
un chemin relatif sur la même origine que la PWA; `proxy.conf.ts` transmet ces
requêtes à l’API locale sans requête inter-origine.

Le conteneur combine Nginx et Node sous supervisord. L’état Docker ne devient
sain que lorsque la PWA et le endpoint de santé de l’API répondent tous les deux.
Le répertoire `/data` doit être monté sur un volume persistant et sauvegardé avec
un outil SQLite cohérent avec WAL (ne pas copier seulement le fichier principal
pendant que la base est ouverte).

## Limites

La décompression et le premier parsing XMLTV utilisent le thread principal. Les
images TMDB restent chargées depuis son CDN. Les conditions de cache et
d’attribution de TMDB doivent être revalidées avant un usage public ou
commercial; les métadonnées ne sont pas un contenu open source.

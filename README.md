# Mon Guide TV

PWA mobile, entièrement statique, pour consulter les programmes réels de la TNT française. Elle télécharge directement le guide complet GZIP de XML TV Fr depuis le navigateur, l’analyse progressivement pour enrichir les programmes TNT, conserve les données dans IndexedDB pendant 24 heures et les préférences dans `localStorage`. Une vérification légère de `Last-Modified` déclenche une actualisation anticipée lorsque la source change. Aucun backend ni compte n'est utilisé.

## Développement

Prérequis : Node.js LTS récent.

```bash
npm install
npm run dev
npm test
npm run build
```

Le build est indépendant de son répertoire d’installation. Les scripts, feuilles de style, icônes, manifest et service worker utilisent des chemins relatifs. Le même contenu de `dist/` peut donc être installé sous `/tv/`, `/guide/` ou directement à la racine, sans recompilation. Les seules URL absolues sont les ressources externes nécessaires : le flux XML TV Fr et les images fournies par la source EPG.

## Créer et extraire l’archive TAR

Construire l’application puis créer une archive compressée contenant directement les fichiers déployables :

```bash
npm ci
docker build -t mon-guide-tv .
docker save -o mon-guide-tv.tar mon-guide-tv:latest
```

Sur le NAS, créer le répertoire correspondant à l’URL choisie, puis y extraire l’archive. Exemple pour `/tv/` :

```bash
mkdir -p /chemin/du/site/tv
tar -xzf mon-guide-tv.tar.gz -C /chemin/du/site/tv
```

Après extraction, `/chemin/du/site/tv/index.html` doit exister directement. Il ne faut pas obtenir un niveau supplémentaire `tv/dist/index.html`.

Le contenu autonome de `dist/` est le livrable à copier sur le serveur HTTPS. Voir [le guide Synology](docs/DEPLOY_SYNOLOGY.md), [l’architecture](docs/ARCHITECTURE.md), [la source EPG](docs/EPG_SOURCES.md) et [le guide utilisateur](docs/USER_GUIDE.md).

## Vie privée

Les favoris et réglages ne quittent pas l’appareil. Effacer les données du site les supprime ; utilisez l’export JSON pour les sauvegarder.

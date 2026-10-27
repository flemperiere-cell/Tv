# Déploiement Synology / Nginx

1. Exécutez `npm ci && npm run build`, puis `tar -czf mon-guide-tv.tar.gz -C dist .` sur la machine de développement.
2. Depuis Android, copiez l’archive vers File Station et extrayez-la dans le sous-répertoire de votre choix du dossier déjà servi par Nginx. Par exemple, extrayez-la dans `tv/` pour l’ouvrir avec `https://votre-domaine/tv/`. Le build utilise des chemins relatifs et peut être déplacé sans recompilation.
3. Vérifiez le guide, installez la PWA depuis Chrome et testez un favori puis un redémarrage.

Ne créez pas de second conteneur. Adaptez seulement le bloc `server` existant après sauvegarde :

```nginx
location /tv/ {
  try_files $uri $uri/ /tv/index.html;
}
location = /tv/index.html { add_header Cache-Control "no-cache"; }
location = /tv/sw.js { add_header Cache-Control "no-cache"; }
location ~* ^/tv/.*\.(?:js|css|png|svg)$ { expires 1y; add_header Cache-Control "public, immutable"; }
add_header X-Content-Type-Options nosniff always;
add_header Referrer-Policy strict-origin-when-cross-origin always;
add_header Content-Security-Policy "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self' https://xmltvfr.fr; img-src 'self' data: https:; object-src 'none'; base-uri 'self'" always;
```

Le certificat et le nom de domaine doivent être valides : les service workers ne fonctionnent pas sur une origine HTTP distante. Après une mise à jour, remplacez tout le contenu par le nouveau `dist/` sans mélanger les versions ; rechargez Nginx uniquement si sa configuration a changé.

# Mon Guide TV — PWA Android

Application statique, à publier sur un site HTTPS (GitHub Pages par exemple).

## Fonctionnement

- Par défaut : favoris et « Maintenant ».
- Sélection du jour depuis Hier jusqu’à J+5 et bouton Ce soir (programme actif à 21 h).
- Liste de la TNT française, logos abrégés, catégorie, durée et saison/épisode si XMLTV le fournit.
- Cache local de 24 h, vérification de `data/meta.json` au maximum une fois par heure, actualisation manuelle ⟳.
- Pas d’émissions fictives affichées en cas d’absence de guide réel.

## Publication depuis un téléphone Android

1. Créer un dépôt GitHub public (par exemple `mon-guide-tv`).
2. Envoyer **le contenu** de ce dossier dans la racine du dépôt (y compris `.github/workflows/update-epg.yml`).
3. Sur GitHub, ouvrir **Actions → Actualiser les programmes TV → Run workflow** pour la première importation. L’action télécharge `https://xmltvfr.fr/xmltv/xmltv_tnt.xml.gz` et écrit `data/epg.json` et `data/meta.json`.
4. Dans **Settings → Pages**, sélectionner **Deploy from a branch**, branche `main`, dossier `/ (root)`, puis enregistrer.
5. Attendre la publication et ouvrir `https://NOM-UTILISATEUR.github.io/mon-guide-tv/` sur Chrome Android. Via le menu Chrome, choisir **Installer l’application** ou **Ajouter à l’écran d’accueil**.
6. Les importations se relancent ensuite automatiquement toutes les six heures (leur exécution peut parfois être retardée par GitHub).

Sans exécution initiale de l’action et sans publication HTTPS, l’application ne dispose pas encore de vrais programmes.

Source : XML TV Fr, guide TNT compressé, consultable sur https://xmltvfr.fr/xmltv.php. Certaines chaînes peuvent être absentes de la source ; les images, durées, saisons et épisodes dépendent des métadonnées qu’elle fournit. Vérifier les droits de réutilisation et de diffusion des données/images avant publication publique.

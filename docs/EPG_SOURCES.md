# Source EPG

Source : `https://xmltvfr.fr/xmltv/xmltv.xml.gz` (XML TV Fr, guide complet). Cette variante GZIP contient le même guide XML que `xmltv.zip`, tout en permettant la décompression progressive native dans Chrome. Le flux expose CORS, `Last-Modified` et les métadonnées HTTP utiles. L’application extrait les chaînes TNT et rapproche les occurrences enrichies des autres identifiants de chaînes par titre et horaires afin de récupérer casting, réalisation et autres crédits.

Le guide complet représente environ 15 Mo compressés et 125 Mo décompressés. Il est analysé progressivement : l’application ne construit pas un DOM contenant tout le document. Le cache IndexedDB est valable 24 heures. Avant cette échéance, une requête `HEAD` légère compare `Last-Modified` ; le guide complet n’est retéléchargé que si la source a changé. Le bouton ⟳ force toujours une actualisation.

Le test d’en-têtes avec un `Origin` tiers confirme l’accès CORS. La validation finale doit néanmoins être répétée depuis le domaine HTTPS du NAS, car une politique distante peut évoluer. L’application affiche explicitement l’erreur et ne fabrique aucune donnée si la source devient inaccessible. L’URL peut être remplacée à la compilation avec `VITE_EPG_URL` si un fournisseur XMLTV GZIP compatible possède le même format.

Le projet XML TV Fr est open source sous licence Apache 2.0. Les données agrégées et images peuvent relever de leurs diffuseurs respectifs ; cette application personnelle ne les republie pas et les charge depuis leurs URL sources.

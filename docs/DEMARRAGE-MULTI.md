# Centurionmulti — état du partage

18 octobre 2026. Dépôt indépendant issu de `vcnamgn/science005`, avec son historique. `origin` désigne `vcnamgn/centurionmulti` et `upstream` conserve la source en lecture. Développement sur `codex/prepare-multi-session`, PR nº 1.

## Version 0.3.0

Une seule application Cloudron sert [le simulateur](https://s.vcnam.fr/simulateur/centurion.html) et le relais Socket.IO. L’ancienne adresse sockets.vcnam.fr reste un alias actif pour récupérer les autosauvegardes de cette origine. Aucun emplacement supplémentaire ni stockage de projet sur le serveur.

Le maître crée une séance de quatre chiffres et restaure ses schémas personnels. Les auxiliaires ouvrent les mêmes interfaces, pilotent et éditent le projet commun, sans lire ni écraser leurs autosauvegardes personnelles. Les menus **Ouvrir** et **Fichier** permettent des imports explicites dans la séance. Les rôles M/A restent dans le bouton existant.

La physique, les CC et la conduite auto restent exécutés par le maître. `centurion-session-controls.js` énumère les gestes distants et réutilise les règles du pupitre. `centurion-share.js` porte le protocole 2, les reçus, les documents par révision, les historiques paginés et les fichiers fragmentés. `centurion-commands.js` conserve son API locale réutilisable pour les commandes du catalogue de conduite ; il n’est pas le transport réseau.

Les conflits d’édition sont refusés avec conservation du brouillon ; aucune fusion automatique. Un chargement validé met la simulation en pause. Le renouvellement d’une séance garde le réacteur vivant mais révoque les anciennes invitations. Les numéros temporaires ne servent jamais de clé d’archive.

## Vérification et suites

Les tests couvrent commandes, isolement des séances et rôles, déduplication, documents, autosauvegardes auxiliaires, absence de calcul local, imports et tracé des connecteurs. Les essais navigateur vérifient pilotage, CC, conduite Auto et chargement d’état depuis un auxiliaire. La parité physique est vérifiée à ×1, ×20 et ×200.

Garder le maître visible. Le Worker commun physique/CC/Auto, une bibliothèque durable de projets, les droits réglables et les essais entre ordinateurs ou sous charge restent à réaliser. Le [plan initial](PARTAGE-SIMULATION.md) conserve ces perspectives ; la [conception](CONCEPTION.md) décrit le code livré. Voir les détails de déploiement et limites dans [le relais](../partage/relay/README.md).

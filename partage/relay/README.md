# Séances partagées Centurion

La version 0.3.0 ouvre le simulateur habituel comme maître, lui attribue un numéro de séance à quatre chiffres et donne aux auxiliaires les mêmes interfaces, le pilotage et l’édition partagés. Le relais ne charge aucun moteur physique ni évaluateur CC. Il sert aussi les fichiers statiques : une seule application Cloudron suffit pour l’ensemble de cet essai.

## Essai local

Depuis le répertoire `partage/relay`, avec Node.js 22 ou plus récent et npm :

```text
npm ci
npm test
npm start
```

Ouvrir `http://127.0.0.1:3000/simulateur/centurion.html`. Le numéro de séance apparaît automatiquement à droite de **Fichier**. Démarrer la simulation dans le maître. Dans le menu du réacteur, copier l’invitation ou saisir le numéro d’un autre maître dans **Rejoindre** : le simulateur auxiliaire complet s’ouvre dans un autre onglet. Le test entre ordinateurs exige une adresse réellement accessible : `127.0.0.1` désigne toujours l’ordinateur du navigateur.

Le service écoute par défaut uniquement sur la boucle locale. Dans le conteneur, il écoute sur `0.0.0.0:3000` et Cloudron gère l’accès HTTPS.

## Cible Cloudron

- Version vérifiée par l’API du serveur : **Cloudron 8.3.1** (la version annoncée initialement était 8.3.2).
- Adresse : **s.vcnam.fr** ; **sockets.vcnam.fr** reste un alias actif pour récupérer les anciennes autosauvegardes.
- Une seule application ; aucun addon de base de données, d’authentification ou de stockage.
- Limite de mémoire initiale : 256 Mio, à mesurer pendant les essais.
- Image construite en dehors de Cloudron, pour ne pas utiliser un second emplacement avec une application de construction ou de registre.

Le manifeste conserve les champs disponibles sur Cloudron 8.3.1. Il n’utilise pas les nouveaux champs de publication du catalogue. La base Node.js Cloudron est épinglée par version datée et digest, suivant le guide officiel courant. L’installation sur le serveur cible a confirmé le démarrage du conteneur et un contrôle de santé `healthy`.

Le modèle de workflow GitHub **Image du relais Cloudron** est fourni dans [relay-image.workflow.txt](relay-image.workflow.txt). Le workflow actif se trouve dans `.github/workflows/relay-image.yml`, sur la branche de préparation. Il se déclenche sur les modifications du relais dans cette branche, ou manuellement. Il exécute les tests, construit le Dockerfile racine puis publie `ghcr.io/vcnamgn/centurionmulti:relay-0.3.0` ainsi qu’une étiquette contenant le SHA Git. La visibilité du paquet GHCR doit être publique pour une récupération anonyme ; si GitHub l’a créé privé, la modifier dans les paramètres du paquet avant installation. Ne jamais inclure de token GitHub dans le manifeste, le Dockerfile ou une URL de téléchargement.

Depuis un checkout de cette branche, avec le client Cloudron installé :

```text
cloudron login my.vcnam.fr
cloudron install --image ghcr.io/vcnamgn/centurionmulti:relay-0.3.0 --location s.vcnam.fr
```

Le tableau de bord confirmé est `https://my.vcnam.fr`. L’image est disponible publiquement ; les commandes ci-dessus servent à une nouvelle installation, pas à répéter celle déjà effectuée. Le client lit le `CloudronManifest.json` du répertoire courant. Aucun service ne doit remplacer l’application déjà présente sur le serveur.

Après installation, ouvrir `https://s.vcnam.fr/simulateur/centurion.html` et suivre les mêmes étapes que pour l’essai local. Les participants rejoignent ce site par leur lien ; ils n’installent pas chacun une application Cloudron. Le navigateur maître doit utiliser la version du simulateur servie par cette application pour activer ce premier raccordement.

## Premier déploiement (0.1.0)

Le 17 octobre 2026 (heure de Paris), le relais 0.1.0 a été installé sur **https://sockets.vcnam.fr**, via le tableau de bord **https://my.vcnam.fr**, sur Cloudron **8.3.1**. L’application utilise le second emplacement ; l’application existante a été conservée. L’image est récupérée anonymement et épinglée au digest :

```text
ghcr.io/vcnamgn/centurionmulti@sha256:31f9337976c97d05dd7487b7995a3c564d1fb5d8ead45d53929dd6b045486df9
```

Cette image provient du commit `de84e0899fbe3ed80d115ac341efdb593046685b`, construit et testé par le workflow GitHub. Le minimum du manifeste a ensuite été ajusté à 8.3.1 pour correspondre au serveur ; le manifeste est fourni séparément lors de l’installation et n’est pas embarqué dans cette image.

Vérifications sur le site déployé : HTTPS, état Cloudron sain, création de séance, connexion d’un maître et d’un auxiliaire, mesures initiales, démarrage et pause reçus par l’auxiliaire, suivi à ×1 et ×200, et fermeture explicite du partage. Il s’agit d’un essai dans deux onglets du navigateur ; la validation entre deux ordinateurs et les essais de charge restent à faire. Aucune connexion GitHub n’est nécessaire aux participants.

## Déploiement vérifié (0.2.0)

Le 18 octobre 2026, l’application a été renommée en **s.vcnam.fr** et mise à jour vers **0.2.0** sur le même emplacement Cloudron. **sockets.vcnam.fr** reste un alias actif, confirmé par une réponse HTTP 200 servant le simulateur. Cela permet d’y rouvrir les autosauvegardes de l’ancienne origine et d’exporter un fichier. Cloudron confirme une application installée, en cours d’exécution et saine. L’image déployée est :

```text
ghcr.io/vcnamgn/centurionmulti@sha256:086af53ff39edc5d2bc3a37687936a742583876d1cae37587a3d9dbe380bfe1b
```

Révision source : `bb5184ca81ed0d8154bca103a4589ce1cd137f9c`. Construction et 15 tests du relais réussis dans GitHub Actions. Essai sur le site déployé avec deux pages maîtres et un auxiliaire : numéros distincts attribués, jonction depuis la seconde page vers le premier maître par les quatre chiffres, réception de la marche et de la pause, puis renouvellement de séance à 00:00:18 sans retour à zéro ; l’ancien auxiliaire affiche « Séance terminée ». Aucune erreur JavaScript relevée. Cet essai utilise des onglets d’un même navigateur ; le test entre ordinateurs reste à faire.

## Correctif de présentation déployé (0.2.1)

La version **0.2.1** a été installée le 18 octobre 2026. Elle conserve le protocole de séance de 0.2.0 et corrige le retour à la ligne de la barre supérieure dans les volets étroits. À la largeur de 602 pixels du navigateur, la page déployée a une largeur de contenu de 602 pixels : aucun débordement horizontal. Le menu Fichier et le numéro restent accessibles. Les 15 tests du relais passent aussi dans le workflow de cette version.

Image : `ghcr.io/vcnamgn/centurionmulti@sha256:2317e44f330ee676c7bf355f3e09c88b21da58585b002e11c811b0fc12b729b9` ; révision source : `64c1720ebeb2e317bac20daf39b698727acaa4e7`. Le contrôle final confirme également l’attribution d’un numéro et la connexion maître en HTTPS. Le serveur de test local a été arrêté après validation.

## Fonctionnement de la version 0.3.0

Le bouton existant affiche **M · numéro** ou **A · numéro**, avec rôle détaillé et connexion dans son menu/infobulle. Aucune ligne supplémentaire du bandeau. **Rejoindre** exige un maître connecté et donne accès au pilotage et à l’édition de sa séance. Le numéro est un code d’accès pratique, sans compte ni mot de passe individuel : le communiquer seulement aux participants souhaités. Les liens auxiliaires gardent une capacité longue dans leur fragment ; la capacité maître reste distincte et privée.

Les séances numérotées vont de 1000 à 9999 et sont uniques tant qu’elles existent. **Nouvelle séance** renouvelle numéro et invitations sans remplacer le modèle, les CC ou la conduite. Recharger le maître crée une nouvelle simulation et une nouvelle séance. Les recherches sont limitées à dix et les créations à cinq par minute et adresse cliente.

Les auxiliaires affichent synoptiques, graphiques, initiateurs, transitoires, paramètres, CC et conduite Auto. Navigation, zoom, GV et choix des courbes restent locaux. Le maître exécute seul les pas physiques, les mémoires CC et les séquences ; les modules auxiliaires servent seulement au rendu. Les gestes distants utilisent un catalogue de contrôles autorisés, les mêmes gestionnaires métier et un reçu du maître. Une réponse incertaine n’entraîne aucun rejeu automatique.

Le maître restaure et autosauvegarde ses graphes dans son navigateur. Les iframes auxiliaires démarrent en mode partagé, sans lire ni écrire les autosauvegardes personnelles. **Ouvrir** importe explicitement un JSON dans la séance ; **Fichier** sauvegarde l’état maître ou charge un état validé en pause. Chaque document possède une révision : une modification périmée est refusée, conserve le brouillon visible/exportable et propose de reprendre la version commune. Aucune fusion automatique. Interrompre la conduite auto avant édition. Une modification de position CC conserve les mémoires et l’activation ; un remplacement explicite suit les règles normales d’import.

Le protocole 2 diffuse les mesures à 5 Hz sans attendre le réseau entre les pas. Les anciens instantanés sont remplaçables ; les documents fiables ont un seul envoi en attente par destinataire. Les historiques anciens se demandent par pages ; les fichiers complets transitent par fragments de 64 K caractères. Le relais ne charge aucun moteur et ne conserve que séances, dernier instantané et dernier document en mémoire.

Limites : 20 séances, 20 auxiliaires par séance, instantané 1 Mio, document 6 Mio, commande 4 Mio, paquet Socket.IO 8 Mio ; commandes bornées à 20/s, deux en attente par auxiliaire et 32 par séance. Deux transferts de fichier simultanés au maximum dans le maître, expirant après deux minutes sans activité. Le fichier final doit respecter la limite du format Centurion-State (160 Mio).

Une coupure marque les valeurs périmées et suspend les interventions, sans promotion automatique. Un même maître vivant peut se reconnecter. Les séances sans maître expirent après 30 minutes ; redémarrer le relais les efface. Les projets restent indépendants des quatre chiffres : conserver des JSON ou un état complet. Le changement de domaine ne déplace pas le stockage du navigateur ; utiliser l’alias ancien pour exporter ses travaux.

**Garder l’onglet maître visible.** Le Worker commun physique/CC/Auto n’est pas intégré. Veille, navigateur fermé ou page gelée interrompent la progression. Les essais entre ordinateurs et les essais de charge restent à faire. Le mode fichier ou site statique garde son partage désactivé.

## Références de packaging

- [Cloudron — manifeste](https://docs.cloudron.io/packaging/manifest/).
- [Cloudron — images de base et système de fichiers](https://docs.cloudron.io/packaging/cheat-sheet/).
- [GitHub — registre de conteneurs et visibilité des paquets](https://docs.github.com/en/packages/working-with-a-github-packages-registry/working-with-the-container-registry).

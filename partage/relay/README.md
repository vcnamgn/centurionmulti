# Premier essai du relais Centurion

Ce prototype ouvre directement le simulateur habituel comme maître, lui attribue un numéro de séance à quatre chiffres et affiche ses mesures dans un tableau auxiliaire en lecture seule. Le relais ne charge aucun moteur physique ni évaluateur CC. Il sert aussi les fichiers statiques : une seule application Cloudron suffit pour l’ensemble de cet essai.

## Essai local

Depuis le répertoire `partage/relay`, avec Node.js 22 ou plus récent et npm :

```text
npm ci
npm test
npm start
```

Ouvrir `http://127.0.0.1:3000/simulateur/centurion.html`. Le numéro de séance apparaît automatiquement à droite de **Fichier**. Démarrer la simulation dans le maître. Dans le menu du réacteur, copier l’invitation ou saisir le numéro d’un autre maître dans **Rejoindre** : l’écran auxiliaire s’ouvre dans un autre onglet. Le test entre ordinateurs exige une adresse réellement accessible : `127.0.0.1` désigne toujours l’ordinateur du navigateur.

Le service écoute par défaut uniquement sur la boucle locale. Dans le conteneur, il écoute sur `0.0.0.0:3000` et Cloudron gère l’accès HTTPS.

## Cible Cloudron

- Version vérifiée par l’API du serveur : **Cloudron 8.3.1** (la version annoncée initialement était 8.3.2).
- Adresse : **s.vcnam.fr** ; **sockets.vcnam.fr** redirige vers cette nouvelle adresse.
- Une seule application ; aucun addon de base de données, d’authentification ou de stockage.
- Limite de mémoire initiale : 256 Mio, à mesurer pendant les essais.
- Image construite en dehors de Cloudron, pour ne pas utiliser un second emplacement avec une application de construction ou de registre.

Le manifeste conserve les champs disponibles sur Cloudron 8.3.1. Il n’utilise pas les nouveaux champs de publication du catalogue. La base Node.js Cloudron est épinglée par version datée et digest, suivant le guide officiel courant. L’installation sur le serveur cible a confirmé le démarrage du conteneur et un contrôle de santé `healthy`.

Le modèle de workflow GitHub **Image du relais Cloudron** est fourni dans [relay-image.workflow.txt](relay-image.workflow.txt). Le workflow actif se trouve dans `.github/workflows/relay-image.yml`, sur la branche de préparation. Il se déclenche sur les modifications du relais dans cette branche, ou manuellement. Il exécute les tests, construit le Dockerfile racine puis publie `ghcr.io/vcnamgn/centurionmulti:relay-0.2.0` ainsi qu’une étiquette contenant le SHA Git. La visibilité du paquet GHCR doit être publique pour une récupération anonyme ; si GitHub l’a créé privé, la modifier dans les paramètres du paquet avant installation. Ne jamais inclure de token GitHub dans le manifeste, le Dockerfile ou une URL de téléchargement.

Depuis un checkout de cette branche, avec le client Cloudron installé :

```text
cloudron login my.vcnam.fr
cloudron install --image ghcr.io/vcnamgn/centurionmulti:relay-0.2.0 --location s.vcnam.fr
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

Le 18 octobre 2026, l’application a été renommée en **s.vcnam.fr** et mise à jour vers **0.2.0** sur le même emplacement Cloudron. **sockets.vcnam.fr** reste une redirection. Cloudron confirme une application installée, en cours d’exécution et saine. L’image déployée est :

```text
ghcr.io/vcnamgn/centurionmulti@sha256:086af53ff39edc5d2bc3a37687936a742583876d1cae37587a3d9dbe380bfe1b
```

Révision source : `bb5184ca81ed0d8154bca103a4589ce1cd137f9c`. Construction et 15 tests du relais réussis dans GitHub Actions. Essai sur le site déployé avec deux pages maîtres et un auxiliaire : numéros distincts attribués, jonction depuis la seconde page vers le premier maître par les quatre chiffres, réception de la marche et de la pause, puis renouvellement de séance à 00:00:18 sans retour à zéro ; l’ancien auxiliaire affiche « Séance terminée ». Aucune erreur JavaScript relevée. Cet essai utilise des onglets d’un même navigateur ; le test entre ordinateurs reste à faire.

## Séances numérotées (0.2.0)

Le relais active le partage dans la page qu’il sert. Une ouverture directe crée une nouvelle séance et un numéro de 1000 à 9999, unique parmi les séances présentes. Le navigateur maître conserve en mémoire sa capacité secrète, distincte du numéro. **Nouvelle séance** crée une nouvelle invitation puis ferme l’ancienne, sans remplacer le modèle, réinitialiser les CC ou interrompre la conduite. **Arrêter le partage** conserve aussi la simulation locale. Recharger la page crée un nouveau réacteur local et une nouvelle séance ; le numéro ne permet pas de récupérer une simulation perdue.

**Rejoindre** exige un maître connecté et ouvre seulement une invitation en lecture seule. Le numéro n’est pas un mot de passe : aucune sauvegarde personnelle, capacité maître ou commande n’est exposée par cette recherche. Les essais sont limités à dix recherches et cinq créations par minute et par adresse cliente ; le proxy Cloudron est pris en compte. Les numéros sont libérés à la fermeture ou à l’expiration. Les liens auxiliaires contiennent toujours une capacité longue, dans leur fragment. Les anciennes invitations cessent de fonctionner lors du renouvellement.

Les autosauvegardes des CC et de la conduite auto restent celles du navigateur et de l’adresse du site. Elles sont communes aux onglets de cette adresse et ne forment pas une archive par numéro. Un fichier **Fichier → Sauvegarder l’état** conserve physique, historiques, graphes CC et conduite auto indépendamment de toute séance ; les exports propres aux ateliers constituent les fichiers de bibliothèque. Le changement de domaine ne transfère pas automatiquement le stockage local : exporter depuis l’ancien onglet, puis importer sur la nouvelle adresse permet de déplacer les travaux. Le relais ne stocke aucun projet durable.

Les tests du relais couvrent aussi l’attribution de numéros distincts, la jonction après connexion du maître, le formulaire natif, le refus d’un rôle maître avec l’invitation auxiliaire, la révocation lors du renouvellement, les refus de saisie et les limites de recherche. Dans le navigateur local, le renouvellement a conservé l’horloge à 00:00:40 et fermé l’ancien auxiliaire.

## Portée du test

Le flux courant contient une projection confirmée à 5 Hz et un seul instantané est conservé par séance. L’auxiliaire affiche les mesures générales, les quatre GV et les quatre boucles. Les numéros de publication évitent de revenir à une mesure plus ancienne ; un remplacement du modèle renouvelle la génération. Le client ne publie pas un pas CC incomplet et aucune réponse du relais n’est attendue par la simulation.

La page auxiliaire ne charge ni `centurion-engine.js`, ni `centurion-app.js`, ni conduite auto ni éditeur CC. Les tokens maître et auxiliaire sont distincts ; les secrets des liens restent dans leur fragment et ne figurent pas dans les requêtes HTTP. La connexion maître est unique. Un rechargement de la page maître qui perd la simulation impose une nouvelle séance ; une simple reconnexion réseau du même maître vivant reste possible. Les anciens instantanés sont marqués périmés si le maître disparaît ; aucun auxiliaire n’est promu.

Les séances sans maître expirent après 30 minutes. Les limites par défaut sont 20 séances et 20 auxiliaires par séance ; les créations et publications sont bornées. Les mesures courantes sont remplaçables et envoyées sans file de rattrapage. Le serveur ne persiste aucun état : un redémarrage efface les séances, tandis que le maître continue sa simulation locale.

Pour ce premier essai, **garder l’onglet maître visible**. Les synoptiques complets côté auxiliaire, les historiques distants, les commandes distantes, les verrous d’édition et le Worker ne sont pas encore intégrés. Le simulateur servi comme fichier ou site statique garde sa balise de partage désactivée et n’établit aucune connexion au relais.

## Références de packaging

- [Cloudron — manifeste](https://docs.cloudron.io/packaging/manifest/).
- [Cloudron — images de base et système de fichiers](https://docs.cloudron.io/packaging/cheat-sheet/).
- [GitHub — registre de conteneurs et visibilité des paquets](https://docs.github.com/en/packages/working-with-a-github-packages-registry/working-with-the-container-registry).

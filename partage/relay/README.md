# Premier essai du relais Centurion

Ce prototype ouvre une séance, lance le simulateur habituel comme maître et affiche ses mesures dans un tableau auxiliaire en lecture seule. Le relais ne charge aucun moteur physique ni évaluateur CC. Il sert aussi les fichiers statiques : une seule application Cloudron suffit pour l’ensemble de cet essai.

## Essai local

Depuis le répertoire `partage/relay`, avec Node.js 22 ou plus récent et npm :

```text
npm ci
npm test
npm start
```

Ouvrir `http://127.0.0.1:3000`, cliquer **Créer une séance**, puis **Ouvrir le maître**. Démarrer la simulation dans le maître. Le lien d’invitation ouvre l’écran auxiliaire, dans une autre fenêtre ou sur un autre navigateur. Le test entre ordinateurs exige une adresse réellement accessible : `127.0.0.1` désigne toujours l’ordinateur du navigateur.

Le service écoute par défaut uniquement sur la boucle locale. Dans le conteneur, il écoute sur `0.0.0.0:3000` et Cloudron gère l’accès HTTPS.

## Cible Cloudron

- Version fournie par l’utilisateur : **Cloudron 8.3.2**.
- Adresse souhaitée : **sockets.vcnam.fr**.
- Une seule application ; aucun addon de base de données, d’authentification ou de stockage.
- Limite de mémoire initiale : 256 Mio, à mesurer pendant les essais.
- Image construite en dehors de Cloudron, pour ne pas utiliser un second emplacement avec une application de construction ou de registre.

Le manifeste conserve les champs disponibles sur Cloudron 8.3.2. Il n’utilise pas les nouveaux champs de publication du catalogue. La base Node.js Cloudron est épinglée par version datée et digest, suivant le guide officiel courant. Le fonctionnement réel du conteneur sur Cloudron reste à confirmer lors de l’installation.

Le modèle de workflow GitHub **Image du relais Cloudron** est fourni dans [relay-image.workflow.txt](relay-image.workflow.txt). Le workflow actif se trouve dans `.github/workflows/relay-image.yml`, sur la branche de préparation. Il se déclenche sur les modifications du relais dans cette branche, ou manuellement. Il exécute les tests, construit le Dockerfile racine puis publie `ghcr.io/vcnamgn/centurionmulti:relay-0.1.0` ainsi qu’une étiquette contenant le SHA Git. La visibilité du paquet GHCR doit être publique pour une récupération anonyme ; si GitHub l’a créé privé, la modifier dans les paramètres du paquet avant installation. Ne jamais inclure de token GitHub dans le manifeste, le Dockerfile ou une URL de téléchargement.

Depuis un checkout de cette branche, avec le client Cloudron installé :

```text
cloudron login my.vcnam.fr
cloudron install --image ghcr.io/vcnamgn/centurionmulti:relay-0.1.0 --location sockets.vcnam.fr
```

Le tableau de bord confirmé est `https://my.vcnam.fr`. Les commandes ne doivent être exécutées qu’après confirmation de la disponibilité de l’image. Le client lit le `CloudronManifest.json` du répertoire courant. Aucun service ne doit remplacer l’application déjà présente sur le serveur.

Après installation, ouvrir `https://sockets.vcnam.fr` et suivre les mêmes étapes que pour l’essai local. Les participants rejoignent ce site par leur lien ; ils n’installent pas chacun une application Cloudron. Le navigateur maître doit utiliser la version du simulateur servie par cette application pour activer ce premier raccordement.

## Portée du test

Le flux courant contient une projection confirmée à 5 Hz et un seul instantané est conservé par séance. L’auxiliaire affiche les mesures générales, les quatre GV et les quatre boucles. Les numéros de publication évitent de revenir à une mesure plus ancienne ; un remplacement du modèle renouvelle la génération. Le client ne publie pas un pas CC incomplet et aucune réponse du relais n’est attendue par la simulation.

La page auxiliaire ne charge ni `centurion-engine.js`, ni `centurion-app.js`, ni conduite auto ni éditeur CC. Les tokens maître et auxiliaire sont distincts ; les secrets des liens restent dans leur fragment et ne figurent pas dans les requêtes HTTP. La connexion maître est unique. Un rechargement de la page maître qui perd la simulation impose une nouvelle séance ; une simple reconnexion réseau du même maître vivant reste possible. Les anciens instantanés sont marqués périmés si le maître disparaît ; aucun auxiliaire n’est promu.

Les séances sans maître expirent après 30 minutes. Les limites par défaut sont 20 séances et 20 auxiliaires par séance ; les créations et publications sont bornées. Les mesures courantes sont remplaçables et envoyées sans file de rattrapage. Le serveur ne persiste aucun état : un redémarrage efface les séances, tandis que le maître continue sa simulation locale.

Pour ce premier essai, **garder l’onglet maître visible**. Les synoptiques complets côté auxiliaire, les historiques distants, les commandes distantes, les verrous d’édition et le Worker ne sont pas encore intégrés. Le simulateur individuel, ouvert sans lien maître, n’établit aucune connexion au relais.

## Références de packaging

- [Cloudron — manifeste](https://docs.cloudron.io/packaging/manifest/).
- [Cloudron — images de base et système de fichiers](https://docs.cloudron.io/packaging/cheat-sheet/).
- [GitHub — registre de conteneurs et visibilité des paquets](https://docs.github.com/en/packages/working-with-a-github-packages-registry/working-with-the-container-registry).

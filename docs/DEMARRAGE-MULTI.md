# Centurionmulti — préparation du partage

17 octobre 2026. Dépôt indépendant créé à partir de `vcnamgn/science005`, branche `main`, commit `ced5ea094b809def2d713a706ca6952b4ccd0492`. L’historique Git est conservé. Le dépôt source reste accessible par le remote de lecture `upstream` ; `origin` désigne `vcnamgn/centurionmulti`.

## Ce qui est prêt

- Une copie propre du code public, distincte du dossier de travail historique.
- Le [plan d’architecture](PARTAGE-SIMULATION.md) : maître autoritaire, auxiliaires sans calcul, relais optionnel, droits communs simples et reprise après coupure.
- Le [comparatif d’hébergement](PARTAGE-HEBERGEMENT.md), avec Vultr comme premier candidat et des alternatives gratuites ou économiques.
- `simulateur/centurion-commands.js` : premier point d’entrée local, sans DOM ni réseau, qui réutilise le catalogue et l’application des commandes de `centurion-auto.js`.
- Des vérifications ciblées du nouveau point d’entrée : priorités, validation sans effet, application en pause, changement de modèle et groupes refusés avant application.

Le nouveau module n’est pas encore chargé par la page et les gestionnaires du pupitre ne lui sont pas encore raccordés. Un premier relais et un tableau auxiliaire en lecture seule sont maintenant disponibles pour essai, avec création automatique d’une séance sur le relais et jonction par numéro de quatre chiffres. Le mode fichier ou site statique reste sans connexion. Voir `partage/relay/README.md`. Le point d’entrée local ne constitue pas une barrière d’authentification réseau : permissions, fraîcheur, file, déduplication et reçus seront ajoutés à la session autoritaire.

## Interface locale préparée

```js
const commands = CenturionCommands.create({
  getContext: () => ({
    E, model, regulationActive,
    setRegulationActive,
    setProtectionActive,
    setRManualOverride: changeManualROverride
  })
});

commands.validate({id: 'heater', value: 450}); // contrôle sans effet
commands.execute({id: 'heater', value: 450});
commands.executeMany([
  {id: 'regulation.enabled', value: 0},
  {id: 'heater', value: 450}
]);
```

Le chargement navigateur devra se faire après `centurion-auto.js`. En Node.js, `require('./simulateur/centurion-commands.js')` charge la dépendance directement. Les objets de commande ne contiennent que `id` et `value` ; valeurs nulles, bornes, énumérations et priorités sont celles du catalogue existant.

Le fournisseur de contexte est rappelé à chaque opération afin de retrouver le modèle courant après chargement ou réinitialisation. Les callbacks fournis par l’application doivent conserver leurs règles métier actuelles. `executeMany` réemploie la validation préalable existante de la conduite auto ; ce n’est pas une transaction avec retour arrière face à une exception imprévue d’un callback pendant l’application.

## Suite du premier lot

1. Inventorier les écritures dans `model.controls` et les appels moteur effectués par les gestionnaires DOM et les iframes. Distinguer commandes de simulation et navigation locale.
2. Compléter les commandes absentes du catalogue existant : programmes de charge, initiateurs, défaillances et paramètres sélectionnés. Énumérer chaque cible et ses bornes, sans écriture arbitraire de chemin.
3. Raccorder progressivement les commandes du pupitre au point d’entrée commun, avec affichage des refus et tests des priorités actuelles. Conserver la place de la conduite auto avant le pas physique.
4. Extraire la session locale autoritaire et sa frontière de pas, en prévoyant le traitement des commandes en pause et pendant les sauvegardes.
5. Préparer la projection d’affichage et le fournisseur d’historiques, distincts des sauvegardes complètes et des préférences de navigation.
6. Mettre à jour la conception du code et son catalogue généré lors de ce raccordement, puis valider la parité avant de commencer le transport en lecture seule.

Le prototype réseau transmet déjà les mesures courantes à 5 Hz. Les historiques sur demande restent à ajouter. Il n’attendra jamais un auxiliaire entre deux pas de 0,1 s. Le fonctionnement du maître masqué demande ensuite l’extraction conjointe de la physique, des CC et de la conduite auto dans un Worker local.

## Vérifications

```text
node --test simulateur/tests/centurion-commands.test.js
node --test simulateur/tests/centurion-cc.test.js simulateur/tests/centurion-auto-actions.test.js simulateur/tests/centurion-state.test.js
node scripts/check-docs.mjs
```

Les deux premières notes sont des propositions autonomes conservées en Markdown sur la branche de préparation. Leur ajout aux pages HTML publiques est différé jusqu’à l’intégration de la documentation du partage. Le test local est distinct de l’installation Cloudron. Le relais est installé sur https://s.vcnam.fr/simulateur/centurion.html (ancienne adresse sockets.vcnam.fr redirigée), sur Cloudron 8.3.1 (version vérifiée par l’API), avec un seul emplacement d’application. Le suivi maître–auxiliaire a été vérifié en HTTPS dans deux onglets ; les essais entre ordinateurs restent à faire. Voir les détails d’installation dans `partage/relay/README.md`.

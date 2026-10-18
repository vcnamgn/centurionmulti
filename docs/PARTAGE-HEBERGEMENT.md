# Héberger le relais de Centurionmulti

Comparatif vérifié le 17 octobre 2026 à partir des documentations officielles. Prix en dollars américains, hors taxes, change, dépassements et options. Ces offres peuvent évoluer.

## Recommandation pour commencer

Utiliser le serveur Vultr déjà disponible avec un petit service Node.js/Socket.IO dans un conteneur, derrière un reverse proxy HTTPS, si la machine dispose des ressources et du trafic nécessaires. Aucune nouvelle VM n’est requise par principe. Le coût supplémentaire peut être nul tant que l’instance existante et son allocation de trafic suffisent ; cela reste à vérifier sur le forfait réel.

Le navigateur maître garde l’ensemble des calculs. Le relais conserve seulement les séances et les connexions et distribue les messages. L’application statique peut rester sur GitHub Pages. Le même conteneur pourra être déployé sur un autre VPS ou une plateforme Node.js ; Cloudron reste une possibilité si l’on souhaite l’utiliser, pas une dépendance de l’architecture.

L’installation réelle nécessite l’adresse du serveur, un accès administrateur approprié, un nom d’hôte et la connaissance du reverse proxy existant. Aucun accès ni déploiement Vultr n’a été effectué à ce stade.

## Options

| Solution | Offre d’entrée vérifiée | Adaptation à Centurionmulti |
| --- | --- | --- |
| Vultr existant | Coût marginal potentiellement nul, dans les limites de la machine et du forfait déjà payés | Premier choix pour un relais Node.js/Socket.IO simple, maîtrise de l’hébergement et pas de quota commercial par message. Maintenance du serveur et trafic à suivre. |
| Render | Service web gratuit : 750 heures d’instance par espace de travail et par mois ; arrêt après 15 min sans trafic entrant ; redémarrage d’environ une minute. Petit calcul payant `0.5c-512mb` annoncé à 7 $/mois. | Même relais Node.js. Gratuit pour démonstrations et essais ; la mise en veille et les redémarrages effacent les séances en mémoire. Les messages WebSocket entrants comptent comme activité. Surveiller aussi le quota de trafic. |
| Railway | Free : essai 30 jours/5 $, puis 1 $ de crédit d’usage mensuel. Hobby : minimum 5 $/mois, dont 5 $ d’usage ; dépassements facturés. Trafic sortant de service : 0,05 $/Go. | Même relais Node.js, déploiement géré. Le crédit gratuit n’est pas un serveur permanent garanti ; 5 $ est un minimum, pas un forfait illimité. |
| Cloudflare Workers + Durable Objects | Gratuit : 100 000 requêtes/jour et 13 000 Go-s/jour pour Durable Objects. Offre Workers payante à partir de 5 $/mois, puis usage au-delà des allocations. | Bon candidat pour un relais WebSocket géré avec un objet par séance. Adapter le transport et le cycle de vie des séances au runtime Cloudflare ; ce n’est pas le simple dépôt du conteneur Node.js/Socket.IO. Aucun calcul du réacteur n’y serait transféré. |
| Ably Pub/Sub | Gratuit : 6 millions de messages/mois, 200 connexions simultanées, plafond de 500 messages/s. Offre Standard de base à 29 $/mois, puis consommation. | Évite d’exploiter soi-même le transport. Adaptateur Pub/Sub et attribution de capacités temporaires nécessaires pour isoler maître et auxiliaires ; une clé privée Ably ne doit pas être incluse dans l’application statique. Taille des messages et fan-out réduisent la durée utilisable gratuitement. |
| WebRTC avec PeerJS | Signalisation PeerServer Cloud proposée gratuitement ; TURN éventuel à prévoir séparément | Données potentiellement directes entre maître et auxiliaires. Davantage de complexité pour les connexions, reprises et réseaux filtrés ; le maître envoie une copie à chaque pair. Choix possible ensuite, sans avantage déterminant pour le premier lot. |

Les services de transport gérés ne remplacent pas la validation des commandes par le maître, les numéros de génération et les reçus d’application. Le choix d’hébergement ne change pas les deux rôles ni l’autonomie individuelle.

## Budget de trafic et quotas

Hypothèse illustrative, pas une mesure de production : instantané de 10 724 octets, cinq publications par seconde réelle, dix auxiliaires et une heure de fonctionnement.

- Le maître envoie environ 193 Mo au relais pendant l’heure.
- Le relais envoie environ 1,93 Go au total vers les dix auxiliaires, hors TLS/protocole, commandes, graphes et historiques.
- Dix heures de ce seul flux correspondent à environ 19,3 Go sortants du relais. La compression peut réduire ce chiffre ; les champs supplémentaires et historiques peuvent l’augmenter.

À ×200, il reste cinq publications courantes par seconde réelle ; en revanche, la production de points historiques augmente. Il faut plafonner et sélectionner les transferts d’historique, indépendamment du choix d’hébergeur.

Chez Ably, les messages sont comptés à l’entrée et pour chaque destinataire, par tranches de 5 Kio. À dix auxiliaires, un petit message de moins de 5 Kio publié à 5 Hz consomme donc environ `18 000 × 11 = 198 000` unités par heure, soit au plus environ 30 heures pour six millions d’unités, avant tous les autres messages. L’instantané nominal de 10 724 octets représente trois tranches : environ 594 000 unités par heure, soit environ dix heures sur le quota gratuit, avant commandes, présence et historiques. Ces chiffres supposent un canal où le maître ne reçoit pas sa propre publication.

Chez Cloudflare Durable Objects, les messages WebSocket entrants bénéficient d’un ratio de facturation de 20 pour 1 et les messages WebSocket sortants ne sont pas facturés comme requêtes. La durée active reste un autre poste de quota : utiliser l’API d’hibernation et mesurer l’activité réelle. Un calcul basé seulement sur le nombre de messages ne suffit pas à garantir la gratuité. Si un quota quotidien gratuit est épuisé, des opérations peuvent échouer jusqu’au renouvellement.

Pour les tests, Render gratuit permet de réutiliser directement le relais envisagé, au prix d’un démarrage plus lent après inactivité. Pour une séance de formation prévue à une heure donnée, le serveur Vultr existant évite cette attente de réveil. Pour supprimer la maintenance d’un VPS, Railway à partir de 5 $/mois ou Render à partir de 7 $/mois sont les alternatives simples ; Cloudflare est intéressant si l’on accepte un adaptateur spécifique.

## Préparation indépendante de l’hébergeur

Le protocole de séance et les règles d’application restent séparés du connecteur réseau. Le premier adaptateur visé est Socket.IO sur un seul processus Node.js. Les données du réacteur ne transitent qu’après calcul ; les files de publication et les historiques sont bornés. Une déconnexion du relais laisse le maître continuer sa simulation locale.

Les premiers livrables d’hébergement seront un répertoire de relais indépendant, ses dépendances verrouillées, un contrôle de santé, un conteneur et un exemple de reverse proxy HTTPS. L’adresse du relais sera configurable ; aucune adresse personnelle ou clé ne sera compilée dans le simulateur. Les manifests Cloudron ou d’une autre plateforme seront des ajouts de déploiement au même niveau.

## Sources officielles

- [Render — offres gratuites](https://render.com/docs/free), [tarifs](https://render.com/pricing) et [noms des plans de calcul](https://render.com/docs/compute-plans).
- [Railway — tarifs et crédits](https://railway.com/pricing).
- [Cloudflare — tarifs Durable Objects](https://developers.cloudflare.com/durable-objects/platform/pricing/) et [Workers](https://developers.cloudflare.com/workers/platform/pricing/).
- [Ably — offre gratuite](https://ably.com/docs/platform/pricing/free), [tarifs](https://ably.com/pricing) et [comptage des messages](https://ably.com/docs/messages).
- [PeerJS — démarrage du serveur de signalisation](https://peerjs.com/server/getting-started) et [FAQ, signalisation et TURN](https://peerjs.com/client/faq).

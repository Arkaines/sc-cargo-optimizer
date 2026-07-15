<p align="center">
  <img src="assets/logo.png" alt="Arkaine Heinlein" width="120" />
</p>

<h1 align="center">Optimiseur de routes cargo — Star Citizen</h1>

<p align="center">🇫🇷 Français · <a href="README.en.md">🇬🇧 English</a></p>

> Ceci est un site de fans non-officiel de Star Citizen, non affilié au groupe d'entreprises Cloud Imperium. Tout le contenu de ce site non créé par son hébergeur ou ses utilisateurs appartient à ses propriétaires respectifs. Site officiel : [robertsspaceindustries.com](https://robertsspaceindustries.com)

Petit outil web pour enregistrer des missions de transport (Star Citizen) et calculer l'ordre d'arrêts qui minimise la distance parcourue, en tenant compte de la capacité cargo de ton vaisseau.

Aucune installation, aucun build : c'est une page HTML/JS statique, à ouvrir directement dans le navigateur.

## Fonctionnalités

- **Missions multi-marchandises** : chaque mission peut contenir plusieurs marchandises, chacune avec son propre lieu de récupération et de dépôt.
- **Optimisation de trajet** : calcul exact (programmation dynamique) pour un nombre raisonnable de lieux, bascule automatique sur une heuristique (plus proche voisin + 2-opt) au-delà.
- **Suivi de charge** : simule la charge réelle du vaisseau tout au long du trajet (récupérations/dépôts), pas juste la somme totale — et compare à la capacité SCU du vaisseau sélectionné.
- **Données réelles [UEX Corp](https://uexcorp.space/api/documentation/)** : lieux, distances, marchandises, entreprises et vaisseaux, avec un bouton "Tout synchroniser" pour les rafraîchir. Les distances entre lieux sont dérivées du graphe d'orbites du jeu. Pour les lieux absents d'UEX (petits points de livraison), l'app se rabat sur le jeu de données plus granulaire de [Star Citizen Wiki](https://api.star-citizen.wiki).
- **Import par capture d'écran (OCR)** : colle ou dépose une capture de l'écran de détails d'un contrat en jeu, et l'app extrait automatiquement le titre, le donneur, les marchandises, les quantités, la récompense et les lieux (reconnaissance de texte via [Tesseract.js](https://github.com/naptha/tesseract.js), entièrement dans le navigateur). Fonctionne aussi bien avec un client français qu'anglais.
- **Réputation estimée par mission** : chaque mission (nouvelle, enregistrée ou dans l'historique) affiche la réputation qu'elle rapporte probablement, d'après un catalogue de missions/récompenses issu du [Star Citizen Wiki](https://api.star-citizen.wiki).
- **Onglet Réputation** : progression estimée vers le prochain palier pour chaque entreprise de transport (légale ou non), avec les vrais seuils du jeu. Le jeu n'affichant jamais le nombre exact de réputation, un calibrage manuel (palier constaté en jeu + curseur fin, verrouillable) permet de recaler l'estimation sur la réalité ; les missions terminées ensuite continuent de s'additionner par-dessus automatiquement.
- **Connexion Discord optionnelle** avec sauvegarde cloud (Supabase) : retrouve tes missions, ton historique et tes calibrages de réputation sur un autre appareil. L'appli reste 100% utilisable sans se connecter (données en local uniquement dans ce cas).
- **Onglet Optimisation du cargo** : range les marchandises des missions incluses dans les vraies soutes du vaisseau sélectionné (dimensions et capacités issues de [FleetYards.net](https://fleetyards.net/tools/cargo-grids/)) et affiche le résultat dans une vue 3D interactive (rotation à la souris), pour savoir où mettre quoi et ne pas se perdre pendant le trajet.
- **Bilingue FR/EN** et **thème clair/sombre**, avec préférence mémorisée.

## Utilisation

Ouvre simplement `index.html` dans un navigateur (Chrome/Edge recommandés pour la reconnaissance de texte), ou utilise directement le site en ligne. Toutes les données (missions, lieux personnalisés, distances, préférences) sont sauvegardées dans le stockage local du navigateur. La connexion avec Discord est optionnelle : elle ajoute une sauvegarde cloud (Supabase) pour retrouver ses données sur un autre appareil, sans quoi rien n'est envoyé à un serveur.

## Tutoriel

### 1. Choisir son vaisseau

Dans l'encart **Mon vaisseau** (panneau de gauche), sélectionne ton vaisseau dans la liste : sa capacité en SCU s'affiche et sert de référence pour détecter les surcharges de cargo.

### 2. Ajouter des missions

Deux façons de faire, dans l'onglet **Nouvelle mission** :

- **À la main** : renseigne le nom, le donneur, la récompense, puis ajoute une ou plusieurs lignes de marchandise (bouton "Ajouter une marchandise") en précisant pour chacune la quantité, le lieu de récupération et le lieu de dépôt.
- **Par capture d'écran (OCR)** : dans le panneau de gauche, colle (Ctrl+V) ou dépose l'image d'une capture d'écran du détail du contrat en jeu. L'outil extrait automatiquement les champs — vérifie-les puis clique sur "Utiliser ces champs dans le formulaire". Tu peux aussi coller/déposer **plusieurs captures en une fois** : dans ce cas, une mission est créée automatiquement pour chacune (un résumé indique ce qui a été créé et les points à vérifier). Un mode d'emploi avec un exemple de capture est disponible dans le panneau d'import.

### 3. Gérer les missions enregistrées

Dans l'onglet **Missions enregistrées** : coche/décoche les missions à inclure dans le calcul de trajet, termine une mission (elle passe dans l'Historique) ou supprime-la. Un avertissement apparaît au-delà de 10 missions actives (le jeu limite les contrats acceptés simultanément).

### 4. Optimiser la route

Dans l'onglet **Optimisation de la route**, choisis éventuellement un lieu de départ puis clique sur "Optimiser la route". L'outil calcule l'ordre d'arrêts qui minimise la distance totale, en respectant l'ordre récupération → dépôt de chaque marchandise, et affiche la charge du vaisseau à chaque étape. En cas de surcharge, une ligne indique quelle(s) mission(s) la provoquent, avec un bouton pour la/les désélectionner et recalculer aussitôt.

### 5. Historique et lieux personnalisés

L'onglet **Historique** liste les missions terminées (regroupées si identiques, avec un compteur "× N"), avec possibilité de les restaurer. Si un lieu n'existe pas dans la liste, tu peux en ajouter un manuellement depuis l'onglet Nouvelle mission. Le menu "Distances entre lieux utilisés" (en bas de page) permet de corriger une distance à la main si besoin.

### 6. Réputation

L'onglet **Réputation** liste les entreprises de transport (légales et illégales) pour lesquelles une progression est suivie. Pour chacune : le palier estimé (calculé depuis ton historique de missions terminées), et ce qu'il manque pour atteindre le suivant. Comme le jeu n'affiche jamais le nombre exact, tu peux calibrer manuellement : choisis ton palier réellement constaté en jeu dans le menu déroulant, ajuste finement avec le curseur (ou clique directement sur 0/25/50/75/100), puis clique sur le cadenas (🔓 → 🔒) pour verrouiller cette position — les missions terminées ensuite s'additionnent alors automatiquement par-dessus.

### 7. Connexion Discord et sauvegarde cloud

Le bouton "Se connecter avec Discord" (en haut à droite) est optionnel. Une fois connecté, tes données (missions, historique, lieux personnalisés, distances, calibrages de réputation) se synchronisent automatiquement avec ton compte, pour les retrouver sur un autre appareil. Sans connexion, tout reste en local dans le navigateur comme avant.

### 8. Synchronisation, langue et thème

Le bouton "Tout synchroniser" (panneau de gauche) met à jour lieux, distances, marchandises, entreprises et vaisseaux depuis UEX Corp. Les boutons en haut du header permettent de basculer entre français/anglais et thème clair/sombre ; les préférences sont mémorisées.

## Déploiement avec Docker

```bash
docker compose up -d --build
```

L'outil est alors accessible sur `http://<adresse-du-serveur>:8080`. Le port exposé se change dans `docker-compose.yml`.

Sans docker compose :

```bash
docker build -t sc-cargo-optimizer .
docker run -d -p 8080:80 --name sc-cargo-optimizer sc-cargo-optimizer
```

## Structure du projet

| Emplacement | Rôle |
|---|---|
| `index.html` | Page principale |
| `css/style.css` | Interface |
| `assets/` | Logo et favicon |
| `js/app.js` | Logique principale (état, optimisation de trajet, réputation, rendu) |
| `js/i18n.js` | Traductions FR/EN |
| `js/ocr.js` | Extraction de champs depuis le texte reconnu par Tesseract (titre, donneur, marchandises, lieux, récompense) |
| `js/uex.js` | Appels à l'API UEX Corp |
| `js/scwiki.js` | Appels à l'API communautaire Star Citizen Wiki |
| `js/fleetyards.js` | Appels à l'API publique de FleetYards.net (dimensions/capacités des soutes de cargo par vaisseau) |
| `js/cargo-packing.js` | Décompose les marchandises en caisses standard et calcule leur rangement dans les soutes du vaisseau (sans recouvrement) |
| `js/cargo-viewer.js` | Vue 3D interactive (Three.js) du rangement calculé |
| `js/cloud.js` | Connexion Discord et synchronisation cloud optionnelle (Supabase) |
| `data/locations.js`, `data/distances.js`, `data/commodities.js`, `data/companies.js`, `data/ships.js` | Données par défaut, générées depuis UEX Corp (rafraîchissables via "Tout synchroniser") |
| `data/location-aliases.js`, `data/commodity-aliases.js` | Alias de lieux/marchandises dont le nom affiché en jeu (client français) diffère du nom UEX (anglais), constitués au fil des écarts rencontrés |
| `data/mission-title-aliases.js` | Modèles de traduction pour les titres de mission "génériques" du client français, reconstruits à partir du donneur pour retrouver le titre anglais du catalogue |
| `data/scwiki-locations.js` | Lieux de secours issus de l'API Star Citizen Wiki, utilisés quand un lieu n'existe pas dans UEX (avant-postes/points de livraison mineurs) |
| `data/location-planets.js` | Recoupement local UEX ↔ Star Citizen Wiki (planète/lune de chaque lieu UEX), utilisé pour estimer une distance quand UEX ne la connaît pas (ex. orbite non résolue) |
| `data/mission-reputation.js`, `data/mission-reputation-by-title.js` | Catalogue réputation/récompense par mission (par titre exact, plus fiable, avec repli par donneur), issu de l'API Star Citizen Wiki |
| `data/faction-reputation-ladders.js` | Paliers de réputation (rang + seuil) par entreprise, issus de l'API Star Citizen Wiki |

## Source des données

Les données de jeu (lieux, distances, marchandises, entreprises, vaisseaux) proviennent de l'API publique de [UEX Corp](https://uexcorp.space/). Les données de missions et de réputation (catalogue par titre/donneur, paliers par entreprise) proviennent de l'API communautaire [Star Citizen Wiki](https://api.star-citizen.wiki), qui sert aussi de secours pour les lieux absents d'UEX. Les dimensions et capacités des soutes de cargo (onglet Optimisation du cargo) proviennent de l'API publique de [FleetYards.net](https://fleetyards.net/tools/cargo-grids/).

La réputation affichée reste une **estimation** : le jeu n'expose jamais le nombre exact, seulement un palier et une barre de progression sans valeur — d'où la possibilité de calibrer manuellement l'onglet Réputation.

La sauvegarde cloud optionnelle (connexion Discord) est hébergée sur [Supabase](https://supabase.com/) (base de données + authentification), avec un accès strictement limité aux données du compte connecté (sécurité au niveau des lignes/RLS).

Le logo "Made By The Community" provient du [Fan Kit officiel de Roberts Space Industries](https://robertsspaceindustries.com/fankit), utilisé conformément au [Star Citizen Fankit and Fandom FAQ](https://support.robertsspaceindustries.com/hc/en-us/articles/360006895793-Star-Citizen-Fankit-and-Fandom-FAQ).

## Licence

Code sous licence [MIT](LICENSE). Star Citizen, Roberts Space Industries et les autres marques citées appartiennent à leurs propriétaires respectifs — voir le bandeau de non-affiliation en haut du site.

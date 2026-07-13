<p align="center">
  <img src="logo.png" alt="Arkaine Heinlein" width="120" />
</p>

<h1 align="center">Optimiseur de routes cargo — Star Citizen</h1>

Petit outil web pour enregistrer des missions de transport (Star Citizen) et calculer l'ordre d'arrêts qui minimise la distance parcourue, en tenant compte de la capacité cargo de ton vaisseau.

Aucune installation, aucun build : c'est une page HTML/JS statique, à ouvrir directement dans le navigateur.

## Fonctionnalités

- **Missions multi-marchandises** : chaque mission peut contenir plusieurs marchandises, chacune avec son propre lieu de récupération et de dépôt.
- **Optimisation de trajet** : calcul exact (programmation dynamique) pour un nombre raisonnable de lieux, bascule automatique sur une heuristique (plus proche voisin + 2-opt) au-delà.
- **Suivi de charge** : simule la charge réelle du vaisseau tout au long du trajet (récupérations/dépôts), pas juste la somme totale — et compare à la capacité SCU du vaisseau sélectionné.
- **Données réelles [UEX Corp](https://uexcorp.space/api/documentation/)** : lieux, distances, marchandises, entreprises et vaisseaux, avec un bouton "Tout synchroniser" pour les rafraîchir. Les distances entre lieux sont dérivées du graphe d'orbites du jeu.
- **Import par capture d'écran (OCR)** : colle ou dépose une capture de l'écran de détails d'un contrat en jeu, et l'app extrait automatiquement le donneur, les marchandises, les quantités, la récompense et les lieux (reconnaissance de texte via [Tesseract.js](https://github.com/naptha/tesseract.js), entièrement dans le navigateur).
- **Bilingue FR/EN** et **thème clair/sombre**, avec préférence mémorisée.

## Utilisation

Ouvre simplement `index.html` dans un navigateur (Chrome/Edge recommandés pour la reconnaissance de texte). Toutes les données (missions, lieux personnalisés, distances, préférences) sont sauvegardées dans le stockage local du navigateur.

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

| Fichier | Rôle |
|---|---|
| `index.html` / `style.css` | Interface |
| `app.js` | Logique principale (état, optimisation de trajet, rendu) |
| `i18n.js` | Traductions FR/EN |
| `ocr.js` | Extraction de champs depuis le texte reconnu par Tesseract |
| `uex.js` | Appels à l'API UEX Corp |
| `locations.js`, `distances.js`, `commodities.js`, `companies.js`, `ships.js` | Données par défaut, générées depuis UEX Corp (rafraîchissables via "Tout synchroniser") |

## Source des données

Toutes les données de jeu (lieux, distances, marchandises, entreprises, vaisseaux) proviennent de l'API publique de [UEX Corp](https://uexcorp.space/).

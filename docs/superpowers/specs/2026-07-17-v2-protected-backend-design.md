# V2 — backend protégé : conception d'architecture

> # ⛔ ABANDONNÉ — NE PAS IMPLÉMENTER
>
> **Décision de l'utilisateur, le 2026-07-17, le jour même de la rédaction : on reste sur GitHub Pages, en site statique. Cette V2 ne sera pas construite.**
>
> Le document est conservé pour la trace du raisonnement, pas comme une feuille de route. **Rien ici ne doit être implémenté.**
>
> **Pourquoi l'abandon** — une fois le coût réel posé, le rapport bénéfice/prix ne tenait pas pour un outil de fan non commercial :
> - un coût récurrent **à vie**, à la charge de l'auteur (CIG interdit de monétiser) ;
> - **le hors-ligne meurt** et un compte devient obligatoire pour calculer ;
> - une **dépendance opérationnelle** (VPS en panne = plus aucun calcul), alors que la V1 statique ne tombe jamais ;
> - et surtout : **l'interface serait restée publique de toute façon** (§2) — l'objectif « qu'on ne me vole pas mon travail » n'était donc satisfait qu'en partie.
>
> **Ce qui protège le projet à la place** : la licence **propriétaire tous droits réservés** (voir `LICENSE`), qui fonctionne sur un dépôt public. Le code reste lisible — le copier, le réutiliser ou le redistribuer est interdit.
>
> **Conséquences actées** : le dépôt **reste public** (GitHub Pages n'est gratuit qu'ainsi) ; le passage en privé est écarté avec cette V2 ; l'architecture statique est conservée. La brique 2a (`2026-07-17-admin-grid-editor-design.md`), gelée uniquement à cause de cette V2, **redevient valide et reprenable telle quelle**.

**Statut historique (au moment de la rédaction) :** conception validée, à découper en briques (voir §8). Ce document était le cadre d'architecture ; chaque brique aurait eu son propre spec/plan.

## 1. Objectif et motivation

Décision de l'utilisateur : **protéger son travail**. Le projet représente un investissement important et sa licence est passée en propriétaire (tous droits réservés, voir `LICENSE`). La licence protège juridiquement ; ce document traite de la protection **technique**.

**Le problème** : la V1 est un site statique en JS vanilla. Le JS livré au navigateur **est** le code source — toute personne visitant le site peut lire l'intégralité de l'algorithme. Aucun réglage (dépôt privé, GitHub Pro, obfuscation) ne change cela ; l'obfuscation casserait l'architecture sans-build pour un ralentisseur contournable en minutes.

**La seule protection technique réelle** : déplacer ce qui doit être protégé sur un serveur, où le client ne reçoit que des résultats.

## 2. Ce qu'un backend protège — et ne protège pas

À poser noir sur blanc, parce que la limite est structurelle et non négociable :

**Protégé :**
- L'algorithme de rangement (`js/cargo-packing.js` : zonage 3D, conflits d'accès, comparaison hiérarchique).
- L'optimisation de trajet (Held-Karp avec contrainte de précédence + simulation de charge).
- L'accès en masse aux données : authentification obligatoire, limitation de débit, journalisation, bannissement possible.

**NON protégé, quoi qu'on fasse :**
- **Toute l'interface** : le visualiseur 3D Three.js, les onglets, le CSS. Ça s'exécute dans le navigateur, donc c'est livré au visiteur. Un site web livre son UI, backend ou pas.
- **Les données restent extractibles** par un utilisateur connecté légitime, qui appelle l'API comme le fait l'app — simplement plus lentement, sous authentification et journalisation.

Le backend **déplace la frontière** : il protège l'algorithme, pas le site.

## 3. Ce qui ne vaut PAS la peine d'être protégé

Constat déterminant pour le périmètre : **la majorité de `data/` n'est pas le travail de l'auteur.** `locations.js`, `commodities.js`, `companies.js`, `ships.js`, `scwiki-locations.js`, `distances.js` et les catalogues de réputation sont **régénérés depuis des API publiques** (UEX Corp, Star Citizen Wiki) — c'est exactement ce que fait `scripts/refresh-data.js`. N'importe qui peut les reconstituer en appelant les mêmes API.

Les cacher serait du théâtre : du travail pour zéro gain. Ils restent donc **servis tels quels**.

**Ce qui est réellement propriétaire :**
- `js/cargo-packing.js` — la vraie valeur.
- L'optimisation de trajet dans `js/app.js`.
- Les tables d'alias (`data/location-aliases.js`, `commodity-aliases.js`, `mission-title-aliases.js`) — construites à la main au fil des écarts OCR constatés, introuvables ailleurs.
- Le parsing OCR (`parseOcrText`, `js/ocr.js`) — savoir-faire accumulé.
- Les futures grilles communautaires — le gros de la valeur à venir.

## 4. Architecture

**Un seul petit VPS** (budget accepté : ~5-10 €/mois) qui assure deux rôles :
1. Il héberge l'**API Node** portant la logique protégée.
2. Il **sert le front statique**.

**Supabase est conservé** : auth Discord (déjà en place) et Postgres. L'API vérifie le jeton Supabase à chaque appel protégé.

**Conséquences :**
- Le VPS servant le front, **GitHub Pages n'est plus nécessaire** → le dépôt peut passer **privé sans souscrire GitHub Pro**. Un seul coût récurrent, celui déjà accepté.
- Côté serveur, la clé `service_role` de Supabase devient **utilisable sans danger** (variable d'environnement, jamais livrée au navigateur), ce qui simplifie l'accès aux données par l'API.

**Budget** : un VPS a été préféré au serverless gratuit parce que les tiers gratuits imposent démarrages à froid et limites de temps d'exécution — or le Held-Karp peut être coûteux en CPU.

## 5. La frontière serveur / client

| Serveur (protégé, authentifié) | Client (public, inévitablement) |
|---|---|
| Rangement (`cargo-packing.js`) | L'UI, les onglets, le CSS |
| Optimisation de trajet (Held-Karp + précédence + simulation de charge) | Le visualiseur 3D Three.js |
| Parsing OCR + tables d'alias | Tesseract.js — n'envoie que le **texte brut** |
| Grilles communautaires | L'affichage des résultats |
| Catalogues publics UEX/SC Wiki — **servis, pas cachés** (voir §3) | |

**Décision OCR** : Tesseract **reste dans le navigateur**. Il est gratuit, fonctionne déjà, et n'envoie aucune image — donc aucun coût de traitement ni question de vie privée. Seul le **texte brut reconnu** part vers l'API, qui applique le parsing et les alias (le savoir-faire protégé). On protège l'actif sans payer l'upload d'images.

## 6. L'authentification est le cœur de la protection

Sans elle, l'API devient **un service gratuit pour tout le monde** : le code resterait invisible, mais l'algorithme serait utilisable par n'importe qui. **Chaque endpoint protégé exige un jeton Supabase valide.** Pas de compte → pas d'algorithme.

C'est l'authentification, et non le fait de cacher un fichier, qui constitue la protection.

## 7. Ce qui est perdu, explicitement

- **Le hors-ligne meurt** pour le rangement et l'optimisation : ils exigent le réseau. Consulter ses missions enregistrées continue de fonctionner depuis le stockage local ; **calculer, non**.
- **Un compte devient obligatoire** pour l'usage principal (aujourd'hui l'app est pleinement utilisable sans connexion).
- **Un coût récurrent à vie**, à la charge de l'auteur : la politique de contenu de fan de CIG interdit de monétiser l'outil.
- **Une dépendance opérationnelle** : si le VPS tombe, l'app ne calcule plus. La V1 statique, elle, ne tombait jamais.

Ces pertes sont assumées : elles sont le prix de la protection, et il n'existe pas de variante qui protège sans les payer.

## 8. Découpage

« V2 avec backend » n'est pas un projet mais cinq. **La protection ne dépend que de la brique A.** Chaque brique aura son spec + plan.

- **A — L'API protégée** : VPS, API Node, auth JWT Supabase, portage du rangement, le front l'appelle. ← **atteint l'objectif**
- **B — L'optimisation de trajet** passe derrière l'API.
- **C — Le front servi par le VPS** + passage du dépôt en privé.
- **D — Le parsing OCR + les alias** côté serveur.
- **E — Les grilles communautaires** dans la nouvelle architecture (reprend la brique 2a gelée, voir `2026-07-17-admin-grid-editor-design.md`).

**Le front n'est PAS réécrit.** Décision explicite : sortir les algorithmes règle déjà l'essentiel de ce qui motivait la réécriture Svelte+TS envisagée — `js/app.js` (2500 lignes mêlant état, métier et DOM) **maigrit tout seul** quand le Held-Karp et le rangement partent. Réécrire le front n'apporterait **aucune protection** (un SPA statique reste public — c'était l'angle mort de l'ancien plan V2) et jetterait un travail UI récent et abouti (refonte Cockpit HUD, placement manuel des grilles, édition de la hauteur, i18n). Une réécriture restera possible plus tard, comme un choix et non un préalable.

## 9. Portabilité de l'algorithme — vérifiée

`js/cargo-packing.js` (1086 lignes) **ne contient aucune référence** à `document`, `window`, `localStorage` ni `alert` — vérifié par recherche. Mieux : `scripts/cargo-packing-tests.cjs` le charge déjà dans un `vm` Node dont le contexte ne contient que `{ Object, Math, Array, String }`, et ses **34 tests passent**. C'est donc du métier pur, sans dépendance navigateur : son portage côté serveur est un déplacement, pas une réécriture, et la suite de tests le suit telle quelle.

Contraste utile : `js/app.js` ne peut pas être chargé ainsi (il touche `document`/`localStorage` au chargement — voir `CLAUDE.md`), donc l'extraction de l'optimisation de trajet (brique B) demandera un vrai découpage, contrairement au rangement.

## 10. Tests et vérification

- **La suite existante suit l'algorithme** : `scripts/cargo-packing-tests.cjs` doit rester à **34/34** une fois le rangement porté côté serveur. C'est le filet de sécurité du portage : mêmes entrées, mêmes sorties.
- **Équivalence V1/V2** : pour un même jeu de missions et de vaisseau, le résultat renvoyé par l'API doit être identique à celui que la V1 calculait localement. À vérifier avant de basculer.
- **Authentification** : un appel sans jeton, ou avec un jeton invalide, doit être refusé — c'est la protection elle-même, elle doit être testée comme telle.
- **Dégradation** : l'API injoignable doit produire un message clair (« calcul indisponible »), jamais une page cassée ni un résultat silencieusement faux.

## 11. Hors périmètre

- **Réécriture du front** (Svelte/TS) : possible plus tard, sans rapport avec la protection (§8).
- **Cacher l'UI ou le rendu 3D** : impossible (§2).
- **Monétisation** : interdite par la politique de contenu de fan de CIG.
- **Obfuscation du client** : rejetée — casse l'architecture sans-build pour un gain nul.

# BizCheck

Application web gratuite, grand public : l'utilisateur tape une activité en langage courant
(ex. « escape game ») et voit comment se porte ce secteur en France (croissance / stable / déclin)
sur les 3 dernières années complètes, pour la France entière puis par région et département.

## Porteur du projet
- Débutant en développement : expliquer chaque étape simplement, commande par commande, en français.
- Windows 11, VS Code, Python 3.13, Git installé.

## Architecture
1. **Script de traitement** (Python + DuckDB), lancé une fois par an : télécharge les données publiques,
   calcule les indicateurs par code NAF × zone × année, écrit des fichiers JSON.
2. **Site statique** (HTML/JavaScript + Chart.js) : barre de recherche, filtres France / région / département,
   graphiques et courts commentaires automatiques. Export PDF paysage généré dans le navigateur.
3. **Hébergement gratuit** : Cloudflare Pages, Netlify ou GitHub Pages.

## Arborescence
```
BizCheck/        (C:\Users\thure\BizCheck, hors OneDrive, raccourci sur le bureau)
├── CLAUDE.md
├── data/        ← fichiers téléchargés (parquet Sirene, COG) — ne pas versionner
├── bizcheck.py  ← script : indicateurs France + régions + départements pour un code NAF
├── requirements.txt ← bibliothèques Python (pip install -r requirements.txt)
├── lancer_site.bat ← double-clic : serveur local + ouverture de http://localhost:8000
└── site/        ← site statique (c'est ce dossier qu'on mettra en ligne)
    ├── index.html, style.css, app.js  (Chart.js via CDN jsdelivr)
    └── donnees/ ← écrit par bizcheck.py (tous les codes NAF rév. 2 d'un coup, ~20 s) :
        infos.json (années, sources, limites, date de calcul), zones.json, secteurs.json,
        naf/<code>.json (nombres bruts par zone : actives_debut, actives_fin, creations, fermetures ;
        zone absente = 0 ; taux et solde calculés par le site)
```
Le site lit les JSON avec fetch : il ne marche pas en double-cliquant index.html (file://),
il faut le serveur local (`lancer_site.bat` ou `python -m http.server 8000 --directory site`).
Tendance affichée : croissance si actives fin N ≥ +2 % vs fin N-2, déclin si ≤ −2 %, sinon stable.

## Recherche par activité (fonction la plus importante)
- Libellés NAF officiels + notes explicatives INSEE, dictionnaire de synonymes, recherche tolérante aux fautes et accents.
- Si plusieurs codes correspondent : proposer un choix.
- Toujours afficher le secteur trouvé et ce qu'il regroupe (le code NAF est plus large que l'activité tapée).
- Prévoir la NAF 2025 (colonne `activitePrincipaleNAF25UniteLegale` déjà présente dans Sirene).

## Sources
- Base Sirene (INSEE, data.gouv.fr), fichiers stock en parquet (le CSV disparaît au 2e semestre 2027).
- Comptes annuels (data.gouv.fr / API RNE INPI) pour le chiffre d'affaires.
- BODACC pour les défaillances. Code officiel géographique (INSEE) pour commune → département → région.

## Règles de calcul (StockUniteLegale + StockEtablissement)
- Activité = `activitePrincipaleUniteLegale`, seulement si `nomenclatureActivitePrincipaleUniteLegale = 'NAFRev2'`
  (~3 % des actives encore en NAF 1993/NAP : exclues, signalé dans les limites).
- Création = `dateCreationUniteLegale`.
- Fermeture = `etatAdministratifUniteLegale = 'C'`, date = `dateDebut` (début de la dernière période).
- Active au 31/12/A = créée au plus tard le 31/12/A et non fermée à cette date.
- Taux de création / fermeture = rapportés aux entreprises actives au 1er janvier.
- Lieu = commune du siège actuel (`etablissementSiege = true` dans StockEtablissement) ;
  département = 2 premiers caractères du code commune (3 si 97x), région via le COG.
- Codes de zone dans les JSON : `FR`, `R84` (région), `D69` (département).
- Siège à l'étranger ou en collectivité d'outre-mer (975, 977, 978, 98x) : compté en France seulement.

## Transparence (obligatoire, site ET PDF)
- Sous chaque graphique : source, date d'actualisation, limite de l'indicateur.
- Dates d'actualisation écrites automatiquement par les scripts dans les JSON, jamais à la main.
- Avertissement si moins de 20 entreprises dans la zone.

## Planning
- Sem. 1–2 : environnement + script Sirene ← fait
- Sem. 3 : site avec graphiques et filtres géographiques ← fait (filtres zone ; sélecteur de secteur provisoire)
- Sem. 4 : recherche par mots-clés ← prochaine étape (+ calcul de tous les codes NAF)
- Sem. 5–6 : CA, défaillances, export PDF, mise en ligne

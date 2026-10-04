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
├── data/          ← fichiers téléchargés (Sirene, COG, NAF, population, contours) — ne pas versionner
├── bizcheck.py    ← script principal (orchestration, affichage, écriture des JSON) — ~1 min
├── parametres.py  ← années (10 ans d'historique, 3 ans de tendance), seuils, chemins
├── sources.py     ← téléchargements : Sirene, COG, NAF, population (geo.api.gouv.fr), contours (france-geojson)
├── indicateurs.py ← requêtes DuckDB (GROUPING SETS France/région/département + « TOUS » = toutes activités)
├── territoires.py ← contexte local (INSEE Melodi) + salaires moyens (URSSAF NA88)
├── carte.py       ← contours GeoJSON → tracés SVG (DOM en encadrés, zoom Paris + petite couronne)
├── recherche.py   ← notes INSEE (SPARQL rdf.insee.fr) + synonymes → recherche.json
├── synonymes.csv  ← mots courants → code NAF (expression;code_naf;remarque), rempli à la main
├── requirements.txt ← bibliothèques Python (pip install -r requirements.txt)
├── lancer_site.bat  ← double-clic : serveur local + ouverture de http://localhost:8000
└── site/          ← site statique (c'est ce dossier qu'on mettra en ligne)
    ├── index.html, style.css
    ├── app.js (page), recherche.js, graphiques.js (Chart.js via CDN), carte.js, ville.js, outils.js — modules ES
    └── donnees/   ← écrit par bizcheck.py (~55 Mo) :
        infos.json, zones.json (+ population), secteurs.json (évolution, rang), recherche.json,
        communes.json, carte.json, naf/<code>.json (+ naf/TOUS.json = toutes activités),
        communes/<code>.json (établissements actifs par commune) ; zone absente d'un fichier = 0
```
Le site lit les JSON avec fetch : il ne marche pas en double-cliquant index.html (file://),
il faut le serveur local (`lancer_site.bat` ou `python -m http.server 8000 --directory site`).

## Contenu d'une page secteur
- Ce que regroupe le secteur (notes INSEE) ; 6 tuiles : tendance (±2 % sur 3 ans) + rang national
  (secteurs ≥ 100 entreprises), actives, créations, fermetures, survie à 3 ans, établissements / 10 000 hab.
- Évolution 10 ans (actives, créations/fermetures, tableau) ; survie 1/3/5 ans vs toutes activités ;
  portrait (taille, forme juridique, âge, réseaux) ; saisonnalité (France) ; carte (évolution / densité,
  clic = zone) ; « Et dans ma ville ? » (établissements de la commune, densité vs département et France).
- Densité et ville = établissements actifs selon LEUR activité et LEUR adresse ; le reste = entreprises (siège).
- Survie = administrative (non radiée), plus haute que la survie économique des études INSEE : toujours le dire.
- Lot 2 (economie.js) : salariés 10 ans + employeurs (URSSAF commune × APE), salaire moyen brut
  (URSSAF NA88, division = 2 premiers chiffres du NAF, France), défaillances 10 ans + taux (BODACC :
  jugements d'ouverture RJ/LJ, 1 par SIREN et par an — ≈ 66 700 en 2024, cohérent Banque de France),
  comptes médians (ratios BdF/INPI : CA, marge EBE, marge nette, % en perte, délai clients ; comptes
  C/S publics, année = dernière ayant ≥ 80 % des comptes de l'année d'avant, seuil 20 comptes),
  « Le territoire » (population 2017→2023, niveau de vie médian et pauvreté Filosofi 2023, via INSEE
  Melodi) ; la ville affiche aussi salariés, niveau de vie, évolution de la population.
- Fichiers lot 2 dans data/ : urssaf_*.parquet, ratios_financiers.parquet (230 Mo), bodacc_defaillances.parquet,
  insee_*.zip ; territoires.py = contexte local + salaires ; communes/<code>.json = [établissements, salariés].

## Recherche par activité (fonction la plus importante)
- Fait (sem. 4) : recherche/recherche.js, tout dans le navigateur. Poids : synonyme 10, libellé 4,
  comprend 2, comprend aussi 1,5, renvoi 1,5 (texte d'un « ne comprend pas … cf. X » rangé avec X).
  Tolère accents, pluriels, mots incomplets, fautes (Levenshtein 1 dès 4 lettres, 2 dès 8).
  Pour corriger un mauvais résultat : ajouter une ligne dans synonymes.csv puis relancer bizcheck.py.
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
- Sem. 4 : recherche par mots-clés ← fait (tous les codes NAF calculés, synonymes à enrichir)
- Lot 1 d'infos supplémentaires ← fait (voir « Contenu d'une page secteur »)
- Lot 2 : emploi, salaires, comptes, défaillances, territoire ← fait
- Sem. 5–6 : export PDF, direction artistique, mise en ligne

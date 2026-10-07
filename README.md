# BizCheck

**Comment se porte un secteur d'activité en France ?**

BizCheck est un outil gratuit et d'utilité publique pour les futurs entrepreneurs et toutes les personnes
qui veulent comprendre un marché. On tape une activité en langage courant (« escape game », « boulangerie »,
« plombier »…) et le site affiche, pour la France entière, chaque région et chaque département :

- la tendance du secteur (croissance, stabilité ou déclin) et son classement parmi les 732 secteurs ;
- les créations, les fermetures et le nombre d'entreprises sur 10 ans ;
- le taux de survie à 1, 3 et 5 ans ;
- le portrait des entreprises (taille, forme juridique, âge, réseaux) ;
- l'emploi salarié, le salaire moyen, les défaillances et la rentabilité médiane ;
- une carte des départements, la densité d'établissements et le détail par commune ;
- un rapport PDF à télécharger.

Chaque chiffre est accompagné de sa source, de sa date de mise à jour et de ses limites.

## Sources

Uniquement des données publiques :

| Donnée | Producteur |
|---|---|
| Base Sirene des entreprises et des établissements | INSEE (data.gouv.fr) |
| Code officiel géographique, nomenclature NAF rév. 2 et ses notes explicatives | INSEE |
| Populations légales, populations historiques, niveau de vie (Filosofi) | INSEE |
| Établissements employeurs, effectifs salariés et masse salariale | URSSAF (open.urssaf.fr) |
| Procédures collectives (redressements, liquidations) | BODACC (DILA) |
| Ratios financiers des entreprises | Banque de France / INPI (data.economie.gouv.fr) |
| Contours des départements | IGN Admin Express, via france-geojson |

Ces données sont réutilisées dans le respect de leurs licences (principalement la Licence Ouverte / Open Licence
d'Etalab).

## Fonctionnement

1. Un script Python ([`bizcheck.py`](bizcheck.py)), lancé une fois par an, télécharge les données publiques
   dans `data/` (environ 3,6 Go, non versionné), calcule les indicateurs avec DuckDB et écrit des fichiers
   JSON dans `site/donnees/`.
2. Le site ([`site/`](site/)) est une simple page HTML/JavaScript qui lit ces fichiers : pas de serveur, pas de
   base de données, pas de compte utilisateur.
3. À chaque envoi sur la branche `main`, GitHub Actions publie le dossier `site/` sur GitHub Pages.

## Mettre à jour les chiffres

Avec Python 3.12 ou plus récent :

```
pip install -r requirements.txt
python bizcheck.py
```

Pour forcer le téléchargement de données plus récentes, supprimer le fichier concerné dans `data/`
(ou tout le dossier) avant de relancer. Pour voir le site sur son ordinateur : double-cliquer sur
`lancer_site.bat` (Windows) ou lancer `python -m http.server 8000 --directory site`.

Pour améliorer la recherche d'activité, ajouter des lignes dans [`synonymes.csv`](synonymes.csv)
(`expression;code_naf;remarque`) puis relancer le script.

## Licence

Le code est sous [licence MIT](LICENSE) : vous pouvez le réutiliser, le modifier et le redistribuer librement,
y compris pour l'adapter à vos besoins, en mentionnant son origine.

"""Réglages communs à tous les scripts BizCheck (années, seuils, dossiers)."""

from datetime import date
from pathlib import Path

# --- Années -------------------------------------------------------------------

ANNEE_EN_COURS = date.today().year
DERNIERE_ANNEE = ANNEE_EN_COURS - 1          # dernière année complète
NB_ANNEES_HISTORIQUE = 10                    # graphique « sur 10 ans »
NB_ANNEES_PRINCIPALES = 3                    # tendance, chiffres clés
ANNEES = list(range(DERNIERE_ANNEE - NB_ANNEES_HISTORIQUE + 1, DERNIERE_ANNEE + 1))

DUREES_SURVIE = [1, 3, 5]                    # taux de survie à 1, 3 et 5 ans
NB_ANNEES_SAISONNALITE = 5                   # créations par mois : moyenne sur 5 ans

# --- Seuils -------------------------------------------------------------------

SEUIL_PETIT_EFFECTIF = 20  # en dessous : avertissement « chiffres peu fiables »

# --- Dossiers et fichiers -----------------------------------------------------

DOSSIER_PROJET = Path(__file__).resolve().parent
DOSSIER_DATA = DOSSIER_PROJET / "data"
DOSSIER_SORTIES = DOSSIER_PROJET / "site" / "donnees"  # lu directement par le site
DOSSIER_SECTEURS = DOSSIER_SORTIES / "naf"
DOSSIER_COMMUNES = DOSSIER_SORTIES / "communes"

FICHIER_UNITES_LEGALES = DOSSIER_DATA / "StockUniteLegale.parquet"
FICHIER_ETABLISSEMENTS = DOSSIER_DATA / "StockEtablissement.parquet"
FICHIER_DEPARTEMENTS = DOSSIER_DATA / "cog_departements.csv"
FICHIER_REGIONS = DOSSIER_DATA / "cog_regions.csv"
FICHIER_INFOS_COG = DOSSIER_DATA / "cog.infos.json"
FICHIER_NAF = DOSSIER_DATA / "naf_rev2_niveau5.xls"
FICHIER_POPULATION = DOSSIER_DATA / "communes_population.json"
FICHIER_INFOS_POPULATION = DOSSIER_DATA / "communes_population.infos.json"
FICHIER_CONTOURS = DOSSIER_DATA / "departements-avec-outre-mer.geojson"

# Lot 2 : emploi, salaires, comptes, défaillances, revenus, population
FICHIER_URSSAF_EFFECTIFS = DOSSIER_DATA / "urssaf_effectifs_commune_ape.parquet"
FICHIER_URSSAF_SALAIRES = DOSSIER_DATA / "urssaf_salaires_na88.parquet"
FICHIER_RATIOS = DOSSIER_DATA / "ratios_financiers.parquet"
FICHIER_BODACC = DOSSIER_DATA / "bodacc_defaillances.parquet"
FICHIER_FILOSOFI = DOSSIER_DATA / "insee_filosofi.zip"
FICHIER_POPULATIONS_HISTORIQUES = DOSSIER_DATA / "insee_populations_historiques.zip"

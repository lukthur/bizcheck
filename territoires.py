"""
Contexte local (INSEE) et salaires moyens (URSSAF).

  - niveau de vie médian et taux de pauvreté 2023 (Filosofi) : France métropolitaine,
    régions, départements, communes ;
  - évolution de la population entre deux recensements (populations municipales) ;
  - salaire moyen par grande famille de secteurs (NA88 : les 2 premiers chiffres du code NAF).
"""

import csv
import io
import re
import zipfile

import duckdb

from parametres import DERNIERE_ANNEE, FICHIER_FILOSOFI, FICHIER_POPULATIONS_HISTORIQUES, FICHIER_URSSAF_SALAIRES

ANNEE_POPULATION_DEBUT = 2017
ANNEE_POPULATION_FIN = 2023
NB_ANNEES_SALAIRES = 3  # salaire moyen des 3 dernières années complètes

# Codes géographiques INSEE → codes de zone BizCheck
OBJETS_GEO = {"FRANCE": "FR", "REG": "R", "DEP": "D", "COM": "C"}


def lire_csv_zip(fichier_zip):
    archive = zipfile.ZipFile(fichier_zip)
    nom = next(n for n in archive.namelist() if n.endswith("_data.csv"))
    with archive.open(nom) as f:
        yield from csv.DictReader(io.TextIOWrapper(f, encoding="utf-8"), delimiter=";")


def code_zone(objet, geo):
    if objet == "FRANCE":
        return "FR" if geo in ("F", "FM") else None
    prefixe = OBJETS_GEO.get(objet)
    return f"{prefixe}{geo}" if prefixe else None


def contexte_local():
    """
    Renvoie {code zone ou 'C' + code commune: {revenu_median, taux_pauvrete, population_debut, population_fin}}.
    Pour la France, le niveau de vie est celui de la France métropolitaine (Filosofi).
    """
    contexte = {}
    for ligne in lire_csv_zip(FICHIER_FILOSOFI):
        mesure = {"MED_SL": "revenu_median", "PR_MD60": "taux_pauvrete"}.get(ligne["FILOSOFI_MEASURE"])
        zone = code_zone(ligne["GEO_OBJECT"], ligne["GEO"])
        if mesure and zone and ligne["OBS_VALUE"]:
            # en France, Filosofi distingue métropole (FM) et France entière : on garde la métropole
            if zone == "FR" and ligne["GEO"] != "FM":
                continue
            contexte.setdefault(zone, {})[mesure] = float(ligne["OBS_VALUE"])

    annees = {str(ANNEE_POPULATION_DEBUT): "population_debut", str(ANNEE_POPULATION_FIN): "population_fin"}
    for ligne in lire_csv_zip(FICHIER_POPULATIONS_HISTORIQUES):
        cle = annees.get(ligne["TIME_PERIOD"])
        zone = code_zone(ligne["GEO_OBJECT"], ligne["GEO"])
        if cle and zone and ligne["POPREF_MEASURE"] == "PMUN" and ligne["OBS_VALUE"]:
            if zone == "FR" and ligne["GEO"] != "F":  # F = France entière, FM = métropole
                continue
            contexte.setdefault(zone, {})[cle] = int(float(ligne["OBS_VALUE"]))
    return contexte


def salaires_par_division():
    """
    Salaire moyen brut annuel par salarié, pour chaque division NAF (2 premiers chiffres)
    et pour l'ensemble du privé : masse salariale de l'année / effectif moyen des 4 trimestres.
    Renvoie {"annees": [...], "divisions": {"10": {"libelle", "salaires"}}, "ensemble": [...]}.
    """
    annees = list(range(DERNIERE_ANNEE - NB_ANNEES_SALAIRES + 1, DERNIERE_ANNEE + 1))
    lignes = duckdb.sql(f"""
        SELECT secteur_na88i AS secteur, YEAR(annee) AS annee,
               SUM(masse_salariale_brut) AS masse, AVG(effectifs_salaries_brut) AS effectif,
               COUNT(*) AS trimestres
        FROM read_parquet('{FICHIER_URSSAF_SALAIRES.as_posix()}')
        WHERE YEAR(annee) BETWEEN {annees[0]} AND {annees[-1]}
        GROUP BY ALL
    """).fetchall()

    divisions = {}
    totaux = {a: [0, 0] for a in annees}
    for secteur, annee, masse, effectif, trimestres in lignes:
        if trimestres != 4:
            continue  # année incomplète
        # « 05-06 Extraction de houille… » couvre les divisions 05 et 06
        codes = re.match(r"(\d\d)(?:-(\d\d))?\s+(.*)", secteur)
        if not codes:
            continue
        debut, fin, libelle = codes.group(1), codes.group(2) or codes.group(1), codes.group(3)
        for division in range(int(debut), int(fin) + 1):
            entree = divisions.setdefault(f"{division:02d}", {"libelle": libelle, "salaires": [None] * len(annees)})
            entree["salaires"][annees.index(annee)] = round(masse / effectif) if effectif else None
        totaux[annee][0] += masse
        totaux[annee][1] += effectif
    ensemble = [round(m / e) if e else None for m, e in (totaux[a] for a in annees)]
    return {"annees": annees, "divisions": divisions, "ensemble": ensemble}

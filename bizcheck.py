"""
BizCheck
========

Calcule, pour UN code NAF, l'évolution du secteur sur les 3 dernières années
complètes, pour la France entière, chaque région et chaque département :
  - entreprises actives au 31 décembre
  - créations, fermetures, solde net
  - taux de création et de fermeture

Sources (téléchargées automatiquement si elles ne sont pas déjà dans data/) :
  - base Sirene (INSEE, data.gouv.fr), fichiers parquet :
      StockUniteLegale   → activité, date de création, date de fermeture
      StockEtablissement → commune du siège de chaque entreprise
  - Code officiel géographique (INSEE) → départements et régions

Lancement (depuis le dossier BizCheck) :
    python bizcheck.py
"""

import csv
import json
import re
import sys
import urllib.request
from datetime import date, datetime
from pathlib import Path

import duckdb

# Affiche correctement les accents dans le terminal Windows
sys.stdout.reconfigure(encoding="utf-8")

# --- Paramètres à modifier ---------------------------------------------------

CODE_NAF = "93.29Z"  # Autres activités récréatives et de loisirs (dont escape game)

ANNEE_EN_COURS = date.today().year
ANNEES = [ANNEE_EN_COURS - 3, ANNEE_EN_COURS - 2, ANNEE_EN_COURS - 1]

SEUIL_PETIT_EFFECTIF = 20  # en dessous : avertissement « chiffres peu fiables »

# --- Chemins -----------------------------------------------------------------

DOSSIER_PROJET = Path(__file__).resolve().parent
DOSSIER_DATA = DOSSIER_PROJET / "data"
DOSSIER_SORTIES = DOSSIER_PROJET / "sorties"

FICHIER_DEPARTEMENTS = DOSSIER_DATA / "cog_departements.csv"
FICHIER_REGIONS = DOSSIER_DATA / "cog_regions.csv"
FICHIER_INFOS_COG = DOSSIER_DATA / "cog.infos.json"

# Identifiants des jeux de données sur data.gouv.fr
API_SIRENE = "https://www.data.gouv.fr/api/1/datasets/5b7ffc618b4c4169d30727e0/"
API_COG = "https://www.data.gouv.fr/api/1/datasets/58c984b088ee386cdb1261f3/"


# --- 1. Téléchargements ------------------------------------------------------

def lire_jeu_datagouv(url_api):
    with urllib.request.urlopen(url_api) as reponse:
        return json.load(reponse)


def afficher_progression(nb_blocs, taille_bloc, taille_totale):
    if taille_totale > 0:
        pourcent = min(100, nb_blocs * taille_bloc * 100 // taille_totale)
        print(f"\r  Téléchargement : {pourcent} %", end="", flush=True)


def telecharger(url, destination):
    """Télécharge dans un fichier temporaire, renommé seulement si tout est arrivé."""
    DOSSIER_DATA.mkdir(exist_ok=True)
    fichier_temporaire = destination.with_suffix(".part")
    urllib.request.urlretrieve(url, fichier_temporaire, afficher_progression)
    fichier_temporaire.replace(destination)
    print()


def telecharger_sirene(nom):
    """nom = 'StockUniteLegale' ou 'StockEtablissement'. Renvoie les infos de la source."""
    fichier = DOSSIER_DATA / f"{nom}.parquet"
    fichier_infos = DOSSIER_DATA / f"{nom}.infos.json"
    if fichier.exists() and fichier_infos.exists():
        infos = json.loads(fichier_infos.read_text(encoding="utf-8"))
        print(f"{nom} déjà présent (version du {infos['date_mise_a_jour']}).")
        return infos

    for ressource in lire_jeu_datagouv(API_SIRENE)["resources"]:
        titre = ressource["title"]
        # « Fichier StockEtablissement - » exclut StockEtablissementHistorique, etc.
        if f"Fichier {nom} -" in titre and "parquet" in titre:
            infos = {
                "titre": titre,
                "url": ressource["url"],
                "date_mise_a_jour": ressource["last_modified"][:10],
                "taille": ressource.get("filesize") or 0,
            }
            break
    else:
        sys.exit(f"Impossible de trouver le fichier {nom} (parquet) sur data.gouv.fr.")

    print(f"Téléchargement de : {infos['titre']} (~{infos['taille'] // 1_000_000} Mo)")
    print("  Cela peut prendre plusieurs minutes selon ta connexion...")
    telecharger(infos["url"], fichier)
    fichier_infos.write_text(json.dumps(infos, ensure_ascii=False, indent=2), encoding="utf-8")
    return infos


def telecharger_cog():
    """Listes officielles des départements et des régions (millésime le plus récent)."""
    if FICHIER_DEPARTEMENTS.exists() and FICHIER_REGIONS.exists() and FICHIER_INFOS_COG.exists():
        infos = json.loads(FICHIER_INFOS_COG.read_text(encoding="utf-8"))
        print(f"Code officiel géographique déjà présent (millésime {infos['millesime']}).")
        return infos

    # Titres du type « Millésime 2026 : Liste des départements au 01/01/2026 »
    trouves = {}
    for ressource in lire_jeu_datagouv(API_COG)["resources"]:
        resultat = re.search(r"Liste des (départements|régions) au 01/01/(\d{4})", ressource["title"])
        if resultat:
            sorte, annee = resultat.group(1), int(resultat.group(2))
            if annee > trouves.get(sorte, (0, ""))[0]:
                trouves[sorte] = (annee, ressource["url"])
    if len(trouves) < 2:
        sys.exit("Impossible de trouver le Code officiel géographique sur data.gouv.fr.")

    print(f"Téléchargement du Code officiel géographique {trouves['départements'][0]}...")
    telecharger(trouves["départements"][1], FICHIER_DEPARTEMENTS)
    telecharger(trouves["régions"][1], FICHIER_REGIONS)
    infos = {
        "millesime": trouves["départements"][0],
        "url_departements": trouves["départements"][1],
        "url_regions": trouves["régions"][1],
    }
    FICHIER_INFOS_COG.write_text(json.dumps(infos, ensure_ascii=False, indent=2), encoding="utf-8")
    return infos


def lire_zones():
    """Renvoie {code zone: {type, nom, (region)}} : France, régions (R..), départements (D..)."""
    zones = {"FR": {"type": "france", "nom": "France"}}
    with FICHIER_REGIONS.open(encoding="utf-8") as f:
        for ligne in csv.DictReader(f):
            zones[f"R{ligne['REG']}"] = {"type": "region", "nom": ligne["LIBELLE"]}
    with FICHIER_DEPARTEMENTS.open(encoding="utf-8") as f:
        for ligne in csv.DictReader(f):
            zones[f"D{ligne['DEP']}"] = {
                "type": "departement",
                "nom": ligne["LIBELLE"],
                "region": f"R{ligne['REG']}",
            }
    return zones


# --- 2. Calcul des indicateurs -----------------------------------------------

# Règles utilisées (fichiers stock = situation actuelle de chaque entreprise) :
#   - création  : dateCreationUniteLegale
#   - fermeture : etatAdministratifUniteLegale = 'C' (cessée) ; la date de cessation
#                 est alors dateDebut (début de la dernière période, celle de la fermeture)
#   - active au 31/12/A : créée au plus tard le 31/12/A et pas fermée à cette date
#   - lieu      : commune actuelle (ou la dernière connue) du siège de l'entreprise ;
#                 département = 2 premiers caractères du code commune (3 pour l'outre-mer)
REQUETE = """
WITH entreprises AS (
    SELECT
        siren,
        TRY_CAST(dateCreationUniteLegale AS DATE) AS date_creation,
        CASE WHEN etatAdministratifUniteLegale = 'C'
             THEN TRY_CAST(dateDebut AS DATE) END AS date_fermeture
    FROM read_parquet($unites_legales)
    WHERE activitePrincipaleUniteLegale = $code_naf
),
sieges AS (
    SELECT
        siren,
        ANY_VALUE(CASE WHEN codeCommuneEtablissement LIKE '97%'
                       THEN LEFT(codeCommuneEtablissement, 3)
                       ELSE LEFT(codeCommuneEtablissement, 2) END) AS dep
    FROM read_parquet($etablissements)
    WHERE etablissementSiege
      AND siren IN (SELECT siren FROM entreprises)
    GROUP BY siren
),
secteur AS (
    SELECT e.*, d.DEP AS dep, d.REG AS reg
    FROM entreprises e
    LEFT JOIN sieges s USING (siren)
    LEFT JOIN read_csv($departements, all_varchar = true) d ON d.DEP = s.dep
),
annees AS (
    SELECT UNNEST($annees::INTEGER[]) AS annee
)
SELECT
    a.annee,
    CASE WHEN GROUPING(s.dep) = 0 THEN 'D' || s.dep
         WHEN GROUPING(s.reg) = 0 THEN 'R' || s.reg
         ELSE 'FR' END AS zone,
    COUNT(*) FILTER (
        WHERE s.date_creation <= MAKE_DATE(a.annee - 1, 12, 31)
          AND (s.date_fermeture IS NULL OR s.date_fermeture > MAKE_DATE(a.annee - 1, 12, 31))
    ) AS actives_debut,
    COUNT(*) FILTER (
        WHERE s.date_creation <= MAKE_DATE(a.annee, 12, 31)
          AND (s.date_fermeture IS NULL OR s.date_fermeture > MAKE_DATE(a.annee, 12, 31))
    ) AS actives_fin,
    COUNT(*) FILTER (WHERE YEAR(s.date_creation) = a.annee) AS creations,
    COUNT(*) FILTER (WHERE YEAR(s.date_fermeture) = a.annee) AS fermetures
FROM annees a
CROSS JOIN secteur s
GROUP BY GROUPING SETS ((a.annee), (a.annee, s.reg), (a.annee, s.dep))
HAVING zone IS NOT NULL  -- entreprises sans zone connue : comptées en France seulement
ORDER BY zone, a.annee
"""


def indicateurs_annee(annee, actives_debut, actives_fin, creations, fermetures):
    return {
        "annee": annee,
        "entreprises_actives_fin_annee": actives_fin,
        "creations": creations,
        "fermetures": fermetures,
        "solde_net": creations - fermetures,
        # taux calculés par rapport au nombre d'entreprises actives au 1er janvier
        "taux_creation_pct": round(100 * creations / actives_debut, 1) if actives_debut else None,
        "taux_fermeture_pct": round(100 * fermetures / actives_debut, 1) if actives_debut else None,
    }


def calculer_indicateurs(zones):
    connexion = duckdb.connect()
    lignes = connexion.execute(REQUETE, {
        "unites_legales": str(DOSSIER_DATA / "StockUniteLegale.parquet"),
        "etablissements": str(DOSSIER_DATA / "StockEtablissement.parquet"),
        "departements": str(FICHIER_DEPARTEMENTS),
        "code_naf": CODE_NAF,
        "annees": ANNEES,
    }).fetchall()

    trouves = {(zone, annee): ligne for annee, zone, *ligne in lignes}

    resultats = {}
    for code_zone, zone in zones.items():
        # une zone sans aucune entreprise du secteur n'apparaît pas dans la requête : on met 0
        indicateurs = [indicateurs_annee(annee, *trouves.get((code_zone, annee), (0, 0, 0, 0)))
                       for annee in ANNEES]
        resultats[code_zone] = {
            **zone,
            "indicateurs": indicateurs,
            "alerte_petit_effectif":
                indicateurs[-1]["entreprises_actives_fin_annee"] < SEUIL_PETIT_EFFECTIF,
        }
    return resultats


# --- 3. Affichage et enregistrement ------------------------------------------

def evolution_pct(indicateurs):
    debut = indicateurs[0]["entreprises_actives_fin_annee"]
    fin = indicateurs[-1]["entreprises_actives_fin_annee"]
    return 100 * (fin / debut - 1) if debut else None


def afficher(resultats):
    france = resultats["FR"]["indicateurs"]
    print()
    print(f"Secteur {CODE_NAF} — France entière")
    print("-" * 78)
    print(f"{'Année':<7}{'Actives 31/12':>14}{'Créations':>11}{'Fermetures':>12}"
          f"{'Solde':>8}{'Tx créa.':>11}{'Tx ferm.':>11}")
    for r in france:
        print(f"{r['annee']:<7}{r['entreprises_actives_fin_annee']:>14,}{r['creations']:>11,}"
              f"{r['fermetures']:>12,}{r['solde_net']:>+8,}"
              f"{r['taux_creation_pct']:>10} %{r['taux_fermeture_pct']:>9} %".replace(",", " "))
    print("-" * 78)
    evolution = evolution_pct(france)
    if evolution is not None:
        print(f"Évolution des entreprises actives {ANNEES[0]} → {ANNEES[-1]} : {evolution:+.1f} %")

    print()
    print(f"Par région — entreprises actives au 31/12 et évolution {ANNEES[0]} → {ANNEES[-1]}")
    print("-" * 78)
    for zone in resultats.values():
        if zone["type"] != "region":
            continue
        actives = zone["indicateurs"][-1]["entreprises_actives_fin_annee"]
        evolution = evolution_pct(zone["indicateurs"])
        texte_evolution = f"{evolution:+.1f} %" if evolution is not None else "—"
        alerte = "  (moins de 20 entreprises)" if zone["alerte_petit_effectif"] else ""
        print(f"{zone['nom']:<32}{actives:>10,}{texte_evolution:>12}{alerte}".replace(",", " "))
    print("-" * 78)
    nb_alertes = sum(1 for z in resultats.values()
                     if z["type"] == "departement" and z["alerte_petit_effectif"])
    print(f"{nb_alertes} département(s) sur {sum(1 for z in resultats.values() if z['type'] == 'departement')} "
          f"ont moins de {SEUIL_PETIT_EFFECTIF} entreprises dans ce secteur.")


def enregistrer(resultats, infos_ul, infos_etab, infos_cog):
    DOSSIER_SORTIES.mkdir(exist_ok=True)
    sortie = {
        "code_naf": CODE_NAF,
        "annees": ANNEES,
        "seuil_petit_effectif": SEUIL_PETIT_EFFECTIF,
        "zones": resultats,
        "sources": [
            {
                "nom": "Base Sirene des entreprises (INSEE) — fichier StockUniteLegale",
                "lien": infos_ul["url"],
                "date_actualisation": infos_ul["date_mise_a_jour"],
            },
            {
                "nom": "Base Sirene des entreprises (INSEE) — fichier StockEtablissement (commune du siège)",
                "lien": infos_etab["url"],
                "date_actualisation": infos_etab["date_mise_a_jour"],
            },
            {
                "nom": f"Code officiel géographique (INSEE) — millésime {infos_cog['millesime']}",
                "lien": infos_cog["url_departements"],
                "date_actualisation": f"{infos_cog['millesime']}-01-01",
            },
        ],
        "date_calcul": datetime.now().strftime("%Y-%m-%d %H:%M"),
        "limites": [
            "Le code NAF est l'activité principale actuelle de l'entreprise : une entreprise "
            "qui a changé d'activité est comptée dans son secteur actuel pour toutes les années.",
            "Le code NAF regroupe souvent plusieurs activités proches (plus large que l'activité recherchée).",
            "Une unité légale = une entreprise (siège), quel que soit son nombre d'établissements.",
            "L'entreprise est placée dans la région et le département de son siège actuel "
            "(ou du dernier siège connu si elle est fermée), même si elle a déménagé ou travaille ailleurs.",
            "Les entreprises dont le siège est à l'étranger ou dans une collectivité d'outre-mer "
            "(Saint-Martin, Polynésie…) sont comptées dans la France entière uniquement.",
        ],
    }
    fichier = DOSSIER_SORTIES / f"{CODE_NAF}.json"
    fichier.write_text(json.dumps(sortie, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"\nRésultats enregistrés dans : {fichier.relative_to(DOSSIER_PROJET)}")


if __name__ == "__main__":
    infos_ul = telecharger_sirene("StockUniteLegale")
    infos_etab = telecharger_sirene("StockEtablissement")
    infos_cog = telecharger_cog()
    zones = lire_zones()
    print(f"Calcul des indicateurs pour {CODE_NAF}, années {ANNEES[0]} à {ANNEES[-1]}, "
          f"{len(zones)} zones...")
    resultats = calculer_indicateurs(zones)
    afficher(resultats)
    enregistrer(resultats, infos_ul, infos_etab, infos_cog)

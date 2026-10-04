"""
BizCheck
========

Calcule, pour UN code NAF et pour la France entière, l'évolution du secteur
sur les 3 dernières années complètes :
  - entreprises actives au 31 décembre
  - créations, fermetures, solde net
  - taux de création et de fermeture

Source : fichier StockUniteLegale (base Sirene, INSEE) au format parquet,
téléchargé automatiquement depuis data.gouv.fr s'il n'est pas déjà présent.

Lancement (depuis le dossier BIZCHECK) :
    python bizcheck.py
"""

import json
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

# --- Chemins -----------------------------------------------------------------

DOSSIER_PROJET = Path(__file__).resolve().parent
DOSSIER_DATA = DOSSIER_PROJET / "data"
DOSSIER_SORTIES = DOSSIER_PROJET / "sorties"

FICHIER_PARQUET = DOSSIER_DATA / "StockUniteLegale.parquet"
FICHIER_INFOS = DOSSIER_DATA / "StockUniteLegale.infos.json"  # date et lien de la source

# Identifiant du jeu de données « Base Sirene » sur data.gouv.fr
API_DATAGOUV = "https://www.data.gouv.fr/api/1/datasets/5b7ffc618b4c4169d30727e0/"


# --- 1. Téléchargement -------------------------------------------------------

def trouver_dernier_fichier():
    """Demande à data.gouv.fr le lien du dernier StockUniteLegale en parquet."""
    with urllib.request.urlopen(API_DATAGOUV) as reponse:
        jeu = json.load(reponse)
    for ressource in jeu["resources"]:
        titre = ressource["title"]
        if "StockUniteLegale" in titre and "Historique" not in titre and "parquet" in titre:
            return {
                "titre": titre,
                "url": ressource["url"],
                "date_mise_a_jour": ressource["last_modified"][:10],
                "taille": ressource.get("filesize") or 0,
            }
    sys.exit("Impossible de trouver le fichier StockUniteLegale (parquet) sur data.gouv.fr.")


def afficher_progression(nb_blocs, taille_bloc, taille_totale):
    if taille_totale > 0:
        pourcent = min(100, nb_blocs * taille_bloc * 100 // taille_totale)
        print(f"\r  Téléchargement : {pourcent} %", end="", flush=True)


def telecharger_si_absent():
    if FICHIER_PARQUET.exists() and FICHIER_INFOS.exists():
        infos = json.loads(FICHIER_INFOS.read_text(encoding="utf-8"))
        print(f"Fichier Sirene déjà présent (version du {infos['date_mise_a_jour']}).")
        return infos

    infos = trouver_dernier_fichier()
    taille_mo = infos["taille"] // 1_000_000
    print(f"Téléchargement de : {infos['titre']} (~{taille_mo} Mo)")
    print("  Cela peut prendre plusieurs minutes selon ta connexion...")

    DOSSIER_DATA.mkdir(exist_ok=True)
    fichier_temporaire = FICHIER_PARQUET.with_suffix(".part")
    urllib.request.urlretrieve(infos["url"], fichier_temporaire, afficher_progression)
    fichier_temporaire.replace(FICHIER_PARQUET)  # renommé seulement si le téléchargement est complet
    print()

    FICHIER_INFOS.write_text(json.dumps(infos, ensure_ascii=False, indent=2), encoding="utf-8")
    return infos


# --- 2. Calcul des indicateurs -----------------------------------------------

# Règles utilisées (fichier StockUniteLegale = situation actuelle de chaque entreprise) :
#   - création  : dateCreationUniteLegale
#   - fermeture : etatAdministratifUniteLegale = 'C' (cessée) ; la date de cessation
#                 est alors dateDebut (début de la dernière période, celle de la fermeture)
#   - active au 31/12/A : créée au plus tard le 31/12/A et pas fermée à cette date
REQUETE = """
WITH secteur AS (
    SELECT
        TRY_CAST(dateCreationUniteLegale AS DATE) AS date_creation,
        CASE WHEN etatAdministratifUniteLegale = 'C'
             THEN TRY_CAST(dateDebut AS DATE) END AS date_fermeture
    FROM read_parquet(?)
    WHERE activitePrincipaleUniteLegale = ?
),
annees AS (
    SELECT UNNEST(?::INTEGER[]) AS annee
)
SELECT
    a.annee,
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
GROUP BY a.annee
ORDER BY a.annee
"""


def calculer_indicateurs():
    connexion = duckdb.connect()
    lignes = connexion.execute(REQUETE, [str(FICHIER_PARQUET), CODE_NAF, ANNEES]).fetchall()

    resultats = []
    for annee, actives_debut, actives_fin, creations, fermetures in lignes:
        resultats.append({
            "annee": annee,
            "entreprises_actives_fin_annee": actives_fin,
            "creations": creations,
            "fermetures": fermetures,
            "solde_net": creations - fermetures,
            # taux calculés par rapport au nombre d'entreprises actives au 1er janvier
            "taux_creation_pct": round(100 * creations / actives_debut, 1) if actives_debut else None,
            "taux_fermeture_pct": round(100 * fermetures / actives_debut, 1) if actives_debut else None,
        })
    return resultats


# --- 3. Affichage et enregistrement ------------------------------------------

def afficher(resultats):
    print()
    print(f"Secteur {CODE_NAF} — France entière")
    print("-" * 78)
    print(f"{'Année':<7}{'Actives 31/12':>14}{'Créations':>11}{'Fermetures':>12}"
          f"{'Solde':>8}{'Tx créa.':>11}{'Tx ferm.':>11}")
    for r in resultats:
        print(f"{r['annee']:<7}{r['entreprises_actives_fin_annee']:>14,}{r['creations']:>11,}"
              f"{r['fermetures']:>12,}{r['solde_net']:>+8,}"
              f"{r['taux_creation_pct']:>10} %{r['taux_fermeture_pct']:>9} %".replace(",", " "))
    print("-" * 78)

    premiere, derniere = resultats[0], resultats[-1]
    if premiere["entreprises_actives_fin_annee"]:
        evolution = 100 * (derniere["entreprises_actives_fin_annee"]
                           / premiere["entreprises_actives_fin_annee"] - 1)
        print(f"Évolution des entreprises actives {premiere['annee']} → {derniere['annee']} : "
              f"{evolution:+.1f} %")


def enregistrer(resultats, infos_source):
    DOSSIER_SORTIES.mkdir(exist_ok=True)
    sortie = {
        "code_naf": CODE_NAF,
        "zone": "France",
        "indicateurs": resultats,
        "source": {
            "nom": "Base Sirene des entreprises (INSEE) — fichier StockUniteLegale",
            "lien": infos_source["url"],
            "date_actualisation": infos_source["date_mise_a_jour"],
        },
        "date_calcul": datetime.now().strftime("%Y-%m-%d %H:%M"),
        "limites": [
            "Le code NAF est l'activité principale actuelle de l'entreprise : une entreprise "
            "qui a changé d'activité est comptée dans son secteur actuel pour toutes les années.",
            "Le code NAF regroupe souvent plusieurs activités proches (plus large que l'activité recherchée).",
            "Une unité légale = une entreprise (siège), quel que soit son nombre d'établissements.",
        ],
    }
    fichier = DOSSIER_SORTIES / f"{CODE_NAF}_france.json"
    fichier.write_text(json.dumps(sortie, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"\nRésultats enregistrés dans : {fichier.relative_to(DOSSIER_PROJET)}")


if __name__ == "__main__":
    infos_source = telecharger_si_absent()
    print(f"Calcul des indicateurs pour {CODE_NAF}, années {ANNEES[0]} à {ANNEES[-1]}...")
    resultats = calculer_indicateurs()
    afficher(resultats)
    enregistrer(resultats, infos_source)

"""
BizCheck
========

Calcule, pour TOUS les codes NAF (732 sous-classes de la NAF rév. 2), l'évolution
du secteur sur les 3 dernières années complètes, pour la France entière, chaque
région et chaque département :
  - entreprises actives au 1er janvier et au 31 décembre
  - créations, fermetures
(le solde net et les taux sont calculés par le site à partir de ces nombres)

Sources (téléchargées automatiquement si elles ne sont pas déjà dans data/) :
  - base Sirene (INSEE, data.gouv.fr), fichiers parquet :
      StockUniteLegale   → activité, date de création, date de fermeture
      StockEtablissement → commune du siège de chaque entreprise
  - Code officiel géographique (INSEE) → départements et régions
  - Nomenclature NAF rév. 2 (INSEE) → libellés des codes d'activité

Fichiers écrits dans site/donnees/ :
  - infos.json     : années, sources, dates, limites (communs à tous les secteurs)
  - zones.json     : France, régions, départements (codes et noms)
  - secteurs.json  : liste des secteurs (code, libellé, nombre d'entreprises)
  - naf/<code>.json : chiffres d'un secteur pour chaque zone

Lancement (depuis le dossier BizCheck) :
    python bizcheck.py
"""

import csv
import json
import re
import shutil
import sys
import urllib.request
from datetime import date, datetime
from pathlib import Path

import duckdb
import xlrd  # lecture du fichier Excel (.xls) de la nomenclature NAF

from recherche import preparer_recherche  # données de la barre de recherche (recherche.py)

# Affiche correctement les accents dans le terminal Windows
sys.stdout.reconfigure(encoding="utf-8")

# --- Paramètres à modifier ---------------------------------------------------

ANNEE_EN_COURS = date.today().year
ANNEES = [ANNEE_EN_COURS - 3, ANNEE_EN_COURS - 2, ANNEE_EN_COURS - 1]

SEUIL_PETIT_EFFECTIF = 20  # en dessous : avertissement « chiffres peu fiables »

# --- Chemins -----------------------------------------------------------------

DOSSIER_PROJET = Path(__file__).resolve().parent
DOSSIER_DATA = DOSSIER_PROJET / "data"
DOSSIER_SORTIES = DOSSIER_PROJET / "site" / "donnees"  # lu directement par le site
DOSSIER_SECTEURS = DOSSIER_SORTIES / "naf"

FICHIER_DEPARTEMENTS = DOSSIER_DATA / "cog_departements.csv"
FICHIER_REGIONS = DOSSIER_DATA / "cog_regions.csv"
FICHIER_INFOS_COG = DOSSIER_DATA / "cog.infos.json"
FICHIER_NAF = DOSSIER_DATA / "naf_rev2_niveau5.xls"

# Identifiants des jeux de données sur data.gouv.fr
API_SIRENE = "https://www.data.gouv.fr/api/1/datasets/5b7ffc618b4c4169d30727e0/"
API_COG = "https://www.data.gouv.fr/api/1/datasets/58c984b088ee386cdb1261f3/"

# La NAF rév. 2 date de 2008 et ne change plus : adresse fixe sur insee.fr
URL_NAF = "https://www.insee.fr/fr/statistiques/fichier/2120875/naf2008_liste_n5.xls"
PAGE_NAF = "https://www.insee.fr/fr/information/2120875"

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



def telecharger_naf():
    if not FICHIER_NAF.exists():
        print("Téléchargement de la nomenclature NAF rév. 2...")
        telecharger(URL_NAF, FICHIER_NAF)
    else:
        print("Nomenclature NAF rév. 2 déjà présente.")


def lire_libelles_naf():
    """Renvoie {code NAF: libellé}, ex. {'93.29Z': 'Autres activités récréatives et de loisirs'}."""
    feuille = xlrd.open_workbook(FICHIER_NAF).sheet_by_index(0)
    libelles = {}
    for numero_ligne in range(feuille.nrows):
        code, libelle = feuille.row_values(numero_ligne)[:2]
        if re.fullmatch(r"\d\d\.\d\d[A-Z]", str(code).strip()):
            libelles[code.strip()] = libelle.strip()
    return libelles


# --- 2. Calcul des indicateurs -----------------------------------------------

# Règles utilisées (fichiers stock = situation actuelle de chaque entreprise) :
#   - activité  : activitePrincipaleUniteLegale, seulement si codée en NAF rév. 2
#   - création  : dateCreationUniteLegale
#   - fermeture : etatAdministratifUniteLegale = 'C' (cessée) ; la date de cessation
#                 est alors dateDebut (début de la dernière période, celle de la fermeture)
#   - active au 31/12/A : créée au plus tard le 31/12/A et pas fermée à cette date
#   - lieu      : commune actuelle (ou la dernière connue) du siège de l'entreprise ;
#                 département = 2 premiers caractères du code commune (3 pour l'outre-mer)
REQUETE = """
WITH toutes AS (
    SELECT
        siren,
        activitePrincipaleUniteLegale AS naf,
        TRY_CAST(dateCreationUniteLegale AS DATE) AS date_creation,
        CASE WHEN etatAdministratifUniteLegale = 'C'
             THEN TRY_CAST(dateDebut AS DATE) END AS date_fermeture
    FROM read_parquet($unites_legales)
    WHERE nomenclatureActivitePrincipaleUniteLegale = 'NAFRev2'
),
entreprises AS (
    -- on ne garde que les entreprises qui ont existé pendant la période étudiée
    SELECT * FROM toutes
    WHERE date_creation <= MAKE_DATE($derniere_annee, 12, 31)
      AND (date_fermeture IS NULL OR date_fermeture > MAKE_DATE($premiere_annee - 1, 12, 31))
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
    s.naf,
    CASE WHEN GROUPING(s.dep) = 0 THEN 'D' || s.dep
         WHEN GROUPING(s.reg) = 0 THEN 'R' || s.reg
         ELSE 'FR' END AS zone,
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
GROUP BY GROUPING SETS ((s.naf, a.annee), (s.naf, a.annee, s.reg), (s.naf, a.annee, s.dep))
HAVING zone IS NOT NULL  -- entreprises sans zone connue : comptées en France seulement
"""

NOMS_INDICATEURS = ["actives_debut", "actives_fin", "creations", "fermetures"]


def calculer_indicateurs(libelles_naf):
    """Renvoie {code NAF: {code zone: {indicateur: [valeur année 1, année 2, année 3]}}}."""
    print("  Lecture des fichiers Sirene et calcul (environ une minute)...")
    connexion = duckdb.connect()
    lignes = connexion.execute(REQUETE, {
        "unites_legales": str(DOSSIER_DATA / "StockUniteLegale.parquet"),
        "etablissements": str(DOSSIER_DATA / "StockEtablissement.parquet"),
        "departements": str(FICHIER_DEPARTEMENTS),
        "annees": ANNEES,
        "premiere_annee": ANNEES[0],
        "derniere_annee": ANNEES[-1],
    }).fetchall()

    resultats = {code: {} for code in libelles_naf}
    codes_inconnus = set()
    for naf, zone, annee, *valeurs in lignes:
        if naf not in resultats:
            codes_inconnus.add(naf)
            continue
        # une zone sans aucune entreprise du secteur n'est pas écrite : le site affiche 0
        chiffres = resultats[naf].setdefault(zone, {nom: [0] * len(ANNEES) for nom in NOMS_INDICATEURS})
        position = ANNEES.index(annee)
        for nom, valeur in zip(NOMS_INDICATEURS, valeurs):
            chiffres[nom][position] = valeur
    if codes_inconnus:
        print(f"  Codes absents de la nomenclature, ignorés : {', '.join(sorted(map(str, codes_inconnus)))}")
    return resultats


# --- 3. Affichage et enregistrement ------------------------------------------

def actives_fin(resultats, naf, zone="FR"):
    return resultats[naf].get(zone, {}).get("actives_fin", [0] * len(ANNEES))


def afficher(resultats, libelles_naf):
    print()
    print(f"{len(resultats)} secteurs calculés, années {ANNEES[0]} à {ANNEES[-1]}.")
    total = sum(actives_fin(resultats, naf)[-1] for naf in resultats)
    print(f"Entreprises actives fin {ANNEES[-1]}, tous secteurs : {total:,}".replace(",", " "))

    def evolution(naf):
        debut, *_, fin = actives_fin(resultats, naf)
        return 100 * (fin / debut - 1) if debut else 0

    # Classement parmi les secteurs d'au moins 1 000 entreprises (moins parlant en dessous)
    grands = [naf for naf in resultats if actives_fin(resultats, naf)[-1] >= 1000]
    grands.sort(key=evolution)
    for titre, liste in [("Plus fortes hausses", grands[::-1][:5]), ("Plus fortes baisses", grands[:5])]:
        print(f"\n{titre} (secteurs d'au moins 1 000 entreprises), fin {ANNEES[0]} → fin {ANNEES[-1]} :")
        for naf in liste:
            print(f"  {naf}  {evolution(naf):+6.1f} %  {libelles_naf[naf][:60]}")


def ecrire_json(fichier, contenu, lisible=False):
    texte = json.dumps(contenu, ensure_ascii=False, indent=2 if lisible else None,
                       separators=None if lisible else (",", ":"))
    fichier.write_text(texte, encoding="utf-8")


def enregistrer(resultats, libelles_naf, zones, infos_ul, infos_etab, infos_cog):
    # On repart d'un dossier vide pour ne pas garder de fichiers d'un ancien calcul
    if DOSSIER_SECTEURS.exists():
        shutil.rmtree(DOSSIER_SECTEURS)
    DOSSIER_SECTEURS.mkdir(parents=True)
    for ancien in DOSSIER_SORTIES.glob("*.json"):
        ancien.unlink()

    for naf, chiffres_zones in resultats.items():
        ecrire_json(DOSSIER_SECTEURS / f"{naf}.json", {"code_naf": naf, "zones": chiffres_zones})

    ecrire_json(DOSSIER_SORTIES / "secteurs.json", [
        {"code_naf": naf, "libelle_naf": libelles_naf[naf],
         "entreprises_actives": actives_fin(resultats, naf)[-1]}
        for naf in sorted(resultats)
    ], lisible=True)

    ecrire_json(DOSSIER_SORTIES / "zones.json", zones, lisible=True)

    ecrire_json(DOSSIER_SORTIES / "infos.json", {
        "annees": ANNEES,
        "seuil_petit_effectif": SEUIL_PETIT_EFFECTIF,
        "date_calcul": datetime.now().strftime("%Y-%m-%d %H:%M"),
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
            {
                "nom": "Nomenclature d'activités française NAF rév. 2 (INSEE)",
                "lien": PAGE_NAF,
                "date_actualisation": "2008-01-01",
            },
        ],
        "limites": [
            "Le code NAF est l'activité principale actuelle de l'entreprise : une entreprise "
            "qui a changé d'activité est comptée dans son secteur actuel pour toutes les années.",
            "Le code NAF regroupe souvent plusieurs activités proches (plus large que l'activité recherchée).",
            "Une unité légale = une entreprise (siège), quel que soit son nombre d'établissements.",
            "Seules les fermetures déclarées sont comptées : une entreprise sans activité "
            "mais non radiée reste comptée comme active.",
            "Les entreprises encore codées dans une ancienne nomenclature (NAF 1993, NAP…), "
            "environ 3 % des entreprises actives, ne sont rattachées à aucun secteur.",
            "L'entreprise est placée dans la région et le département de son siège actuel "
            "(ou du dernier siège connu si elle est fermée), même si elle a déménagé ou travaille ailleurs.",
            "Les entreprises dont le siège est à l'étranger ou dans une collectivité d'outre-mer "
            "(Saint-Martin, Polynésie…) sont comptées dans la France entière uniquement.",
        ],
    }, lisible=True)

    taille = sum(f.stat().st_size for f in DOSSIER_SORTIES.rglob("*.json")) / 1_000_000
    print(f"\nRésultats enregistrés dans : {DOSSIER_SORTIES.relative_to(DOSSIER_PROJET)} "
          f"({len(resultats)} fichiers de secteur, {taille:.1f} Mo au total)")


if __name__ == "__main__":
    infos_ul = telecharger_sirene("StockUniteLegale")
    infos_etab = telecharger_sirene("StockEtablissement")
    infos_cog = telecharger_cog()
    telecharger_naf()
    zones = lire_zones()
    libelles_naf = lire_libelles_naf()
    print(f"Calcul des indicateurs : {len(libelles_naf)} secteurs × {len(zones)} zones, "
          f"années {ANNEES[0]} à {ANNEES[-1]}...")
    resultats = calculer_indicateurs(libelles_naf)
    afficher(resultats, libelles_naf)
    enregistrer(resultats, libelles_naf, zones, infos_ul, infos_etab, infos_cog)
    print()
    preparer_recherche(libelles_naf, {naf: actives_fin(resultats, naf)[-1] for naf in resultats},
                       DOSSIER_SORTIES / "recherche.json")

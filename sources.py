"""
Téléchargement et lecture des sources de données publiques.

Chaque fichier est téléchargé une seule fois dans data/ ; pour une mise à jour,
supprimer le fichier concerné (ou tout le dossier data/) et relancer bizcheck.py.
"""

import csv
import gzip
import json
import re
import sys
import urllib.parse
import urllib.request
from datetime import date

import xlrd  # lecture du fichier Excel (.xls) de la nomenclature NAF

from parametres import (
    DOSSIER_DATA, FICHIER_CONTOURS, FICHIER_DEPARTEMENTS, FICHIER_INFOS_COG, FICHIER_INFOS_POPULATION,
    FICHIER_NAF, FICHIER_POPULATION, FICHIER_REGIONS,
    FICHIER_BODACC, FICHIER_FILOSOFI, FICHIER_POPULATIONS_HISTORIQUES, FICHIER_RATIOS,
    FICHIER_URSSAF_EFFECTIFS, FICHIER_URSSAF_SALAIRES,
)

# Identifiants des jeux de données sur data.gouv.fr
API_SIRENE = "https://www.data.gouv.fr/api/1/datasets/5b7ffc618b4c4169d30727e0/"
API_COG = "https://www.data.gouv.fr/api/1/datasets/58c984b088ee386cdb1261f3/"

# La NAF rév. 2 date de 2008 et ne change plus : adresse fixe sur insee.fr
URL_NAF = "https://www.insee.fr/fr/statistiques/fichier/2120875/naf2008_liste_n5.xls"
PAGE_NAF = "https://www.insee.fr/fr/information/2120875"

# Population municipale de chaque commune (populations légales INSEE), via l'API officielle
URL_POPULATION = "https://geo.api.gouv.fr/communes?fields=code,nom,population,codeDepartement,codesPostaux"
PAGE_POPULATION = "https://geo.api.gouv.fr/decoupage-administratif"

# Contours des départements (IGN Admin Express, licence ouverte), convertis en GeoJSON
URL_CONTOURS = ("https://raw.githubusercontent.com/gregoiredavid/france-geojson/master/"
                "departements-avec-outre-mer.geojson")
PAGE_CONTOURS = "https://github.com/gregoiredavid/france-geojson"


def lire_jeu_datagouv(url_api):
    """Lit une réponse JSON d'une API (certains portails l'envoient compressée en gzip)."""
    with urllib.request.urlopen(url_api) as reponse:
        contenu = reponse.read()
    if contenu[:2] == b"\x1f\x8b":
        contenu = gzip.decompress(contenu)
    return json.loads(contenu)


_dernier_pourcentage = [-1]


def afficher_progression(nb_blocs, taille_bloc, taille_totale):
    if taille_totale > 0:
        pourcent = min(100, nb_blocs * taille_bloc * 100 // taille_totale)
        if pourcent != _dernier_pourcentage[0]:  # n'écrit que quand le pourcentage change
            _dernier_pourcentage[0] = pourcent
            print(f"\r  Téléchargement : {pourcent} %", end="", flush=True)


def telecharger(url, destination):
    """Télécharge dans un fichier temporaire, renommé seulement si tout est arrivé."""
    DOSSIER_DATA.mkdir(exist_ok=True)
    fichier_temporaire = destination.with_suffix(".part")
    urllib.request.urlretrieve(url, fichier_temporaire, afficher_progression)
    with fichier_temporaire.open("rb") as f:
        compresse = f.read(2) == b"\x1f\x8b"
    if compresse:  # certains portails envoient le fichier compressé en gzip
        fichier_temporaire.write_bytes(gzip.decompress(fichier_temporaire.read_bytes()))
    fichier_temporaire.replace(destination)
    print()


# --- Sirene -------------------------------------------------------------------

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


# --- Code officiel géographique -----------------------------------------------

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


# --- Nomenclature NAF ---------------------------------------------------------

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


# --- Population et contours ---------------------------------------------------

def telecharger_population():
    if FICHIER_POPULATION.exists() and FICHIER_INFOS_POPULATION.exists():
        infos = json.loads(FICHIER_INFOS_POPULATION.read_text(encoding="utf-8"))
        print(f"Population des communes déjà présente (téléchargée le {infos['date_telechargement']}).")
        return infos
    print("Téléchargement de la population des communes...")
    telecharger(URL_POPULATION, FICHIER_POPULATION)
    infos = {"date_telechargement": date.today().isoformat(), "url": URL_POPULATION}
    FICHIER_INFOS_POPULATION.write_text(json.dumps(infos, ensure_ascii=False, indent=2), encoding="utf-8")
    return infos


def lire_communes():
    """Renvoie la liste des communes : code, nom, département, population, codes postaux."""
    return json.loads(FICHIER_POPULATION.read_text(encoding="utf-8"))


def telecharger_contours():
    if not FICHIER_CONTOURS.exists():
        print("Téléchargement des contours des départements...")
        telecharger(URL_CONTOURS, FICHIER_CONTOURS)
    else:
        print("Contours des départements déjà présents.")


# --- Sources du lot 2 : portails « opendatasoft » (URSSAF, Bercy, BODACC) et INSEE Melodi ---

def _infos_deja_la(fichier, nom):
    fichier_infos = fichier.with_name(fichier.name + ".infos.json")
    if fichier.exists() and fichier_infos.exists():
        infos = json.loads(fichier_infos.read_text(encoding="utf-8"))
        print(f"{nom} déjà présent (version du {infos['date_mise_a_jour']}).")
        return infos
    return None


def _enregistrer_infos(fichier, infos):
    fichier.with_name(fichier.name + ".infos.json").write_text(
        json.dumps(infos, ensure_ascii=False, indent=2), encoding="utf-8")
    return infos


def telecharger_opendatasoft(portail, jeu, fichier, nom, page, format_export="parquet", **filtres):
    """
    Télécharge un jeu de données d'un portail opendatasoft (URSSAF, data.economie.gouv.fr, BODACC).
    filtres : select=..., where=... (langage de requête du portail), pour ne garder que l'utile.
    """
    infos = _infos_deja_la(fichier, nom)
    if infos:
        return infos
    catalogue = f"https://{portail}/api/explore/v2.1/catalog/datasets/{jeu}"
    metadonnees = lire_jeu_datagouv(catalogue)["metas"]["default"]
    adresse = f"{catalogue}/exports/{format_export}"
    if filtres:
        adresse += "?" + urllib.parse.urlencode(filtres)
    print(f"Téléchargement de : {nom}...")
    telecharger(adresse, fichier)
    return _enregistrer_infos(fichier, {
        "nom": nom,
        "url": page,
        "date_mise_a_jour": (metadonnees.get("data_processed") or metadonnees.get("modified"))[:10],
    })


def telecharger_melodi(jeu, fichier_insee, fichier, nom):
    """Fichier d'un jeu de données INSEE Melodi (zip contenant un CSV)."""
    infos = _infos_deja_la(fichier, nom)
    if infos:
        return infos
    catalogue = lire_jeu_datagouv(f"https://api.insee.fr/melodi/catalog/{jeu}")
    print(f"Téléchargement de : {nom}...")
    telecharger(f"https://api.insee.fr/melodi/file/{jeu}/{fichier_insee}", fichier)
    return _enregistrer_infos(fichier, {
        "nom": nom,
        "url": f"https://catalogue-donnees.insee.fr/fr/catalogue/recherche/{jeu}",
        "date_mise_a_jour": catalogue["modified"][:10],
    })


def telecharger_lot2():
    """Emploi (URSSAF), salaires (URSSAF), comptes (BCE/INPI), défaillances (BODACC), revenus et population (INSEE)."""
    infos = {}
    infos["effectifs"] = telecharger_opendatasoft(
        "open.urssaf.fr", "etablissements-et-effectifs-salaries-au-niveau-commune-x-ape-last",
        FICHIER_URSSAF_EFFECTIFS,
        "Établissements employeurs et effectifs salariés du secteur privé, par commune × APE (URSSAF)",
        "https://open.urssaf.fr/explore/dataset/etablissements-et-effectifs-salaries-au-niveau-commune-x-ape-last/")
    infos["salaires"] = telecharger_opendatasoft(
        "open.urssaf.fr", "effectifs-salaries-et-masse-salariale-du-secteur-prive-france-entiere-x-na88",
        FICHIER_URSSAF_SALAIRES,
        "Effectifs salariés et masse salariale du secteur privé, France × secteur NA88 (URSSAF)",
        "https://open.urssaf.fr/explore/dataset/effectifs-salaries-et-masse-salariale-du-secteur-prive-france-entiere-x-na88/")
    infos["comptes"] = telecharger_opendatasoft(
        "data.economie.gouv.fr", "ratios_inpi_bce", FICHIER_RATIOS,
        "Ratios financiers des entreprises (Banque de France / INPI)",
        "https://data.economie.gouv.fr/explore/dataset/ratios_inpi_bce/",
        select="siren,date_cloture_exercice,chiffre_d_affaires,ebe,resultat_net,marge_ebe,"
               "credit_clients_jours,type_bilan,confidentiality")
    # Défaillances : jugements d'ouverture de redressement ou de liquidation judiciaire
    infos["defaillances"] = telecharger_opendatasoft(
        "bodacc-datadila.opendatasoft.com", "annonces-commerciales", FICHIER_BODACC,
        "Bulletin officiel des annonces civiles et commerciales (BODACC) — procédures collectives",
        "https://bodacc-datadila.opendatasoft.com/explore/dataset/annonces-commerciales/",
        select="registre,dateparution,numerodepartement,jugement",
        where=('familleavis="collective" and dateparution>="2015-01-01" '
               'and jugement like "*\\"famille\\": \\"Jugement d\'ouverture\\"*" '
               'and (jugement like "*liquidation judiciaire*" or jugement like "*redressement judiciaire*")'))
    infos["revenus"] = telecharger_melodi(
        "DS_FILOSOFI_CC", "DS_FILOSOFI_CC_2023_CSV_FR", FICHIER_FILOSOFI,
        "Niveau de vie et pauvreté (INSEE, Filosofi)")
    infos["population_historique"] = telecharger_melodi(
        "DS_POPULATIONS_HISTORIQUES", "DS_POPULATIONS_HISTORIQUES_CSV_FR", FICHIER_POPULATIONS_HISTORIQUES,
        "Populations municipales de 1968 à 2023 (INSEE)")
    return infos

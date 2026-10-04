"""
Calcul des indicateurs avec DuckDB, pour tous les codes NAF et toutes les zones.

Chaque indicateur est calculé à trois niveaux d'un coup (France, région, département)
grâce aux « GROUPING SETS », et aussi pour l'ensemble des secteurs (code « TOUS »),
qui sert de point de comparaison sur le site.

Règles (fichiers stock = situation actuelle de chaque entreprise) :
  - activité  : activitePrincipaleUniteLegale, seulement si codée en NAF rév. 2
  - création  : dateCreationUniteLegale
  - fermeture : etatAdministratifUniteLegale = 'C' (cessée) ; date = dateDebut
                (début de la dernière période, celle de la fermeture)
  - active au 31/12/A : créée au plus tard le 31/12/A et pas fermée à cette date
  - lieu      : commune actuelle (ou la dernière connue) du siège de l'entreprise ;
                département = 2 premiers caractères du code commune (3 pour l'outre-mer)
  - établissements (concurrence locale) : établissements actifs dont l'activité
                principale est le code NAF, quel que soit le secteur de leur entreprise
"""

import duckdb

from parametres import (
    ANNEES, DERNIERE_ANNEE, DUREES_SURVIE, FICHIER_BODACC, FICHIER_DEPARTEMENTS, FICHIER_ETABLISSEMENTS,
    FICHIER_RATIOS, FICHIER_UNITES_LEGALES, FICHIER_URSSAF_EFFECTIFS, NB_ANNEES_SAISONNALITE,
)

# Département à partir du code commune ; arrondissements de Paris, Lyon, Marseille → commune
DEPARTEMENT = """CASE WHEN {c} LIKE '97%' THEN LEFT({c}, 3) ELSE LEFT({c}, 2) END"""
COMMUNE = """CASE WHEN {c} BETWEEN '75101' AND '75120' THEN '75056'
                  WHEN {c} BETWEEN '69381' AND '69389' THEN '69123'
                  WHEN {c} BETWEEN '13201' AND '13216' THEN '13055'
                  ELSE {c} END"""

# Code NAF (ou « TOUS ») et code de zone (FR, R.., D..) pour chaque ligne agrégée
NAF_ET_ZONE = """
    CASE WHEN GROUPING(naf) = 1 THEN 'TOUS' ELSE naf END AS naf,
    CASE WHEN GROUPING(dep) = 0 THEN 'D' || dep
         WHEN GROUPING(reg) = 0 THEN 'R' || reg
         ELSE 'FR' END AS zone"""


def niveaux(colonnes=""):
    """Les 6 regroupements : (secteur ou tous) × (France, région, département)."""
    plus = f", {colonnes}" if colonnes else ""
    seul = colonnes
    return (f"GROUPING SETS ((naf{plus}), (naf, reg{plus}), (naf, dep{plus}), "
            f"({seul}), (reg{plus}), (dep{plus}))")


# --- Tables de travail -----------------------------------------------------------

TABLE_ENTREPRISES = f"""
CREATE TEMP TABLE entreprises AS
WITH unites AS (
    SELECT
        siren,
        activitePrincipaleUniteLegale AS naf,
        TRY_CAST(dateCreationUniteLegale AS DATE) AS date_creation,
        CASE WHEN etatAdministratifUniteLegale = 'C'
             THEN TRY_CAST(dateDebut AS DATE) END AS date_fermeture,
        trancheEffectifsUniteLegale AS tranche,
        CAST(categorieJuridiqueUniteLegale AS VARCHAR) AS forme
    FROM read_parquet($unites_legales)
    WHERE nomenclatureActivitePrincipaleUniteLegale = 'NAFRev2'
),
utiles AS (
    -- seulement les entreprises qui ont existé pendant la période étudiée
    SELECT * FROM unites
    WHERE date_creation <= MAKE_DATE($derniere_annee, 12, 31)
      AND (date_fermeture IS NULL OR date_fermeture > MAKE_DATE($premiere_annee - 1, 12, 31))
),
par_entreprise AS (
    SELECT
        siren,
        ANY_VALUE(CASE WHEN etablissementSiege
                       THEN {DEPARTEMENT.format(c="codeCommuneEtablissement")} END) AS dep_siege,
        COUNT(*) FILTER (WHERE etatAdministratifEtablissement = 'A') AS nb_etablissements
    FROM read_parquet($etablissements)
    WHERE siren IN (SELECT siren FROM utiles)
    GROUP BY siren
)
SELECT u.*, d.DEP AS dep, d.REG AS reg, COALESCE(p.nb_etablissements, 0) AS nb_etablissements
FROM utiles u
LEFT JOIN par_entreprise p USING (siren)
LEFT JOIN read_csv($departements, all_varchar = true) d ON d.DEP = p.dep_siege
"""

TABLE_ETABLISSEMENTS = f"""
CREATE TEMP TABLE etablissements AS
SELECT
    e.activitePrincipaleEtablissement AS naf,
    {COMMUNE.format(c="e.codeCommuneEtablissement")} AS commune,
    d.DEP AS dep,
    d.REG AS reg
FROM read_parquet($etablissements) e
LEFT JOIN read_csv($departements, all_varchar = true) d
       ON d.DEP = {DEPARTEMENT.format(c="e.codeCommuneEtablissement")}
WHERE e.etatAdministratifEtablissement = 'A'
  AND e.nomenclatureActivitePrincipaleEtablissement = 'NAFRev2'
"""

# --- Indicateurs ------------------------------------------------------------------

# Entreprises actives, créations et fermetures, année par année (10 ans)
REQUETE_ANNEES = f"""
SELECT {NAF_ET_ZONE}, a.annee,
    COUNT(*) FILTER (
        WHERE date_creation <= MAKE_DATE(a.annee - 1, 12, 31)
          AND (date_fermeture IS NULL OR date_fermeture > MAKE_DATE(a.annee - 1, 12, 31))
    ) AS actives_debut,
    COUNT(*) FILTER (
        WHERE date_creation <= MAKE_DATE(a.annee, 12, 31)
          AND (date_fermeture IS NULL OR date_fermeture > MAKE_DATE(a.annee, 12, 31))
    ) AS actives_fin,
    COUNT(*) FILTER (WHERE YEAR(date_creation) = a.annee) AS creations,
    COUNT(*) FILTER (WHERE YEAR(date_fermeture) = a.annee) AS fermetures
FROM entreprises
CROSS JOIN (SELECT UNNEST($annees::INTEGER[]) AS annee) a
GROUP BY {niveaux("a.annee")}
HAVING zone IS NOT NULL  -- entreprises sans zone connue : comptées en France seulement
"""

# Survie : parmi les entreprises créées en (dernière année − k), combien n'avaient pas
# fermé k ans après leur création ? (k = 1, 3, 5 : cohortes 2024, 2022, 2020 pour 2025)
REQUETE_SURVIE = f"""
SELECT {NAF_ET_ZONE}, d.duree,
    COUNT(*) AS cohorte,
    COUNT(*) FILTER (
        WHERE date_fermeture IS NULL OR date_fermeture > date_creation + TO_YEARS(d.duree)
    ) AS survivantes
FROM entreprises
JOIN (SELECT UNNEST($durees::INTEGER[]) AS duree) d
  ON YEAR(date_creation) = $derniere_annee - d.duree
GROUP BY {niveaux("d.duree")}
HAVING zone IS NOT NULL
"""

# Portrait des entreprises actives aujourd'hui (date du fichier Sirene)
REQUETE_PORTRAIT = f"""
SELECT {NAF_ET_ZONE},
    COUNT(*) AS actives,
    -- taille (salariés) : NN = aucun salarié dans l'année, 00 = aucun au 31/12
    COUNT(*) FILTER (WHERE tranche IN ('NN', '00') OR tranche IS NULL) AS taille_0,
    COUNT(*) FILTER (WHERE tranche IN ('01', '02', '03')) AS taille_1_9,
    COUNT(*) FILTER (WHERE tranche IN ('11', '12')) AS taille_10_49,
    COUNT(*) FILTER (WHERE tranche IN ('21', '22', '31')) AS taille_50_249,
    COUNT(*) FILTER (WHERE tranche IN ('32', '41', '42', '51', '52', '53')) AS taille_250,
    -- parmi les entreprises sans salarié, celles qui sont des entreprises individuelles (dont micro)
    COUNT(*) FILTER (WHERE (tranche IN ('NN', '00') OR tranche IS NULL) AND forme = '1000')
        AS sans_salarie_individuelles,
    -- forme juridique (catégories juridiques INSEE)
    COUNT(*) FILTER (WHERE forme = '1000') AS forme_individuelle,
    COUNT(*) FILTER (WHERE forme LIKE '54%') AS forme_sarl,
    COUNT(*) FILTER (WHERE forme LIKE '57%') AS forme_sas,
    COUNT(*) FILTER (WHERE (forme LIKE '5%' OR forme LIKE '6%')
                       AND forme NOT LIKE '54%' AND forme NOT LIKE '57%') AS forme_autre_societe,
    COUNT(*) FILTER (WHERE forme <> '1000' AND forme NOT LIKE '5%' AND forme NOT LIKE '6%')
        AS forme_association_autre,
    -- âge à la date du fichier
    COUNT(*) FILTER (WHERE date_creation > $date_reference - INTERVAL 3 YEAR) AS age_moins_3,
    COUNT(*) FILTER (WHERE date_creation <= $date_reference - INTERVAL 3 YEAR
                       AND date_creation > $date_reference - INTERVAL 10 YEAR) AS age_3_10,
    COUNT(*) FILTER (WHERE date_creation <= $date_reference - INTERVAL 10 YEAR) AS age_plus_10,
    -- réseaux : entreprises avec au moins 2 établissements actifs
    COUNT(*) FILTER (WHERE nb_etablissements >= 2) AS plusieurs_etablissements
FROM entreprises
WHERE date_fermeture IS NULL
GROUP BY {niveaux()}
HAVING zone IS NOT NULL
"""

# Créations par mois de l'année (France seulement), sur les 5 dernières années
REQUETE_SAISON = """
SELECT CASE WHEN GROUPING(naf) = 1 THEN 'TOUS' ELSE naf END AS naf,
       MONTH(date_creation) AS mois, COUNT(*) AS creations
FROM entreprises
WHERE YEAR(date_creation) BETWEEN $derniere_annee - $nb_annees + 1 AND $derniere_annee
GROUP BY GROUPING SETS ((naf, mois), (mois))
"""

# Établissements actifs du secteur, par zone
REQUETE_ETABLISSEMENTS_ZONES = f"""
SELECT {NAF_ET_ZONE}, COUNT(*) AS etablissements
FROM etablissements
GROUP BY {niveaux()}
HAVING zone IS NOT NULL
"""

# Établissements actifs du secteur, par commune
REQUETE_ETABLISSEMENTS_COMMUNES = """
SELECT naf, commune, COUNT(*) AS etablissements
FROM etablissements
WHERE commune IS NOT NULL
GROUP BY naf, commune
"""

def table_emploi():
    """Effectifs salariés (URSSAF) par code APE et commune, une colonne par année."""
    colonnes = ", ".join(f"COALESCE(effectifs_salaries_{a}, 0) AS effectifs_{a}" for a in ANNEES)
    return f"""
CREATE TEMP TABLE emploi AS
SELECT
    SUBSTR(u.code_ape, 1, 2) || '.' || SUBSTR(u.code_ape, 3) AS naf,
    {COMMUNE.format(c="u.code_commune")} AS commune,
    d.DEP AS dep,
    d.REG AS reg,
    {colonnes},
    COALESCE(u.nombre_d_etablissements_{DERNIERE_ANNEE}, 0) AS employeurs
FROM read_parquet($urssaf) u
LEFT JOIN read_csv($departements, all_varchar = true) d ON d.DEP = u.code_departement
"""


def requete_emploi_zones():
    sommes = ", ".join(f"SUM(effectifs_{a}) AS effectifs_{a}" for a in ANNEES)
    return f"""
SELECT {NAF_ET_ZONE}, {sommes}, SUM(employeurs) AS employeurs
FROM emploi
GROUP BY {niveaux()}
HAVING zone IS NOT NULL
"""


REQUETE_EMPLOI_COMMUNES = f"""
SELECT naf, commune, SUM(effectifs_{DERNIERE_ANNEE}) AS effectifs
FROM emploi
WHERE commune IS NOT NULL
GROUP BY naf, commune
"""

# Défaillances : une entreprise comptée une fois par an (premier jugement d'ouverture de
# redressement ou de liquidation judiciaire), rattachée à son secteur et à son siège via Sirene
TABLE_DEFAILLANCES = r"""
CREATE TEMP TABLE defaillances AS
SELECT DISTINCT
    regexp_extract(registre, '(\d{9})', 1) AS siren,
    YEAR(COALESCE(TRY_CAST(json_extract_string(jugement, '$.date') AS DATE), dateparution)) AS annee
FROM read_parquet($bodacc)
"""

REQUETE_DEFAILLANCES = f"""
SELECT {NAF_ET_ZONE}, f.annee, COUNT(*) AS defaillances
FROM defaillances f
JOIN entreprises USING (siren)
WHERE f.annee BETWEEN $premiere_annee AND $derniere_annee
GROUP BY {niveaux("f.annee")}
HAVING zone IS NOT NULL
"""

# Comptes annuels (ratios Banque de France / INPI) : un exercice par entreprise et par année,
# comptes complets ou simplifiés (pas les comptes consolidés de groupes), chiffre d'affaires > 0
TABLE_COMPTES = """
CREATE TEMP TABLE comptes AS
SELECT
    r.siren,
    YEAR(CAST(r.date_cloture_exercice AS DATE)) AS annee,
    r.chiffre_d_affaires AS ca,
    r.marge_ebe,
    r.resultat_net,
    r.credit_clients_jours,
    e.naf, e.dep, e.reg
FROM read_parquet($ratios) r
JOIN entreprises e USING (siren)
WHERE r.chiffre_d_affaires > 0
  AND r.type_bilan IN ('C', 'S')
QUALIFY ROW_NUMBER() OVER (
    PARTITION BY r.siren, YEAR(CAST(r.date_cloture_exercice AS DATE))
    ORDER BY r.date_cloture_exercice DESC) = 1
"""

REQUETE_ANNEES_COMPTES = "SELECT annee, COUNT(*) AS nombre FROM comptes GROUP BY annee ORDER BY annee"

REQUETE_COMPTES = f"""
SELECT {NAF_ET_ZONE},
    COUNT(*) AS nombre,
    MEDIAN(ca) AS ca_median,
    MEDIAN(marge_ebe) AS marge_ebe_mediane,
    MEDIAN(100.0 * resultat_net / ca) AS marge_nette_mediane,
    100.0 * AVG(CASE WHEN resultat_net < 0 THEN 1 ELSE 0 END) AS part_deficitaires,
    MEDIAN(credit_clients_jours) AS delai_clients_median
FROM comptes
WHERE annee = $annee
GROUP BY {niveaux()}
HAVING zone IS NOT NULL
"""

INDICATEURS_COMPTES = ["nombre", "ca_median", "marge_ebe_mediane", "marge_nette_mediane",
                       "part_deficitaires", "delai_clients_median"]


def calculer_comptes(executer, zone_de):
    """Médianes financières par secteur et zone, pour la dernière année assez complète."""
    executer(TABLE_COMPTES, ratios=str(FICHIER_RATIOS))
    nombres = {ligne["annee"]: ligne["nombre"] for ligne in executer(REQUETE_ANNEES_COMPTES)}
    # les comptes arrivent avec 6 à 18 mois de retard : on prend la dernière année qui a au
    # moins 80 % des comptes de l'année d'avant (une année encore incomplète en a bien moins)
    annee = max(a for a, n in nombres.items()
                if a <= DERNIERE_ANNEE and n >= 0.8 * nombres.get(a - 1, float("inf")))
    print(f"    exercices {annee} : {nombres[annee]:,} comptes".replace(",", " "))
    for ligne in executer(REQUETE_COMPTES, annee=annee):
        zone = zone_de(ligne)
        if zone is not None:
            zone["comptes"] = [None if ligne[k] is None else round(ligne[k], 1) for k in INDICATEURS_COMPTES]
    return annee


PORTRAIT = {
    "taille": ["taille_0", "taille_1_9", "taille_10_49", "taille_50_249", "taille_250"],
    "forme": ["forme_individuelle", "forme_sarl", "forme_sas", "forme_autre_societe", "forme_association_autre"],
    "age": ["age_moins_3", "age_3_10", "age_plus_10"],
}


def calculer(codes_naf, date_reference):
    """
    Renvoie (resultats, communes, annee_comptes) :
      resultats = {code NAF ou 'TOUS': {code zone: {indicateur: valeur}}}
      communes  = {code NAF: {code commune: [établissements actifs, salariés]}}
      annee_comptes = année des comptes utilisés pour les indicateurs financiers
    """
    connexion = duckdb.connect()
    parametres_communs = {
        "unites_legales": str(FICHIER_UNITES_LEGALES),
        "etablissements": str(FICHIER_ETABLISSEMENTS),
        "departements": str(FICHIER_DEPARTEMENTS),
    }

    def executer(requete, **parametres):
        utilises = {k: v for k, v in {**parametres_communs, **parametres}.items() if f"${k}" in requete}
        curseur = connexion.execute(requete, utilises)
        colonnes = [c[0] for c in curseur.description]
        return [dict(zip(colonnes, ligne)) for ligne in curseur.fetchall()]

    print("  Préparation des entreprises (lecture des fichiers Sirene)...")
    executer(TABLE_ENTREPRISES, premiere_annee=ANNEES[0], derniere_annee=DERNIERE_ANNEE)
    print("  Préparation des établissements...")
    executer(TABLE_ETABLISSEMENTS)

    codes = set(codes_naf) | {"TOUS"}
    resultats = {code: {} for code in codes}

    def zone_de(ligne):
        """Dictionnaire de la zone (créé si besoin), ou None pour un code NAF inconnu."""
        if ligne["naf"] not in codes:
            return None
        return resultats[ligne["naf"]].setdefault(ligne["zone"], {})

    print("  Entreprises actives, créations et fermetures sur 10 ans...")
    for ligne in executer(REQUETE_ANNEES, annees=ANNEES):
        zone = zone_de(ligne)
        if zone is None:
            continue
        position = ANNEES.index(ligne["annee"])
        for nom in ("actives_debut", "actives_fin", "creations", "fermetures"):
            zone.setdefault(nom, [0] * len(ANNEES))[position] = ligne[nom]

    print("  Taux de survie...")
    for ligne in executer(REQUETE_SURVIE, durees=DUREES_SURVIE, derniere_annee=DERNIERE_ANNEE):
        zone = zone_de(ligne)
        if zone is not None:
            zone.setdefault("survie", {})[str(ligne["duree"])] = [ligne["cohorte"], ligne["survivantes"]]

    print("  Portrait des entreprises actives (taille, forme, âge, réseaux)...")
    for ligne in executer(REQUETE_PORTRAIT, date_reference=date_reference):
        zone = zone_de(ligne)
        if zone is None:
            continue
        zone["actives_aujourdhui"] = ligne["actives"]
        for nom, colonnes in PORTRAIT.items():
            zone[nom] = [ligne[c] for c in colonnes]
        zone["plusieurs_etablissements"] = ligne["plusieurs_etablissements"]
        zone["sans_salarie_individuelles"] = ligne["sans_salarie_individuelles"]

    print("  Saisonnalité des créations...")
    for ligne in executer(REQUETE_SAISON, derniere_annee=DERNIERE_ANNEE, nb_annees=NB_ANNEES_SAISONNALITE):
        if ligne["naf"] in codes and ligne["mois"]:
            zone = resultats[ligne["naf"]].setdefault("FR", {})
            zone.setdefault("creations_par_mois", [0] * 12)[ligne["mois"] - 1] = ligne["creations"]

    print("  Établissements par zone et par commune...")
    for ligne in executer(REQUETE_ETABLISSEMENTS_ZONES):
        zone = zone_de(ligne)
        if zone is not None:
            zone["etablissements"] = ligne["etablissements"]
    # communes[naf][commune] = [établissements actifs (Sirene), salariés (URSSAF)]
    communes = {code: {} for code in codes_naf}
    for ligne in executer(REQUETE_ETABLISSEMENTS_COMMUNES):
        if ligne["naf"] in communes:
            communes[ligne["naf"]][ligne["commune"]] = [ligne["etablissements"], 0]

    print("  Emploi salarié (URSSAF)...")
    executer(table_emploi(), urssaf=str(FICHIER_URSSAF_EFFECTIFS))
    for ligne in executer(requete_emploi_zones()):
        zone = zone_de(ligne)
        if zone is not None:
            zone["effectifs"] = [ligne[f"effectifs_{a}"] for a in ANNEES]
            zone["employeurs"] = ligne["employeurs"]
    for ligne in executer(REQUETE_EMPLOI_COMMUNES):
        if ligne["naf"] in communes and ligne["effectifs"]:
            communes[ligne["naf"]].setdefault(ligne["commune"], [0, 0])[1] = ligne["effectifs"]

    print("  Défaillances (BODACC)...")
    executer(TABLE_DEFAILLANCES, bodacc=str(FICHIER_BODACC))
    for ligne in executer(REQUETE_DEFAILLANCES, premiere_annee=ANNEES[0], derniere_annee=DERNIERE_ANNEE):
        zone = zone_de(ligne)
        if zone is not None:
            zone.setdefault("defaillances", [0] * len(ANNEES))[ANNEES.index(ligne["annee"])] = ligne["defaillances"]

    print("  Comptes des entreprises (ratios financiers)...")
    annee_comptes = calculer_comptes(executer, zone_de)

    return resultats, communes, annee_comptes

"""
Comptes des entreprises par secteur (INSEE, Ésane) : France entière, une année.

  - par code NAF (sous-classe) : nombre d'entreprises, salariés en équivalent temps plein,
    chiffre d'affaires, exportations, valeur ajoutée, frais de personnel, EBE, résultat net,
    investissements ;
  - par groupe (3 premiers chiffres du code NAF, ex. 56.1) et par division (2 chiffres) :
    compte de résultat simplifié, pour la répartition « pour 100 € de chiffre d'affaires ».

Montants en millions d'euros, comme dans les fichiers de l'INSEE. « S » (secret statistique)
et « N » (non disponible) deviennent null.
"""

import re

import duckdb

from parametres import DOSSIER_ESANE

# Colonnes du fichier « principales caractéristiques au niveau sous-classe » (début du titre)
COLONNES_SECTEUR = {
    "entreprises": "nombre d'entreprises",
    "etp": "effectifs salariés en équivalent temps plein",
    "ca": "chiffre d'affaires hors taxes",
    "export": "chiffre d'affaires à l'exportation",
    "va": "valeur ajoutée",
    "personnel": "frais de personnel",
    "ebe": "excédent brut d'exploitation",
    "resultat_net": "résultat net comptable",
    "investissements": "investissements corporels",
}

# Lignes des comptes de résultat par groupe (début du libellé, sans les signes + - =)
LIGNES_COMPTE = {
    "ca": "chiffre d'affaires hors taxes",
    "achats_marchandises": "achats de marchandises",
    "stock_marchandises": "variation de stock de marchandises",
    "achats_matieres": "achats de matières premières",
    "stock_matieres": "variations de stock (matières",
    "charges_externes": "autres achats et charges externes",
    "sous_traitance": "dont : sous-traitance",
    "locations": "dont : locations, charges locatives",
    "credit_bail": "dont : crédit-bail",
    "impots": "impôts, taxes et versements assimilés",
    "salaires": "salaires et traitements",
    "charges_patronales": "charges patronales",
    "amortissements": "dotations d'exploitation aux amortissements",
    "participation": "participation des salariés",
    "impot_benefices": "impôts sur les bénéfices",
    "resultat_net": "résultat net comptable",
}

# Répartition « pour 100 € de chiffre d'affaires » envoyée au site (même ordre que dans le graphique)
COLONNES_COUTS = ["ca", "achats", "loyers", "sous_traitance", "autres_charges_externes", "personnel",
                  "impots", "amortissements", "impot_benefices", "resultat_net"]


def lire_feuille(fichier):
    connexion = duckdb.connect()
    connexion.sql("INSTALL excel; LOAD excel;")
    return connexion.sql(f"""SELECT * FROM read_xlsx('{fichier.as_posix()}', header = false,
        all_varchar = true, ignore_errors = true, range = 'A1:AZ3000')""").fetchall()


def nombre(texte):
    try:
        return float(texte)
    except (TypeError, ValueError):
        return None  # « S » secret statistique, « N » non disponible


def libelle(texte):
    return re.sub(r"^[-+=\s]+", "", (texte or "").strip()).lower()


def code_naf(code):
    """'5610A' → '56.10A' ; '561' → '56.1' ; '56' → '56'."""
    return code if len(code) <= 2 else f"{code[:2]}.{code[2:]}"


def arrondi(valeur):
    return None if valeur is None else round(valeur, 3)


def lire_secteurs():
    """Principales caractéristiques par code NAF + total de toutes les activités couvertes."""
    fichier = next(DOSSIER_ESANE.glob("DD_esane*_caracteristiques.xlsx"))
    lignes = lire_feuille(fichier)
    entete = next(i for i, l in enumerate(lignes) if (l[0] or "").strip().upper() == "NIVEAU NAF")
    titres = [libelle(t) for t in lignes[entete]]
    position = {cle: next(i for i, t in enumerate(titres) if t.startswith(debut))
                for cle, debut in COLONNES_SECTEUR.items()}

    secteurs, sections = {}, []
    for ligne in lignes[entete + 1:]:
        niveau, code = (ligne[0] or "").strip(), (ligne[1] or "").strip()
        valeurs = [nombre(ligne[position[cle]]) for cle in COLONNES_SECTEUR]
        if niveau == "a732":
            secteurs[code_naf(code)] = [arrondi(v) for v in valeurs]
        elif niveau == "a21" and code.isalpha() and code.isupper():  # sections A, B, C… (sans l'artisanat « y »)
            sections.append(valeurs)
    ensemble = [arrondi(sum(v[i] or 0 for v in sections)) for i in range(len(COLONNES_SECTEUR))]
    return secteurs, ensemble


def repartition(compte):
    """Compte de résultat d'un groupe → montants de la répartition des coûts (COLONNES_COUTS)."""
    def somme(*cles):
        valeurs = [compte.get(c) for c in cles]
        return None if any(v is None for v in valeurs) else sum(valeurs)

    loyers = somme("locations", "credit_bail")
    autres = somme("charges_externes")
    if autres is not None and loyers is not None and compte.get("sous_traitance") is not None:
        autres -= loyers + compte["sous_traitance"]
    return [arrondi(v) for v in (
        compte.get("ca"),
        somme("achats_marchandises", "stock_marchandises", "achats_matieres", "stock_matieres"),
        loyers,
        compte.get("sous_traitance"),
        autres,
        somme("salaires", "charges_patronales"),
        compte.get("impots"),
        compte.get("amortissements"),
        somme("impot_benefices", "participation"),
        compte.get("resultat_net"),
    )]


def lire_comptes():
    """Comptes de résultat par division et groupe + total de toutes les sections."""
    groupes, sections = {}, {}
    for fichier in sorted(DOSSIER_ESANE.glob("CR_NV_*.xlsx")):
        lignes = lire_feuille(fichier)
        entete = next(i for i, l in enumerate(lignes) if libelle(l[0]).startswith("secteur d"))
        codes = [(c or "").strip() for c in lignes[entete]]
        noms = [(c or "").strip() for c in lignes[entete + 1]]
        comptes = {j: {} for j, c in enumerate(codes) if j > 0 and c}
        for ligne in lignes[entete + 2:]:
            texte = libelle(ligne[0])
            cle = next((c for c, debut in LIGNES_COMPTE.items() if texte.startswith(debut)), None)
            if cle is None:
                continue
            for j, compte in comptes.items():
                compte.setdefault(cle, nombre(ligne[j]))  # 1re occurrence (« dont » répétés plus bas)
        for j, compte in comptes.items():
            code = codes[j]
            if code.isdigit():
                groupes[code_naf(code)] = {"libelle": noms[j], "couts": repartition(compte)}
            elif code.isalpha() and code.isupper():  # total de la section (C apparaît dans plusieurs fichiers)
                sections[code] = compte
    total = {cle: sum(c.get(cle) or 0 for c in sections.values()) for cle in LIGNES_COMPTE}
    return groupes, repartition(total)


def comptes_des_secteurs(infos):
    secteurs, ensemble_secteurs = lire_secteurs()
    groupes, ensemble_couts = lire_comptes()
    print(f"  Ésane {infos['annee']} : {len(secteurs)} codes NAF, {len(groupes)} divisions et groupes.")
    return {
        "annee": infos["annee"],
        "colonnes_secteur": list(COLONNES_SECTEUR),
        "secteurs": secteurs,
        "colonnes_couts": COLONNES_COUTS,
        "groupes": groupes,
        "ensemble": {"secteur": ensemble_secteurs, "couts": ensemble_couts},
    }

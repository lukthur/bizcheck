"""
BizCheck
========

Calcule, pour tous les codes NAF (732 sous-classes de la NAF rév. 2) et pour la
France, chaque région et chaque département :
  - entreprises actives, créations, fermetures, sur 10 ans
  - taux de survie à 1, 3 et 5 ans
  - portrait des entreprises actives : taille, forme juridique, âge, réseaux
  - saisonnalité des créations (France)
  - établissements actifs par zone et par commune (concurrence locale)
  - emploi salarié (URSSAF), défaillances (BODACC), médianes financières (comptes annuels)
puis prépare la recherche par activité et le fond de carte.

Les calculs sont dans indicateurs.py, les téléchargements dans sources.py,
la carte dans carte.py, la recherche dans recherche.py, les réglages dans parametres.py.

Fichiers écrits dans site/donnees/ :
  - infos.json       : années, sources, dates, limites (communs à tous les secteurs)
  - zones.json       : France, régions, départements (noms, population)
  - secteurs.json    : liste des secteurs (effectif, évolution, rang)
  - recherche.json   : libellés, notes INSEE et synonymes pour la barre de recherche
  - communes.json    : liste des communes (nom, département, population, revenu, évolution)
  - salaires.json    : salaire moyen par famille de secteurs (URSSAF)
  - carte.json       : tracés des départements
  - naf/<code>.json  : chiffres d'un secteur pour chaque zone (naf/TOUS.json : tous secteurs)
  - communes/<code>.json : établissements actifs d'un secteur par commune

Lancement (depuis le dossier BizCheck) :
    python bizcheck.py
"""

import json
import shutil
import sys
from datetime import date, datetime

import carte
import indicateurs
import sources
import territoires
from parametres import (
    ANNEES, DERNIERE_ANNEE, DOSSIER_COMMUNES, DOSSIER_PROJET, DOSSIER_SECTEURS, DOSSIER_SORTIES,
    DUREES_SURVIE, NB_ANNEES_PRINCIPALES, NB_ANNEES_SAISONNALITE, SEUIL_PETIT_EFFECTIF,
)
from recherche import preparer_recherche

# Affiche correctement les accents dans le terminal Windows
sys.stdout.reconfigure(encoding="utf-8")

SEUIL_CLASSEMENT = 100  # rang calculé parmi les secteurs d'au moins 100 entreprises


# --- Petits calculs sur les résultats -------------------------------------------

def actives_fin(resultats, naf, zone="FR"):
    return resultats[naf].get(zone, {}).get("actives_fin", [0] * len(ANNEES))


def evolution_pct(resultats, naf):
    """Évolution des entreprises actives sur les 3 dernières années (fin N-3 → fin N)."""
    valeurs = actives_fin(resultats, naf)
    debut, fin = valeurs[-NB_ANNEES_PRINCIPALES], valeurs[-1]
    return round(100 * (fin / debut - 1), 1) if debut else None


def populations_par_zone(communes, zones):
    population = {code: 0 for code in zones}
    for commune in communes:
        departement = f"D{commune['codeDepartement']}"
        if departement in zones:
            habitants = commune.get("population", 0)
            population[departement] += habitants
            population[zones[departement]["region"]] += habitants
            population["FR"] += habitants
    return population


def classement(resultats, libelles_naf):
    """secteurs.json : effectif, évolution et rang de chaque secteur (France entière)."""
    evolutions = {naf: evolution_pct(resultats, naf) for naf in libelles_naf}
    classables = sorted(
        (naf for naf in libelles_naf
         if actives_fin(resultats, naf)[-1] >= SEUIL_CLASSEMENT and evolutions[naf] is not None),
        key=lambda naf: evolutions[naf], reverse=True)
    rangs = {naf: rang for rang, naf in enumerate(classables, start=1)}
    return [
        {
            "code_naf": naf,
            "libelle_naf": libelles_naf[naf],
            "entreprises_actives": actives_fin(resultats, naf)[-1],
            "evolution_pct": evolutions[naf],
            "rang": rangs.get(naf),
            "nb_classes": len(classables),
        }
        for naf in sorted(libelles_naf)
    ]


# --- Affichage dans le terminal -----------------------------------------------------

def afficher(resultats, libelles_naf, secteurs):
    tous = resultats["TOUS"]["FR"]
    print()
    print(f"{len(libelles_naf)} secteurs calculés, années {ANNEES[0]} à {ANNEES[-1]}.")
    print(f"Entreprises actives fin {DERNIERE_ANNEE}, tous secteurs : {tous['actives_fin'][-1]:,}".replace(",", " "))
    survie = ", ".join(f"{d} an{'s' if int(d) > 1 else ''} : {100 * s / c:.0f} %"
                       for d, (c, s) in sorted(tous["survie"].items(), key=lambda x: int(x[0])))
    print(f"Survie des entreprises, tous secteurs : {survie}")

    classes = sorted((s for s in secteurs if s["rang"] and s["entreprises_actives"] >= 1000),
                     key=lambda s: s["rang"])
    for titre, liste in [("Plus fortes hausses", classes[:5]), ("Plus fortes baisses", classes[::-1][:5])]:
        print(f"\n{titre} (secteurs d'au moins 1 000 entreprises), fin {ANNEES[-NB_ANNEES_PRINCIPALES]} "
              f"→ fin {DERNIERE_ANNEE} :")
        for s in liste:
            print(f"  {s['code_naf']}  {s['evolution_pct']:+6.1f} %  {s['libelle_naf'][:60]}")


# --- Enregistrement ------------------------------------------------------------------

def ecrire_json(fichier, contenu, lisible=False):
    texte = json.dumps(contenu, ensure_ascii=False, indent=2 if lisible else None,
                       separators=None if lisible else (",", ":"))
    fichier.write_text(texte, encoding="utf-8")


def vider_sorties():
    """On repart de dossiers vides pour ne pas garder de fichiers d'un ancien calcul."""
    for dossier in (DOSSIER_SECTEURS, DOSSIER_COMMUNES):
        if dossier.exists():
            shutil.rmtree(dossier)
        dossier.mkdir(parents=True)
    for ancien in DOSSIER_SORTIES.glob("*.json"):
        ancien.unlink()


def enregistrer(resultats, communes_par_naf, secteurs, zones, communes, infos_sources,
                contexte, salaires, annee_comptes):
    vider_sorties()

    for naf, chiffres_zones in resultats.items():
        # ordre fixe (France, régions, départements) : un nouveau calcul identique donne un fichier identique
        dans_l_ordre = {zone: chiffres_zones[zone] for zone in zones if zone in chiffres_zones}
        ecrire_json(DOSSIER_SECTEURS / f"{naf}.json", {"code_naf": naf, "zones": dans_l_ordre})

    for naf, par_commune in communes_par_naf.items():
        ecrire_json(DOSSIER_COMMUNES / f"{naf}.json", dict(sorted(par_commune.items())))

    ecrire_json(DOSSIER_SORTIES / "secteurs.json", secteurs, lisible=True)
    ecrire_json(DOSSIER_SORTIES / "zones.json", zones, lisible=True)
    ecrire_json(DOSSIER_SORTIES / "carte.json", carte.construire_carte())
    ecrire_json(DOSSIER_SORTIES / "salaires.json", salaires, lisible=True)

    # Communes, de la plus peuplée à la moins peuplée (ordre utile pour la recherche de ville) :
    # [code, nom, département, population, codes postaux, niveau de vie médian, évolution de la population en %]
    def ligne_commune(c):
        local = contexte.get(f"C{c['code']}", {})
        debut, fin = local.get("population_debut"), local.get("population_fin")
        evolution = round(100 * (fin / debut - 1), 1) if debut and fin else None
        return [c["code"], c["nom"], c["codeDepartement"], c.get("population", 0),
                " ".join(c.get("codesPostaux") or []), local.get("revenu_median"), evolution]

    ecrire_json(DOSSIER_SORTIES / "communes.json",
                [ligne_commune(c) for c in sorted(communes, key=lambda c: (-c.get("population", 0), c["code"]))])

    ul, etab, cog, population = (infos_sources[k] for k in ("ul", "etab", "cog", "population"))
    ecrire_json(DOSSIER_SORTIES / "infos.json", {
        "annees": ANNEES,
        "nb_annees_principales": NB_ANNEES_PRINCIPALES,
        "durees_survie": DUREES_SURVIE,
        "nb_annees_saisonnalite": NB_ANNEES_SAISONNALITE,
        "annee_comptes": annee_comptes,
        "annees_population": [territoires.ANNEE_POPULATION_DEBUT, territoires.ANNEE_POPULATION_FIN],
        "annee_revenus": 2023,
        "date_reference": ul["date_mise_a_jour"],
        "seuil_petit_effectif": SEUIL_PETIT_EFFECTIF,
        "seuil_classement": SEUIL_CLASSEMENT,
        "date_calcul": datetime.now().strftime("%Y-%m-%d %H:%M"),
        "sources": [
            {
                "nom": "Base Sirene des entreprises (INSEE) — fichier StockUniteLegale",
                "lien": ul["url"],
                "date_actualisation": ul["date_mise_a_jour"],
            },
            {
                "nom": "Base Sirene des entreprises (INSEE) — fichier StockEtablissement",
                "lien": etab["url"],
                "date_actualisation": etab["date_mise_a_jour"],
            },
            {
                "nom": f"Code officiel géographique (INSEE) — millésime {cog['millesime']}",
                "lien": cog["url_departements"],
                "date_actualisation": f"{cog['millesime']}-01-01",
            },
            {
                "nom": "Nomenclature d'activités française NAF rév. 2 (INSEE)",
                "lien": sources.PAGE_NAF,
                "date_actualisation": "2008-01-01",
            },
            {
                "nom": "Populations légales des communes (INSEE), via l'API Découpage administratif",
                "lien": sources.PAGE_POPULATION,
                "date_actualisation": population["date_telechargement"],
            },
            {
                "nom": "Contours des départements (IGN Admin Express, licence ouverte), via france-geojson",
                "lien": sources.PAGE_CONTOURS,
                "date_actualisation": "2018-01-01",
            },
        ] + [
            {"nom": infos_sources[cle]["nom"], "lien": infos_sources[cle]["url"],
             "date_actualisation": infos_sources[cle]["date_mise_a_jour"]}
            for cle in ("effectifs", "salaires", "comptes", "defaillances", "revenus", "population_historique")
        ],
        "limites": [
            "Le code NAF est l'activité principale actuelle de l'entreprise : une entreprise "
            "qui a changé d'activité est comptée dans son secteur actuel pour toutes les années.",
            "Le code NAF regroupe souvent plusieurs activités proches (plus large que l'activité recherchée).",
            "Une unité légale = une entreprise (siège), quel que soit son nombre d'établissements.",
            "Seules les fermetures déclarées sont comptées : une entreprise sans activité "
            "mais non radiée reste comptée comme active.",
            "Les micro-entreprises sans chiffre d'affaires pendant 2 ans sont radiées d'office : "
            "elles comptent comme des fermetures, ce qui fait baisser les taux de survie.",
            "Les entreprises encore codées dans une ancienne nomenclature (NAF 1993, NAP…), "
            "environ 3 % des entreprises actives, ne sont rattachées à aucun secteur.",
            "L'entreprise est placée dans la région et le département de son siège actuel "
            "(ou du dernier siège connu si elle est fermée), même si elle a déménagé ou travaille ailleurs.",
            "Les entreprises dont le siège est à l'étranger ou dans une collectivité d'outre-mer "
            "(Saint-Martin, Polynésie…) sont comptées dans la France entière uniquement.",
            "Les établissements (boutiques, agences, ateliers…) sont comptés selon leur propre activité, "
            "à l'adresse où ils se trouvent : ils mesurent la présence locale, pas le nombre d'entreprises.",
            "Plus on remonte dans le temps, plus l'historique est approximatif (changements "
            "d'activité et entreprises disparues avant leur recodage en NAF rév. 2).",
            "Emploi : salariés du secteur privé au 31 décembre (URSSAF), dans les établissements employeurs. "
            "Les indépendants, les micro-entrepreneurs et la fonction publique ne sont pas comptés.",
            "Salaire moyen : brut annuel par salarié (temps partiels compris), pour la grande famille de "
            "secteurs (2 premiers chiffres du code NAF), France entière.",
            "Comptes : seulement les sociétés qui déposent des comptes publics (ni les entrepreneurs "
            "individuels, ni les micro-entreprises, ni les comptes confidentiels). Ce sont des médianes : "
            "la moitié des entreprises fait plus, l'autre moitié moins.",
            "Défaillances : ouvertures de redressement ou de liquidation judiciaire publiées au BODACC, "
            "une fois par entreprise et par an. Une défaillance ne veut pas toujours dire disparition "
            "(un redressement peut réussir).",
        ],
    }, lisible=True)

    taille = sum(f.stat().st_size for f in DOSSIER_SORTIES.rglob("*.json")) / 1_000_000
    print(f"\nRésultats enregistrés dans : {DOSSIER_SORTIES.relative_to(DOSSIER_PROJET)} ({taille:.1f} Mo au total)")


if __name__ == "__main__":
    infos_sources = {
        "ul": sources.telecharger_sirene("StockUniteLegale"),
        "etab": sources.telecharger_sirene("StockEtablissement"),
        "cog": sources.telecharger_cog(),
        "population": sources.telecharger_population(),
        **sources.telecharger_lot2(),
    }
    sources.telecharger_naf()
    sources.telecharger_contours()

    zones = sources.lire_zones()
    libelles_naf = sources.lire_libelles_naf()
    communes = sources.lire_communes()
    for code, population in populations_par_zone(communes, zones).items():
        zones[code]["population"] = population
    contexte = territoires.contexte_local()
    for code, zone in zones.items():
        zone.update(contexte.get(code, {}))
    salaires = territoires.salaires_par_division()

    print(f"\nCalcul des indicateurs : {len(libelles_naf)} secteurs × {len(zones)} zones, "
          f"années {ANNEES[0]} à {ANNEES[-1]}...")
    date_reference = date.fromisoformat(infos_sources["ul"]["date_mise_a_jour"])
    resultats, communes_par_naf, annee_comptes = indicateurs.calculer(libelles_naf, date_reference)

    secteurs = classement(resultats, libelles_naf)
    afficher(resultats, libelles_naf, secteurs)
    enregistrer(resultats, communes_par_naf, secteurs, zones, communes, infos_sources,
                contexte, salaires, annee_comptes)
    print()
    preparer_recherche(libelles_naf, {s["code_naf"]: s["entreprises_actives"] for s in secteurs},
                       DOSSIER_SORTIES / "recherche.json")

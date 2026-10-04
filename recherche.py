"""
Prépare les données de la barre de recherche du site (appelé par bizcheck.py).

Pour chaque code NAF, on rassemble :
  - le libellé officiel ;
  - les notes explicatives de l'INSEE : « comprend », « comprend aussi »,
    « ne comprend pas » (avec les codes vers lesquels l'INSEE renvoie) ;
  - les synonymes en langage courant du fichier synonymes.csv (rempli à la main).

Les notes viennent de la base de métadonnées de l'INSEE (rdf.insee.fr), interrogée
en une seule requête et gardée dans data/naf_notes.json.
"""

import csv
import json
import re
import urllib.parse
import urllib.request
from html.parser import HTMLParser
from pathlib import Path

DOSSIER_PROJET = Path(__file__).resolve().parent
FICHIER_NOTES = DOSSIER_PROJET / "data" / "naf_notes.json"
FICHIER_SYNONYMES = DOSSIER_PROJET / "synonymes.csv"

URL_SPARQL = "https://rdf.insee.fr/sparql"
REQUETE_NOTES = """
PREFIX skos: <http://www.w3.org/2004/02/skos/core#>
PREFIX xkos: <http://rdf-vocabulary.ddialliance.org/xkos#>
PREFIX evoc: <http://eurovoc.europa.eu/schema#>
PREFIX dc: <http://purl.org/dc/terms/>
SELECT ?code ?type ?html WHERE {
  ?sousClasse skos:inScheme <http://id.insee.fr/codes/nafr2/naf> ;
              skos:notation ?code ;
              ?type ?note .
  FILTER(STRSTARTS(STR(?sousClasse), "http://id.insee.fr/codes/nafr2/sousClasse/"))
  FILTER(?type IN (xkos:coreContentNote, xkos:additionalContentNote, xkos:exclusionNote))
  ?note evoc:noteLiteral ?html ;
        dc:language ?langue .
  FILTER(STR(?langue) = "fr")
}
"""
# type de note INSEE → nom court utilisé dans le site
TYPES_NOTES = {
    "coreContentNote": "comprend",
    "additionalContentNote": "comprend_aussi",
    "exclusionNote": "ne_comprend_pas",
}
CODE_NAF = re.compile(r"\d\d\.\d\d[A-Z]")


def telecharger_notes():
    if FICHIER_NOTES.exists():
        print("Notes explicatives NAF déjà présentes.")
        return json.loads(FICHIER_NOTES.read_text(encoding="utf-8"))

    print("Téléchargement des notes explicatives NAF (INSEE)...")
    adresse = URL_SPARQL + "?" + urllib.parse.urlencode({"query": REQUETE_NOTES})
    requete = urllib.request.Request(adresse, headers={"Accept": "application/sparql-results+json"})
    with urllib.request.urlopen(requete) as reponse:
        lignes = json.load(reponse)["results"]["bindings"]
    notes = [
        {
            "code": ligne["code"]["value"],
            "type": ligne["type"]["value"].split("#")[-1],
            "html": ligne["html"]["value"],
        }
        for ligne in lignes
    ]
    FICHIER_NOTES.write_text(json.dumps(notes, ensure_ascii=False, indent=1), encoding="utf-8")
    return notes


class LecteurListe(HTMLParser):
    """Découpe une note HTML de l'INSEE en éléments de liste (texte + codes cités)."""

    def __init__(self):
        super().__init__()
        self.elements = []
        self.texte = ""
        self.profondeur_li = 0

    def handle_starttag(self, balise, attributs):
        if balise == "li":
            if self.profondeur_li == 0:
                self._terminer()
            elif self.texte.strip() and not self.texte.rstrip().endswith(":"):
                self.texte += ", "  # sous-liste : « farines, produits pour la boulangerie, … »
            else:
                self.texte += " "
            self.profondeur_li += 1

    def handle_endtag(self, balise):
        if balise == "li":
            self.profondeur_li -= 1
            if self.profondeur_li == 0:
                self._terminer()
        elif balise == "p" and self.profondeur_li == 0:
            self._terminer()

    def handle_data(self, donnees):
        self.texte += donnees

    def _terminer(self):
        texte = re.sub(r"\s+", " ", self.texte).strip(" ;,.:")
        if texte:
            self.elements.append(texte)
        self.texte = ""

    def lire(self, html):
        self.feed(html)
        self._terminer()
        return self.elements


def lire_synonymes():
    """synonymes.csv : une ligne par couple (expression, code NAF)."""
    synonymes = {}
    with FICHIER_SYNONYMES.open(encoding="utf-8") as f:
        for ligne in csv.DictReader(f, delimiter=";"):
            expression, code = ligne["expression"].strip(), ligne["code_naf"].strip()
            if expression and code:
                synonymes.setdefault(code, []).append(expression)
    return synonymes


def preparer_recherche(libelles_naf, entreprises_par_code, fichier_sortie):
    notes = telecharger_notes()
    synonymes = lire_synonymes()

    inconnus = sorted(set(synonymes) - set(libelles_naf))
    if inconnus:
        print(f"  Attention, codes inconnus dans synonymes.csv : {', '.join(inconnus)}")

    secteurs = {
        code: {
            "code_naf": code,
            "libelle_naf": libelle,
            "entreprises_actives": entreprises_par_code.get(code, 0),
            "synonymes": synonymes.get(code, []),
            "comprend": [],
            "comprend_aussi": [],
            "ne_comprend_pas": [],
        }
        for code, libelle in libelles_naf.items()
    }
    for note in notes:
        secteur = secteurs.get(note["code"])
        if not secteur:
            continue
        cle = TYPES_NOTES[note["type"]]
        for element in LecteurListe().lire(note["html"]):
            if cle == "ne_comprend_pas":
                # « les troupes de théâtre (cf. 90.01Z) » → on garde le renvoi vers 90.01Z
                renvois = [c for c in CODE_NAF.findall(element) if c != note["code"]]
                secteur[cle].append({"texte": element, "voir": renvois})
            else:
                secteur[cle].append(element)

    liste = [secteurs[code] for code in sorted(secteurs)]
    fichier_sortie.write_text(json.dumps(liste, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    nb_synonymes = sum(len(s["synonymes"]) for s in liste)
    print(f"Recherche : {len(liste)} secteurs, {nb_synonymes} synonymes, "
          f"{fichier_sortie.stat().st_size / 1_000_000:.1f} Mo")

"""
Prépare le fond de carte des départements pour le site (fichier site/donnees/carte.json).

Les contours IGN (longitude, latitude) sont transformés en tracés SVG prêts à afficher :
  - projection simple (longitude resserrée selon la latitude, comme sur une carte routière) ;
  - simplification des tracés (on enlève les points qui ne changent rien à l'œil) ;
  - les départements d'outre-mer sont placés dans des encadrés sous la métropole.
"""

import json
import math

from parametres import FICHIER_CONTOURS

LARGEUR = 600              # largeur de la métropole sur la carte (unités SVG)
HAUTEUR_ENCADRES = 110     # bande des encadrés d'outre-mer, sous la métropole
MARGE = 8
TOLERANCE = 0.6            # simplification : écart maximal toléré, en unités SVG
OUTRE_MER = ["971", "972", "973", "974", "976"]
PETITE_COURONNE = ["75", "92", "93", "94"]
TAILLE_ZOOM = 110          # encadré « Paris et petite couronne »


def anneaux(geometrie):
    """Tous les contours (îles comprises) d'un Polygon ou MultiPolygon."""
    if geometrie["type"] == "Polygon":
        return geometrie["coordinates"]
    return [anneau for polygone in geometrie["coordinates"] for anneau in polygone]


def simplifier(points, tolerance):
    """Algorithme de Douglas-Peucker : garde seulement les points utiles au dessin."""
    if len(points) < 3:
        return points
    (x1, y1), (x2, y2) = points[0], points[-1]
    longueur = math.hypot(x2 - x1, y2 - y1) or 1e-9
    plus_loin, indice = 0, 0
    for i, (x, y) in enumerate(points[1:-1], start=1):
        ecart = abs((y2 - y1) * x - (x2 - x1) * y + x2 * y1 - y2 * x1) / longueur
        if ecart > plus_loin:
            plus_loin, indice = ecart, i
    if plus_loin <= tolerance:
        return [points[0], points[-1]]
    return simplifier(points[: indice + 1], tolerance)[:-1] + simplifier(points[indice:], tolerance)


def projeter(anneaux_lonlat, latitude_reference):
    facteur = math.cos(math.radians(latitude_reference))
    return [[(lon * facteur, -lat) for lon, lat in anneau] for anneau in anneaux_lonlat]


def cadre(anneaux_projetes):
    xs = [x for anneau in anneaux_projetes for x, _ in anneau]
    ys = [y for anneau in anneaux_projetes for _, y in anneau]
    return min(xs), min(ys), max(xs), max(ys)


def placer(anneaux_projetes, cadre_source, x, y, echelle):
    x0, y0, _, _ = cadre_source
    return [[((px - x0) * echelle + x, (py - y0) * echelle + y) for px, py in anneau]
            for anneau in anneaux_projetes]


def en_chemin_svg(anneaux_places):
    morceaux = []
    for anneau in anneaux_places:
        # contour fermé (1er point = dernier) : on le coupe en deux moitiés pour le simplifier
        milieu = len(anneau) // 2
        points = simplifier(anneau[: milieu + 1], TOLERANCE)[:-1] + simplifier(anneau[milieu:], TOLERANCE)
        if len(points) < 3:
            continue
        morceaux.append("M" + "L".join(f"{x:.1f} {y:.1f}" for x, y in points) + "Z")
    return "".join(morceaux)


def construire_carte():
    contours = json.loads(FICHIER_CONTOURS.read_text(encoding="utf-8"))
    departements = {f["properties"]["code"]: anneaux(f["geometry"]) for f in contours["features"]}

    # Métropole : une seule projection et une seule échelle pour tous les départements
    metropole = {code: projeter(a, 46.5) for code, a in departements.items() if code not in OUTRE_MER}
    cadre_metropole = cadre([anneau for a in metropole.values() for anneau in a])
    echelle = (LARGEUR - 2 * MARGE) / (cadre_metropole[2] - cadre_metropole[0])
    hauteur_metropole = (cadre_metropole[3] - cadre_metropole[1]) * echelle + 2 * MARGE

    chemins = {code: en_chemin_svg(placer(a, cadre_metropole, MARGE, MARGE, echelle))
               for code, a in metropole.items()}

    # Outre-mer : chaque territoire agrandi dans son encadré (échelles différentes, comme d'usage)
    largeur_encadre = (LARGEUR - 2 * MARGE) / len(OUTRE_MER)
    encadres = []
    for i, code in enumerate(OUTRE_MER):
        projete = projeter(departements[code], sum(lat for _, lat in departements[code][0]) / len(departements[code][0]))
        c = cadre(projete)
        taille = min((largeur_encadre - 16) / (c[2] - c[0]), (HAUTEUR_ENCADRES - 16) / (c[3] - c[1]))
        x = MARGE + i * largeur_encadre + (largeur_encadre - (c[2] - c[0]) * taille) / 2
        y = hauteur_metropole + (HAUTEUR_ENCADRES - (c[3] - c[1]) * taille) / 2
        chemins[code] = en_chemin_svg(placer(projete, c, x, y, taille))
        encadres.append([round(MARGE + i * largeur_encadre + 2, 1), round(hauteur_metropole + 2, 1),
                         round(largeur_encadre - 4, 1), HAUTEUR_ENCADRES - 4])

    # Paris et petite couronne : trop petits sur la carte, on les agrandit dans un encadré en haut à gauche
    petite_couronne = {code: metropole[code] for code in PETITE_COURONNE}
    c = cadre([anneau for a in petite_couronne.values() for anneau in a])
    taille = (TAILLE_ZOOM - 16) / max(c[2] - c[0], c[3] - c[1])
    zoom = {code: en_chemin_svg(placer(a, c, MARGE + 8, MARGE + 8, taille)) for code, a in petite_couronne.items()}
    encadres.append([MARGE, MARGE, TAILLE_ZOOM, TAILLE_ZOOM])

    return {
        "largeur": LARGEUR,
        "zoom_paris": zoom,
        "hauteur": round(hauteur_metropole + HAUTEUR_ENCADRES + MARGE),
        "encadres": encadres,
        "departements": chemins,
    }

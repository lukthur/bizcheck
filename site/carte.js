// BizCheck — carte des départements (dessinée en SVG à partir de donnees/carte.json).

import { $, couleur, decimal, densite, element, nombre, pourcent } from "./outils.js";

const SVG = "http://www.w3.org/2000/svg";

// Évolution sur 3 ans : classes fixes, le gris correspond à « stable » (entre −2 % et +2 %)
const CLASSES_EVOLUTION = [
  { max: -10, couleur: "--div-baisse-forte", texte: "−10 % ou moins" },
  { max: -2, couleur: "--div-baisse", texte: "−10 à −2 %" },
  { max: 2, couleur: "--div-stable", texte: "stable (±2 %)" },
  { max: 10, couleur: "--div-hausse", texte: "+2 à +10 %" },
  { max: Infinity, couleur: "--div-hausse-forte", texte: "+10 % ou plus" },
];
const COULEURS_DENSITE = ["--seq-2", "--seq-3", "--seq-4", "--seq-5", "--seq-6"];

let carte = null;          // tracés chargés une fois
let surClic = null;        // fonction appelée quand on clique sur un département
let indicateur = "evolution";
let valeurs = {};          // code département → { valeur, texte }

export async function preparerCarte(donneesCarte, quandOnClique) {
  carte = donneesCarte;
  surClic = quandOnClique;
  const svg = $("carte-departements");
  svg.setAttribute("viewBox", `0 0 ${carte.largeur} ${carte.hauteur}`);

  for (const [x, y, largeur, hauteur] of carte.encadres) {
    const cadre = document.createElementNS(SVG, "rect");
    Object.entries({ x, y, width: largeur, height: hauteur, rx: 4 }).forEach(([k, v]) => cadre.setAttribute(k, v));
    svg.append(cadre);
  }
  // le dernier encadré est celui de Paris et de la petite couronne
  const [xParis, yParis, , hauteurParis] = carte.encadres[carte.encadres.length - 1];
  const legende = document.createElementNS(SVG, "text");
  legende.setAttribute("x", xParis + 2);
  legende.setAttribute("y", yParis + hauteurParis + 11);
  legende.textContent = "Paris et petite couronne";
  svg.append(legende);

  const traces = [...Object.entries(carte.departements), ...Object.entries(carte.zoom_paris)];
  for (const [code, chemin] of traces) {
    const forme = document.createElementNS(SVG, "path");
    forme.setAttribute("d", chemin);
    forme.dataset.code = code;
    forme.addEventListener("mousemove", (e) => montrerInfobulle(e, code));
    forme.addEventListener("mouseleave", () => ($("infobulle-carte").hidden = true));
    forme.addEventListener("click", () => surClic(`D${code}`));
    svg.append(forme);
  }

  document.querySelectorAll(".choix-indicateur button").forEach((bouton) => {
    bouton.addEventListener("click", () => {
      indicateur = bouton.dataset.indicateur;
      document.querySelectorAll(".choix-indicateur button")
        .forEach((b) => b.setAttribute("aria-checked", String(b === bouton)));
      colorer(dernierAppel.chiffres, dernierAppel.zones, dernierAppel.zoneChoisie, dernierAppel.infos);
    });
  });
}

let dernierAppel = {};

// chiffres = fichier du secteur ; zones = zones.json ; zoneChoisie = code de la zone affichée
export function colorer(chiffres, zones, zoneChoisie, infos) {
  dernierAppel = { chiffres, zones, zoneChoisie, infos };
  if (!carte) return;
  const nbAnnees = infos.nb_annees_principales;
  valeurs = {};

  for (const [codeZone, zone] of Object.entries(zones)) {
    if (zone.type !== "departement") continue;
    const brut = chiffres.zones[codeZone];
    const actives = brut?.actives_fin ?? [];
    const fin = actives[actives.length - 1] ?? 0;
    const debut = actives[actives.length - nbAnnees] ?? 0;
    const etablissements = brut?.etablissements ?? 0;
    const code = codeZone.slice(1);
    if (indicateur === "evolution") {
      const evolution = debut ? 100 * (fin / debut - 1) : null;
      const peu = fin < infos.seuil_petit_effectif;
      valeurs[code] = {
        nom: zone.nom,
        valeur: peu ? null : evolution,
        texte: peu ? `moins de ${infos.seuil_petit_effectif} entreprises` : `${pourcent(evolution)} (${nombre.format(fin)} entreprises)`,
      };
    } else {
      const d = densite(etablissements, zone.population);
      valeurs[code] = {
        nom: zone.nom,
        valeur: d,
        texte: `${decimal(d)} pour 10 000 hab. (${nombre.format(etablissements)} établissements)`,
      };
    }
  }

  const classes = indicateur === "evolution" ? CLASSES_EVOLUTION : classesDensite();
  const couleurVide = couleur("--vide");
  const departementsChoisis = new Set(
    zoneChoisie.startsWith("D") ? [zoneChoisie.slice(1)]
      : zoneChoisie.startsWith("R")
        ? Object.entries(zones).filter(([, z]) => z.region === zoneChoisie).map(([c]) => c.slice(1))
        : [],
  );
  for (const forme of $("carte-departements").querySelectorAll("path")) {
    const { valeur } = valeurs[forme.dataset.code] || {};
    const classe = valeur === null || valeur === undefined ? null : classes.find((c) => valeur <= c.max);
    forme.style.fill = classe ? couleur(classe.couleur) : couleurVide;
    forme.classList.toggle("choisi", departementsChoisis.has(forme.dataset.code));
  }
  afficherLegende(classes, couleurVide);
}

// Densité : 5 classes de taille égale (quintiles), recalculées pour chaque secteur
function classesDensite() {
  const triees = Object.values(valeurs).map((v) => v.valeur).filter((v) => v !== null).sort((a, b) => a - b);
  if (triees.length === 0) return [];
  const seuils = [1, 2, 3, 4].map((i) => triees[Math.floor((i * triees.length) / 5)]);
  const bornes = [triees[0], ...seuils, triees[triees.length - 1]];
  return COULEURS_DENSITE.map((variable, i) => ({
    max: i === 4 ? Infinity : bornes[i + 1],
    couleur: variable,
    texte: `${decimal(bornes[i])} – ${decimal(bornes[i + 1])}`,
  }));
}

function afficherLegende(classes, couleurVide) {
  const legende = $("legende-carte");
  legende.innerHTML = "";
  if (indicateur === "densite") legende.append(element("span", null, "Établissements pour 10 000 habitants :"));
  for (const classe of classes) {
    const item = element("span");
    const pastille = element("i");
    pastille.style.background = couleur(classe.couleur);
    item.append(pastille, classe.texte);
    legende.append(item);
  }
  if (indicateur === "evolution") {
    const item = element("span");
    const pastille = element("i");
    pastille.style.background = couleurVide;
    item.append(pastille, "trop peu d'entreprises");
    legende.append(item);
  }
}

function montrerInfobulle(evenement, code) {
  const info = valeurs[code];
  if (!info) return;
  const bulle = $("infobulle-carte");
  bulle.innerHTML = "";
  bulle.append(element("strong", null, `${info.nom} (${code})`), info.texte);
  const cadre = $("carte-departements").parentElement.getBoundingClientRect();
  const x = evenement.clientX - cadre.left;
  bulle.style.left = `${Math.min(x + 12, cadre.width - 220)}px`;
  bulle.style.top = `${evenement.clientY - cadre.top + 12}px`;
  bulle.hidden = false;
}

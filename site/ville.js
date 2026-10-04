// BizCheck — « Et dans ma ville ? » : établissements du secteur dans une commune.

import { normaliser } from "./recherche.js";
import { $, boutonAide, decimal, densite, element, lireJson, nombre, pluriel, pourcent } from "./outils.js";

const euros = new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR", maximumFractionDigits: 0 });

const SEUIL_PETITE_COMMUNE = 2000; // habitants : en dessous, la densité varie beaucoup

// [code, nom, département, population, codes postaux, niveau de vie médian, évolution population %]
let communes = null;               // chargées au premier usage
let communesNormalisees = null;
const parSecteur = {};             // cache : code NAF → { code commune: [établissements, salariés] }
let suggestions = [];
let active = -1;
let communeChoisie = null;
let contexte = null;               // { codeNaf, zones, chiffres } du secteur affiché

async function chargerCommunes() {
  if (!communes) {
    communes = await lireJson("donnees/communes.json");
    communesNormalisees = communes.map((c) => normaliser(c[1]));
  }
}

export function brancherVille(codeVilleDemande) {
  const champ = $("champ-ville");
  champ.addEventListener("focus", chargerCommunes, { once: true });
  champ.addEventListener("input", async () => {
    await chargerCommunes();
    proposer(champ.value);
  });
  champ.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown" && suggestions.length) {
      e.preventDefault();
      surligner((active + 1) % suggestions.length);
    } else if (e.key === "ArrowUp" && suggestions.length) {
      e.preventDefault();
      surligner((active - 1 + suggestions.length) % suggestions.length);
    } else if (e.key === "Enter" && suggestions.length) {
      e.preventDefault();
      choisir(suggestions[Math.max(0, active)]);
    } else if (e.key === "Escape") {
      fermer();
    }
  });
  champ.addEventListener("blur", () => setTimeout(fermer, 150));

  if (codeVilleDemande) {
    chargerCommunes().then(() => {
      const commune = communes.find((c) => c[0] === codeVilleDemande);
      if (commune) choisir(commune);
    });
  }
}

// Recherche par début de nom (« saint et » → Saint-Étienne) ou par code postal / code commune
function trouver(texte) {
  const tape = normaliser(texte);
  if (tape.length < 2) return [];
  if (/^\d/.test(tape.replace(/ /g, ""))) {
    const chiffres = tape.replace(/ /g, "");
    return communes
      .filter((c) => c[4].split(" ").some((cp) => cp.startsWith(chiffres)) || c[0].startsWith(chiffres))
      .slice(0, 8);
  }
  const resultats = [];
  for (let i = 0; i < communes.length && resultats.length < 8; i++) {
    const nom = communesNormalisees[i];
    if (nom.startsWith(tape) || nom.includes(` ${tape}`)) resultats.push(communes[i]);
  }
  return resultats; // communes triées de la plus peuplée à la moins peuplée
}

function proposer(texte) {
  const liste = $("suggestions-ville");
  suggestions = trouver(texte);
  active = -1;
  liste.innerHTML = "";
  if (texte.trim().length < 2) {
    fermer();
    return;
  }
  if (suggestions.length === 0) liste.append(element("li", "vide", "Aucune commune trouvée."));
  suggestions.forEach((commune, i) => {
    const [, nom, departement, population, codesPostaux] = commune;
    const codePostal = codesPostaux.split(" ")[0];
    const li = element("li");
    li.id = `ville-${i}`;
    li.setAttribute("role", "option");
    li.setAttribute("aria-selected", "false");
    const ligne = element("span", "sugg-ligne");
    ligne.append(element("span", "sugg-libelle", nom), element("span", "sugg-code", codePostal || departement));
    li.append(ligne, element("span", "sugg-nombre", `${nombre.format(population)} habitants`));
    li.addEventListener("mousedown", (e) => {
      e.preventDefault();
      choisir(commune);
    });
    liste.append(li);
  });
  liste.hidden = false;
  $("champ-ville").setAttribute("aria-expanded", "true");
}

function surligner(position) {
  active = position;
  [...$("suggestions-ville").children].forEach((li, i) => li.setAttribute("aria-selected", String(i === position)));
  $(`ville-${position}`)?.scrollIntoView({ block: "nearest" });
}

function fermer() {
  $("suggestions-ville").hidden = true;
  $("champ-ville").setAttribute("aria-expanded", "false");
}

function choisir(commune) {
  communeChoisie = commune;
  $("champ-ville").value = commune[1];
  fermer();
  afficherVille();
  const adresse = new URL(location.href);
  adresse.searchParams.set("ville", commune[0]);
  history.replaceState(null, "", adresse);
}

// Appelé à chaque changement de secteur
export function mettreAJourVille(codeNaf, zones, chiffres, aides) {
  contexte = { codeNaf, zones, chiffres, aides };
  if (communeChoisie) afficherVille();
}

async function afficherVille() {
  if (!contexte || !communeChoisie) return;
  const { codeNaf, zones, chiffres, aides } = contexte;
  if (!parSecteur[codeNaf]) parSecteur[codeNaf] = await lireJson(`donnees/communes/${codeNaf}.json`);
  if (contexte.codeNaf !== codeNaf) return; // le secteur a changé entre-temps

  const [code, nom, departement, population, , revenuMedian, evolutionPopulation] = communeChoisie;
  const [etablissements, salaries] = parSecteur[codeNaf][code] || [0, 0];
  const zoneDepartement = zones[`D${departement}`];
  const densiteVille = densite(etablissements, population);
  const densiteDepartement = zoneDepartement
    ? densite(chiffres.zones[`D${departement}`]?.etablissements || 0, zoneDepartement.population) : null;
  const densiteFrance = densite(chiffres.zones.FR?.etablissements || 0, zones.FR.population);

  const bloc = $("resultat-ville");
  bloc.innerHTML = "";
  bloc.append(element("h3", null, `${nom} (${departement})`));

  let phrase = `${nom} compte ${pluriel(etablissements, "établissement actif", "établissements actifs")} `
    + `de ce secteur pour ${nombre.format(population)} habitants`;
  if (densiteVille !== null && densiteFrance) {
    const ecart = 100 * (densiteVille / densiteFrance - 1);
    phrase += Math.abs(ecart) < 10 ? ", une densité proche de la moyenne française."
      : `, soit une densité ${ecart > 0 ? "supérieure" : "inférieure"} de ${Math.round(Math.abs(ecart))} % `
        + "à la moyenne française.";
  } else {
    phrase += ".";
  }
  bloc.append(element("p", "portrait-phrase", phrase));

  const tableau = element("dl", "comparaison-ville");
  const ajouter = (titre, valeur, detail, aide) => {
    const case_ = element("div");
    const dd = element("dd", null, valeur);
    if (detail) dd.append(element("small", null, detail));
    const dt = element("dt", null, titre);
    if (aide) dt.append(boutonAide(aide));
    case_.append(dt, dd);
    tableau.append(case_);
  };
  ajouter("Établissements dans la commune", nombre.format(etablissements), null, aides.ville_etablissements);
  ajouter("Pour 10 000 habitants", decimal(densiteVille), nom, aides.ville_densite);
  if (zoneDepartement) ajouter("Département", decimal(densiteDepartement), zoneDepartement.nom, aides.departement_densite);
  ajouter("France", decimal(densiteFrance), "pour 10 000 habitants", aides.france_densite);
  ajouter("Salariés du secteur", nombre.format(salaries), "dans la commune (URSSAF)", aides.ville_salaries);
  ajouter("Évolution de la population", pourcent(evolutionPopulation), "entre 2017 et 2023", aides.evolution_population);
  ajouter("Niveau de vie médian", revenuMedian ? euros.format(revenuMedian) : "non publié",
    zoneDepartement?.revenu_median ? `${zoneDepartement.nom} : ${euros.format(zoneDepartement.revenu_median)}` : null, aides.niveau_de_vie);
  bloc.append(tableau);

  if (population < SEUIL_PETITE_COMMUNE) {
    bloc.append(element("p", "secondaire petit",
      "Petite commune : un seul établissement de plus ou de moins change fortement la densité. "
      + "Comparez plutôt avec le département."));
  }
  bloc.hidden = false;
}

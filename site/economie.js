// BizCheck — emploi (URSSAF), défaillances (BODACC), comptes (ratios financiers) et territoire (INSEE).

import { dessinerDefaillances, dessinerEmploi } from "./graphiques.js";
import { $, decimal, element, nombre, pourcent } from "./outils.js";

const SEUIL_COMPTES = 20; // en dessous, pas de médiane affichée

const euros = new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR", maximumFractionDigits: 0 });

// 312 456 → « 312 k€ » ; 1 234 567 → « 1,2 M€ »
function eurosCourts(valeur) {
  if (valeur === null || valeur === undefined) return "—";
  if (valeur >= 1e6) return `${decimal(valeur / 1e6)} M€`;
  if (valeur >= 1e4) return `${nombre.format(Math.round(valeur / 1e3))} k€`;
  return euros.format(valeur);
}

function evolutionPct(debut, fin) {
  return debut ? 100 * (fin / debut - 1) : null;
}

// Remplit une liste <dl> de chiffres : [titre, valeur, détail]
function remplir(idListe, lignes) {
  const liste = $(idListe);
  liste.innerHTML = "";
  for (const [titre, valeur, detail] of lignes) {
    const bloc = element("div");
    const dd = element("dd", null, valeur);
    if (detail) dd.append(element("small", null, ` ${detail}`));
    bloc.append(element("dt", null, titre), dd);
    liste.append(bloc);
  }
}

function message(idListe, texte) {
  const liste = $(idListe);
  liste.innerHTML = "";
  liste.append(element("p", "secondaire petit", texte));
}

// --- Emploi, défaillances, comptes ------------------------------------------------------

export function afficherEconomie({ infos, chiffres, tous, salaires, zone, codeNaf }) {
  const annees = infos.annees;
  const n = annees.length;
  const nbPrincipales = infos.nb_annees_principales;
  const derniere = annees[n - 1];
  const brut = chiffres.zones[zone] || {};
  const brutTous = tous.zones[zone] || {};

  // Emploi salarié
  const effectifs = brut.effectifs || new Array(n).fill(0);
  const effectifsTous = brutTous.effectifs || new Array(n).fill(0);
  const salariesFin = effectifs[n - 1];
  const division = salaires.divisions[codeNaf.slice(0, 2)];
  const salaire = division?.salaires[division.salaires.length - 1];
  const salaireEnsemble = salaires.ensemble[salaires.ensemble.length - 1];
  const lignesEmploi = [
    [`Salariés fin ${derniere}`, nombre.format(salariesFin),
      `${pourcent(evolutionPct(effectifs[n - nbPrincipales], salariesFin))} en ${nbPrincipales - 1} ans `
      + `(toutes activités : ${pourcent(evolutionPct(effectifsTous[n - nbPrincipales], effectifsTous[n - 1]))})`],
    ["Établissements employeurs", nombre.format(brut.employeurs || 0),
      brut.employeurs ? `${decimal(salariesFin / brut.employeurs)} salariés en moyenne` : null],
  ];
  if (salaire) {
    lignesEmploi.push([`Salaire moyen brut ${salaires.annees[salaires.annees.length - 1]}`, euros.format(salaire),
      `« ${division.libelle} », France · privé : ${euros.format(salaireEnsemble)}`]);
  }
  if (effectifs.every((v) => !v)) {
    message("chiffres-emploi", "Pas de salariés du secteur privé recensés par l'URSSAF pour ce secteur dans cette "
      + "zone (l'agriculture, l'administration publique et les entreprises sans salarié ne sont pas couvertes).");
  } else {
    remplir("chiffres-emploi", lignesEmploi);
  }
  dessinerEmploi(annees, effectifs);

  // Défaillances : taux = défaillances de l'année / entreprises actives au 1er janvier
  const defaillances = brut.defaillances || new Array(n).fill(0);
  const defaillancesTous = brutTous.defaillances || new Array(n).fill(0);
  const activesDebut = brut.actives_debut?.[n - 1] || 0;
  const activesDebutTous = brutTous.actives_debut?.[n - 1] || 0;
  const taux = activesDebut ? (100 * defaillances[n - 1]) / activesDebut : null;
  const tauxTous = activesDebutTous ? (100 * defaillancesTous[n - 1]) / activesDebutTous : null;
  remplir("chiffres-defaillances", [
    [`Défaillances en ${derniere}`, nombre.format(defaillances[n - 1]),
      `${pourcent(evolutionPct(defaillances[n - 2], defaillances[n - 1]))} sur un an`],
    ["Taux de défaillance", pourcent(taux, false, 2), `toutes activités : ${pourcent(tauxTous, false, 2)}`],
  ]);
  dessinerDefaillances(annees, defaillances);

  // Comptes : [nombre, CA médian, marge EBE, marge nette, % déficitaires, délai clients]
  const [nombreComptes, ca, margeEbe, margeNette, deficitaires, delai] = brut.comptes || [0];
  const comptesTous = brutTous.comptes || [];
  $("titre-comptes").textContent = `Rentabilité des sociétés — comptes ${infos.annee_comptes}`;
  if (!nombreComptes || nombreComptes < SEUIL_COMPTES) {
    $("intro-comptes").textContent = "";
    message("chiffres-comptes", `Trop peu de comptes publiés dans cette zone (${nombre.format(nombreComptes || 0)}) `
      + `pour des médianes fiables${zone === "FR" ? "." : " : essayez la France entière."}`);
    return;
  }
  $("intro-comptes").textContent = `Médianes calculées sur ${nombre.format(nombreComptes)} sociétés du secteur `
    + "qui publient leurs comptes : la moitié fait mieux, l'autre moitié moins bien.";
  const jours = (v) => (v === null || v === undefined ? "—"
    : `${nombre.format(Math.round(v))} ${Math.round(v) > 1 ? "jours" : "jour"}`);
  remplir("chiffres-comptes", [
    ["Chiffre d'affaires médian", eurosCourts(ca), `toutes activités : ${eurosCourts(comptesTous[1])}`],
    ["Marge d'EBE médiane", pourcent(margeEbe, false), `toutes activités : ${pourcent(comptesTous[2], false)}`],
    ["Marge nette médiane", pourcent(margeNette, false), `toutes activités : ${pourcent(comptesTous[3], false)}`],
    ["Sociétés en perte", pourcent(deficitaires, false, 0), `toutes activités : ${pourcent(comptesTous[4], false, 0)}`],
    ["Délai de paiement des clients", jours(delai), `toutes activités : ${jours(comptesTous[5])}`],
  ]);
}

// --- Territoire ---------------------------------------------------------------------------

export function afficherTerritoire({ infos, zones, zone }) {
  const z = zones[zone];
  const france = zones.FR;
  const [debut, fin] = infos.annees_population;
  const evolution = (t) => evolutionPct(t.population_debut, t.population_fin);
  $("intro-territoire").textContent = `${z.nom} — population, niveau de vie et pauvreté. Utile pour juger de la `
    + "clientèle potentielle d'une activité tournée vers les particuliers.";
  const comparaison = (texte) => (zone === "FR" ? null : `France : ${texte}`);
  remplir("chiffres-territoire", [
    [`Habitants (${fin})`, z.population_fin ? nombre.format(z.population_fin) : "—", null],
    [`Évolution ${debut}–${fin}`, pourcent(evolution(z)), comparaison(pourcent(evolution(france)))],
    [`Niveau de vie médian (${infos.annee_revenus})`, z.revenu_median ? euros.format(z.revenu_median) : "—",
      zone === "FR" ? "France métropolitaine, par an" : `France métropolitaine : ${euros.format(france.revenu_median)}`],
    ["Taux de pauvreté", pourcent(z.taux_pauvrete ?? null, false), comparaison(pourcent(france.taux_pauvrete, false))],
  ]);
}

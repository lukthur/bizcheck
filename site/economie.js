// BizCheck — emploi (URSSAF), défaillances (BODACC), comptes des sociétés (INPI), comptes du secteur en
// France (INSEE Ésane) et territoire (INSEE).

import { dessinerCouts, dessinerDefaillances, dessinerEmploi } from "./graphiques.js";
import { $, boutonAide, decimal, element, nombre, pourcent } from "./outils.js";

const SEUIL_COMPTES = 20; // en dessous, pas de médiane affichée

const euros = new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR", maximumFractionDigits: 0 });

// 312 456 → « 312 k€ » ; 1 234 567 → « 1,2 M€ »
function eurosCourts(valeur) {
  if (valeur === null || valeur === undefined || Number.isNaN(valeur)) return "—";
  const taille = Math.abs(valeur);
  if (taille >= 1e9) return `${decimal(valeur / 1e9)} Md€`;
  if (taille >= 1e6) return `${decimal(valeur / 1e6)} M€`;
  if (taille >= 1e4) return `${nombre.format(Math.round(valeur / 1e3))} k€`;
  return euros.format(valeur);
}

function evolutionPct(debut, fin) {
  return debut ? 100 * (fin / debut - 1) : null;
}

// Remplit une liste <dl> de chiffres : [titre, valeur, détail] ; explications = textes des bulles « ? »
function remplir(idListe, lignes, explications = []) {
  const liste = $(idListe);
  liste.innerHTML = "";
  lignes.forEach(([titre, valeur, detail], i) => {
    const bloc = element("div");
    const dd = element("dd", null, valeur);
    if (detail) dd.append(element("small", null, ` ${detail}`));
    const dt = element("dt", null, titre);
    if (explications[i]) dt.append(boutonAide(explications[i]));
    bloc.append(dt, dd);
    liste.append(bloc);
  });
}

function message(idListe, texte) {
  const liste = $(idListe);
  liste.innerHTML = "";
  liste.append(element("p", "secondaire petit", texte));
}

// --- Emploi, défaillances, comptes ------------------------------------------------------

export function afficherEconomie({ infos, chiffres, tous, salaires, zone, codeNaf, aides }) {
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
    remplir("chiffres-emploi", lignesEmploi, [aides.salaries, aides.employeurs, aides.salaire]);
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
  ], [aides.defaillances, aides.taux_defaillance]);
  dessinerDefaillances(annees, defaillances);

  // Comptes : [nombre, CA médian, marge EBE, marge nette, % déficitaires, délai clients, CA 1er quartile,
  // CA 3e quartile, délai fournisseurs, jours de stock, % avec stock, endettement]
  const [nombreComptes, ca, margeEbe, margeNette, deficitaires, delai, caBas, caHaut, delaiFournisseurs,
    joursStock, partStock, endettement] = brut.comptes || [0];
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
  const lignes = [
    ["Chiffre d'affaires médian", eurosCourts(ca), `toutes activités : ${eurosCourts(comptesTous[1])}`],
    ["Fourchette de chiffre d'affaires",
      caBas === undefined ? "—" : `${eurosCourts(caBas)} – ${eurosCourts(caHaut)}`,
      "la moitié des sociétés se situe entre les deux"],
    ["Marge d'EBE médiane", pourcent(margeEbe, false), `toutes activités : ${pourcent(comptesTous[2], false)}`],
    ["Marge nette médiane", pourcent(margeNette, false), `toutes activités : ${pourcent(comptesTous[3], false)}`],
    ["Sociétés en perte", pourcent(deficitaires, false, 0), `toutes activités : ${pourcent(comptesTous[4], false, 0)}`],
    ["Délai de paiement des clients", jours(delai), `toutes activités : ${jours(comptesTous[5])}`],
    ["Délai de paiement des fournisseurs", jours(delaiFournisseurs), `toutes activités : ${jours(comptesTous[8])}`],
    ["Endettement médian", pourcent(endettement, false, 0),
      `des fonds propres · toutes activités : ${pourcent(comptesTous[11], false, 0)}`],
  ];
  const explications = [aides.ca, aides.ca_fourchette, aides.marge_ebe, aides.marge_nette, aides.en_perte,
    aides.delai_clients, aides.delai_fournisseurs, aides.endettement];
  // Stocks : seulement si au moins une société sur cinq en a (la plupart des services n'en ont pas)
  if (partStock >= 20) {
    lignes.push(["Stock moyen", jours(joursStock),
      `de ventes · ${pourcent(partStock, false, 0)} des sociétés ont des stocks`]);
    explications.push(aides.jours_stock);
  }
  remplir("chiffres-comptes", lignes, explications);
}

// --- Chiffre d'affaires et coûts du secteur en France (INSEE Ésane) -----------------------

// Répartition « pour 100 € de chiffre d'affaires » : même ordre que esane.json (colonnes_couts, sans le CA)
const POSTES_COUTS = [
  "Achats (marchandises, matières)",
  "Loyers et crédit-bail",
  "Sous-traitance",
  "Autres charges externes",
  "Salaires et cotisations",
  "Impôts et taxes",
  "Amortissements",
  "Impôt sur les bénéfices",
  "Bénéfice net",
];

export function afficherFinances({ esane, zone, codeNaf, aides }) {
  const annee = esane.annee;
  const col = Object.fromEntries(esane.colonnes_secteur.map((c, i) => [c, i]));
  const ligne = esane.secteurs[codeNaf];
  const tous = esane.ensemble.secteur;
  const valeur = (l, cle) => l?.[col[cle]] ?? null;
  const millions = (v) => (v === null ? null : v * 1e6);

  const horsFrance = zone === "FR" ? "" : " L'INSEE ne les publie que pour la France entière, pas par région "
    + "ni par département.";
  $("intro-finances").textContent = `En haut : comptes ${annee} de toutes les entreprises du secteur en France, `
    + `micro-entrepreneurs compris (INSEE).${horsFrance} En bas : comptes des sociétés qui publient leurs `
    + "comptes, dans la zone choisie.";
  $("titre-chiffres-secteur").textContent = `Le secteur en chiffres — France, ${annee}`;

  // Chiffres clés du code NAF
  const entreprises = valeur(ligne, "entreprises");
  const ca = valeur(ligne, "ca");
  if (!ligne || !entreprises || ca === null) {
    message("chiffres-secteur", "L'INSEE ne publie pas ces comptes pour ce secteur : il n'est pas couvert "
      + "(agriculture, banques et assurances, administration…) ou ses chiffres sont protégés par le secret "
      + "statistique (trop peu d'entreprises).");
  } else {
    const part = (l, cle) => {
      const v = valeur(l, cle);
      const total = valeur(l, "ca");
      return v === null || !total ? null : (100 * v) / total;
    };
    const parEntreprise = (l, cle) => {
      const v = valeur(l, cle);
      const n = valeur(l, "entreprises");
      return v === null || !n ? null : v / n;
    };
    const parSalarie = (l) => (valeur(l, "etp") >= 1 && valeur(l, "ca") !== null
      ? millions(valeur(l, "ca")) / valeur(l, "etp") : null);
    const centEuros = (v) => (v === null ? "—" : `${decimal(v)} €`);
    remplir("chiffres-secteur", [
      ["Chiffre d'affaires du secteur", eurosCourts(millions(ca)), `${nombre.format(entreprises)} entreprises`],
      ["Chiffre d'affaires moyen par entreprise", eurosCourts(millions(parEntreprise(ligne, "ca"))),
        `toutes activités : ${eurosCourts(millions(parEntreprise(tous, "ca")))}`],
      ["Chiffre d'affaires par salarié", eurosCourts(parSalarie(ligne)),
        `équivalent temps plein · toutes activités : ${eurosCourts(parSalarie(tous))}`],
      ["Salariés par entreprise", decimal(parEntreprise(ligne, "etp")),
        `en moyenne, temps plein · toutes activités : ${decimal(parEntreprise(tous, "etp"))}`],
      ["Part des salaires", pourcent(part(ligne, "personnel"), false, 0),
        `du chiffre d'affaires · toutes activités : ${pourcent(part(tous, "personnel"), false, 0)}`],
      ["Bénéfice net pour 100 € de ventes", centEuros(part(ligne, "resultat_net")),
        `toutes activités : ${centEuros(part(tous, "resultat_net"))}`],
      ["Ventes à l'étranger", pourcent(part(ligne, "export"), false, 0),
        `du chiffre d'affaires · toutes activités : ${pourcent(part(tous, "export"), false, 0)}`],
      ["Investissements", pourcent(part(ligne, "investissements"), false, 1),
        `du chiffre d'affaires · toutes activités : ${pourcent(part(tous, "investissements"), false, 1)}`],
    ], [aides.ca_secteur, aides.ca_moyen, aides.ca_salarie, aides.salaries_entreprise, aides.part_salaires,
      aides.benefice_100, aides.export, aides.investissements]);
  }

  // Pour 100 € de chiffre d'affaires : groupe (56.1), sinon division (56)
  const codeGroupe = [codeNaf.slice(0, 4), codeNaf.slice(0, 2)].find((c) => esane.groupes[c]?.couts[0]);
  $("carte-couts").hidden = !codeGroupe;
  if (!codeGroupe) return;
  const groupe = esane.groupes[codeGroupe];
  const beneficeCode = valeur(ligne, "resultat_net") === null || !ca ? null
    : (100 * valeur(ligne, "resultat_net")) / ca;
  const pour100 = (couts) => couts.slice(1).map((v) => (v === null || !couts[0] ? null : (100 * v) / couts[0]));
  $("titre-couts").textContent = `Pour 100 € de chiffre d'affaires — France, ${annee}`;
  // le groupe peut ne contenir que ce code NAF (ex. 64.2 = 64.20Z) : il n'est alors pas « plus large »
  const plusLarge = Object.keys(esane.secteurs).filter((c) => c.startsWith(codeGroupe)).length > 1;
  const niveau = codeGroupe.length === 2 ? "la division" : "le groupe";
  $("intro-couts").textContent = (plusLarge
    ? `Calculé sur ${niveau} ${codeGroupe} « ${groupe.libelle} », un peu plus large que le secteur ${codeNaf}. `
    : `Calculé sur ${niveau} ${codeGroupe} « ${groupe.libelle} ». `)
    + "Le total ne fait pas exactement 100 € : les produits et charges financiers et exceptionnels ne sont pas "
    + "représentés."
    + (beneficeCode === null || !plusLarge ? "" : ` Pour le seul secteur ${codeNaf}, le bénéfice net est de `
      + `${decimal(beneficeCode)} € pour 100 € (voir plus haut).`);
  dessinerCouts(POSTES_COUTS, pour100(groupe.couts), pour100(esane.ensemble.couts));
}

// --- Territoire ---------------------------------------------------------------------------

export function afficherTerritoire({ infos, zones, zone, aides }) {
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
  ], [aides.habitants, aides.evolution_population, aides.niveau_de_vie, aides.pauvrete]);
}

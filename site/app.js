// BizCheck — page d'un secteur, à partir des fichiers JSON de donnees/ (produits par bizcheck.py).
// Aucune donnée n'est écrite à la main ici.
//
// Les autres fichiers : recherche.js (moteur de recherche), graphiques.js (Chart.js),
// carte.js (carte des départements), ville.js (« Et dans ma ville ? »), economie.js (emploi,
// défaillances, comptes, territoire), outils.js (mise en forme).

import { colorer, preparerCarte } from "./carte.js";
import { textesAide } from "./aides.js";
import { afficherEconomie, afficherTerritoire } from "./economie.js";
import {
  dessinerCamembert, dessinerEvolution, dessinerSaison, dessinerSurvie, tauxSurvie,
} from "./graphiques.js";
import {
  $, boutonAide, decimal, densite, element, formaterDate, installerBulles, lireJson, nombre, pluriel,
  poserAide, pourcent, signe,
} from "./outils.js";
import { creerIndex, rechercher } from "./recherche.js";
import { brancherVille, mettreAJourVille } from "./ville.js";

const SEUIL_TENDANCE_PCT = 2; // au-delà de ±2 % sur 3 ans : croissance ou déclin

const etat = {
  infos: null,        // infos.json : années, sources, limites
  zones: null,        // zones.json : France, régions, départements (avec population)
  secteurs: {},       // recherche.json, par code NAF : libellé, notes INSEE
  classement: {},     // secteurs.json, par code NAF : évolution et rang national
  tous: null,         // naf/TOUS.json : toutes activités confondues (point de comparaison)
  salaires: null,     // salaires.json : salaire moyen par famille de secteurs
  index: null,        // index du moteur de recherche
  chiffres: null,     // naf/<code>.json du secteur affiché
  zone: "FR",
  aides: {},         // textes des bulles « ? » (aides.js)
  inclureSansSalarie: true, // camembert « Taille » : avec ou sans les entreprises sans salarié
  suggestions: [],
  suggestionActive: -1,
};

// --- Lecture des chiffres --------------------------------------------------------

// Indicateurs année par année d'une zone (10 ans), à partir des nombres bruts d'un fichier.
// Une zone absente du fichier n'a aucune entreprise du secteur : tout vaut 0.
function indicateursZone(fichier, codeZone) {
  const brut = fichier.zones[codeZone];
  return etat.infos.annees.map((annee, i) => {
    const valeur = (nom) => brut?.[nom]?.[i] ?? 0;
    const activesDebut = valeur("actives_debut");
    const creations = valeur("creations");
    const fermetures = valeur("fermetures");
    return {
      annee,
      entreprises_actives_fin_annee: valeur("actives_fin"),
      creations,
      fermetures,
      solde_net: creations - fermetures,
      // taux rapportés aux entreprises actives au 1er janvier
      taux_creation_pct: activesDebut ? (100 * creations) / activesDebut : null,
      taux_fermeture_pct: activesDebut ? (100 * fermetures) / activesDebut : null,
    };
  });
}

// Les 3 dernières années (tendance, chiffres clés)
function periodePrincipale(indicateurs) {
  return indicateurs.slice(-etat.infos.nb_annees_principales);
}

function evolution(indicateurs) {
  const debut = indicateurs[0].entreprises_actives_fin_annee;
  const fin = indicateurs[indicateurs.length - 1].entreprises_actives_fin_annee;
  return debut ? 100 * (fin / debut - 1) : null;
}

function afficherErreur(texte) {
  $("message-erreur").textContent = texte;
  $("message-erreur").hidden = false;
  $("contenu").hidden = true;
}

// --- Chargement ---------------------------------------------------------------------

async function demarrer() {
  const parametres = new URLSearchParams(location.search);
  let listeSecteurs;
  let classement;
  let fondDeCarte;
  try {
    [etat.infos, etat.zones, listeSecteurs, classement, etat.tous, fondDeCarte, etat.salaires] = await Promise.all([
      lireJson("donnees/infos.json"),
      lireJson("donnees/zones.json"),
      lireJson("donnees/recherche.json"),
      lireJson("donnees/secteurs.json"),
      lireJson("donnees/naf/TOUS.json"),
      lireJson("donnees/carte.json"),
      lireJson("donnees/salaires.json"),
    ]);
  } catch (erreur) {
    afficherErreur("Impossible de lire les données. Le site doit être ouvert via le serveur local "
      + "(lancer_site.bat), pas en double-cliquant sur index.html.");
    return;
  }
  for (const s of listeSecteurs) etat.secteurs[s.code_naf] = s;
  for (const s of classement) etat.classement[s.code_naf] = s;
  etat.index = creerIndex(listeSecteurs);

  etat.zone = etat.zones[parametres.get("zone")] ? parametres.get("zone") : "FR";
  remplirChoixZone();
  $("choix-zone").addEventListener("change", (e) => changerZone(e.target.value));
  brancherRecherche();
  installerBulles();
  await preparerCarte(fondDeCarte, changerZone);
  brancherVille(parametres.get("ville"));
  // Mode clair / sombre changé dans le système : on redessine avec les bonnes couleurs
  matchMedia("(prefers-color-scheme: dark)").addEventListener("change", afficher);

  const codeDemande = parametres.get("naf");
  if (etat.secteurs[codeDemande]) {
    await chargerSecteur(codeDemande);
  } else {
    $("accueil").hidden = false;
    $("champ-recherche").focus();
  }
}

async function chargerSecteur(code) {
  try {
    etat.chiffres = await lireJson(`donnees/naf/${code}.json`);
  } catch (erreur) {
    afficherErreur(`Les données du secteur ${code} sont introuvables.`);
    return;
  }
  $("accueil").hidden = true;
  $("champ-recherche").value = etat.secteurs[code].libelle_naf;
  afficherPerimetre(etat.secteurs[code]);
  afficher();
}

function changerZone(codeZone) {
  etat.zone = codeZone;
  $("choix-zone").value = codeZone;
  afficher();
}

function remplirChoixZone() {
  const zones = etat.zones;
  const choix = $("choix-zone");
  choix.add(new Option("France entière", "FR"));

  const groupes = [
    ["Régions", "region", (a, b) => zones[a].nom.localeCompare(zones[b].nom, "fr"), (c) => zones[c].nom],
    ["Départements", "departement", (a, b) => a.localeCompare(b, "fr", { numeric: true }),
      (c) => `${c.slice(1)} — ${zones[c].nom}`],
  ];
  for (const [titre, type, tri, libelle] of groupes) {
    const groupe = document.createElement("optgroup");
    groupe.label = titre;
    Object.keys(zones).filter((c) => zones[c].type === type).sort(tri)
      .forEach((c) => groupe.append(new Option(libelle(c), c)));
    choix.append(groupe);
  }
  choix.value = etat.zone;
}

// --- Recherche d'activité --------------------------------------------------------------

function brancherRecherche() {
  const champ = $("champ-recherche");
  champ.addEventListener("input", () => proposer(champ.value));
  champ.addEventListener("focus", () => {
    // un clic dans le champ sélectionne le texte : on peut taper directement une nouvelle recherche
    if (etat.chiffres && champ.value === etat.secteurs[etat.chiffres.code_naf].libelle_naf) champ.select();
  });
  champ.addEventListener("keydown", (e) => {
    const nombreSuggestions = etat.suggestions.length;
    if (e.key === "ArrowDown" && nombreSuggestions) {
      e.preventDefault();
      surligner((etat.suggestionActive + 1) % nombreSuggestions);
    } else if (e.key === "ArrowUp" && nombreSuggestions) {
      e.preventDefault();
      surligner((etat.suggestionActive - 1 + nombreSuggestions) % nombreSuggestions);
    } else if (e.key === "Enter" && nombreSuggestions) {
      e.preventDefault();
      choisir(etat.suggestions[Math.max(0, etat.suggestionActive)].fiche.code_naf);
    } else if (e.key === "Escape") {
      fermerSuggestions();
    }
  });
  champ.addEventListener("blur", () => setTimeout(fermerSuggestions, 150));

  document.querySelectorAll(".exemple").forEach((bouton) => {
    bouton.addEventListener("click", () => {
      champ.value = bouton.textContent;
      champ.focus();
      proposer(champ.value);
    });
  });
}

function proposer(texte) {
  const liste = $("suggestions");
  etat.suggestions = rechercher(etat.index, texte);
  etat.suggestionActive = -1;
  liste.innerHTML = "";
  if (texte.trim().length < 2) {
    fermerSuggestions();
    return;
  }
  if (etat.suggestions.length === 0) {
    liste.append(element("li", "vide",
      "Aucun secteur trouvé. Essayez un autre mot : le métier, le produit vendu ou le service rendu."));
  }
  etat.suggestions.forEach(({ fiche, extrait }, i) => {
    const li = element("li");
    li.id = `suggestion-${i}`;
    li.setAttribute("role", "option");
    li.setAttribute("aria-selected", "false");

    const ligne = element("span", "sugg-ligne");
    ligne.append(element("span", "sugg-libelle", fiche.libelle_naf), element("span", "sugg-code", fiche.code_naf));
    li.append(ligne);
    if (extrait) {
      const debut = extrait.renvoi ? "Inclut, selon l'INSEE" : "Comprend";
      li.append(element("span", "sugg-extrait", `${debut} : ${extrait.texte}`));
    }
    li.append(element("span", "sugg-nombre",
      `${nombre.format(fiche.entreprises_actives)} entreprises actives en France`));

    li.addEventListener("mousedown", (e) => {
      e.preventDefault(); // garde le focus dans le champ jusqu'au choix
      choisir(fiche.code_naf);
    });
    liste.append(li);
  });
  liste.hidden = false;
  $("champ-recherche").setAttribute("aria-expanded", "true");
}

function surligner(position) {
  etat.suggestionActive = position;
  [...$("suggestions").children].forEach((li, i) => li.setAttribute("aria-selected", String(i === position)));
  const active = $(`suggestion-${position}`);
  $("champ-recherche").setAttribute("aria-activedescendant", active ? active.id : "");
  active?.scrollIntoView({ block: "nearest" });
}

function fermerSuggestions() {
  $("suggestions").hidden = true;
  $("champ-recherche").setAttribute("aria-expanded", "false");
  $("champ-recherche").removeAttribute("aria-activedescendant");
}

function choisir(code) {
  fermerSuggestions();
  $("champ-recherche").blur();
  chargerSecteur(code);
}

// --- Ce que regroupe le secteur -------------------------------------------------------

function afficherPerimetre(fiche) {
  const comprend = [...fiche.comprend, ...fiche.comprend_aussi];
  const liste = $("liste-comprend");
  liste.innerHTML = "";
  for (const texte of comprend.length ? comprend : [fiche.libelle_naf]) liste.append(element("li", null, texte));

  const exclusions = $("liste-exclusions");
  exclusions.innerHTML = "";
  $("bloc-exclusions").hidden = fiche.ne_comprend_pas.length === 0;
  $("bloc-exclusions").open = false;
  for (const { texte, voir } of fiche.ne_comprend_pas) {
    const li = element("li", null, texte);
    // lien direct vers le ou les secteurs indiqués par l'INSEE
    voir.filter((code) => etat.secteurs[code]).forEach((code) => {
      const bouton = element("button", "lien-code", `voir ${code}`);
      bouton.type = "button";
      bouton.addEventListener("click", () => {
        chargerSecteur(code);
        window.scrollTo({ top: 0, behavior: "smooth" });
      });
      li.append(" — ", bouton);
    });
    exclusions.append(li);
  }
}

// --- Affichage de la page du secteur ------------------------------------------------------

function afficher() {
  if (!etat.chiffres) return;
  const code = etat.chiffres.code_naf;
  const libelle = etat.secteurs[code].libelle_naf;
  const zone = etat.zones[etat.zone];
  const historique = indicateursZone(etat.chiffres, etat.zone);
  const periode = periodePrincipale(historique);
  const premier = periode[0];
  const dernier = periode[periode.length - 1];

  // L'adresse de la page garde le choix : on peut la copier et la partager
  const adresse = new URL(location.href);
  adresse.searchParams.set("naf", code);
  adresse.searchParams.set("zone", etat.zone);
  history.replaceState(null, "", adresse);

  etat.aides = textesAide(etat.infos, { famillesalaire: etat.salaires.divisions[code.slice(0, 2)]?.libelle });

  $("message-erreur").hidden = true;
  $("contenu").hidden = false;
  $("titre").textContent = `${libelle} — ${zone.nom}`;
  $("sous-titre").textContent = `Code NAF ${code} · tendance de fin ${premier.annee} à fin ${dernier.annee} `
    + `· ce code regroupe plusieurs activités proches.`;
  document.title = `${libelle} — ${zone.nom} · BizCheck`;

  const alerte = $("alerte-petit-effectif");
  alerte.hidden = dernier.entreprises_actives_fin_annee >= etat.infos.seuil_petit_effectif;
  alerte.textContent = `Attention : moins de ${etat.infos.seuil_petit_effectif} entreprises de ce secteur dans `
    + `cette zone. Quelques créations ou fermetures suffisent à faire varier fortement les chiffres : `
    + `ils sont à prendre avec prudence.`;

  afficherTuiles(code, zone, periode);
  afficherCommentaire(zone, periode);
  dessinerEvolution(historique);
  afficherTableau(historique);
  afficherSurvieEtPortrait();
  afficherEconomie({ ...etat, zone: etat.zone, codeNaf: code });
  afficherTerritoire({ infos: etat.infos, zones: etat.zones, zone: etat.zone, aides: etat.aides });
  afficherSaison();
  colorer(etat.chiffres, etat.zones, etat.zone, etat.infos);
  mettreAJourVille(code, etat.zones, etat.chiffres, etat.aides);
  afficherSources();
  // bulles « ? » des titres de graphiques (attribut data-explication dans index.html)
  document.querySelectorAll("[data-explication]")
    .forEach((titre) => poserAide(titre, etat.aides[titre.dataset.explication]));
}

// --- Chiffres clés -----------------------------------------------------------------------

function tuile(libelle, valeur, details = []) {
  const bloc = element("div", "tuile");
  bloc.append(element("p", "tuile-libelle", libelle));
  if (valeur instanceof Node) bloc.append(valeur);
  else bloc.append(element("p", "tuile-valeur", valeur));
  for (const detail of details.filter(Boolean)) bloc.append(element("p", "tuile-detail", detail));
  return bloc;
}

function afficherTuiles(code, zone, periode) {
  const premier = periode[0];
  const dernier = periode[periode.length - 1];
  const evo = evolution(periode);
  const brut = etat.chiffres.zones[etat.zone] || {};
  const brutTous = etat.tous.zones[etat.zone] || {};
  const zoneVide = periode.every((r) => r.entreprises_actives_fin_annee === 0 && r.creations === 0 && r.fermetures === 0);

  // Tendance
  let tendance = { texte: "Stable", classe: "stable", icone: "→" };
  if (evo !== null && evo >= SEUIL_TENDANCE_PCT) tendance = { texte: "En croissance", classe: "hausse", icone: "↗" };
  if (evo !== null && evo <= -SEUIL_TENDANCE_PCT) tendance = { texte: "En déclin", classe: "baisse", icone: "↘" };
  if (zoneVide) tendance = { texte: "Aucune entreprise", classe: "stable", icone: "–" };
  const verdict = element("p", "verdict");
  const icone = element("span", `icone-verdict ${tendance.classe}`, tendance.icone);
  icone.setAttribute("aria-hidden", "true");
  verdict.append(icone, tendance.texte);

  const rang = etat.classement[code];
  const texteRang = rang?.rang
    ? `Classement national : ${rang.rang}e sur ${rang.nb_classes} secteurs `
      + `(mieux que ${Math.round((100 * (rang.nb_classes - rang.rang)) / rang.nb_classes)} %)`
    : null;
  const evoTous = evolution(periodePrincipale(indicateursZone(etat.tous, etat.zone)));

  // Survie à 3 ans
  const cohorte3 = brut.survie?.["3"]?.[0] ?? 0;
  const survie3 = cohorte3 >= etat.infos.seuil_petit_effectif ? tauxSurvie(brut.survie, 3) : null;

  // Densité : établissements pour 10 000 habitants
  const densiteZone = densite(brut.etablissements || 0, zone.population);
  const densiteFrance = densite(etat.chiffres.zones.FR?.etablissements || 0, etat.zones.FR.population);

  const tuiles = $("tuiles");
  tuiles.innerHTML = "";
  tuiles.append(
    tuile("Tendance", verdict, zoneVide ? ["Pas de tendance calculable dans cette zone."] : [
      `${pourcent(evo)} d'entreprises actives entre fin ${premier.annee} et fin ${dernier.annee} `
        + `(toutes activités : ${pourcent(evoTous)})`,
      texteRang,
    ]),
    tuile(`Entreprises actives fin ${dernier.annee}`, nombre.format(dernier.entreprises_actives_fin_annee), [
      `${signe(dernier.entreprises_actives_fin_annee - premier.entreprises_actives_fin_annee)} depuis fin ${premier.annee}`,
    ]),
    tuile(`Créations en ${dernier.annee}`, nombre.format(dernier.creations), [
      `Taux de création : ${pourcent(dernier.taux_creation_pct, false)}`,
    ]),
    tuile(`Fermetures en ${dernier.annee}`, nombre.format(dernier.fermetures), [
      `Taux de fermeture : ${pourcent(dernier.taux_fermeture_pct, false)}`,
    ]),
    tuile("Toujours actives 3 ans après", survie3 === null ? "—" : pourcent(survie3, false, 0), [
      survie3 === null ? "Trop peu de créations pour un taux fiable."
        : `Toutes activités : ${pourcent(tauxSurvie(brutTous.survie, 3), false, 0)}`,
    ]),
    tuile("Établissements pour 10 000 habitants", decimal(densiteZone), [
      `${pluriel(brut.etablissements || 0, "établissement actif", "établissements actifs")}`,
      etat.zone === "FR" ? null : `France : ${decimal(densiteFrance)}`,
    ]),
  );
  // La tuile tendance garde son style particulier
  tuiles.firstElementChild.classList.add("tuile-verdict");
  // Bulle « ? » à côté du titre de chaque tuile, dans l'ordre des tuiles
  ["tendance", "actives", "creations", "fermetures", "survie3", "densite"].forEach((cle, i) => {
    tuiles.children[i].querySelector(".tuile-libelle").append(boutonAide(etat.aides[cle]));
  });
}

// Phrase de résumé, accordée selon les nombres
function afficherCommentaire(zone, periode) {
  const premier = periode[0];
  const dernier = periode[periode.length - 1];
  const zoneVide = periode.every((r) => r.entreprises_actives_fin_annee === 0 && r.creations === 0 && r.fermetures === 0);
  if (zoneVide) {
    $("commentaire").textContent = `${zone.nom} : aucune entreprise de ce secteur n'y a son siège `
      + `entre ${premier.annee} et ${dernier.annee}.`;
    return;
  }
  const evo = evolution(periode);
  const actives = dernier.entreprises_actives_fin_annee;
  const phraseEvolution = evo === null
    ? `alors qu'il n'y en avait aucune fin ${premier.annee}`
    : `soit ${pourcent(evo)} par rapport à fin ${premier.annee}`;
  const comparaison = etat.zone === "FR" ? ""
    : ` (France entière : ${pourcent(evolution(periodePrincipale(indicateursZone(etat.chiffres, "FR"))))})`;

  const { creations, fermetures, solde_net: solde } = dernier;
  const phraseCreations = creations === 0 ? "aucune entreprise n'a été créée"
    : pluriel(creations, "entreprise a été créée", "entreprises ont été créées");
  const phraseFermetures = fermetures === 0 ? "aucune n'a fermé"
    : `${nombre.format(fermetures)} ${fermetures > 1 ? "ont" : "a"} fermé`;
  const phraseSolde = solde > 0 ? `il y a donc eu ${pluriel(solde, "création", "créations")} de plus que de fermetures`
    : solde < 0 ? `il y a donc eu ${pluriel(-solde, "fermeture", "fermetures")} de plus que de créations`
      : "créations et fermetures s'équilibrent";

  $("commentaire").textContent = `${zone.nom} : le secteur compte `
    + `${pluriel(actives, "entreprise active", "entreprises actives")} fin ${dernier.annee}, `
    + `${phraseEvolution}${comparaison}. En ${dernier.annee}, ${phraseCreations} et ${phraseFermetures} : `
    + `${phraseSolde}.`;
}

function afficherTableau(historique) {
  $("tableau").innerHTML = [...historique].reverse().map((r) => `<tr>
      <td>${r.annee}</td>
      <td>${nombre.format(r.entreprises_actives_fin_annee)}</td>
      <td>${nombre.format(r.creations)}</td>
      <td>${nombre.format(r.fermetures)}</td>
      <td>${signe(r.solde_net)}</td>
      <td>${pourcent(r.taux_creation_pct, false)}</td>
      <td>${pourcent(r.taux_fermeture_pct, false)}</td>
    </tr>`).join("");
}

// --- Survie et portrait ------------------------------------------------------------------

const PORTRAIT = [
  {
    cle: "taille", titre: "Taille (salariés)",
    parts: ["Aucun salarié", "1 à 9", "10 à 49", "50 à 249", "250 et plus"],
    couleurs: ["--neutre", "--serie-1", "--serie-2", "--serie-3", "--serie-5"],
  },
  {
    cle: "forme", titre: "Forme juridique",
    parts: ["Entreprise individuelle", "SARL / EURL", "SAS / SASU", "Autre société", "Association, autre"],
    couleurs: ["--serie-1", "--serie-2", "--serie-3", "--serie-4", "--serie-5"],
  },
  {
    cle: "age", titre: "Âge",
    parts: ["Moins de 3 ans", "3 à 10 ans", "Plus de 10 ans"],
    couleurs: ["--serie-6", "--serie-7", "--serie-4"],
  },
];

// Emplacement d'un camembert : titre + bulle « ? », dessin, légende (remplis par remplirCamembert)
function emplacementCamembert(cle, titre) {
  const groupe = element("div", "portrait-groupe");
  const enTete = element("p", "portrait-titre", titre);
  enTete.append(boutonAide(etat.aides[cle]));
  groupe.append(enTete);
  const zone = element("div", "zone-camembert");
  const canvas = element("canvas");
  canvas.id = `camembert-${cle}`;
  canvas.setAttribute("role", "img");
  zone.append(canvas);
  const legende = element("ul", "legende-empilee");
  legende.id = `legende-${cle}`;
  groupe.append(zone, legende);
  return groupe;
}

// Dessine le camembert et écrit la légende avec les pourcentages (calculés sur les parts affichées)
function remplirCamembert(cle, titre, valeurs, couleurs, libelles) {
  const total = valeurs.reduce((a, b) => a + b, 0);
  const part = (v) => pourcent(total ? (100 * v) / total : 0, false, 0);
  $(`camembert-${cle}`).setAttribute("aria-label",
    `${titre} : ${libelles.map((l, i) => `${l} ${part(valeurs[i])}`).join(", ")}`);
  const legende = $(`legende-${cle}`);
  legende.innerHTML = "";
  if (!total) {
    legende.append(element("li", null, "Aucune entreprise dans ces catégories pour cette zone."));
  } else {
    valeurs.forEach((valeur, i) => {
      const item = element("li");
      const pastille = element("span", "pastille");
      pastille.style.background = `var(${couleurs[i]})`;
      item.append(pastille, `${libelles[i]} `, element("strong", null, part(valeur)));
      legende.append(item);
    });
  }
  dessinerCamembert(`camembert-${cle}`, valeurs, couleurs, libelles);
}

// Taille : avec ou sans les entreprises sans salarié, selon la case à cocher
function remplirCamembertTaille(brut) {
  const { titre, parts, couleurs } = PORTRAIT[0];
  const debut = etat.inclureSansSalarie ? 0 : 1;
  remplirCamembert("taille", titre, brut.taille.slice(debut), couleurs.slice(debut), parts.slice(debut));
}

function afficherSurvieEtPortrait() {
  const brut = etat.chiffres.zones[etat.zone] || {};
  const brutTous = etat.tous.zones[etat.zone] || {};
  const durees = etat.infos.durees_survie;
  const derniere = etat.infos.annees[etat.infos.annees.length - 1];

  $("intro-survie").textContent = "Part des entreprises toujours immatriculées 1, 3 et 5 ans après leur création "
    + `(créées en ${durees.map((d) => derniere - d).join(", ")}).`;
  dessinerSurvie(durees, brut.survie, brutTous.survie);

  const portrait = $("portrait");
  portrait.innerHTML = "";
  const actives = brut.actives_aujourdhui || 0;
  if (!actives) {
    portrait.append(element("p", "secondaire", "Aucune entreprise active de ce secteur dans cette zone."));
    return;
  }
  const camemberts = element("div", "camemberts");
  portrait.append(camemberts);
  for (const { cle, titre } of PORTRAIT) camemberts.append(emplacementCamembert(cle, titre));

  // Taille : case « inclure les entreprises sans salarié » + phrase sur leur composition
  const groupeTaille = camemberts.firstElementChild;
  const choix = element("label", "case-a-cocher");
  const caseACocher = element("input");
  caseACocher.type = "checkbox";
  caseACocher.checked = etat.inclureSansSalarie;
  caseACocher.addEventListener("change", () => {
    etat.inclureSansSalarie = caseACocher.checked;
    remplirCamembertTaille(brut);
  });
  choix.append(caseACocher, " Inclure les entreprises sans salarié");
  const ligneChoix = element("div", "ligne-case");
  ligneChoix.append(choix, boutonAide(etat.aides.sans_salarie));
  groupeTaille.querySelector(".portrait-titre").after(ligneChoix);
  const sansSalarie = brut.taille[0];
  if (sansSalarie) {
    groupeTaille.append(element("p", "secondaire petit",
      `${pourcent((100 * sansSalarie) / actives, false, 0)} des entreprises n'ont aucun salarié, dont `
      + `${pourcent((100 * (brut.sans_salarie_individuelles || 0)) / sansSalarie, false, 0)} d'entreprises `
      + "individuelles (souvent des micro-entrepreneurs) ; les autres sont des sociétés ou des associations "
      + "sans salarié (dirigeant seul, structure peu ou pas active…)."));
  }

  // on dessine une fois les trois emplacements en place (sinon le premier prend toute la largeur)
  remplirCamembertTaille(brut);
  for (const { cle, titre, parts, couleurs } of PORTRAIT.slice(1)) {
    remplirCamembert(cle, titre, brut[cle], couleurs, parts);
  }
  const partReseaux = (100 * (brut.plusieurs_etablissements || 0)) / actives;
  const partReseauxTous = (100 * (brutTous.plusieurs_etablissements || 0)) / (brutTous.actives_aujourdhui || 1);
  portrait.append(element("p", "portrait-phrase",
    `${pourcent(partReseaux, false, 0)} des entreprises ont plusieurs établissements (réseaux, chaînes, `
    + `boutiques multiples…) — toutes activités : ${pourcent(partReseauxTous, false, 0)}.`));
}

// --- Saisonnalité -------------------------------------------------------------------------

function afficherSaison() {
  const annees = etat.infos.annees;
  const derniere = annees[annees.length - 1];
  const premiere = derniere - etat.infos.nb_annees_saisonnalite + 1;
  $("titre-graphique-saison").textContent = `Part des créations de l'année, mois par mois — France entière, `
    + `${premiere} à ${derniere}`;
  dessinerSaison(etat.chiffres.zones.FR?.creations_par_mois, etat.tous.zones.FR?.creations_par_mois);
}

// --- Sources, limites et notes sous les graphiques -------------------------------------

function afficherSources() {
  const infos = etat.infos;
  const dateSirene = formaterDate(infos.sources[0].date_actualisation);
  const source = `Source : INSEE, base Sirene (fichier du ${dateSirene}).`;
  const notes = {
    actives: `${source} Limite : une entreprise est comptée dans son activité et le département de son siège `
      + `actuels, pour toutes les années ; l'historique ancien est approximatif.`,
    flux: `${source} Limite : seules les fermetures déclarées sont comptées ; une entreprise sans activité `
      + `mais non radiée reste « active ».`,
    survie: `${source} Limite : il s'agit de survie administrative (entreprise non radiée). Les micro-entreprises `
      + `inactives sont radiées d'office au bout de 2 ans, d'autres restent inscrites sans activité.`,
    portrait: `${source} Entreprises actives à cette date. La taille vient de la déclaration d'effectif la plus `
      + `récente ; les entrepreneurs individuels et micro-entrepreneurs sont dans « Entreprise individuelle ».`,
    saison: `${source} Date de création déclarée ; le 1er janvier est souvent choisi par convention, ce qui `
      + `gonfle janvier.`,
    carte: `${source} Évolution : entreprises selon leur siège. Densité : établissements actifs du secteur à `
      + `leur adresse, rapportés à la population légale (INSEE). Cliquez sur un département pour l'afficher.`,
    ville: `${source} Établissements actifs dont l'activité principale est ce code NAF, à leur adresse dans la `
      + `commune (arrondissements de Paris, Lyon et Marseille regroupés). Salariés : URSSAF. Niveau de vie : `
      + `INSEE Filosofi (non publié pour les plus petites communes).`,
    emploi: `Source : URSSAF, salariés du secteur privé au 31 décembre, dans les établissements de ce secteur `
      + `situés dans la zone. Limite : indépendants, micro-entrepreneurs et fonction publique non comptés. `
      + `Salaire : moyenne brute annuelle par salarié (temps partiels compris) de la famille de secteurs.`,
    defaillances: `Source : BODACC, jugements d'ouverture de redressement ou de liquidation judiciaire, une fois `
      + `par entreprise et par an, rattachés au secteur et au siège via Sirene. Limite : un redressement peut `
      + `réussir ; taux = défaillances / entreprises actives au 1er janvier.`,
    comptes: `Source : ratios financiers Banque de France / INPI. Limite : seulement les sociétés qui publient `
      + `leurs comptes (ni entrepreneurs individuels, ni micro-entreprises, ni comptes confidentiels) ; les `
      + `comptes arrivent avec un an de décalage.`,
    territoire: `Sources : INSEE, populations municipales (recensement) et Filosofi (niveau de vie par unité de `
      + `consommation, après impôts et prestations). Limite : Filosofi ne couvre pas Mayotte.`,
  };
  for (const [cle, texte] of Object.entries(notes)) {
    document.querySelector(`[data-note="${cle}"]`).textContent = texte;
  }

  $("liste-sources").innerHTML = "";
  for (const s of infos.sources) {
    const li = element("li");
    const lien = element("a", null, s.nom);
    lien.href = s.lien;
    li.append(lien, ` — version du ${formaterDate(s.date_actualisation)}`);
    $("liste-sources").append(li);
  }
  $("liste-limites").innerHTML = "";
  for (const limite of infos.limites) $("liste-limites").append(element("li", null, limite));
  const [jour, heure] = infos.date_calcul.split(" ");
  $("date-calcul").textContent = `Chiffres calculés le ${formaterDate(jour)} à ${heure}.`;
}

demarrer();

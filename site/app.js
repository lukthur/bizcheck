// BizCheck — affichage d'un secteur à partir des fichiers JSON de donnees/
// (produits par bizcheck.py). Aucune donnée n'est écrite à la main ici.

const SEUIL_TENDANCE_PCT = 2; // au-delà de ±2 % sur la période : croissance ou déclin

const nombre = new Intl.NumberFormat("fr-FR");
const dateLongue = new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "long", year: "numeric" });

// infos, zones et secteurs sont lus une fois ; chiffres = fichier du secteur affiché
const etat = { infos: null, zones: null, secteurs: {}, chiffres: null, zone: "FR", graphiques: [] };

// --- Petits utilitaires -------------------------------------------------------

function $(id) {
  return document.getElementById(id);
}

function pourcent(valeur, avecSigne = true) {
  if (valeur === null || valeur === undefined) return "—";
  const texte = Math.abs(valeur).toLocaleString("fr-FR", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  const signe = valeur > 0 ? "+" : valeur < 0 ? "−" : "";
  return `${avecSigne ? signe : ""}${texte} %`;
}

function signe(valeur) {
  return (valeur > 0 ? "+" : valeur < 0 ? "−" : "") + nombre.format(Math.abs(valeur));
}

function formaterDate(texteIso) {
  const texte = dateLongue.format(new Date(`${texteIso}T12:00:00`));
  return texte.replace(/^1 /, "1er "); // « 1er octobre », pas « 1 octobre »
}

function evolution(indicateurs) {
  const debut = indicateurs[0].entreprises_actives_fin_annee;
  const fin = indicateurs[indicateurs.length - 1].entreprises_actives_fin_annee;
  return debut ? 100 * (fin / debut - 1) : null;
}

function couleur(nomVariable) {
  return getComputedStyle(document.documentElement).getPropertyValue(nomVariable).trim();
}

async function lireJson(chemin) {
  const reponse = await fetch(chemin);
  if (!reponse.ok) throw new Error(`${chemin} : ${reponse.status}`);
  return reponse.json();
}

function afficherErreur(texte) {
  $("message-erreur").textContent = texte;
  $("message-erreur").hidden = false;
  $("contenu").hidden = true;
}

// Indicateurs d'une zone, année par année, à partir des nombres bruts du fichier du secteur.
// Une zone absente du fichier n'a aucune entreprise du secteur : tout vaut 0.
function indicateursZone(codeZone) {
  const brut = etat.chiffres.zones[codeZone];
  return etat.infos.annees.map((annee, i) => {
    const valeur = (nom) => (brut ? brut[nom][i] : 0);
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

// --- Chargement ---------------------------------------------------------------

async function demarrer() {
  const parametres = new URLSearchParams(location.search);
  let listeSecteurs;
  try {
    [etat.infos, etat.zones, listeSecteurs] = await Promise.all([
      lireJson("donnees/infos.json"),
      lireJson("donnees/zones.json"),
      lireJson("donnees/secteurs.json"),
    ]);
  } catch (erreur) {
    afficherErreur("Impossible de lire les données. Le site doit être ouvert via le serveur local "
      + "(lancer_site.bat), pas en double-cliquant sur index.html.");
    return;
  }

  const choixSecteur = $("choix-secteur");
  for (const s of listeSecteurs) {
    etat.secteurs[s.code_naf] = s;
    choixSecteur.add(new Option(`${s.code_naf} — ${s.libelle_naf}`, s.code_naf));
  }
  const codeDemande = parametres.get("naf");
  choixSecteur.value = etat.secteurs[codeDemande] ? codeDemande : "93.29Z";
  etat.zone = etat.zones[parametres.get("zone")] ? parametres.get("zone") : "FR";
  remplirChoixZone();

  choixSecteur.addEventListener("change", () => chargerSecteur(choixSecteur.value));
  $("choix-zone").addEventListener("change", (e) => {
    etat.zone = e.target.value;
    afficher();
  });
  // Mode clair / sombre changé dans le système : on redessine avec les bonnes couleurs
  matchMedia("(prefers-color-scheme: dark)").addEventListener("change", afficher);

  await chargerSecteur(choixSecteur.value);
}

async function chargerSecteur(code) {
  try {
    etat.chiffres = await lireJson(`donnees/naf/${code}.json`);
  } catch (erreur) {
    afficherErreur(`Les données du secteur ${code} sont introuvables.`);
    return;
  }
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

// --- Affichage ----------------------------------------------------------------

// « 0 création », « 1 création », « 2 créations » (en français, 0 et 1 sont au singulier)
function pluriel(n, singulier, pluriel) {
  return `${nombre.format(n)} ${n > 1 ? pluriel : singulier}`;
}

// Phrase de résumé, accordée selon les nombres
function commentaire(nomZone, premier, dernier, evo) {
  const actives = dernier.entreprises_actives_fin_annee;
  const phraseEvolution = evo === null
    ? `alors qu'il n'y en avait aucune fin ${premier.annee}`
    : `soit ${pourcent(evo)} par rapport à fin ${premier.annee}`;
  let comparaison = "";
  if (etat.zone !== "FR") comparaison = ` (France entière : ${pourcent(evolution(indicateursZone("FR")))})`;

  const { creations, fermetures, solde_net: solde } = dernier;
  const phraseCreations = creations === 0 ? "aucune entreprise n'a été créée"
    : pluriel(creations, "entreprise a été créée", "entreprises ont été créées");
  const phraseFermetures = fermetures === 0 ? "aucune n'a fermé" : `${nombre.format(fermetures)} ${fermetures > 1 ? "ont" : "a"} fermé`;
  const phraseSolde = solde > 0 ? `il y a donc eu ${pluriel(solde, "création", "créations")} de plus que de fermetures`
    : solde < 0 ? `il y a donc eu ${pluriel(-solde, "fermeture", "fermetures")} de plus que de créations`
    : "créations et fermetures s'équilibrent";

  return `${nomZone} : le secteur compte ${pluriel(actives, "entreprise active", "entreprises actives")} `
    + `fin ${dernier.annee}, ${phraseEvolution}${comparaison}. `
    + `En ${dernier.annee}, ${phraseCreations} et ${phraseFermetures} : ${phraseSolde}.`;
}

function afficher() {
  if (!etat.chiffres) return;
  const infos = etat.infos;
  const code = etat.chiffres.code_naf;
  const libelle = etat.secteurs[code].libelle_naf;
  const zone = etat.zones[etat.zone];
  const ind = indicateursZone(etat.zone);
  const premier = ind[0];
  const dernier = ind[ind.length - 1];
  const evo = evolution(ind);

  // L'adresse de la page garde le choix : on peut la copier et la partager
  history.replaceState(null, "", `?naf=${encodeURIComponent(code)}&zone=${etat.zone}`);

  $("message-erreur").hidden = true;
  $("contenu").hidden = false;
  $("titre").textContent = `${libelle} — ${zone.nom}`;
  $("sous-titre").textContent = `Code NAF ${code} · années ${premier.annee} à ${dernier.annee} `
    + `· ce code regroupe plusieurs activités proches.`;
  document.title = `${libelle} — ${zone.nom} · BizCheck`;

  // Avertissement petit effectif
  const alerte = $("alerte-petit-effectif");
  alerte.hidden = dernier.entreprises_actives_fin_annee >= infos.seuil_petit_effectif;
  alerte.textContent = `Attention : moins de ${infos.seuil_petit_effectif} entreprises de ce secteur dans `
    + `cette zone. Quelques créations ou fermetures suffisent à faire varier fortement les chiffres : `
    + `ils sont à prendre avec prudence.`;

  // Verdict
  let tendance = { texte: "Stable", classe: "stable", icone: "→" };
  if (evo !== null && evo >= SEUIL_TENDANCE_PCT) tendance = { texte: "En croissance", classe: "hausse", icone: "↗" };
  if (evo !== null && evo <= -SEUIL_TENDANCE_PCT) tendance = { texte: "En déclin", classe: "baisse", icone: "↘" };
  $("verdict").innerHTML = `<span class="icone-verdict ${tendance.classe}" aria-hidden="true">${tendance.icone}</span>`
    + tendance.texte;
  $("verdict-detail").textContent = `${pourcent(evo)} d'entreprises actives entre fin ${premier.annee} `
    + `et fin ${dernier.annee} (stable = entre −${SEUIL_TENDANCE_PCT} % et +${SEUIL_TENDANCE_PCT} %)`;

  // Tuiles
  $("libelle-actives").textContent = `Entreprises actives fin ${dernier.annee}`;
  $("valeur-actives").textContent = nombre.format(dernier.entreprises_actives_fin_annee);
  $("detail-actives").textContent = `${signe(dernier.entreprises_actives_fin_annee - premier.entreprises_actives_fin_annee)} `
    + `depuis fin ${premier.annee}`;
  $("libelle-creations").textContent = `Créations en ${dernier.annee}`;
  $("valeur-creations").textContent = nombre.format(dernier.creations);
  $("detail-creations").textContent = `Taux de création : ${pourcent(dernier.taux_creation_pct, false)}`;
  $("libelle-fermetures").textContent = `Fermetures en ${dernier.annee}`;
  $("valeur-fermetures").textContent = nombre.format(dernier.fermetures);
  $("detail-fermetures").textContent = `Taux de fermeture : ${pourcent(dernier.taux_fermeture_pct, false)}`;

  // Zone sans aucune entreprise du secteur sur toute la période
  const zoneVide = ind.every((r) => r.entreprises_actives_fin_annee === 0 && r.creations === 0 && r.fermetures === 0);
  if (zoneVide) {
    $("verdict").innerHTML = `<span class="icone-verdict stable" aria-hidden="true">–</span>Aucune entreprise`;
    $("verdict-detail").textContent = "Pas de tendance calculable dans cette zone.";
  }

  $("commentaire").textContent = zoneVide
    ? `${zone.nom} : aucune entreprise de ce secteur n'y a son siège entre ${premier.annee} et ${dernier.annee}.`
    : commentaire(zone.nom, premier, dernier, evo);

  // Tableau
  $("tableau").innerHTML = ind.map((r) => `<tr>
      <td>${r.annee}</td>
      <td>${nombre.format(r.entreprises_actives_fin_annee)}</td>
      <td>${nombre.format(r.creations)}</td>
      <td>${nombre.format(r.fermetures)}</td>
      <td>${signe(r.solde_net)}</td>
      <td>${pourcent(r.taux_creation_pct, false)}</td>
      <td>${pourcent(r.taux_fermeture_pct, false)}</td>
    </tr>`).join("");

  afficherSources(infos);
  dessinerGraphiques(ind);
}

function afficherSources(infos) {
  const sirene = infos.sources[0];
  const dateSirene = formaterDate(sirene.date_actualisation);
  const debutNote = `Source : INSEE, base Sirene (fichier du ${dateSirene}).`;
  document.querySelector('[data-limite="actives"]').textContent = `${debutNote} Limite : une entreprise est `
    + `comptée dans son activité et le département de son siège actuels, pour toutes les années.`;
  document.querySelector('[data-limite="flux"]').textContent = `${debutNote} Limite : seules les fermetures `
    + `déclarées sont comptées ; une entreprise sans activité mais non radiée reste « active ».`;

  $("liste-sources").innerHTML = "";
  for (const source of infos.sources) {
    const li = document.createElement("li");
    const lien = document.createElement("a");
    lien.href = source.lien;
    lien.textContent = source.nom;
    li.append(lien, ` — version du ${formaterDate(source.date_actualisation)}`);
    $("liste-sources").append(li);
  }
  $("liste-limites").innerHTML = "";
  for (const limite of infos.limites) {
    const li = document.createElement("li");
    li.textContent = limite;
    $("liste-limites").append(li);
  }
  const [jour, heure] = infos.date_calcul.split(" ");
  $("date-calcul").textContent = `Chiffres calculés le ${formaterDate(jour)} à ${heure}.`;
}

// --- Graphiques (Chart.js) ----------------------------------------------------

// Affiche la valeur au-dessus de la dernière colonne de chaque série seulement
const etiquetteDerniereColonne = {
  id: "etiquetteDerniereColonne",
  afterDatasetsDraw(graphique) {
    const ctx = graphique.ctx;
    ctx.save();
    ctx.font = "600 12px system-ui, -apple-system, 'Segoe UI', sans-serif";
    ctx.fillStyle = couleur("--texte");
    ctx.textAlign = "center";
    ctx.textBaseline = "bottom";
    graphique.data.datasets.forEach((serie, i) => {
      const barres = graphique.getDatasetMeta(i).data;
      const derniere = barres[barres.length - 1];
      if (derniere) ctx.fillText(nombre.format(serie.data[serie.data.length - 1]), derniere.x, derniere.y - 4);
    });
    ctx.restore();
  },
};

function optionsCommunes() {
  return {
    responsive: true,
    maintainAspectRatio: false,
    layout: { padding: { top: 20 } },
    interaction: { mode: "index", intersect: false },
    plugins: {
      legend: { display: false },
      tooltip: {
        backgroundColor: couleur("--fond-carte"),
        titleColor: couleur("--texte"),
        bodyColor: couleur("--texte"),
        borderColor: couleur("--axe"),
        borderWidth: 1,
        padding: 10,
        boxPadding: 4,
        callbacks: { label: (c) => ` ${c.dataset.label} : ${nombre.format(c.parsed.y)}` },
      },
    },
    scales: {
      x: {
        grid: { display: false },
        border: { color: couleur("--axe") },
        ticks: { color: couleur("--texte-discret") },
      },
      y: {
        beginAtZero: true,
        grid: { color: couleur("--grille") },
        border: { display: false },
        ticks: { color: couleur("--texte-discret"), callback: (v) => nombre.format(v), maxTicksLimit: 5 },
      },
    },
  };
}

function serie(libelle, donnees, variableCouleur) {
  return {
    label: libelle,
    data: donnees,
    backgroundColor: couleur(variableCouleur),
    maxBarThickness: 24,
    borderRadius: { topLeft: 4, topRight: 4 },
    borderSkipped: "start",
  };
}

function dessinerGraphiques(ind) {
  etat.graphiques.forEach((g) => g.destroy());
  const annees = ind.map((r) => String(r.annee));

  etat.graphiques = [
    new Chart($("graphique-actives"), {
      type: "bar",
      data: {
        labels: annees,
        datasets: [serie("Entreprises actives", ind.map((r) => r.entreprises_actives_fin_annee), "--serie-1")],
      },
      options: optionsCommunes(),
      plugins: [etiquetteDerniereColonne],
    }),
    new Chart($("graphique-flux"), {
      type: "bar",
      data: {
        labels: annees,
        datasets: [
          serie("Créations", ind.map((r) => r.creations), "--serie-1"),
          serie("Fermetures", ind.map((r) => r.fermetures), "--serie-2"),
        ],
      },
      options: { ...optionsCommunes(), datasets: { bar: { categoryPercentage: 0.5, barPercentage: 0.9 } } },
      plugins: [etiquetteDerniereColonne],
    }),
  ];
}

demarrer();

// BizCheck — affichage d'un secteur à partir des fichiers JSON de donnees/
// (produits par bizcheck.py). Aucune donnée n'est écrite à la main ici.

const SEUIL_TENDANCE_PCT = 2; // au-delà de ±2 % sur la période : croissance ou déclin

const nombre = new Intl.NumberFormat("fr-FR");
const dateLongue = new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "long", year: "numeric" });

const etat = { secteur: null, zone: "FR", graphiques: [] };

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

// --- Chargement ---------------------------------------------------------------

async function demarrer() {
  const parametres = new URLSearchParams(location.search);
  let secteurs;
  try {
    secteurs = await lireJson("donnees/secteurs.json");
  } catch (erreur) {
    afficherErreur("Impossible de lire les données. Le site doit être ouvert via le serveur local "
      + "(voir les instructions), pas en double-cliquant sur index.html.");
    return;
  }

  const choixSecteur = $("choix-secteur");
  for (const s of secteurs) {
    choixSecteur.add(new Option(`${s.code_naf} — ${s.libelle_naf}`, s.code_naf));
  }
  const codeDemande = parametres.get("naf");
  if (secteurs.some((s) => s.code_naf === codeDemande)) choixSecteur.value = codeDemande;
  etat.zone = parametres.get("zone") || "FR";

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
    etat.secteur = await lireJson(`donnees/${code}.json`);
  } catch (erreur) {
    afficherErreur(`Les données du secteur ${code} sont introuvables.`);
    return;
  }
  remplirChoixZone();
  afficher();
}

function remplirChoixZone() {
  const zones = etat.secteur.zones;
  const choix = $("choix-zone");
  choix.innerHTML = "";
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
  if (!zones[etat.zone]) etat.zone = "FR";
  choix.value = etat.zone;
}

// --- Affichage ----------------------------------------------------------------

function afficher() {
  if (!etat.secteur) return;
  const secteur = etat.secteur;
  const zone = secteur.zones[etat.zone];
  const france = secteur.zones.FR;
  const ind = zone.indicateurs;
  const premier = ind[0];
  const dernier = ind[ind.length - 1];
  const evo = evolution(ind);

  // L'adresse de la page garde le choix : on peut la copier et la partager
  history.replaceState(null, "", `?naf=${encodeURIComponent(secteur.code_naf)}&zone=${etat.zone}`);

  $("message-erreur").hidden = true;
  $("contenu").hidden = false;
  $("titre").textContent = `${secteur.libelle_naf} — ${zone.nom}`;
  $("sous-titre").textContent = `Code NAF ${secteur.code_naf} · années ${secteur.annees[0]} à `
    + `${secteur.annees[secteur.annees.length - 1]} · ce code regroupe plusieurs activités proches.`;
  document.title = `${secteur.libelle_naf} — ${zone.nom} · BizCheck`;

  // Avertissement petit effectif
  const alerte = $("alerte-petit-effectif");
  alerte.hidden = !zone.alerte_petit_effectif;
  alerte.textContent = `Attention : moins de ${secteur.seuil_petit_effectif} entreprises de ce secteur dans `
    + `cette zone. Quelques créations ou fermetures suffisent à faire varier fortement les chiffres : `
    + `ils sont à prendre avec prudence.`;

  // Verdict
  let tendance = { texte: "Stable", classe: "stable", icone: "→" };
  if (evo !== null && evo >= SEUIL_TENDANCE_PCT) tendance = { texte: "En croissance", classe: "hausse", icone: "↗" };
  if (evo !== null && evo <= -SEUIL_TENDANCE_PCT) tendance = { texte: "En déclin", classe: "baisse", icone: "↘" };
  $("verdict").innerHTML = `<span class="icone-verdict ${tendance.classe}" aria-hidden="true">${tendance.icone}</span>`
    + tendance.texte;
  $("verdict-detail").textContent = `${pourcent(evo)} d'entreprises actives entre fin ${premier.annee} `
    + `et fin ${dernier.annee} (stable = entre −${SEUIL_TENDANCE_PCT} % et +${SEUIL_TENDANCE_PCT} %)`;

  // Tuiles
  $("libelle-actives").textContent = `Entreprises actives fin ${dernier.annee}`;
  $("valeur-actives").textContent = nombre.format(dernier.entreprises_actives_fin_annee);
  $("detail-actives").textContent = `${signe(dernier.entreprises_actives_fin_annee - premier.entreprises_actives_fin_annee)} `
    + `depuis fin ${premier.annee}`;
  $("libelle-creations").textContent = `Créations en ${dernier.annee}`;
  $("valeur-creations").textContent = nombre.format(dernier.creations);
  $("detail-creations").textContent = `Taux de création : ${pourcent(dernier.taux_creation_pct, false)}`;
  $("libelle-fermetures").textContent = `Fermetures en ${dernier.annee}`;
  $("valeur-fermetures").textContent = nombre.format(dernier.fermetures);
  $("detail-fermetures").textContent = `Taux de fermeture : ${pourcent(dernier.taux_fermeture_pct, false)}`;

  // Commentaire automatique
  let comparaison = "";
  if (etat.zone !== "FR") comparaison = ` (France entière : ${pourcent(evolution(france.indicateurs))})`;
  const solde = dernier.solde_net;
  const phraseSolde = solde > 0 ? `il y a donc eu ${nombre.format(solde)} créations de plus que de fermetures`
    : solde < 0 ? `il y a donc eu ${nombre.format(-solde)} fermetures de plus que de créations`
    : "créations et fermetures s'équilibrent";
  $("commentaire").textContent = `${zone.nom} : le secteur compte ${nombre.format(dernier.entreprises_actives_fin_annee)} `
    + `entreprises actives fin ${dernier.annee}, soit ${pourcent(evo)} par rapport à fin ${premier.annee}${comparaison}. `
    + `En ${dernier.annee}, ${nombre.format(dernier.creations)} entreprises ont été créées et `
    + `${nombre.format(dernier.fermetures)} ont fermé : ${phraseSolde}.`;

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

  afficherSources(secteur);
  dessinerGraphiques(ind);
}

function afficherSources(secteur) {
  const sirene = secteur.sources[0];
  const dateSirene = formaterDate(sirene.date_actualisation);
  const debutNote = `Source : INSEE, base Sirene (fichier du ${dateSirene}).`;
  document.querySelector('[data-limite="actives"]').textContent = `${debutNote} Limite : une entreprise est `
    + `comptée dans son activité et le département de son siège actuels, pour toutes les années.`;
  document.querySelector('[data-limite="flux"]').textContent = `${debutNote} Limite : seules les fermetures `
    + `déclarées sont comptées ; une entreprise sans activité mais non radiée reste « active ».`;

  $("liste-sources").innerHTML = "";
  for (const source of secteur.sources) {
    const li = document.createElement("li");
    const lien = document.createElement("a");
    lien.href = source.lien;
    lien.textContent = source.nom;
    li.append(lien, ` — mis à jour le ${formaterDate(source.date_actualisation)}`);
    $("liste-sources").append(li);
  }
  $("liste-limites").innerHTML = "";
  for (const limite of secteur.limites) {
    const li = document.createElement("li");
    li.textContent = limite;
    $("liste-limites").append(li);
  }
  const [jour, heure] = secteur.date_calcul.split(" ");
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

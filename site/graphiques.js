// BizCheck — graphiques Chart.js (évolution, survie, saisonnalité).
// Chart est chargé par index.html (bibliothèque Chart.js).

import { $, couleur, nombre, pourcent } from "./outils.js";

const graphiques = {}; // un graphique par canvas, détruit avant d'être redessiné

const POLICE = "system-ui, -apple-system, 'Segoe UI', sans-serif";
const MOIS = ["janv.", "févr.", "mars", "avr.", "mai", "juin", "juil.", "août", "sept.", "oct.", "nov.", "déc."];

function dessiner(idCanvas, configuration) {
  graphiques[idCanvas]?.destroy();
  graphiques[idCanvas] = new Chart($(idCanvas), configuration);
}

// Valeur affichée seulement au bout de la dernière barre (ou du dernier point) des séries choisies
function etiquetteFinale(formater, seriesAEtiqueter = [0], toutesLesBarres = false) {
  return {
    id: "etiquetteFinale",
    afterDatasetsDraw(graphique) {
      const ctx = graphique.ctx;
      const horizontal = graphique.options.indexAxis === "y";
      ctx.save();
      ctx.font = `600 12px ${POLICE}`;
      ctx.fillStyle = couleur("--texte");
      ctx.textAlign = horizontal ? "left" : "center";
      ctx.textBaseline = horizontal ? "middle" : "bottom";
      for (const i of seriesAEtiqueter) {
        const serie = graphique.data.datasets[i];
        const elements = graphique.getDatasetMeta(i).data;
        const positions = toutesLesBarres ? elements.map((_, j) => j) : [elements.length - 1];
        for (const j of positions) {
          const el = elements[j];
          if (!el || serie.data[j] === null || serie.data[j] === undefined) continue;
          const texte = formater(serie.data[j]);
          if (horizontal) ctx.fillText(texte, el.x + 6, el.y);
          else ctx.fillText(texte, el.x, el.y - 6);
        }
      }
      ctx.restore();
    },
  };
}

function options({ formatAxe = (v) => nombre.format(v), formatInfobulle = (v) => nombre.format(v),
  horizontal = false, axeZero = true, max } = {}) {
  const axeValeurs = {
    beginAtZero: axeZero,
    max,
    grid: { color: couleur("--grille") },
    border: { display: false },
    ticks: { color: couleur("--texte-discret"), callback: formatAxe, maxTicksLimit: 5 },
  };
  const axeCategories = {
    grid: { display: false },
    border: { color: couleur("--axe") },
    ticks: { color: couleur("--texte-discret"), autoSkip: true, maxRotation: 0 },
  };
  return {
    responsive: true,
    maintainAspectRatio: false,
    indexAxis: horizontal ? "y" : "x",
    layout: { padding: horizontal ? { right: 48 } : { top: 22, right: 18 } },
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
        callbacks: { label: (c) => ` ${c.dataset.label} : ${formatInfobulle(horizontal ? c.parsed.x : c.parsed.y)}` },
      },
    },
    scales: horizontal ? { x: axeValeurs, y: axeCategories } : { x: axeCategories, y: axeValeurs },
  };
}

function barres(libelle, donnees, variableCouleur, horizontal = false) {
  return {
    type: "bar",
    label: libelle,
    data: donnees,
    backgroundColor: couleur(variableCouleur),
    maxBarThickness: horizontal ? 18 : 24,
    borderRadius: horizontal ? { topRight: 4, bottomRight: 4 } : { topLeft: 4, topRight: 4 },
    borderSkipped: "start",
  };
}

// --- Évolution sur 10 ans -----------------------------------------------------

export function dessinerEvolution(indicateurs) {
  const annees = indicateurs.map((r) => String(r.annee));
  const bleu = couleur("--serie-1");
  const dernier = indicateurs.length - 1;

  dessiner("graphique-actives", {
    type: "line",
    data: {
      labels: annees,
      datasets: [{
        label: "Entreprises actives",
        data: indicateurs.map((r) => r.entreprises_actives_fin_annee),
        borderColor: bleu,
        backgroundColor: `${bleu}1a`, // voile à 10 %
        fill: true,
        borderWidth: 2,
        tension: 0.25,
        // un seul point visible : la dernière année
        pointRadius: (c) => (c.dataIndex === dernier ? 4 : 0),
        pointHoverRadius: 5,
        pointBackgroundColor: bleu,
        pointBorderColor: couleur("--fond-carte"),
        pointBorderWidth: 2,
      }],
    },
    options: options({ axeZero: false }),
    plugins: [etiquetteFinale((v) => nombre.format(v))],
  });

  dessiner("graphique-flux", {
    type: "bar",
    data: {
      labels: annees,
      datasets: [
        barres("Créations", indicateurs.map((r) => r.creations), "--serie-1"),
        barres("Fermetures", indicateurs.map((r) => r.fermetures), "--serie-2"),
      ],
    },
    options: { ...options(), datasets: { bar: { categoryPercentage: 0.7, barPercentage: 0.85 } } },
  });
}

// --- Survie --------------------------------------------------------------------

// survie = { "1": [cohorte, survivantes], ... } → pourcentages
export function tauxSurvie(survie, duree) {
  const valeurs = survie?.[String(duree)];
  return valeurs && valeurs[0] ? (100 * valeurs[1]) / valeurs[0] : null;
}

export function dessinerSurvie(durees, survieSecteur, survieTous) {
  const libelles = durees.map((d) => `${d} an${d > 1 ? "s" : ""}`);
  dessiner("graphique-survie", {
    type: "bar",
    data: {
      labels: libelles,
      datasets: [
        barres("Ce secteur", durees.map((d) => tauxSurvie(survieSecteur, d)), "--serie-1", true),
        barres("Toutes activités", durees.map((d) => tauxSurvie(survieTous, d)), "--neutre", true),
      ],
    },
    options: {
      ...options({ horizontal: true, max: 100, formatAxe: (v) => `${v} %`,
        formatInfobulle: (v) => pourcent(v, false, 0) }),
      datasets: { bar: { categoryPercentage: 0.8, barPercentage: 0.9 } },
    },
    plugins: [etiquetteFinale((v) => pourcent(v, false, 0), [0], true)],
  });
}

// --- Saisonnalité -----------------------------------------------------------------

function partsParMois(creationsParMois) {
  const total = (creationsParMois || []).reduce((a, b) => a + b, 0);
  return total ? creationsParMois.map((n) => (100 * n) / total) : null;
}

export function dessinerSaison(creationsSecteur, creationsTous) {
  const secteur = partsParMois(creationsSecteur);
  const tous = partsParMois(creationsTous);
  dessiner("graphique-saison", {
    type: "bar",
    data: {
      labels: MOIS,
      datasets: [
        barres("Ce secteur", secteur || [], "--serie-1"),
        {
          type: "line",
          label: "Toutes activités",
          data: tous || [],
          borderColor: couleur("--neutre"),
          borderWidth: 2,
          pointRadius: 0,
          pointHoverRadius: 4,
          tension: 0.25,
        },
      ],
    },
    options: options({ formatAxe: (v) => `${v} %`, formatInfobulle: (v) => pourcent(v, false) }),
  });
}

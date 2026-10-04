// BizCheck — petits utilitaires partagés (mise en forme des nombres, dates, éléments HTML).

export const nombre = new Intl.NumberFormat("fr-FR");
const dateLongue = new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "long", year: "numeric" });

export function $(id) {
  return document.getElementById(id);
}

export function element(balise, classe, texte) {
  const el = document.createElement(balise);
  if (classe) el.className = classe;
  if (texte !== undefined && texte !== null) el.textContent = texte;
  return el;
}

// 12.345 → « +12,3 % » (ou « 12,3 % » sans signe)
export function pourcent(valeur, avecSigne = true, decimales = 1) {
  if (valeur === null || valeur === undefined || Number.isNaN(valeur)) return "—";
  const texte = Math.abs(valeur).toLocaleString("fr-FR", {
    minimumFractionDigits: decimales, maximumFractionDigits: decimales,
  });
  const signe = valeur > 0 ? "+" : valeur < 0 ? "−" : "";
  return `${avecSigne ? signe : ""}${texte} %`;
}

// 1234 → « +1 234 »
export function signe(valeur) {
  return (valeur > 0 ? "+" : valeur < 0 ? "−" : "") + nombre.format(Math.abs(valeur));
}

// « 0 création », « 1 création », « 2 créations » (en français, 0 et 1 sont au singulier)
export function pluriel(n, singulier, pluriel) {
  return `${nombre.format(n)} ${n > 1 ? pluriel : singulier}`;
}

// 12.34 → « 12,3 » (pour les densités)
export function decimal(valeur, decimales = 1) {
  if (valeur === null || valeur === undefined) return "—";
  return valeur.toLocaleString("fr-FR", { minimumFractionDigits: decimales, maximumFractionDigits: decimales });
}

export function formaterDate(texteIso) {
  const texte = dateLongue.format(new Date(`${texteIso}T12:00:00`));
  return texte.replace(/^1 /, "1er "); // « 1er octobre », pas « 1 octobre »
}

// Valeur d'une couleur définie dans style.css (change entre mode clair et sombre)
export function couleur(nomVariable) {
  return getComputedStyle(document.documentElement).getPropertyValue(nomVariable).trim();
}

export async function lireJson(chemin) {
  const reponse = await fetch(chemin);
  if (!reponse.ok) throw new Error(`${chemin} : ${reponse.status}`);
  return reponse.json();
}

// Établissements pour 10 000 habitants
export function densite(etablissements, population) {
  return population ? (10000 * etablissements) / population : null;
}

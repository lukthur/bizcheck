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

// --- Bulles d'explication « ? » ------------------------------------------------------

export function boutonAide(texte) {
  const bouton = element("button", "aide", "?");
  bouton.type = "button";
  bouton.dataset.aide = texte;
  bouton.setAttribute("aria-label", "Comment ce chiffre est-il calculé ?");
  bouton.setAttribute("aria-expanded", "false");
  return bouton;
}

// Ajoute (ou remplace) le bouton « ? » à la fin d'un élément
export function poserAide(cible, texte) {
  if (!cible || !texte) return;
  cible.querySelector(":scope > .aide")?.remove();
  cible.append(boutonAide(texte));
}

// Une seule bulle pour toute la page : survol à la souris, appui sur téléphone, clavier (Tab)
export function installerBulles() {
  const bulle = $("bulle-aide");
  let active = null;
  let ouverteA = 0;

  const montrer = (bouton) => {
    if (active && active !== bouton) active.setAttribute("aria-expanded", "false");
    active = bouton;
    ouverteA = Date.now();
    bulle.textContent = bouton.dataset.aide;
    bulle.hidden = false;
    bouton.setAttribute("aria-expanded", "true");
    bouton.setAttribute("aria-describedby", "bulle-aide");
    // sous le bouton, sans dépasser de l'écran (au-dessus s'il n'y a pas la place)
    const r = bouton.getBoundingClientRect();
    const largeur = bulle.offsetWidth;
    const hauteur = bulle.offsetHeight;
    const gauche = Math.min(Math.max(16, r.left + r.width / 2 - largeur / 2), innerWidth - largeur - 16);
    const haut = r.bottom + 8 + hauteur > innerHeight - 8 ? r.top - hauteur - 8 : r.bottom + 8;
    bulle.style.left = `${gauche}px`;
    bulle.style.top = `${haut}px`;
  };
  const cacher = () => {
    if (active) {
      active.setAttribute("aria-expanded", "false");
      active.removeAttribute("aria-describedby");
    }
    active = null;
    bulle.hidden = true;
  };

  document.addEventListener("mouseover", (e) => {
    const bouton = e.target.closest?.(".aide");
    if (bouton) montrer(bouton);
  });
  document.addEventListener("mouseout", (e) => {
    if (e.target.closest?.(".aide") && document.activeElement !== e.target.closest(".aide")) cacher();
  });
  document.addEventListener("focusin", (e) => {
    const bouton = e.target.closest?.(".aide");
    if (bouton) montrer(bouton);
  });
  document.addEventListener("focusout", (e) => {
    if (e.target.closest?.(".aide")) cacher();
  });
  document.addEventListener("click", (e) => {
    const bouton = e.target.closest?.(".aide");
    if (!bouton) {
      cacher();
      return;
    }
    // sur téléphone, l'appui ouvre la bulle (focus) puis déclenche ce clic : on ne la referme pas aussitôt
    if (active === bouton && Date.now() - ouverteA > 400) cacher();
    else montrer(bouton);
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") cacher();
  });
  addEventListener("scroll", cacher, { passive: true });
}

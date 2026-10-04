// BizCheck — moteur de recherche d'activité (tout se passe dans le navigateur).
//
// Principe : on découpe chaque secteur en mots (libellé, notes INSEE, synonymes),
// puis on compare les mots tapés à ces mots, en tolérant les fautes de frappe,
// les accents, les pluriels et les mots incomplets.

const MOTS_VIDES = new Set([
  "a", "au", "aux", "avec", "d", "de", "des", "du", "en", "et", "l", "la", "le", "les", "ou",
  "par", "pour", "sans", "sur", "un", "une", "y", "autre", "autres", "activite", "activites",
  "etc", "compris", "notamment", "non", "ailleurs", "classe", "classes",
]);

// Poids de chaque source : un mot du libellé compte plus qu'un mot d'une note
const POIDS = { synonyme: 10, libelle: 4, comprend: 2, comprend_aussi: 1.5, renvoi: 1.5 };

// « Pâtisseries » → « patisserie » ; « jeux » → « jeu »
export function normaliser(texte) {
  return texte
    .toLowerCase()
    .replace(/œ/g, "oe").replace(/æ/g, "ae")
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function racine(mot) {
  if (mot.length > 3 && (mot.endsWith("s") || mot.endsWith("x"))) return mot.slice(0, -1);
  return mot;
}

export function mots(texte) {
  return normaliser(texte).split(" ").filter((m) => m.length > 1 && !MOTS_VIDES.has(m)).map(racine);
}

// Distance de Levenshtein (nombre de lettres à changer), arrêtée dès qu'elle dépasse max
function distance(a, b, max) {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let precedente = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const ligne = [i];
    let minimum = i;
    for (let j = 1; j <= b.length; j++) {
      const cout = a[i - 1] === b[j - 1] ? 0 : 1;
      ligne[j] = Math.min(precedente[j] + 1, ligne[j - 1] + 1, precedente[j - 1] + cout);
      minimum = Math.min(minimum, ligne[j]);
    }
    if (minimum > max) return max + 1;
    precedente = ligne;
  }
  return precedente[b.length];
}

// Ressemblance entre un mot tapé et un mot de l'index : 1 = identique, 0 = rien à voir
function ressemblance(tape, mot) {
  if (tape === mot) return 1;
  if (tape.length >= 3 && mot.startsWith(tape)) return 0.8; // mot en cours de frappe
  const tolerance = tape.length >= 8 ? 2 : tape.length >= 4 ? 1 : 0;
  if (tolerance && distance(tape, mot, tolerance) <= tolerance) return 0.6; // faute de frappe
  return 0;
}

export function creerIndex(secteurs) {
  // vocabulaire : mot → liste de { secteur, poids } (on garde le meilleur poids par secteur)
  const vocabulaire = new Map();
  const ajouter = (mot, position, poids) => {
    if (!vocabulaire.has(mot)) vocabulaire.set(mot, new Map());
    const parSecteur = vocabulaire.get(mot);
    parSecteur.set(position, Math.max(parSecteur.get(position) || 0, poids));
  };

  // « 93.29Z ne comprend pas les troupes de théâtre (cf. 90.01Z) » : ce texte décrit une
  // activité de 90.01Z, on le range donc avec 90.01Z (« renvois »)
  const renvois = new Map();
  for (const s of secteurs) {
    for (const exclusion of s.ne_comprend_pas) {
      for (const code of exclusion.voir) {
        if (!renvois.has(code)) renvois.set(code, []);
        renvois.get(code).push(exclusion.texte);
      }
    }
  }

  const fiches = secteurs.map((s, position) => {
    const champs = {
      synonyme: s.synonymes,
      libelle: [s.libelle_naf],
      comprend: s.comprend,
      comprend_aussi: s.comprend_aussi,
      renvoi: renvois.get(s.code_naf) || [],
    };
    for (const [champ, textes] of Object.entries(champs)) {
      for (const texte of textes) for (const mot of mots(texte)) ajouter(mot, position, POIDS[champ]);
    }
    return {
      ...s,
      synonymesNormalises: s.synonymes.map(normaliser),
      // pour l'extrait affiché sous chaque résultat
      elements: [
        ...[...s.comprend, ...s.comprend_aussi].map((t) => ({ texte: t, renvoi: false })),
        ...champs.renvoi.map((t) => ({ texte: t, renvoi: true })),
      ].map((e) => ({ ...e, mots: new Set(mots(e.texte)) })),
    };
  });
  return { fiches, vocabulaire };
}

// Mots de l'index qui ressemblent à un mot tapé : Map mot → ressemblance
function correspondances(index, tape) {
  const trouves = new Map();
  for (const mot of index.vocabulaire.keys()) {
    const r = ressemblance(tape, mot);
    if (r > 0) trouves.set(mot, r);
  }
  return trouves;
}

export function rechercher(index, requete, nombreMax = 8) {
  const texte = normaliser(requete);
  if (texte.length < 2) return [];

  // Recherche directe par code NAF (« 93.29Z », « 9329 »)
  const codeTape = texte.replace(/ /g, "");
  if (/^\d{2,4}[a-z]?$/.test(codeTape)) {
    return index.fiches
      .filter((f) => f.code_naf.replace(".", "").toLowerCase().startsWith(codeTape))
      .slice(0, nombreMax)
      .map((f) => ({ fiche: f, extrait: null }));
  }

  const motsTapes = mots(requete);
  if (motsTapes.length === 0) return [];
  const proches = motsTapes.map((m) => correspondances(index, m));

  const scores = new Map(); // position → { total, motsTrouves }
  proches.forEach((trouves) => {
    const meilleurParSecteur = new Map();
    for (const [mot, r] of trouves) {
      for (const [position, poids] of index.vocabulaire.get(mot)) {
        meilleurParSecteur.set(position, Math.max(meilleurParSecteur.get(position) || 0, poids * r));
      }
    }
    for (const [position, points] of meilleurParSecteur) {
      const s = scores.get(position) || { total: 0, motsTrouves: 0 };
      s.total += points;
      s.motsTrouves += 1;
      scores.set(position, s);
    }
  });

  // Synonyme tapé en entier (ou presque) : gros bonus
  index.fiches.forEach((f, position) => {
    for (const syn of f.synonymesNormalises) {
      const bonus = syn === texte ? 30 : syn.startsWith(texte) && texte.length >= 3 ? 15
        : texte.includes(syn) ? 12 : 0;
      if (bonus) {
        const s = scores.get(position) || { total: 0, motsTrouves: motsTapes.length };
        s.total += bonus;
        s.motsTrouves = Math.max(s.motsTrouves, motsTapes.length);
        scores.set(position, s);
      }
    }
  });

  // Classement : d'abord les secteurs qui contiennent tous les mots tapés, puis le score,
  // puis le nombre d'entreprises (à égalité, le secteur le plus courant d'abord)
  const resultats = [...scores.entries()]
    .map(([position, s]) => ({ fiche: index.fiches[position], ...s }))
    .filter((r) => r.motsTrouves >= Math.ceil(motsTapes.length / 2));
  const complet = resultats.some((r) => r.motsTrouves === motsTapes.length);
  return resultats
    .filter((r) => !complet || r.motsTrouves === motsTapes.length)
    .sort((a, b) => b.total - a.total || b.fiche.entreprises_actives - a.fiche.entreprises_actives)
    .slice(0, nombreMax)
    .map((r) => ({ fiche: r.fiche, extrait: libelleSuffit(r.fiche, proches) ? null : extrait(r.fiche, proches) }));
}

// Le libellé contient déjà tous les mots tapés : pas besoin d'extrait
function libelleSuffit(fiche, proches) {
  const motsLibelle = new Set(mots(fiche.libelle_naf));
  return proches.every((p) => [...p.keys()].some((m) => motsLibelle.has(m)));
}

// L'élément (« comprend » ou renvoi) qui contient le plus de mots tapés : montre pourquoi ce résultat
function extrait(fiche, proches) {
  let meilleur = null;
  let meilleurNombre = 0;
  for (const element of fiche.elements) {
    const nombre = proches.filter((p) => [...p.keys()].some((m) => element.mots.has(m))).length;
    if (nombre > meilleurNombre) {
      meilleur = element;
      meilleurNombre = nombre;
    }
  }
  return meilleur;
}

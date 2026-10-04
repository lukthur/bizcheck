// BizCheck — textes des bulles « ? » : comment chaque chiffre est calculé.
// Les années et les seuils viennent des données (infos.json) : rien n'est à mettre à jour à la main.

export function textesAide(infos, { famillesalaire = "" } = {}) {
  const annees = infos.annees;
  const n = annees[annees.length - 1];
  const debut = annees[annees.length - infos.nb_annees_principales];
  const [popDebut, popFin] = infos.annees_population;
  const comptes = infos.annee_comptes;

  return {
    // Chiffres clés
    tendance: `Évolution du nombre d'entreprises actives entre le 31/12/${debut} et le 31/12/${n}. `
      + "Au-delà de +2 % : en croissance ; en dessous de −2 % : en déclin ; entre les deux : stable. "
      + `Le classement compare cette évolution à celle des secteurs d'au moins ${infos.seuil_classement} `
      + "entreprises en France (1er = plus forte hausse).",
    actives: `Entreprises (une par numéro SIREN) créées au plus tard le 31/12/${n} et pas encore fermées à cette `
      + "date, dont l'activité principale est ce code NAF et dont le siège est dans la zone.",
    creations: `Entreprises dont la date de création déclarée tombe en ${n}. Taux de création = créations de `
      + "l'année ÷ entreprises actives au 1er janvier.",
    fermetures: `Entreprises déclarées cessées dont la date de cessation tombe en ${n}. Taux de fermeture = `
      + "fermetures de l'année ÷ entreprises actives au 1er janvier.",
    survie3: `Parmi les entreprises du secteur créées en ${n - 3} dans la zone, part de celles qui n'avaient pas `
      + "fermé 3 ans après leur création. Survie administrative : une entreprise sans activité mais non radiée "
      + "compte comme survivante.",
    densite: "Établissements actifs dont l'activité principale est ce code NAF, situés dans la zone, pour "
      + "10 000 habitants (population municipale INSEE). Un établissement = un lieu d'activité : boutique, "
      + "agence, atelier…",

    // Graphiques
    graphique_actives: `Nombre d'entreprises actives au 31 décembre de chaque année, de ${annees[0]} à ${n}. `
      + "Chaque entreprise est rattachée à son activité et à son siège actuels.",
    graphique_flux: "Créations : date de création déclarée dans l'année. Fermetures : date de cessation dans "
      + "l'année. Les barres bleues au-dessus des orange signifient que le secteur gagne des entreprises.",
    survie: `Pour chaque durée, on prend les entreprises créées une année donnée (${n - 1} pour 1 an, ${n - 3} `
      + `pour 3 ans, ${n - 5} pour 5 ans) et on compte la part de celles qui n'avaient pas fermé au bout de `
      + "cette durée. Le gris donne le même calcul pour toutes les activités de la zone.",
    taille: "Tranche d'effectif salarié déclarée la plus récente. « Aucun salarié » regroupe les entreprises "
      + "sans salarié au cours de l'année ou au 31 décembre (dont presque tous les micro-entrepreneurs). "
      + "Décochez la case pour ne voir que les entreprises qui emploient : les pourcentages sont alors "
      + "calculés parmi elles.",
    forme: "Catégorie juridique Sirene. « Entreprise individuelle » inclut les micro-entrepreneurs ; « Autre "
      + "société » : SCI, SNC, SA, coopératives… ; « Association, autre » : associations, organismes publics…",
    age: "Ancienneté des entreprises actives à la date du fichier Sirene, d'après leur date de création.",
    saison: `Pour chaque mois : créations de ce mois sur ${infos.nb_annees_saisonnalite} ans ÷ toutes les `
      + "créations de ces années. Si les créations étaient régulières, chaque mois ferait environ 8,3 %.",
    carte: "Évolution : même calcul que la tendance, département par département (gris foncé = stable, très "
      + "clair = moins de 20 entreprises). Densité : établissements pour 10 000 habitants ; chaque couleur "
      + "regroupe un cinquième des départements.",

    // Emploi et défaillances
    graphique_emploi: "Salariés du secteur privé au 31 décembre de chaque année, dans les établissements de ce "
      + "code d'activité situés dans la zone (URSSAF).",
    salaries: `Salariés du secteur privé au 31/12/${n} dans les établissements de ce secteur situés dans la zone. `
      + `Évolution entre fin ${debut} et fin ${n}. Les indépendants et micro-entrepreneurs ne sont pas comptés.`,
    employeurs: `Établissements du secteur ayant au moins un salarié au 31/12/${n}. Moyenne = salariés ÷ `
      + "établissements employeurs.",
    salaire: "Masse salariale brute versée sur l'année ÷ effectif salarié moyen des 4 trimestres, pour toute "
      + `la famille de secteurs${famillesalaire ? ` « ${famillesalaire} »` : ""}, en France. Temps partiels `
      + "compris : ce n'est pas un salaire à temps plein.",
    graphique_defaillances: "Entreprises du secteur (siège dans la zone) ayant fait l'objet, dans l'année, d'un "
      + "jugement d'ouverture de redressement ou de liquidation judiciaire publié au BODACC.",
    defaillances: `Entreprises du secteur ayant connu en ${n} l'ouverture d'un redressement ou d'une liquidation `
      + "judiciaire (BODACC). Une entreprise n'est comptée qu'une fois par an.",
    taux_defaillance: `Défaillances de ${n} ÷ entreprises actives au 1er janvier ${n}. Le même calcul est fait `
      + "pour toutes les activités de la zone.",

    // Comptes
    comptes: `Comptes annuels ${comptes} des sociétés qui les publient (Banque de France / INPI). Ni les `
      + "entrepreneurs individuels, ni les micro-entreprises, ni les comptes confidentiels.",
    ca: `Chiffre d'affaires de l'exercice ${comptes}. Médiane : la moitié des sociétés du secteur fait plus, `
      + "l'autre moitié moins.",
    marge_ebe: "Excédent brut d'exploitation ÷ chiffre d'affaires. L'EBE est ce que rapporte l'activité avant "
      + "amortissements, frais financiers et impôts. Valeur médiane.",
    marge_nette: "Résultat net ÷ chiffre d'affaires : ce qui reste une fois toutes les charges et les impôts "
      + "payés. Valeur médiane.",
    en_perte: `Part des sociétés dont le résultat net de l'exercice ${comptes} est négatif.`,
    delai_clients: "Créances clients ÷ chiffre d'affaires × 360 : nombre de jours que mettent les clients à "
      + "payer. 0 jour = paiement comptant (commerce, restauration…). Valeur médiane.",

    // Territoire et ville
    habitants: `Population municipale ${popFin} (recensement INSEE).`,
    evolution_population: `Variation de la population municipale entre ${popDebut} et ${popFin}.`,
    niveau_de_vie: `Revenu disponible du ménage (après impôts et prestations) divisé par le nombre d'unités de `
      + `consommation. Médiane : la moitié des habitants vit avec plus, l'autre moitié avec moins (INSEE `
      + `Filosofi ${infos.annee_revenus}).`,
    pauvrete: "Part des habitants dont le niveau de vie est inférieur à 60 % du niveau de vie médian de la "
      + "France métropolitaine.",
    ville_etablissements: "Établissements actifs de ce secteur (selon leur propre activité) situés dans la "
      + "commune. Les arrondissements de Paris, Lyon et Marseille sont regroupés.",
    ville_densite: "Établissements de la commune ÷ population municipale × 10 000.",
    departement_densite: "Établissements du secteur dans tout le département ÷ population du département × 10 000.",
    france_densite: "Établissements du secteur dans toute la France ÷ population française × 10 000.",
    ville_salaries: `Salariés du secteur privé au 31/12/${n} dans les établissements de ce secteur situés dans `
      + "la commune (URSSAF).",
  };
}

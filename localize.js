/**
 * Runtime i18n injector for Heavenward
 * Detects browser language and swaps UI to French when applicable.
 * Vanilla JS - no TypeScript syntax.
 */

(function() {
  'use strict';

  const translations = {
	today: "Ce soir",
	recherche: "Recherche",
	parametres: "Paramètres",
	emplacement: "Emplacement",
	compte: "Compte",
	aPropos: "À propos",
	observations: "Observations",
	etreSocial: "S'épanouir",
	partager: "Partager",
	retour: "Retour",
	support: "Support",

	objet: "objet(s)",
	dansLeCiel: "dans le ciel",
	visibleMaintenant: "Visible maintenant",
	auDessusDeLHorizon: "Au-dessus de l'horizon",
	sousLHorizon: "Sous l'horizon",
	quotidienne: "quotidienne",

	oeilNu: "Œil nu",
	telescopePersonnel: "Télescope personnel",
	observatoire: "Observatoire",
	systemeSolaire: "Système solaire",
	voieLactee: "Voie lactée",
	auDela: "Au-delà",
	plusLumineux: "Le plus lumineux",
	lePlusProche: "Le plus proche",
	lePlusEloigne: "Le plus éloigné",
	direction: "Direction",
	nord: "Nord",
	sud: "Sud",
	est: "Est",
	ouest: "Ouest",
	triePar: "Trier par",

	iciAuDessusDeVous: "ici au-dessus de vous",
	vautLePlusGrandTelescope: "vaut le(s) plus grand(s) télescopes",
	observationDetaillee: "observation détaillée",
	conseilsDePhotographie: "conseils de photographie",
	toutCeQueVousBesoin: "tout ce dont vous avez besoin",
	"Appareil/Portable": "Appareil photo / Portable",
	Oculaire: "Oculaire",
	Jumelles: "Jumelles",

	conseilsPratiques: "conseils pratiques",
	nomsEtSignifications: "noms et significations",
	constellations: "schematismes des constellations",
	histoiresMythologiques: "histoires mythologiques",
	significationsHistoriques: "significations historiques",

	notesDePhotographie: "notes de photographie",
	famousPhoto: "photo célèbre",
	recommandationsEquipement: "recommandations d'équipement",
	parametresExposition: "paramètres d'exposition",

	avertissement: "⚠️",
	note: "ℹ️",
	astuce: "💡",

	"ouvertA": "Ouvert à",
	de: "de",
	"coordsGPS": "inclure les coordonnées GPS exactes dans l'export",
	"noteCourte": "une courte note sur la soirée (optionnel)…",
	"copieColle": "Copié — collez dans votre application de notes.",
	"nePeutPasCopier": "Impossible de copier — appuyez longuement pour sélectionner.",
	sauvegarde: "Sauvegarde…",
	"sauvegardeCompte": "Sauvegardé dans votre compte.",
	"nePeutPasSauvegarder": "Impossible de sauvegarder",
	nouveau: "Nouveau",
	"connecterSauvegarder": "Connectez-vous pour sauvegarder",
	"afficherSauvegardes": "Afficher les observations sauvegardées →",
	"rienSauvegarder": "Rien de sauvegardé pour le moment. Ouvrez Observations depuis le menu Sauvegarder après une soirée de balade pour garder un enregistrement.",
	"lieuPlaceholder": "Ouvrez quelques objets du ciel et ils apparaîtront ici — un journal tranquille de votre soirée." + "\n\n" + "Voulez-vous passer en français ?",
	"resumeObservation": "objet(s) vu depuis",
	"lieuNon": "lieu non enregistré",

	"observationsSauvegardees": "Observations sauvegardées",
	"connecterJournal": "Connectez-vous pour garder un journal tranquille de vos soirées à travers les appareils.",
	"connecter": "Connectez-vous →",
	"chargement": "Chargement…",
	"supprimerObservation": "Supprimer cette observation ?",

	"installerHeavenward": "Installer Heavenward",
	"cielDuSoir": "Garder le ciel du soir à un clic.",
	"navigateur": "Ouvrir dans votre navigateur",
	"meilleursResultats": "pour de meilleurs résultats",
	facebookInstagram: "Facebook et Instagram",
	browsers: "navigateurs intégrés",
	bloquerLocalisation: "peuvent bloquer la localisation et les calculs d'heure du ciel",
	copierLien: "Copier le lien",
	copie: "Copié",
	"menuNavigateur": "Utiliser le menu → navigateur",

	trucs: "Trucs",
	trucsLabel: "Trucs",
	trucsPanneau: "Trucs",
	"trucsSocial": "S'épanouir",
	trucsSocialGrid: " ",
	copiePartage: "Texte de partage copié",
	"instaShare": "Instagram",
	contribution: "contribution informelle",
	supportDemande: "Demande de support"
  };

  function partialKey(key) {
    return key.split(' ')[0].toLowerCase();
  }

  function applyTranslations() {
    const elts = document.querySelectorAll('[data-i18n]');

    elts.forEach(function(el) {
      const key = el.getAttribute('data-i18n');
      if (!key) return;

      let text = translations[key];
      if (!text && translations[partialKey(key)]) {
        text = translations[partialKey(key)];
      }

      if (text !== undefined) {
        el.textContent = text;
      }
    });
  }

  const browserLang = navigator.language.slice(0, 2);

  if (browserLang === 'fr') {
    applyTranslations();
  }

  const savedLang = localStorage.getItem('heavenward-locale');
  if (savedLang === 'fr') {
    applyTranslations();
  }
})();
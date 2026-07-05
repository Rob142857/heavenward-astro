/**
 * Runtime i18n injector
 * This script runs in the browser and detects the user's language.
 * If French, it swaps all static text to French immediately.
 * No build step required.
 */

(function() {
	'use strict';

	// Translations from src/i18n/translations.ts (en fallback is original English text)
	const translations = {
		tonight: "Ce soir",
		recherche: "Recherche",
		paramètres: "Paramètres",
		emplacement: "Emplacement",
		compte: "Compte",
		"à propos": "À propos",
		observations: "Observations",
		"être social": "S'épanouir",
		partager: "Partager",
		retour: "Retour",
		support: "Support",

		"objet(s)": "objet(s)",
		"dans le ciel": "dans le ciel",
		"visible maintenant": "Visible maintenant",
		"au-dessus de l'horizon": "Au-dessus de l'horizon",
		"sous l'horizon": "Sous l'horizon",
		"quotidienne": "quotidienne",

		"œil nu": "Œil nu",
		"télescope personnel": "Télescope personnel",
		"observatoire": "Observatoire",
		"système solaire": "Système solaire",
		"voie lactée": "Voie lactée",
		"au-delà": "Au-delà",
		"plus lumineux": "Le plus lumineux",
		"le plus proche": "Le plus proche",
		"le plus éloigné": "Le plus éloigné",
		direction: "Direction",
		nord: "Nord",
		sud: "Sud",
		est: "Est",
		ouest: "Ouest",
		"trié par": "Trier par",

		"ici au-dessus de vous": "ici au-dessus de vous",
		"vaut le(s) plus grand(s) télescope(s)": "vaut le(s) plus grand(s) télescopes",
		"observation détaillée": "observation détaillée",
		"conseils de photographie": "conseils de photographie",
		"tout ce dont vous avez besoin": "tout ce dont vous avez besoin",
		"Appareil photo/Portable": "Appareil photo / Portable",
		"Oculaire": "Oculaire",
		"Jumelles": "Jumelles",

		"conseils pratiques": "conseils pratiques",
		"noms et significations": "noms et significations",
		"schematismes des constellations": "schematismes des constellations",
		"histoires mythologiques": "histoires mythologiques",
		"significations historiques": "significations historiques",

		"notes de photographie": "notes de photographie",
		"photo celebre": "photo célèbre",
		"recommandations d'équipement": "recommandations d'équipement",
		"paramètres d'exposition": "paramètres d'exposition",

		avertissement: "⚠️",
		note: "ℹ️",
		astuce: "💡",

		"ouvert à": "Ouvert à",
		"de": "de",
		"inclure les coordonnées gps exactes": "inclure les coordonnées GPS exactes dans l'export",
		"une courte note": "une courte note sur la soirée (optionnel)…",
		"copié — collez dans votre application de notes": "Copié — collez dans votre application de notes.",
		"n'a pas pu copier": "Impossible de copier — appuyez longuement pour sélectionner.",
		"sauvegarde…": "Sauvegarde…",
		"sauvegardé dans votre compte": "Sauvegardé dans votre compte.",
		"n'a pas pu sauvegarder": "Impossible de sauvegarder",
		nouveau: "Nouveau",
		"connectez-vous pour sauvegarder": "Connectez-vous pour sauvegarder",
		"afficher les observations sauvegardées →": "Afficher les observations sauvegardées →",
		"rien de sauvegardé pour le moment": "Rien de sauvegardé pour le moment. Ouvrez Observations depuis le menu Sauvegarder après une soirée de balade pour garder un enregistrement.",
		"lieu vide placeholder": "Ouvrez quelques objets du ciel et ils apparaîtront ici — un journal tranquille de votre soirée." + "\n\n" + "Voulez-vous passer en français ?",
		"résumé de l'observation": "objet(s) vu depuis",
		"lieu non enregistré": "lieu non enregistré",

		"observations sauvegardées": "Observations sauvegardées",
		"connectez-vous pour un journal tranquille": "Connectez-vous pour garder un journal tranquille de vos soirées à travers les appareils.",
		"connectez-vous →": "Connectez-vous →",
		"chargement…": "Chargement…",
		"supprimer cette observation ?": "Supprimer cette observation ?",

		"installer heavenward": "Installer Heavenward",
		"garder le ciel du soir à un clic": "Garder le ciel du soir à un clic.",
		"ouvrez dans votre navigateur": "Ouvrir dans votre navigateur",
		"pour de meilleurs résultats": "pour de meilleurs résultats",
		"facebook instagram": "Facebook et Instagram",
		"navigateurs intégrés": "navigateurs intégrés",
		"peuvent bloquer la localisation": "peuvent bloquer la localisation et les calculs d'heure du ciel",
		"copier le lien": "Copier le lien",
		"copié": "Copié",
		"utiliser le menu → navigateur": "Utiliser le menu → navigateur",

		"trucs": "Trucs",
		"trucs étiquette": "Trucs",
		"trucs panneau titre": "Trucs",
		"trucs social étiquette": "S'épanouir",
		"trucs social grille": " ",
		"texte du partage copié": "Texte de partage copié",
		"partager instagram": "Instagram",
		"contribution informelle": "contribution informelle",
		"demande de support": "Demande de support"
	};

	function partialKey(key: string) {
		return key.split(' ')[0].toLowerCase();
	}

	function applyTranslations() {
		const elts = document.querySelectorAll('[data-i18n]') as NodeListOf<HTMLElement>;

		F\/**\n * Runtime i18n injector for Heavenward\n * Detects browser language and swaps UI to French when applicable.\n * No build step required.\n */\n\n(function() {\n  \"use strict\";\n\n  // Translations (English fallbacks)\n  const translations = {\n\ttonight: \"Ce soir\",\n\trecherche: \"Recherche\",\n\tparamètres: \"Paramètres\",\n\templacement: \"Emplacement\",\n\tcompte: \"Compte\",\n\t\"à propos\": \"À propos\",\n\tobservations: \"Observations\",\n\t\"être social\": \"S'épanouir\",\n\tpartager: \"Partager\",\n\tretour: \"Retour\",\n\tsupport: \"Support\",\n\n\t\"objet(s)\": \"objet(s)\",\n\t\"dans le ciel\": \"dans le ciel\",\n\t\"visible maintenant\": \"Visible maintenant\",\n\t\"au-dessus de l'horizon\": \"Au-dessus de l'horizon\",\n\t\"sous l'horizon\": \"Sous l'horizon\",\n\t\"quotidienne\": \"quotidienne\",\n\n\t\"œil nu\": \"Œil nu\",\n\t\"télescope personnel\": \"Télescope personnel\",\n\t\"observatoire\": \"Observatoire\",\n\tsystème solaire: "Système solaire",
	voie lactée: "Voie lactée",
	"au-delà": "Au-delà",
	"plus lumineux": "Le plus lumineux",
	"le plus proche": "Le plus proche",
	"le plus éloigné": "Le plus éloigné",
	direction: "Direction",
	nord: "Nord",
	sud: "Sud",
	est: "Est",
	ouest: "Ouest",
	"trié par": "Trier par",

	"ici au-dessus de vous": "ici au-dessus de vous",
	"vaut le(s) plus grand(s) télescope(s)": "vaut le(s) plus grand(s) télescopes",
	"observation détaillée": "observation détaillée",
	"conseils de photographie": "conseils de photographie",
	"tout ce dont vous avez besoin": "tout ce dont vous avez besoin",
	"Appareil photo/Portable": "Appareil photo / Portable",
	"Oculaire": "Oculaire",
	"Jumelles": "Jumelles",

	"conseils pratiques": "conseils pratiques",
	"noms et significations": "noms et significations",
	"schematismes des constellations": "schematismes des constellations",
	"histoires mythologiques": "histoires mythologiques",
	"significations historiques": "significations historiques",

	"notes de photographie": "notes de photographie",
	"photo celebre": "photo célèbre",
	"recommandations d'équipement": "recommandations d'équipement",
	"paramètres d'exposition": "paramètres d'exposition",

	avertissement: "⚠️",
	note: "ℹ️",
	astuce: "💡",

	"ouvert à": "Ouvert à",
	"de": "de",
	"inclure les coordonnées gps exactes": "inclure les coordonnées GPS exactes dans l'export",
	"une courte note": "une courte note sur la soirée (optionnel)…",
	"copié — collez dans votre application de notes": "Copié — collez dans votre application de notes.",
	"n'a pas pu copier": "Impossible de copier — appuyez longuement pour sélectionner.",
	"sauvegarde…": "Sauvegarde…",
	"sauvegardé dans votre compte": "Sauvegardé dans votre compte.",
	"n'a pas pu sauvegarder": "Impossible de sauvegarder",
	nouveau: "Nouveau",
	"connectez-vous pour sauvegarder": "Connectez-vous pour sauvegarder",
	"afficher les observations sauvegardées →": "Afficher les observations sauvegardées →",
	"rien de sauvegardé pour le moment": "Rien de sauvegardé pour le moment. Ouvrez Observations depuis le menu Sauvegarder après une soirée de balade pour garder un enregistrement.",
	"lieu vide placeholder": "Ouvrez quelques objets du ciel et ils apparaîtront ici — un journal tranquille de votre soirée." + "\n\n" + "Voulez-vous passer en français ?",
	"résumé de l'observation": "objet(s) vu depuis",
	"lieu non enregistré": "lieu non enregistré",

	"observations sauvegardées": "Observations sauvegardées",
	"connectez-vous pour un journal tranquille": "Connectez-vous pour garder un journal tranquille de vos soirées à travers les appareils.",
	"connectez-vous →": "Connectez-vous →",
	"chargement…": "Chargement…",
	"supprimer cette observation ?": "Supprimer cette observation ?",

	"installer heavenward": "Installer Heavenward",
	"garder le ciel du soir à un clic": "Garder le ciel du soir à un clic.",
	"ouvrez dans votre navigateur": "Ouvrir dans votre navigateur",
	"pour de meilleurs résultats": "pour de meilleurs résultats",
	"facebook instagram": "Facebook et Instagram",
	"navigateurs intégrés": "navigateurs intégrés",
	"peuvent bloquer la localisation": "peuvent bloquer la localisation et les calculs d'heure du ciel",
	"copier le lien": "Copier le lien",
	"copié": "Copié",
	"utiliser le menu → navigateur": "Utiliser le menu → navigateur",

	"trucs": "Trucs",
	"trucs étiquette": "Trucs",
	"trucs panneau titre": "Trucs",
	"trucs social étiquette": "S'épanouir",
	"trucs social grille": " ",
	"texte du partage copié": "Texte de partage copié",
	"partager instagram": "Instagram",
	"contribution informelle": "contribution informelle",
	"demande de support": "Demande de support"
  };

  function partialKey(key) {\n    return key.split(' ')[0].toLowerCase();\n  }

  function applyTranslations() {\n    const elts = document.querySelectorAll('[data-i18n]') as NodeListOf<HTMLElement>;

    elts.forEach(el => {\n      const key = el.getAttribute('data-i18n');\n      if (!key) return;\n\n      let text = translations[key as keyof typeof translations];\n      if (!text && translations[partialKey(key)]) {\n        text = translations[partialKey(key)];\n      }

      if (text !== undefined) {\n        el.textContent = text;\n      }\n    });\n  }

  // Detect if browser language is French\n  const browserLang = navigator.language.slice(0, 2); // e.g., "fr-CA" → "fr"\n\n  if (browserLang === 'fr') {\n    applyTranslations();\n  }

  // Allow manual toggle via localStorage
  const savedLang = localStorage.getItem('heavenward-locale');\n  if (savedLang === 'fr') {\n    applyTranslations();\n  }
})();
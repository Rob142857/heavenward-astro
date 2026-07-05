/**
 * Centralized translations for Heavenward
 * English is the primary/default language.
 * Add a new object here to support additional languages (e.g., Chinese, German, Lithuanian, Japanese).
 */
export type Locale = 'en' | 'fr';

export const translations: Record<Locale, Record<string, string>> = {
	en: {
		"tonight": "Tonight",
		"search": "Search",
		"settings": "Settings",
		"location": "Location",
		"account": "Account",
		"about": "About",
		"observations": "Observations",
		"beSocial": "Be social",
		"share": "Share",
		"feedback": "Feedback",
		"support": "Support",
		"stuff": "Stuff",
		"stuff toggle label": "Stuff",
		"stuff panel title": "Stuff",
		"stuff social grid": " "
	},
	fr: {
		"tonight": "Ce soir",
		"search": "Recherche",
		"settings": "Paramètres",
		"location": "Emplacement",
		"account": "Compte",
		"about": "À propos",
		"observations": "Observations",
		"beSocial": "S'épanouir",
		"share": "Partager",
		"feedback": "Revenir",
		"support": "Support",
		"stuff": "Trucs",
		"stuff toggle label": "Trucs",
		"stuff panel title": "Trucs",
		"connectez-vous →": "Se connecter →"
	}
};

/**
 * Generate a safe partial key from the full key.
 * For example, "tonight sky" → "tonight", "need the telescope" → "need".
 * This makes translation lookup less fragile during maintenance.
 */
function partialKey(key: string): string {
	return key.split(' ')[0].toLowerCase();
}

/**
 * Get locale from URL query parameter first, then browser, then localStorage.
 */
export function detectLocale(): Locale {
	// Check URL parameter first (e.g., ?locale=fr)
	const urlParams = new URLSearchParams(window.location.search);
	const urlLocale = urlParams.get('locale');

	if (urlLocale === 'fr') {
		return 'fr';
	}

	// Check browser language
	const browserLang = navigator.language.slice(0, 2); // e.g., "fr-CA" → "fr"

	if (browserLang === 'fr') {
		return 'fr';
	}

	// Fall back to localStorage
	const storedLocale = localStorage.getItem('heavenward-locale');
	if (storedLocale && (storedLocale === 'fr' || storedLocale === 'en')) {
		return storedLocale as Locale;
	}

	return 'en';
}

/**
 * Set the current locale and save to localStorage.
 */
export function setLocale(locale: Locale): void {
	localStorage.setItem('heavenward-locale', locale);
	// Update URL parameter without triggering page reload
	const urlParams = new URLSearchParams(window.location.search);
	urlParams.set('locale', locale);
	const newUrl = `${window.location.pathname}?${urlParams.toString()}`;
	window.history.replaceState({}, '', newUrl);
}

/**
 * Get a translation for a given key.
 * Falls back to English if the current locale doesn't have that key.
 */
export function t(key: string, locale?: Locale): string {
	const targetLocale = locale || (localStorage.getItem('heavenward-locale') as Locale) || detectLocale();
	const trans = translations[targetLocale];

	// Direct match
	if (trans && trans[key]) {
		return trans[key];
	}

	// Partial match with fallback
	if (trans && trans[partialKey(key)]) {
		return trans[partialKey(key)];
	}

	// Last resort: English (or key if no English either)
	return translations.en ? translations.en[key] : key;
}
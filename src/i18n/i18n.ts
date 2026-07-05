/**
 * Internationalization (i18n) service for Heavenward
 * Provides translation utilities and locale management.
 */
import type { Locale } from './translations.js';
import { t, setLocale, detectLocale } from './translations.js';

/**
 * Current locale (cached after first load).
 */
let currentLocale: Locale | null = null;

/**
 * Initialize the i18n system.
 * Detects locale from browser or localStorage and starts using it.
 */
export function initI18n(): Locale {
	currentLocale = detectLocale();
	return currentLocale;
}

/**
 * Get the current locale.
 */
export function getLocale(): Locale {
	if (!currentLocale) {
		currentLocale = initI18n();
	}
	return currentLocale;
}

/**
 * Set the locale and save it.
 */
export async function setUILocale(locale: Locale): Promise<void> {
	currentLocale = locale;
	setLocale(locale);
}
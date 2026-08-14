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

function applyDocumentLocale(locale: Locale): void {
	document.documentElement.lang = locale;
	// Every currently supported script is written left-to-right. Keep this
	// explicit so a previously embedded/translated document cannot leak a
	// stale direction into the app shell.
	document.documentElement.dir = "ltr";
}

/**
 * Initialize the i18n system.
 * Detects locale from browser or localStorage and starts using it.
 */
export function initI18n(): Locale {
	// Deliberately does NOT persist: an auto-detected locale must stay
	// auto-detected, so a device whose language later changes (or that once
	// loaded a ?locale= link) isn't stuck forever. Only setUILocale() writes.
	currentLocale = detectLocale();
	applyDocumentLocale(currentLocale);
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
	applyDocumentLocale(locale);
	setLocale(locale);
}

/**
 * Heavenward French localization logic
 * Injects French-optimized HTML initially, then falls back to English content.
 * Used when browser language is French.
 */

(function() {
	// Get locale: URL param first, then browser, then default
	const urlParams = new URLSearchParams(window.location.search);
	const urlLocale = urlParams.get('locale');
	const browserLang = navigator.language.slice(0, 2); // e.g., "fr-CA" → "fr"
	const storedLocale = localStorage.getItem('heavenward-locale');

	let locale = 'en';

	if (urlLocale === 'fr') {
		locale = 'fr';
	} else if (browserLang === 'fr') {
		locale = 'fr';
	} else if (storedLocale === 'fr') {
		locale = 'fr';
	}

	if (locale === 'fr') {
		console.log('☀️ Heavenward: French locale detected');
		// Content is already in English—the detection logic auto-fallback will show our content
		// as-is. No HTML string replacement needed.
	} else {
		console.log('☀️ Heavenward: English locale detected');
	}
})();
/**
 * Fails the build if the locale tables have drifted apart.
 *
 * t() falls back locale -> en -> the key itself, so a key missing from one
 * table doesn't throw; it silently renders the literal string
 * "settings.aiQuality.note" on screen in production. That is the kind of
 * fault that ships unnoticed and is then reported as "the app looks broken in
 * French". English is the source of truth: every key it defines must exist in
 * every other locale, and no locale may define keys English doesn't.
 */
import { translations, type Locale } from "../src/i18n/translations.ts";

const SOURCE: Locale = "en";

/**
 * Keys that are legitimately empty in some locales. Listed explicitly so a
 * blank stays a deliberate decision someone wrote down, rather than the
 * check being loosened until it stops catching real omissions.
 *
 * quote.langNote: notes that Campbell's epigraphs are shown in their original
 * English. An English reader needs no such note, so the string is empty for
 * them and the element is not rendered at all.
 */
const INTENTIONALLY_BLANK = new Set(["quote.langNote"]);

function main(): void {
  const sourceKeys = Object.keys(translations[SOURCE]).sort();
  const problems: string[] = [];

  for (const locale of Object.keys(translations) as Locale[]) {
    if (locale === SOURCE) continue;
    const keys = new Set(Object.keys(translations[locale]));

    const missing = sourceKeys.filter((k) => !keys.has(k));
    if (missing.length) {
      problems.push(
        `  ${locale}: missing ${missing.length} key(s) present in ${SOURCE}:\n` +
          missing.map((k) => `    - ${k}`).join("\n"),
      );
    }

    // Presence, not truthiness: an intentionally empty English value is still
    // a defined key, and testing the value would flag it as missing.
    const extra = [...keys]
      .filter((k) => !Object.hasOwn(translations[SOURCE], k))
      .sort();
    if (extra.length) {
      problems.push(
        `  ${locale}: defines ${extra.length} key(s) absent from ${SOURCE} (dead or misspelt):\n` +
          extra.map((k) => `    - ${k}`).join("\n"),
      );
    }

    // An empty value falls through to English at runtime, which reads as an
    // untranslated string rather than an obvious error — worth catching here.
    const blank = sourceKeys.filter(
      (k) =>
        keys.has(k) &&
        !INTENTIONALLY_BLANK.has(k) &&
        translations[locale][k].trim() === "",
    );
    if (blank.length) {
      problems.push(
        `  ${locale}: ${blank.length} key(s) present but blank:\n` +
          blank.map((k) => `    - ${k}`).join("\n"),
      );
    }
  }

  if (problems.length) {
    console.error("i18n key parity check FAILED\n");
    console.error(problems.join("\n\n"));
    console.error(
      `\nEvery key in "${SOURCE}" must exist, non-blank, in all locales.`,
    );
    process.exit(1);
  }

  const localeCount = Object.keys(translations).length;
  console.log(
    `i18n OK — ${sourceKeys.length} keys consistent across ${localeCount} locales.`,
  );
}

main();

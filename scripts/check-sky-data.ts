/**
 * Build-time integrity checks for the small, hand-curated cultural catalogs.
 *
 * These facts are part of the app's trust boundary: a missing translation or
 * mistyped star/constellation key otherwise fails silently and leaves the
 * local model with thinner grounding. Keep this script dependency-free so it
 * can run anywhere the normal TypeScript build runs.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

type JsonRecord = Record<string, unknown>;

const ROOT = process.cwd();
const REQUIRED_LOCALES = ["fr", "ja", "zh-Hans"] as const;
const errors: string[] = [];

function readJson(name: string): unknown {
  return JSON.parse(
    readFileSync(resolve(ROOT, "src", "catalog", name), "utf8"),
  ) as unknown;
}

function records(name: string): JsonRecord[] {
  const value = readJson(name);
  if (!Array.isArray(value)) {
    throw new Error(`${name} must contain a JSON array`);
  }
  return value as JsonRecord[];
}

function textField(entry: JsonRecord, field: string, label: string): string {
  const value = entry[field];
  if (typeof value !== "string" || value.trim() === "") {
    errors.push(`${label}: missing ${field}`);
    return "";
  }
  return value;
}

function localizedField(
  entry: JsonRecord,
  field: string,
  label: string,
): void {
  const value = entry[field];
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    errors.push(`${label}: missing ${field}`);
    return;
  }
  const translations = value as JsonRecord;
  for (const locale of REQUIRED_LOCALES) {
    const translated = translations[locale];
    if (typeof translated !== "string" || translated.trim() === "") {
      errors.push(`${label}: missing ${field}.${locale}`);
    }
  }
}

function duplicateCheck(values: string[], catalog: string): void {
  const seen = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) errors.push(`${catalog}: duplicate record ${value}`);
    seen.add(value);
  }
}

const stars = records("stars.json");
const dsos = records("dso.json");
const starNames = new Set(
  stars
    .map((entry) => entry.name)
    .filter((name): name is string => typeof name === "string"),
);
const constellationCodes = new Set(
  [...stars, ...dsos]
    .map((entry) => entry.constellation)
    .filter((code): code is string => typeof code === "string"),
);

const mythology = records("mythology.json");
duplicateCheck(
  mythology.map((entry, index) =>
    textField(entry, "constellation", `mythology[${index}]`),
  ),
  "mythology.json",
);
for (const [index, entry] of mythology.entries()) {
  const label = `mythology[${index}]`;
  const code = textField(entry, "constellation", label);
  if (code && !constellationCodes.has(code)) {
    errors.push(`${label}: unknown constellation ${code}`);
  }
  textField(entry, "figure", label);
  textField(entry, "summary", label);
  textField(entry, "source", label);
  textField(entry, "sourceDetail", label);
  localizedField(entry, "summaryI18n", label);
  if (!["explicit", "moderate", "thin"].includes(String(entry.connectionStrength))) {
    errors.push(`${label}: invalid connectionStrength`);
  }
}

const history = records("history.json");
duplicateCheck(
  history.map((entry, index) =>
    [
      textField(entry, "constellation", `history[${index}]`),
      typeof entry.starName === "string" ? entry.starName : "",
      textField(entry, "topic", `history[${index}]`),
    ].join("|"),
  ),
  "history.json",
);
for (const [index, entry] of history.entries()) {
  const label = `history[${index}]`;
  const code = textField(entry, "constellation", label);
  if (code && !constellationCodes.has(code)) {
    errors.push(`${label}: unknown constellation ${code}`);
  }
  if (entry.starName !== undefined && !starNames.has(String(entry.starName))) {
    errors.push(`${label}: unknown star ${String(entry.starName)}`);
  }
  textField(entry, "summary", label);
  textField(entry, "source", label);
  textField(entry, "sourceDetail", label);
  localizedField(entry, "topicI18n", label);
  localizedField(entry, "summaryI18n", label);
  if (!["primary", "academic"].includes(String(entry.sourceType))) {
    errors.push(`${label}: invalid sourceType`);
  }
}

const namesakes = records("namesakes.json");
duplicateCheck(
  namesakes.map((entry, index) =>
    textField(entry, "thing", `namesakes[${index}]`),
  ),
  "namesakes.json",
);
for (const [index, entry] of namesakes.entries()) {
  const label = `namesakes[${index}]`;
  if (!Array.isArray(entry.stars) || entry.stars.length === 0) {
    errors.push(`${label}: stars must be a non-empty array`);
  } else {
    for (const star of entry.stars) {
      if (typeof star !== "string" || !starNames.has(star)) {
        errors.push(`${label}: unknown star ${String(star)}`);
      }
    }
  }
  textField(entry, "summary", label);
  textField(entry, "source", label);
  localizedField(entry, "thingI18n", label);
  localizedField(entry, "summaryI18n", label);
  if (!["documented", "widely-reported"].includes(String(entry.confidence))) {
    errors.push(`${label}: invalid confidence`);
  }
}

const prohibited = /\b(?:horoscope|personality categor(?:y|ies|isation|ization)|fortune[- ]?telling|birth sign|star sign compatibility)\b/i;
for (const [catalog, entries] of [
  ["mythology", mythology],
  ["history", history],
  ["namesakes", namesakes],
] as const) {
  entries.forEach((entry, index) => {
    if (prohibited.test(JSON.stringify(entry))) {
      errors.push(`${catalog}[${index}]: prohibited astrology framing`);
    }
  });
}

if (errors.length) {
  console.error(`Sky-data check failed with ${errors.length} problem(s):`);
  for (const error of errors) console.error(`  - ${error}`);
  process.exitCode = 1;
} else {
  console.log(
    `Sky-data check passed: ${mythology.length} mythology, ${history.length} history, and ${namesakes.length} namesake records; all keys, sources, and translations are present.`,
  );
}

import type { UserPrefs } from "../types.js";

const PREFS_KEY = "heavenward-prefs";
const CATEGORY_KEYS = ["solar-system", "milky-way", "beyond"] as const;
const EQUIPMENT_DEFAULT = "naked-eye" as const;

const DEFAULT_PREFS: UserPrefs = {
  enabledSources: [
    "planets",
    "moon",
    "stars",
    "dso",
    "meteors",
    "eclipses",
    "conjunctions",
  ],
  magnitudeLimit: 6.0,
  defaultLocation: null,
  equipment: EQUIPMENT_DEFAULT,
  displayLimit: 50,
  enabledCategories: [...CATEGORY_KEYS],
  sortBy: "brightest",
};

function normalizeEquipment(equipment: unknown): UserPrefs["equipment"] {
  if (equipment === "naked-eye") {
    return "naked-eye";
  }

  if (
    equipment === "personal-telescope" ||
    equipment === "binoculars" ||
    equipment === "telescope"
  ) {
    return "personal-telescope";
  }

  if (equipment === "observatory" || equipment === "deep-scope") {
    return "observatory";
  }

  return EQUIPMENT_DEFAULT;
}

function normalizeCategories(enabledCategories: unknown): string[] {
  const categories = Array.isArray(enabledCategories)
    ? enabledCategories.filter(
        (value): value is string => typeof value === "string",
      )
    : [];

  if (categories.length === 0) {
    return [...CATEGORY_KEYS];
  }

  const normalized = new Set<string>();

  for (const category of categories) {
    if (category === "solar-system") {
      normalized.add("solar-system");
      continue;
    }

    if (
      category === "milky-way" ||
      category === "stars" ||
      category === "nebulae" ||
      category === "clusters" ||
      category === "double-stars" ||
      category === "meteors"
    ) {
      normalized.add("milky-way");
      continue;
    }

    if (category === "beyond" || category === "galaxies") {
      normalized.add("beyond");
    }
  }

  return normalized.size > 0 ? [...normalized] : [...CATEGORY_KEYS];
}

export function loadPrefs(): UserPrefs {
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    if (!raw) return { ...DEFAULT_PREFS };
    const parsed: unknown = JSON.parse(raw);
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      "enabledSources" in parsed
    ) {
      const prefs = parsed as Partial<UserPrefs>;
      return {
        ...DEFAULT_PREFS,
        ...prefs,
        equipment: normalizeEquipment(prefs.equipment),
        enabledCategories: normalizeCategories(prefs.enabledCategories),
      };
    }
    return { ...DEFAULT_PREFS };
  } catch {
    return { ...DEFAULT_PREFS };
  }
}

export function savePrefs(prefs: UserPrefs): void {
  localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
}

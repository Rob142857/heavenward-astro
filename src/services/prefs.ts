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
  directionFilter: [],
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

function normalizeSort(sortBy: unknown): UserPrefs["sortBy"] {
  if (
    sortBy === "brightest" ||
    sortBy === "closest" ||
    sortBy === "farthest" ||
    sortBy === "direction"
  ) {
    return sortBy;
  }

  return "brightest";
}

function normalizeDirectionFilter(
  directionFilter: unknown,
): UserPrefs["directionFilter"] {
  const VALID = ["north", "east", "south", "west"] as const;
  type C = (typeof VALID)[number];
  // Legacy single-string values from older clients → convert to array.
  if (typeof directionFilter === "string") {
    if ((VALID as readonly string[]).includes(directionFilter)) {
      return [directionFilter as C];
    }
    return []; // "all" or unknown → empty (no filter)
  }
  if (Array.isArray(directionFilter)) {
    const set = new Set<C>();
    for (const v of directionFilter) {
      if (typeof v === "string" && (VALID as readonly string[]).includes(v)) {
        set.add(v as C);
      }
    }
    // All four selected ≡ none selected (both mean "everything") — normalise.
    if (set.size === 4) return [];
    return Array.from(set);
  }
  return [];
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
        sortBy: normalizeSort(prefs.sortBy),
        directionFilter: normalizeDirectionFilter(prefs.directionFilter),
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

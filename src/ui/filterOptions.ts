import type { Equipment, SortBy } from "../types.js";

// label/desc are translation KEYS, not display text — call t(opt.labelKey)
// / t(opt.descKey) at render time so these stay correct across a locale
// switch (these arrays are built once at module load, before the user can
// have changed locale).

export const EQUIPMENT_LIMITS: Record<Equipment, number> = {
  "naked-eye": 6.0,
  "personal-telescope": 13.0,
  observatory: 99,
};

export const EQUIPMENT_OPTIONS: {
  key: Equipment;
  labelKey: string;
  icon: string;
  mag: number;
  descKey: string;
}[] = [
  {
    key: "naked-eye",
    labelKey: "common.equipment.nakedEye",
    icon: "👁",
    mag: 6.0,
    descKey: "common.equipment.nakedEyeDesc",
  },
  {
    key: "personal-telescope",
    labelKey: "common.equipment.personalTelescope",
    icon: "🔭",
    mag: 13.0,
    descKey: "common.equipment.personalTelescopeDesc",
  },
  {
    key: "observatory",
    labelKey: "common.equipment.observatory",
    icon: "🛰",
    mag: 99,
    descKey: "common.equipment.observatoryDesc",
  },
];

export const CATEGORY_OPTIONS: {
  key: string;
  labelKey: string;
  icon: string;
}[] = [
  { key: "solar-system", labelKey: "common.category.solarSystem", icon: "🪐" },
  { key: "milky-way", labelKey: "common.category.milkyWay", icon: "⭐" },
  { key: "beyond", labelKey: "common.category.beyond", icon: "🌌" },
];

export const SORT_OPTIONS: { key: SortBy; labelKey: string }[] = [
  { key: "brightest", labelKey: "common.sort.brightest" },
  { key: "closest", labelKey: "common.sort.closest" },
  { key: "farthest", labelKey: "common.sort.farthest" },
  { key: "direction", labelKey: "common.sort.direction" },
];

export const DIRECTION_OPTIONS: {
  key: "north" | "east" | "south" | "west";
  labelKey: string;
  shortLabelKey: string;
}[] = [
  { key: "north", labelKey: "common.direction.north", shortLabelKey: "common.direction.n" },
  { key: "east", labelKey: "common.direction.east", shortLabelKey: "common.direction.e" },
  { key: "south", labelKey: "common.direction.south", shortLabelKey: "common.direction.s" },
  { key: "west", labelKey: "common.direction.west", shortLabelKey: "common.direction.w" },
];

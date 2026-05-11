import type { Equipment, SortBy } from "../types.js";

export const EQUIPMENT_LIMITS: Record<Equipment, number> = {
  "naked-eye": 6.0,
  "personal-telescope": 13.0,
  observatory: 99,
};

export const EQUIPMENT_OPTIONS: {
  key: Equipment;
  label: string;
  icon: string;
  mag: number;
  desc: string;
}[] = [
  {
    key: "naked-eye",
    label: "Naked Eye",
    icon: "👁",
    mag: 6.0,
    desc: "Objects visible without any optical aid — bright planets, the Moon, named stars, and a handful of the brightest deep-sky showpieces like the Pleiades and Andromeda Galaxy.",
  },
  {
    key: "personal-telescope",
    label: "Personal Telescope",
    icon: "🔬",
    mag: 13.0,
    desc: "A home telescope opens up galaxies, planetary nebula detail, resolved globular clusters, and fainter comets well beyond naked-eye range.",
  },
  {
    key: "observatory",
    label: "Observatory",
    icon: "🛰",
    mag: 99,
    desc: "Observatory-class gear or long-exposure imaging shows the full catalog with no practical brightness cutoff applied.",
  },
];

export const CATEGORY_OPTIONS: { key: string; label: string; icon: string }[] =
  [
    { key: "solar-system", label: "Solar System", icon: "🪐" },
    { key: "milky-way", label: "Milky Way", icon: "⭐" },
    { key: "beyond", label: "Beyond", icon: "🌌" },
  ];

export const SORT_OPTIONS: { key: SortBy; label: string }[] = [
  { key: "brightest", label: "Brightest" },
  { key: "highest", label: "Highest" },
  { key: "lowest", label: "Lowest" },
  { key: "smallest", label: "Smallest" },
];

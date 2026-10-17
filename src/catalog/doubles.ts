import type { EquipmentClass } from "../engine/equipment.ts";

/**
 * Showpiece double stars for Tonight's Best's "Doubles" filter.
 *
 * HYG's double flag marks any star with a known companion, including ones no
 * one can split at the eyepiece (Sirius B, Aldebaran B, Fomalhaut's
 * companions two degrees away). This list holds only pairs worth showing
 * someone. Positions come from the star catalogue by `star` id; the
 * separation decides the equipment, not the brightness.
 *
 * Separations are rounded figures from the Washington Double Star catalogue
 * (WDS) and change slowly with orbital motion. Alpha Centauri's is left out
 * because it changes quickly (it is a few arcseconds at present).
 */
export interface ShowpieceDouble {
  /** Star catalogue id (stars.json). */
  star: string;
  /** Separation of the pair worth looking at, arcseconds. */
  sepArcsec: number | null;
  /** Least equipment that splits it. */
  needs: EquipmentClass;
}

export const SHOWPIECE_DOUBLES: ShowpieceDouble[] = [
  { star: "mizar", sepArcsec: 708, needs: "naked-eye" }, // with Alcor; Mizar B 14" in a scope
  { star: "algedi", sepArcsec: 378, needs: "naked-eye" },
  { star: "zubenelgenubi", sepArcsec: 231, needs: "binoculars" },
  { star: "mintaka", sepArcsec: 52, needs: "small-scope" },
  { star: "albireo", sepArcsec: 35, needs: "small-scope" },
  { star: "alya", sepArcsec: 22, needs: "small-scope" },
  { star: "cor-caroli", sepArcsec: 19, needs: "small-scope" },
  { star: "polaris", sepArcsec: 18, needs: "small-scope" },
  { star: "graffias", sepArcsec: 14, needs: "small-scope" },
  { star: "achird", sepArcsec: 13, needs: "small-scope" },
  { star: "almach", sepArcsec: 10, needs: "small-scope" },
  { star: "rigel", sepArcsec: 9.5, needs: "small-scope" },
  { star: "acamar", sepArcsec: 8.3, needs: "small-scope" },
  { star: "mesarthim", sepArcsec: 7.5, needs: "small-scope" },
  { star: "castor", sepArcsec: 5, needs: "small-scope" },
  { star: "algieba", sepArcsec: 4.7, needs: "small-scope" },
  { star: "rasalgethi", sepArcsec: 4.6, needs: "small-scope" },
  { star: "acrux", sepArcsec: 4, needs: "small-scope" },
  { star: "izar", sepArcsec: 2.9, needs: "small-scope" },
  { star: "rigil-kentaurus", sepArcsec: null, needs: "small-scope" },
];

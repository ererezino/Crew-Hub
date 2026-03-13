/**
 * Crew page department display normalization.
 *
 * PRESENTATION-LAYER ONLY — this does NOT change stored department values.
 *
 * On The Crew page, several stored department values are merged into a single
 * display bucket labeled "Marketing & Growth":
 *
 *   "Marketing"          → "Marketing & Growth"
 *   "Growth"             → "Marketing & Growth"
 *   "Sales"              → "Marketing & Growth"
 *   "Marketing & Growth" → "Marketing & Growth"  (legacy DB value)
 *
 * Every piece of Crew-specific UI logic (section grouping, section ordering,
 * department counts, filter chips, card metadata) MUST call this function
 * instead of using the raw `department` string directly.
 *
 * This is the SINGLE SOURCE OF TRUTH for Crew department display bucketing.
 * If the mapping needs to change, change it here — nowhere else.
 */

/** Stored department values that all map to the same combined display bucket. */
const MGS_RAW_VALUES = new Set([
  "marketing",
  "growth",
  "sales",
  "marketing & growth",
]);

/** The display label for the combined Marketing & Growth bucket. */
export const CREW_MGS_DISPLAY_LABEL = "Marketing & Growth";

/**
 * Normalize a raw department value to its Crew display label.
 *
 * - Marketing / Growth / Sales / "Marketing & Growth" → "Marketing & Growth"
 * - Everything else → unchanged (or "Other" if null/undefined)
 *
 * @param rawDepartment - The stored department value from the database.
 * @returns The display label to use on The Crew page.
 */
export function crewDisplayDepartment(rawDepartment: string | null | undefined): string {
  if (!rawDepartment) return "Other";
  if (MGS_RAW_VALUES.has(rawDepartment.toLowerCase())) return CREW_MGS_DISPLAY_LABEL;
  return rawDepartment;
}

/**
 * Check whether a raw department value belongs to the Marketing & Growth bucket.
 *
 * @param rawDepartment - The stored department value from the database.
 */
export function isCrewMgsDepartment(rawDepartment: string | null | undefined): boolean {
  if (!rawDepartment) return false;
  return MGS_RAW_VALUES.has(rawDepartment.toLowerCase());
}

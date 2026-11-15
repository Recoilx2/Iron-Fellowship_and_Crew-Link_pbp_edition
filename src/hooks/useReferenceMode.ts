import { createContext, useContext } from "react";

/**
 * Reference mode is for pages that only show the rules to read, like the
 * Rules page. Inside it nothing rolls, saves or edits: roll buttons stay out,
 * rows open for reading instead of rolling, and character values are not
 * shown even when a character is open elsewhere.
 *
 * It is off by default, so every other page behaves as before.
 */
export const ReferenceModeContext = createContext(false);

export function useReferenceMode(): boolean {
  return useContext(ReferenceModeContext);
}

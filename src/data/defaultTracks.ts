import { getMomentumTrack } from "config/mechanics.config";

/** Ironsworn's momentum track, kept as a named export for legacy callers. */
export const momentumTrack = {
  min: -6,
  max: 10,
  startingValue: 2,
};

/** Momentum track of the active base ruleset (Ironsworn math by default). */
export function getActiveMomentumTrack() {
  return getMomentumTrack();
}

import { LEGACY_TrackTypes } from "types/LegacyTrack.type";

/**
 * Starforged uses legacy tracks; other rulesets reuse Ironsworn progress
 * tracks unless a replacement declares legacy labels of its own.
 */
export function usesLegacyTracks(
  rulesetId: string,
  specialTracks: Record<string, { label: string }>,
): boolean {
  if (rulesetId === "starforged") return true;
  if (rulesetId === "classic") return false;
  return Object.values(specialTracks).some((track) =>
    Object.values(LEGACY_TrackTypes).includes(
      track.label.toLowerCase() as LEGACY_TrackTypes,
    ),
  );
}

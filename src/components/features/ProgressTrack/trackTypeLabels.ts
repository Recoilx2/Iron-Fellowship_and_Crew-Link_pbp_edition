import { getActiveRulesetId } from "data/activeRuleset";
import { TrackSectionProgressTracks, TrackSectionTracks, TrackTypes } from "types/Track.type";

export interface TrackTypeAvailability {
  isDelveEnabled: boolean;
  isIronsworn: boolean;
  isLodestarEnabled: boolean;
  isStarforged: boolean;
  /** Labels of the active base ruleset, in its own declared order. */
  progressTracks?: string[];
  activeRulesetId?: string;
}

export interface TrackTypeLabelOptions {
  progressTracks?: string[];
  activeRulesetId?: string;
}

/** The three core labels of a shipped or replacement ruleset's track list. */
const CORE_TRACK_ORDER: TrackSectionProgressTracks[] = [
  TrackTypes.Fray,
  TrackTypes.Vow,
  TrackTypes.Journey,
];

function isReplacementRuleset(rulesetId: string): boolean {
  return rulesetId !== "classic" && rulesetId !== "starforged";
}

/**
 * A replacement ruleset supplies its own track labels; they are mapped onto
 * the three canonical core track keys so existing stored tracks need no
 * migration. The shipped games keep their exact current labels.
 */
export function getTrackTypeLabel(
  trackType: TrackSectionTracks,
  isStarforged: boolean,
  options: TrackTypeLabelOptions = {},
): string {
  const rulesetId = options.activeRulesetId ?? getActiveRulesetId();
  if (isReplacementRuleset(rulesetId) && options.progressTracks?.length) {
    const index = CORE_TRACK_ORDER.indexOf(
      trackType as TrackSectionProgressTracks,
    );
    const customLabel = index >= 0 ? options.progressTracks[index] : undefined;
    if (customLabel) return customLabel;
  }

  switch (trackType) {
    case TrackTypes.Fray:
      return "Combat Track";
    case TrackTypes.Vow:
      return "Vow";
    case TrackTypes.Journey:
      return isStarforged ? "Expedition" : "Journey";
    case TrackTypes.DelveSite:
      return "Delve Site";
    case TrackTypes.SceneChallenge:
      return "Scene Challenge";
    case TrackTypes.Clock:
      return "Clock";
  }
}

/**
 * Track types available for creation. Delve and Scene Challenge follow the
 * installed expansions (or an explicit replacement label), not the game
 * system baked into the image.
 */
export function getAvailableTrackTypes(
  availability: TrackTypeAvailability,
): TrackSectionTracks[] {
  const rulesetId = availability.activeRulesetId ?? getActiveRulesetId();
  const trackTypes: TrackSectionTracks[] = [
    TrackTypes.Vow,
    TrackTypes.Fray,
    TrackTypes.Journey,
  ];

  if (availability.isDelveEnabled) {
    trackTypes.push(TrackTypes.DelveSite);
  }
  if (
    availability.isStarforged ||
    availability.isLodestarEnabled ||
    (isReplacementRuleset(rulesetId) &&
      availability.progressTracks?.some(
        (label) => label.trim().toLowerCase() === "scene challenge",
      ))
  ) {
    trackTypes.push(TrackTypes.SceneChallenge);
  }

  trackTypes.push(TrackTypes.Clock);
  return trackTypes;
}

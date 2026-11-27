import { describe, expect, it, vi } from "vitest";
import {
  getAvailableTrackTypes,
  getTrackTypeLabel,
} from "../trackTypeLabels";
import { TrackTypes } from "types/Track.type";

vi.mock("hooks/useGameSystem", () => ({ getSystem: () => "ironsworn" }));

describe("track labels and availability", () => {
  it("keeps shipped Ironsworn and Starforged labels", () => {
    expect(getTrackTypeLabel(TrackTypes.Fray, false, { activeRulesetId: "classic" }))
      .toBe("Combat Track");
    expect(getTrackTypeLabel(TrackTypes.Journey, false, { activeRulesetId: "classic" }))
      .toBe("Journey");
    expect(getTrackTypeLabel(TrackTypes.Journey, true, { activeRulesetId: "starforged" }))
      .toBe("Expedition");
    expect(getAvailableTrackTypes({
      isDelveEnabled: false,
      isIronsworn: true,
      isLodestarEnabled: false,
      isStarforged: false,
      activeRulesetId: "classic",
    })).toEqual([TrackTypes.Vow, TrackTypes.Fray, TrackTypes.Journey, TrackTypes.Clock]);
  });

  it("uses the replacement ruleset's own labels regardless of the image's game", () => {
    const options = {
      activeRulesetId: "frontier",
      progressTracks: ["Oath", "Trail", "Peril"],
    };
    // The image was built as Ironsworn, but the mounted package's labels win.
    expect(getTrackTypeLabel(TrackTypes.Fray, false, options)).toBe("Oath");
    expect(getTrackTypeLabel(TrackTypes.Vow, false, options)).toBe("Trail");
    expect(getTrackTypeLabel(TrackTypes.Journey, false, options)).toBe("Peril");
    expect(getTrackTypeLabel(TrackTypes.Clock, false, options)).toBe("Clock");
  });

  it("follows installed expansions, not the baked game system", () => {
    const flags = {
      isDelveEnabled: true,
      isIronsworn: false,
      isLodestarEnabled: false,
      isStarforged: false,
      activeRulesetId: "frontier",
      progressTracks: ["Oath", "Trail", "Peril"],
    };
    expect(getAvailableTrackTypes(flags)).toEqual([
      TrackTypes.Vow,
      TrackTypes.Fray,
      TrackTypes.Journey,
      TrackTypes.DelveSite,
      TrackTypes.Clock,
    ]);

    expect(getAvailableTrackTypes({
      ...flags,
      isDelveEnabled: false,
      progressTracks: ["Oath", "Trail", "Peril", "Scene Challenge"],
    })).toContain(TrackTypes.SceneChallenge);
  });
});

import { describe, expect, it, vi } from "vitest";
import { usesLegacyTracks } from "../specialTrackStyle";

vi.mock("hooks/useGameSystem", () => ({ getSystem: () => "ironsworn" }));

describe("special track style", () => {
  it("keeps the shipped systems' styles", () => {
    expect(usesLegacyTracks("classic", { bonds: { label: "Bonds" } })).toBe(false);
    expect(usesLegacyTracks("starforged", { quests: { label: "Quests" } })).toBe(true);
  });

  it("renders a replacement's own special tracks as progress tracks by default", () => {
    expect(
      usesLegacyTracks("frontier", {
        legacy_of_oaths: { label: "Legacy of Oaths" },
      }),
    ).toBe(false);
  });

  it("uses legacy tracks when a replacement declares legacy labels", () => {
    expect(
      usesLegacyTracks("frontier", {
        bonds: { label: "Bonds" },
      }),
    ).toBe(true);
  });
});

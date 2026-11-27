/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { ThemeProvider, createTheme } from "@mui/material";
import { Difficulty, TrackStatus, TrackTypes } from "types/Track.type";
import { resetActiveRulesetId, setActiveRulesetId } from "data/activeRuleset";

(
  globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("hooks/useGameSystem", () => ({ getSystem: () => "ironsworn" }));
vi.mock("hooks/useIsMobile", () => ({ useIsMobile: () => false }));
vi.mock("hooks/useCampaignType", () => ({
  useCampaignType: () => ({
    hasMultipleCharacters: false,
    showGuidedPlayerView: false,
    showGuideTips: false,
    campaignType: "solo",
  }),
}));
vi.mock("../ProgressTrack", () => ({
  ProgressTrack: (props: { label?: string }) => (
    <div data-testid="progress-track">{props.label}</div>
  ),
}));

const store = vi.hoisted(() => ({ state: {} as Record<string, unknown> }));
vi.mock("stores/store", () => ({
  useStore: (selector: (state: Record<string, unknown>) => unknown) =>
    selector(store.state),
}));

import { UnifiedTracksSection } from "../UnifiedTracksSection";

function state(progressTracks: string[]) {
  const trackMap = {
    [TrackStatus.Active]: {
      [TrackTypes.Fray]: {
        t1: {
          type: TrackTypes.Fray,
          label: "Oath made",
          difficulty: Difficulty.Dangerous,
          value: 0,
          status: TrackStatus.Active,
          createdDate: new Date(),
        },
      },
      [TrackTypes.Vow]: {
        t2: {
          type: TrackTypes.Vow,
          label: "Vow kept",
          difficulty: Difficulty.Dangerous,
          value: 0,
          status: TrackStatus.Active,
          createdDate: new Date(),
        },
      },
    },
    [TrackStatus.Completed]: {},
  };
  return {
    rules: {
      progressTracks,
      expansionIds: [],
      moveMaps: { moveMap: {} },
    },
    appState: { announce: vi.fn(), openDialog: vi.fn() },
    auth: { uid: "uid" },
    worlds: { currentWorld: { currentWorld: undefined } },
    characters: {
      currentCharacter: {
        currentCharacterId: "char-1",
        currentCharacter: undefined,
        tracks: {
          trackMap,
          setLoadCompletedTracks: vi.fn(),
          addTrack: vi.fn(),
          updateTrack: vi.fn(),
          deleteTrack: vi.fn(),
        },
      },
    },
    campaigns: {
      currentCampaign: {
        currentCampaignId: undefined,
        currentCampaign: undefined,
        tracks: {
          trackMap: { [TrackStatus.Active]: {}, [TrackStatus.Completed]: {} },
          addTrack: vi.fn(),
          updateTrack: vi.fn(),
          deleteTrack: vi.fn(),
          setLoadCompletedTracks: vi.fn(),
        },
        characters: { characterTracks: {}, characterMap: {} },
      },
    },
  } as unknown as Record<string, unknown>;
}

function renderSection() {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(
      <ThemeProvider theme={createTheme()}>
        <UnifiedTracksSection mode="character" />
      </ThemeProvider>,
    );
  });
  return { container, root };
}

afterEach(() => {
  resetActiveRulesetId();
  document.body.innerHTML = "";
});

describe("UnifiedTracksSection track labels", () => {
  it("renders a replacement ruleset's labels on a shipped Ironsworn image", () => {
    setActiveRulesetId("frontier");
    store.state = state(["Oath", "Trail", "Peril"]);

    const { container } = renderSection();

    expect(container.textContent).toContain("Oath");
    expect(container.textContent).toContain("Trail");
    expect(container.textContent).not.toContain("Combat Track");
    expect(container.textContent).not.toContain("Journey");
  });

  it("keeps shipped Ironsworn labels", () => {
    resetActiveRulesetId();
    store.state = state(["Combat", "Vow", "Journey"]);

    const { container } = renderSection();

    expect(container.textContent).toContain("Combat Track");
    expect(container.textContent).toContain("Vow");
  });
});

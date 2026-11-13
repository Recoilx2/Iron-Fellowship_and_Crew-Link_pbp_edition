/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, Root } from "react-dom/client";
import { ThemeProvider, createTheme } from "@mui/material";

let mockTabSearch = "";

const mockStoreState = {
  campaigns: {
    currentCampaign: {
      currentCampaignId: "campaign-1",
      currentCampaign: {},
    },
  },
};

vi.mock("stores/store", () => ({
  useStore: (selector: (store: typeof mockStoreState) => unknown) =>
    selector(mockStoreState),
}));
vi.mock("hooks/useCampaignType", () => ({
  useCampaignType: () => ({
    showGuidedPlayerView: false,
    showGuideTips: false,
  }),
}));
vi.mock("react-router-dom", () => ({
  useSearchParams: () => [new URLSearchParams(mockTabSearch)],
}));
vi.mock("../Tabs", () => ({
  CharacterTab: () => <div>Characters pane</div>,
  ChatTab: () => <div>Chat pane</div>,
  MyNotesTab: () => <div>My notes pane</div>,
  NotesTab: () => <div>Notes pane</div>,
  TracksTab: () => <div>Tracks pane</div>,
  WorldTab: () => <div>World pane</div>,
}));
vi.mock("components/features/worlds/NPCSection", () => ({
  NPCSection: () => null,
}));
vi.mock("components/features/worlds/Lore", () => ({
  LoreSection: () => null,
}));
vi.mock("components/features/worlds/Locations", () => ({
  LocationsSection: () => null,
}));

import { CampaignContent } from "../CampaignContent";

const theme = createTheme();

(
  globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

function mockViewport(width: number) {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    configurable: true,
    value: (query: string) => {
      const minWidth = query.match(/min-width:\s*([\d.]+)px/);
      const maxWidth = query.match(/max-width:\s*([\d.]+)px/);
      let matches = true;
      if (minWidth) {
        matches = width >= parseFloat(minWidth[1]);
      } else if (maxWidth) {
        matches = width <= parseFloat(maxWidth[1]);
      }
      return {
        matches,
        media: query,
        addEventListener: () => {},
        removeEventListener: () => {},
        addListener: () => {},
        removeListener: () => {},
        dispatchEvent: () => false,
      };
    },
  });
}

describe("CampaignContent navigation (ticket #122)", () => {
  let root: Root | undefined;
  let container: HTMLDivElement | undefined;

  beforeEach(() => {
    mockViewport(1400);
    mockTabSearch = "";
  });

  afterEach(() => {
    act(() => root?.unmount());
    container?.remove();
    vi.clearAllMocks();
  });

  function render() {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => {
      root?.render(
        <ThemeProvider theme={theme}>
          <CampaignContent openInviteDialog={() => {}} />
        </ThemeProvider>
      );
    });
    return container;
  }

  function tabNames(view: HTMLDivElement) {
    return Array.from(view.querySelectorAll('[role="tab"]')).map(
      (tab) => tab.textContent ?? ""
    );
  }

  it("labels the Notes screen My notes (spec #9)", () => {
    const view = render();

    const names = tabNames(view);
    expect(names).toContain("My notes");
    expect(names).not.toContain("Notes");
  });

  it("renders My notes in the Notes screen", () => {
    mockTabSearch = "?tab=notes";
    const view = render();

    expect(view.textContent).toContain("My notes pane");
    expect(view.textContent).not.toContain("Notes pane");
  });

  it("keeps phones on chat, where the bottom navigation lives", () => {
    mockViewport(390);
    mockTabSearch = "?tab=tracks";
    const view = render();

    expect(view.textContent).toContain("Chat pane");
    expect(view.textContent).not.toContain("Tracks pane");
  });
});

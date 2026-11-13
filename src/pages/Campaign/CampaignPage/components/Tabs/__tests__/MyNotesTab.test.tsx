/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, Root } from "react-dom/client";
import { ThemeProvider, createTheme } from "@mui/material";
import { NoteSource } from "stores/notes/notes.slice.type";

const state = {
  auth: { uid: "player-1" },
  notes: {
    notes: {
      [NoteSource.Campaign]: [
        {
          noteId: "mine-shared",
          title: "My shared plan",
          order: 0,
          shared: true,
          authorId: "player-1",
        },
        {
          noteId: "theirs-shared",
          title: "Their shared plan",
          order: 1,
          shared: true,
          authorId: "player-2",
        },
      ],
      [NoteSource.Character]: [
        {
          noteId: "mine-private",
          title: "My private thought",
          order: 0,
          shared: false,
        },
        {
          noteId: "mine-char-shared",
          title: "My shared backstory",
          order: 1,
          shared: true,
        },
      ],
    },
    openNote: undefined,
    openNoteContent: undefined,
    setOpenNoteId: vi.fn(),
    addNote: vi.fn(),
    temporarilyReorderNotes: vi.fn(),
    updateNoteOrder: vi.fn(),
    updateNote: vi.fn(),
    removeNote: vi.fn(),
    updateNoteShared: vi.fn(),
  },
  characters: {
    currentCharacter: {
      currentCharacterId: "char-1",
      currentCharacter: { uid: "player-1" },
    },
  },
  campaigns: {
    currentCampaign: {
      currentCampaignId: "campaign-1",
      currentCampaign: { gmIds: [], type: "coop" },
    },
  },
  worlds: {
    currentWorld: { currentWorld: undefined },
  },
};

vi.mock("stores/store", () => ({
  useStore: (selector: (store: typeof state) => unknown) => selector(state),
}));

import { MyNotesTab } from "../MyNotesTab";

const theme = createTheme();

(
  globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

describe("MyNotesTab", () => {
  let root: Root | undefined;
  let container: HTMLDivElement | undefined;

  beforeEach(() => {
    // NoteSidebarSection renders its rows inside a Droppable that waits a
    // frame (StrictModeDroppable). Fire it synchronously so the real list
    // renders headlessly.
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      callback(0);
      return 0;
    });
    vi.stubGlobal("cancelAnimationFrame", () => {});
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
          <MyNotesTab />
        </ThemeProvider>
      );
    });
    return container;
  }

  it("shows only my notes, private and shared", () => {
    const view = render();

    expect(view.textContent).toContain("My private thought");
    expect(view.textContent).toContain("My shared backstory");
    expect(view.textContent).toContain("My shared plan");
    expect(view.textContent).not.toContain("Their shared plan");
  });

  it("hides character notes when the open character is not mine", () => {
    (
      state.characters.currentCharacter as { currentCharacter: { uid: string } }
    ).currentCharacter = { uid: "player-2" };
    try {
      const view = render();

      expect(view.textContent).not.toContain("My private thought");
      expect(view.textContent).not.toContain("My shared backstory");
      // My authored campaign note still shows.
      expect(view.textContent).toContain("My shared plan");
    } finally {
      (
        state.characters.currentCharacter as {
          currentCharacter: { uid: string };
        }
      ).currentCharacter = { uid: "player-1" };
    }
  });

  it("never shows the shared roll log", () => {
    const view = render();

    expect(view.textContent).not.toContain("Roll Log");
  });
});

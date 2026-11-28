/** @vitest-environment jsdom */
import { act, useEffect, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

const captured = vi.hoisted(() => ({
  calls: [] as Array<{ campaignId?: string; isGM: boolean }>,
}));

vi.mock("api-calls/notes/listenToNotes", () => ({
  listenToNotes: (
    campaignId: string | undefined,
    _characterId: string | undefined,
    _onNotes: () => void,
    _onError: () => void,
    isGM: boolean
  ) => {
    captured.calls.push({ campaignId, isGM });
    return () => {};
  },
}));
vi.mock("api-calls/notes/listenToNoteContent", () => ({
  listenToNoteContent: () => () => {},
}));

const state = {
  auth: { uid: "gm-1" },
  campaigns: {
    currentCampaign: {
      currentCampaignId: "campaign-1" as string | undefined,
      currentCampaign: { gmIds: [] as string[] },
    },
  },
  characters: { currentCharacter: { currentCharacterId: undefined as string | undefined } },
  notes: {
    openNote: undefined as unknown,
    // Emulate notes.slice: it derives isGM from the same state.
    subscribe: (
      campaignId: string | undefined,
      characterId: string | undefined
    ) =>
      listenToNotes(
        campaignId,
        characterId,
        () => {},
        () => {},
        state.campaigns.currentCampaign.currentCampaign.gmIds.includes(
          state.auth.uid
        )
      ),
    subscribeToNoteContent: () => () => {},
  },
};

vi.mock("stores/store", () => ({
  useStore: (selector: (store: typeof state) => unknown) => selector(state),
}));

import { listenToNotes } from "api-calls/notes/listenToNotes";
import { useListenToNotes } from "./useListenToNotes";

let rerender: () => void = () => {};

function Consumer() {
  const [, setVersion] = useState(0);
  rerender = () => setVersion((version) => version + 1);
  useListenToNotes();
  return null;
}

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("useListenToNotes GM reactivity", () => {
  let root: Root | undefined;
  let container: HTMLDivElement | undefined;

  afterEach(() => {
    act(() => root?.unmount());
    container?.remove();
    root = undefined;
    container = undefined;
    captured.calls.splice(0);
    state.campaigns.currentCampaign.currentCampaign.gmIds = [];
  });

  it("re-subscribes with the GM topic as soon as the roster arrives", () => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => root?.render(<Consumer />));

    // campaignId is set before the roster loads: shared-only at first.
    expect(captured.calls.at(-1)).toEqual({
      campaignId: "campaign-1",
      isGM: false,
    });

    state.campaigns.currentCampaign.currentCampaign.gmIds = ["gm-1"];
    act(() => rerender());

    // No reconcile tick needed: the roster change re-runs the subscription.
    expect(captured.calls.at(-1)).toEqual({
      campaignId: "campaign-1",
      isGM: true,
    });
  });
});

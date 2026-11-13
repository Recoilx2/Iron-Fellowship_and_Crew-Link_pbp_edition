/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";

import { useStore } from "stores/store";
import type { CharacterDocument } from "api-calls/character/_character.type";
import { AddCharacterDialog } from "./AddCharacterDialog";

(
  globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

function makeCharacter(
  overrides: Partial<CharacterDocument> & { uid: string; name: string }
): CharacterDocument {
  return {
    stats: {},
    momentum: 2,
    campaignId: null,
    ...overrides,
  };
}

describe("AddCharacterDialog one character per player", () => {
  let root: Root | undefined;
  let container: HTMLDivElement | undefined;
  const originalAddCharacter = useStore.getState().campaigns.currentCampaign
    .addCharacter;

  afterEach(() => {
    act(() => root?.unmount());
    container?.remove();
    root = undefined;
    container = undefined;
    useStore.setState((store) => {
      store.characters.characterMap = {};
      store.characters.loading = false;
      store.campaigns.currentCampaign.addCharacter = originalAddCharacter;
    });
  });

  function renderDialog(campaignId: string): {
    addCharacter: ReturnType<typeof vi.fn>;
    handleClose: ReturnType<typeof vi.fn>;
  } {
    const addCharacter = vi.fn().mockResolvedValue(undefined);
    const handleClose = vi.fn();
    useStore.setState((store) => {
      store.campaigns.currentCampaign.addCharacter =
        addCharacter as unknown as typeof originalAddCharacter;
    });
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => {
      root?.render(
        <MemoryRouter>
          <AddCharacterDialog
            open
            handleClose={handleClose}
            campaignId={campaignId}
          />
        </MemoryRouter>
      );
    });
    return { addCharacter, handleClose };
  }

  function buttons(): HTMLButtonElement[] {
    return Array.from(document.body.querySelectorAll("button"));
  }

  function buttonFor(name: string): HTMLButtonElement | undefined {
    return buttons().find((button) =>
      button.closest("li")?.textContent?.includes(name)
    );
  }

  it("offers a swap, not a second add, when the player already has one here", async () => {
    useStore.setState((store) => {
      store.characters.loading = false;
      store.characters.characterMap = {
        "current-1": makeCharacter({
          uid: "user-A",
          name: "Ash",
          campaignId: "camp-1",
        }),
        "new-1": makeCharacter({ uid: "user-A", name: "Birch" }),
      };
    });

    const { addCharacter } = renderDialog("camp-1");

    // The dialog names the character already in this campaign.
    expect(document.body.textContent).toMatch(/Ash/);
    const currentButton = buttonFor("Ash");
    expect(currentButton?.textContent).toBe("Current");
    expect(currentButton?.disabled).toBe(true);

    // The other character is offered as a swap, not a second add.
    const swapButton = buttonFor("Birch");
    expect(swapButton?.textContent).toBe("Swap");
    expect(swapButton?.disabled).toBe(false);
    expect(
      buttons().some((button) => button.textContent === "Select")
    ).toBe(false);

    await act(async () => {
      swapButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(addCharacter).toHaveBeenCalledWith("new-1");
  });

  it("offers a plain select when the player has no character here yet", () => {
    useStore.setState((store) => {
      store.characters.loading = false;
      store.characters.characterMap = {
        "new-1": makeCharacter({ uid: "user-A", name: "Birch" }),
      };
    });

    renderDialog("camp-1");

    expect(buttonFor("Birch")?.textContent).toBe("Select");
    expect(
      buttons().some((button) => button.textContent === "Swap")
    ).toBe(false);
  });

  it("keeps characters playing in other campaigns unavailable", () => {
    useStore.setState((store) => {
      store.characters.loading = false;
      store.characters.characterMap = {
        "away-1": makeCharacter({
          uid: "user-A",
          name: "Ash",
          campaignId: "other-camp",
        }),
        "new-1": makeCharacter({ uid: "user-A", name: "Birch" }),
      };
    });

    renderDialog("camp-1");

    expect(buttonFor("Ash")?.disabled).toBe(true);
    expect(buttonFor("Birch")?.textContent).toBe("Select");
  });
});

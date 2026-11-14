/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, Root } from "react-dom/client";

import { LocationCard } from "components/features/worlds/Locations/LocationCard";
import { NPCCard } from "components/features/worlds/NPCSection/NPCCard";
import { LoreCard } from "components/features/worlds/Lore/LoreCard";

(
  globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

describe("world entry cards visibility eye", () => {
  let root: Root | undefined;
  let container: HTMLDivElement | undefined;

  afterEach(() => {
    act(() => root?.unmount());
    container?.remove();
    vi.clearAllMocks();
  });

  function renderCards(props: {
    sharedWithPlayers: boolean;
    showVisibilityToggle: boolean;
    onToggle: () => void;
  }) {
    const { sharedWithPlayers, showVisibilityToggle, onToggle } = props;
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => {
      root?.render(
        <>
          <LocationCard
            location={{ name: "Haven", sharedWithPlayers, updatedDate: new Date(1), createdDate: new Date(1) }}
            onClick={() => {}}
            showHiddenTag
            showVisibilityToggle={showVisibilityToggle}
            onVisibilityToggle={onToggle}
          />
          <NPCCard
            npc={{
              name: "Rival",
              sharedWithPlayers,
              updatedDate: new Date(1),
              createdDate: new Date(1),
            }}
            locations={{}}
            openNPC={() => {}}
            showHiddenTag
            showVisibilityToggle={showVisibilityToggle}
            onVisibilityToggle={onToggle}
          />
          <LoreCard
            lore={{
              name: "Signal",
              sharedWithPlayers,
              updatedDate: new Date(1),
              createdDate: new Date(1),
            }}
            openLore={() => {}}
            showHiddenTag
            showVisibilityToggle={showVisibilityToggle}
            onVisibilityToggle={onToggle}
          />
        </>
      );
    });
    return container;
  }

  it("GM toggling the eye flips visibility and the hidden tag", () => {
    let sharedWithPlayers = false;
    const onToggle = vi.fn(() => {
      sharedWithPlayers = !sharedWithPlayers;
    });
    const renderGM = () =>
      renderCards({ sharedWithPlayers, showVisibilityToggle: true, onToggle });

    let view = renderGM();

    // Hidden entries show the eye-off button and the hidden tag on each card.
    let eyeButtons = view.querySelectorAll('button[aria-label="Share with players"]');
    expect(eyeButtons).toHaveLength(3);
    expect(hiddenTagCount(view)).toBe(3);

    act(() => {
      eyeButtons.forEach((button) =>
        (button as HTMLButtonElement).click()
      );
    });
    expect(onToggle).toHaveBeenCalledTimes(3);

    // Re-render as if the store update landed: shared entries show the
    // hide button and no hidden tag.
    act(() => root?.unmount());
    view = renderCards({ sharedWithPlayers, showVisibilityToggle: true, onToggle });

    eyeButtons = view.querySelectorAll('button[aria-label="Hide from players"]');
    expect(eyeButtons).toHaveLength(3);
    expect(hiddenTagCount(view)).toBe(0);
  });

  // The hidden tag is the VisibilityOff svg rendered directly in the card
  // (the eye toggle renders its svg inside an aria-labeled button, and the
  // whole card body sits in a CardActionArea button with no aria-label).
  function hiddenTagCount(view: ParentNode): number {
    return Array.from(view.querySelectorAll("svg")).filter(
      (svg) => !svg.closest("button[aria-label]")
    ).length;
  }

  it("a player sees no eye button", () => {
    const view = renderCards({
      sharedWithPlayers: true,
      showVisibilityToggle: false,
      onToggle: vi.fn(),
    });

    expect(
      view.querySelectorAll(
        'button[aria-label="Share with players"], button[aria-label="Hide from players"]'
      )
    ).toHaveLength(0);
  });
});

/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, Root } from "react-dom/client";
import { VisibilityToggleButton } from "../VisibilityToggleButton";

(
  globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

describe("VisibilityToggleButton", () => {
  let root: Root | undefined;
  let container: HTMLDivElement | undefined;

  afterEach(() => {
    act(() => root?.unmount());
    container?.remove();
    vi.clearAllMocks();
  });

  function render(sharedWithPlayers: boolean, onToggle: () => void) {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => {
      root?.render(
        <VisibilityToggleButton
          sharedWithPlayers={sharedWithPlayers}
          onToggle={onToggle}
        />
      );
    });
    return container;
  }

  it("offers to share a hidden entry with players", () => {
    const onToggle = vi.fn();
    const view = render(false, onToggle);

    const button = view.querySelector("button");
    expect(button?.getAttribute("aria-label")).toBe("Share with players");
    expect(button?.getAttribute("aria-pressed")).toBe("false");
  });

  it("offers to hide a shared entry from players and calls onToggle", () => {
    const onToggle = vi.fn();
    const view = render(true, onToggle);

    const button = view.querySelector("button");
    expect(button?.getAttribute("aria-label")).toBe("Hide from players");
    expect(button?.getAttribute("aria-pressed")).toBe("true");

    act(() => {
      button?.click();
    });
    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it("does not bubble the click to the card", () => {
    const onToggle = vi.fn();
    const onCardClick = vi.fn();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => {
      root?.render(
        <div onClick={onCardClick}>
          <VisibilityToggleButton
            sharedWithPlayers={false}
            onToggle={onToggle}
          />
        </div>
      );
    });

    act(() => {
      container?.querySelector("button")?.click();
    });
    expect(onToggle).toHaveBeenCalledTimes(1);
    expect(onCardClick).not.toHaveBeenCalled();
  });
});

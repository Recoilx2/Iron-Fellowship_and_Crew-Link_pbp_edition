/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { ThemeProvider, createTheme } from "@mui/material";

import { OutlineRevisionPreview } from "../OutlineRevisionPreview";

const theme = createTheme();

(
  globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

function renderPreview(props: {
  applied?: boolean;
  onApply?: () => void;
  onDiscard?: () => void;
  onUndo?: () => void;
}) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  const onApply = props.onApply ?? vi.fn();
  const onDiscard = props.onDiscard ?? vi.fn();
  const onUndo = props.onUndo ?? vi.fn();
  act(() => {
    root.render(
      <ThemeProvider theme={theme}>
        <OutlineRevisionPreview
          current={"Act one: the bell rings."}
          proposed={"Act one revised: the bell cracks."}
          applied={props.applied ?? false}
          applying={false}
          applyError={null}
          undoing={false}
          onApply={onApply}
          onDiscard={onDiscard}
          onUndo={onUndo}
        />
      </ThemeProvider>
    );
  });
  return { container, root, onApply, onDiscard, onUndo };
}

function buttonByLabel(container: HTMLElement, label: string) {
  const found = Array.from(container.querySelectorAll("button")).find(
    (entry) => entry.textContent?.includes(label)
  );
  if (!found) {
    throw new Error(`no button labelled ${label}`);
  }
  return found as HTMLButtonElement;
}

describe("OutlineRevisionPreview", () => {
  let roots: Root[] = [];
  let containers: HTMLElement[] = [];

  afterEach(() => {
    act(() => roots.forEach((root) => root.unmount()));
    containers.forEach((container) => container.remove());
    roots = [];
    containers = [];
  });

  function render(props: Parameters<typeof renderPreview>[0] = {}) {
    const rendered = renderPreview(props);
    roots.push(rendered.root);
    containers.push(rendered.container);
    return rendered;
  }

  it("shows the current and proposed outline side by side", () => {
    const { container } = render();
    expect(container.textContent).toContain("Current outline");
    expect(container.textContent).toContain("Proposed outline");
    expect(container.textContent).toContain("Act one: the bell rings.");
    expect(container.textContent).toContain("Act one revised: the bell cracks.");
  });

  it("apply needs confirmation before replacing the outline", () => {
    const onApply = vi.fn();
    const { container } = render({ onApply });

    // The first click only asks: nothing is replaced yet.
    act(() => {
      buttonByLabel(container, "Apply to outline").dispatchEvent(
        new MouseEvent("click", { bubbles: true })
      );
    });
    expect(onApply).not.toHaveBeenCalled();
    expect(container.textContent).toContain("Replace the outline");

    // Cancelling leaves the outline unchanged.
    act(() => {
      buttonByLabel(container, "Cancel").dispatchEvent(
        new MouseEvent("click", { bubbles: true })
      );
    });
    expect(onApply).not.toHaveBeenCalled();
    expect(container.textContent).not.toContain("Replace the outline?");

    // Confirming replaces it.
    act(() => {
      buttonByLabel(container, "Apply to outline").dispatchEvent(
        new MouseEvent("click", { bubbles: true })
      );
    });
    act(() => {
      buttonByLabel(container, "Confirm replace").dispatchEvent(
        new MouseEvent("click", { bubbles: true })
      );
    });
    expect(onApply).toHaveBeenCalledTimes(1);
  });

  it("discard leaves the outline unchanged", () => {
    const onApply = vi.fn();
    const onDiscard = vi.fn();
    const { container } = render({ onApply, onDiscard });

    act(() => {
      buttonByLabel(container, "Discard").dispatchEvent(
        new MouseEvent("click", { bubbles: true })
      );
    });

    expect(onDiscard).toHaveBeenCalledTimes(1);
    expect(onApply).not.toHaveBeenCalled();
  });

  it("undo restores the previous version after applying", () => {
    const onUndo = vi.fn();
    const onApply = vi.fn();
    const { container } = render({ applied: true, onUndo, onApply });

    expect(container.textContent).toContain("Applied");
    act(() => {
      buttonByLabel(container, "Undo").dispatchEvent(
        new MouseEvent("click", { bubbles: true })
      );
    });

    expect(onUndo).toHaveBeenCalledTimes(1);
    expect(onApply).not.toHaveBeenCalled();
  });
});

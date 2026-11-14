/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { ThemeProvider, createTheme } from "@mui/material";

vi.mock("api-calls/assistant/outlineVersions", () => ({
  applyOutlineRevision: vi.fn(),
  undoOutlineRevision: vi.fn(),
}));

import { OutlineRevision } from "../OutlineRevision";
import {
  applyOutlineRevision,
  undoOutlineRevision,
} from "api-calls/assistant/outlineVersions";

const theme = createTheme();

(
  globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

// Seam under test: the stateful revision. Apply replaces the outline and
// reports the new text to the parent (which moves its editor onto it);
// Undo restores and reports the restored text; failures stay local.
describe("OutlineRevision", () => {
  let root: Root | undefined;
  let container: HTMLDivElement | undefined;

  afterEach(() => {
    act(() => root?.unmount());
    container?.remove();
    root = undefined;
    container = undefined;
    vi.clearAllMocks();
  });

  function render(onReplaced: (text: string) => void = () => {}) {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => {
      root?.render(
        <ThemeProvider theme={theme}>
          <OutlineRevision
            campaignId={"campaign-1"}
            outlineId={"outline-1"}
            current={"Act one: the bell rings."}
            proposed={"Act one revised: the bell cracks."}
            onDiscard={() => {}}
            onReplaced={onReplaced}
          />
        </ThemeProvider>
      );
    });
    return container as HTMLDivElement;
  }

  function click(view: HTMLDivElement, label: string) {
    const button = Array.from(view.querySelectorAll("button")).find(
      (entry) => entry.textContent === label
    );
    if (!button) {
      throw new Error(`no button labelled ${label}`);
    }
    act(() => {
      button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
  }

  it("apply reports the proposed text after replacing", async () => {
    vi.mocked(applyOutlineRevision).mockResolvedValue("version-1");
    const onReplaced = vi.fn();
    const view = render(onReplaced);

    click(view, "Apply to outline");
    click(view, "Confirm replace");
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(applyOutlineRevision).toHaveBeenCalledWith({
      campaignId: "campaign-1",
      outlineId: "outline-1",
      currentText: "Act one: the bell rings.",
      proposedText: "Act one revised: the bell cracks.",
    });
    expect(onReplaced).toHaveBeenCalledWith(
      "Act one revised: the bell cracks."
    );
    expect(view.textContent).toContain("Applied");
  });

  it("undo reports the restored text", async () => {
    vi.mocked(applyOutlineRevision).mockResolvedValue("version-1");
    vi.mocked(undoOutlineRevision).mockResolvedValue("Act one restored.");
    const onReplaced = vi.fn();
    const view = render(onReplaced);

    click(view, "Apply to outline");
    click(view, "Confirm replace");
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(view.textContent).toContain("Applied");

    click(view, "Undo");
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(undoOutlineRevision).toHaveBeenCalledWith({
      campaignId: "campaign-1",
      outlineId: "outline-1",
    });
    expect(onReplaced).toHaveBeenCalledWith("Act one restored.");
  });

  it("a failed apply shows an error and reports nothing", async () => {
    vi.mocked(applyOutlineRevision).mockRejectedValue(new Error("denied"));
    const onReplaced = vi.fn();
    const view = render(onReplaced);

    click(view, "Apply to outline");
    click(view, "Confirm replace");
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(view.textContent).toContain("couldn't be replaced");
    expect(onReplaced).not.toHaveBeenCalled();
    expect(view.textContent).not.toContain("Applied");
  });
});

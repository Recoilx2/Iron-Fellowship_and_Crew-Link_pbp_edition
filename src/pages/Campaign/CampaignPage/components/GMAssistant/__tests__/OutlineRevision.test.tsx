/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { ThemeProvider, createTheme } from "@mui/material";

vi.mock("api-calls/assistant/outlineVersions", () => ({
  applyOutlineRevision: vi.fn(),
  undoOutlineRevision: vi.fn(),
}));

import { AssistantRequestError } from "api-calls/assistant/gmAssistantClient";
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
// Undo restores the previous text; failures stay local.
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

  function render() {
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

  it("apply replaces the outline and shows it applied", async () => {
    vi.mocked(applyOutlineRevision).mockResolvedValue("version-1");
    const view = render();

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
    expect(view.textContent).toContain("Applied");
  });

  it("undo restores the previous text", async () => {
    vi.mocked(applyOutlineRevision).mockResolvedValue("version-1");
    vi.mocked(undoOutlineRevision).mockResolvedValue("Act one restored.");
    const view = render();

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
    expect(view.textContent).not.toContain("Applied");
  });

  it("a failed apply shows an error and does not show applied", async () => {
    vi.mocked(applyOutlineRevision).mockRejectedValue(new Error("denied"));
    const view = render();

    click(view, "Apply to outline");
    click(view, "Confirm replace");
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(view.textContent).toContain("couldn't be replaced");
    expect(view.textContent).not.toContain("Applied");
  });

  it("keeps the server's reference on a failed apply", async () => {
    vi.mocked(applyOutlineRevision).mockRejectedValue(
      new AssistantRequestError("FORBIDDEN", "denied", { status: 403, ref: "SRV123" })
    );
    const view = render();

    click(view, "Apply to outline");
    click(view, "Confirm replace");
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(view.textContent).toContain("couldn't be replaced");
    expect(view.textContent).toContain("(ref: SRV123)");
    expect(view.textContent).not.toContain("denied");
  });

  it("a failed apply shows a minted reference and no raw error text", async () => {
    vi.mocked(applyOutlineRevision).mockRejectedValue(new Error("denied"));
    const view = render();

    click(view, "Apply to outline");
    click(view, "Confirm replace");
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(view.textContent).toMatch(/\(ref: [A-Z0-9]{6}\)/);
    expect(view.textContent).not.toContain("denied");
  });

  it("a failed undo shows a reference", async () => {
    vi.mocked(applyOutlineRevision).mockResolvedValue("version-1");
    vi.mocked(undoOutlineRevision).mockRejectedValue(new Error("policy"));
    const view = render();

    click(view, "Apply to outline");
    click(view, "Confirm replace");
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    click(view, "Undo");
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(view.textContent).toContain("couldn't be undone");
    expect(view.textContent).toMatch(/\(ref: [A-Z0-9]{6}\)/);
  });
});

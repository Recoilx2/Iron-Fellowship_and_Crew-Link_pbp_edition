/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { ThemeProvider, createTheme } from "@mui/material";

vi.mock("api-calls/notes/campaignOutline", () => ({
  getOrCreateCampaignOutline: vi.fn(),
}));
vi.mock("api-calls/notes/listenToNoteContent", () => ({
  listenToNoteContent: vi.fn(),
}));
vi.mock("api-calls/notes/updateNote", () => ({
  updateNote: vi.fn(),
}));
vi.mock("components/shared/RichTextEditor/RtcRichTextEditor", () => ({
  // Stand-in for the shared note editor: the Outline tab reuses the same
  // editor as other notes, so the stub only needs its wiring (document
  // name, initial bytes, title saves).
  RtcRichTextEditor: (props: {
    id: string;
    documentName: string;
    initialValue?: Uint8Array;
    showTitle?: boolean;
    serverPersisted?: boolean;
    onSave?: (
      id: string,
      notes: Uint8Array,
      isBeaconRequest?: boolean,
      title?: string
    ) => Promise<unknown>;
  }) => (
    <div
      data-document-name={props.documentName}
      data-has-bytes={props.initialValue ? "yes" : "no"}
    >
      <span>Note text</span>
      <button
        aria-label={"Save outline"}
        onClick={() =>
          props.onSave?.(props.id, new Uint8Array([1, 2, 3]), false, "Planned arc")
        }
      >
        Save
      </button>
    </div>
  ),
}));

import { OutlineTab } from "../OutlineTab";
import { getOrCreateCampaignOutline } from "api-calls/notes/campaignOutline";
import { listenToNoteContent } from "api-calls/notes/listenToNoteContent";
import { updateNote } from "api-calls/notes/updateNote";

const theme = createTheme();

(
  globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

async function flush() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

// Seam under test: the assistant panel's Outline tab. It opens (creating)
// the campaign's one GM-only outline, edits it with the same editor as
// other notes against the note server's document, and saves the title
// through the notes data layer. Players never reach it: they get no
// assistant at all, and the access rules hide the row.
describe("OutlineTab", () => {
  let root: Root | undefined;
  let container: HTMLDivElement | undefined;

  beforeEach(() => {
    vi.mocked(getOrCreateCampaignOutline).mockResolvedValue("outline-1");
    vi.mocked(listenToNoteContent).mockImplementation(
      (_campaignId, _characterId, _noteId, onContent) => {
        onContent(new Uint8Array([9]));
        return () => {};
      }
    );
    vi.mocked(updateNote).mockResolvedValue(undefined);
  });

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
          <OutlineTab campaignId={"campaign-1"} />
        </ThemeProvider>
      );
    });
    return container as HTMLDivElement;
  }

  it("creates the outline on open and edits the note server document", async () => {
    const view = render();
    await flush();

    expect(getOrCreateCampaignOutline).toHaveBeenCalledWith({
      campaignId: "campaign-1",
    });
    expect(view.textContent).toContain("GM-only. Never shared with players.");
    expect(
      view.querySelector('[data-document-name="campaign-notes/outline-1"]')
    ).not.toBeNull();
  });

  it("saves the title through the notes data layer", async () => {
    const view = render();
    await flush();

    const save = Array.from(view.querySelectorAll("button")).find(
      (entry) => entry.getAttribute("aria-label") === "Save outline"
    );
    if (!save) {
      throw new Error("no outline save button");
    }
    act(() => {
      save.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await flush();

    expect(updateNote).toHaveBeenCalledWith(
      expect.objectContaining({
        campaignId: "campaign-1",
        noteId: "outline-1",
        title: "Planned arc",
      })
    );
  });

  it("retries when opening the outline fails", async () => {
    vi.mocked(getOrCreateCampaignOutline).mockRejectedValueOnce(
      new Error("no access")
    );
    const view = render();
    await flush();

    expect(view.textContent).toContain("couldn't open the outline");
    const retry = Array.from(view.querySelectorAll("button")).find((entry) =>
      entry.textContent?.includes("Retry")
    );
    if (!retry) {
      throw new Error("no retry button");
    }
    act(() => {
      retry.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await flush();

    expect(vi.mocked(getOrCreateCampaignOutline).mock.calls.length).toBe(2);
  });
});

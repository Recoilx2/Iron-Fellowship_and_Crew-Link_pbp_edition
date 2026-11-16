/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { ThemeProvider, createTheme } from "@mui/material";
import * as Y from "yjs";

vi.mock("api-calls/notes/campaignOutline", () => ({
  getOrCreateCampaignOutline: vi.fn(),
}));
vi.mock("api-calls/notes/listenToNoteContent", () => ({
  listenToNoteContent: vi.fn(),
}));
vi.mock("api-calls/notes/updateNote", () => ({
  updateNote: vi.fn(),
}));
vi.mock("api-calls/assistant/listenToOutlineVersions", () => ({
  listenToOutlineVersions: vi.fn(),
}));
vi.mock("api-calls/assistant/outlineVersions", () => ({
  applyOutlineRevision: vi.fn(),
  fetchOutlineContentBytes: vi.fn(),
  undoOutlineRevision: vi.fn(),
}));
vi.mock("api-calls/assistant/gmAssistantClient", () => ({
  // Faithful copy of the marker extraction: revision replies carry the
  // proposal between markers, ordinary replies carry none.
  extractOutlineProposal: (reply: string) => {
    const begin = "<<<OUTLINE-BEGIN>>>";
    const end = "<<<OUTLINE-END>>>";
    const start = reply.indexOf(begin);
    const stop = reply.lastIndexOf(end);
    if (start < 0 || stop < 0 || stop <= start + begin.length) return null;
    const proposed = reply.slice(start + begin.length, stop).trim();
    return proposed.length > 0 ? proposed : null;
  },
  streamAssistantChat: vi.fn(),
  AssistantRequestError: class extends Error {
    code: string;
    status: number;
    ref: string | null;
    constructor(
      code: string,
      message: string,
      options: { status: number; ref?: string | null }
    ) {
      super(message);
      this.code = code;
      this.status = options.status;
      this.ref = options.ref ?? null;
    }
  },
}));
vi.mock("api-calls/assistant/createConversation", () => ({
  createConversation: vi.fn(),
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
import { listenToOutlineVersions } from "api-calls/assistant/listenToOutlineVersions";
import {
  applyOutlineRevision,
  fetchOutlineContentBytes,
  undoOutlineRevision,
} from "api-calls/assistant/outlineVersions";
import { createConversation } from "api-calls/assistant/createConversation";
import {
  AssistantRequestError,
  streamAssistantChat,
} from "api-calls/assistant/gmAssistantClient";
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
    vi.mocked(listenToOutlineVersions).mockImplementation(
      (_campaignId, handlers) => {
        handlers.onVersions([]);
        handlers.onLoaded();
        return () => {};
      }
    );
    vi.mocked(updateNote).mockResolvedValue(undefined);
    vi.mocked(createConversation).mockResolvedValue("conversation-1");
    vi.mocked(streamAssistantChat).mockResolvedValue({
      text: "<<<OUTLINE-BEGIN>>>\nAct one revised.\n<<<OUTLINE-END>>>",
      aborted: false,
    });
    const currentDoc = new Y.Doc();
    currentDoc.getText("body").insert(0, "Act one: the bell rings.");
    vi.mocked(fetchOutlineContentBytes).mockResolvedValue(
      Y.encodeStateAsUpdate(currentDoc)
    );
    vi.mocked(applyOutlineRevision).mockResolvedValue("version-1");
    vi.mocked(undoOutlineRevision).mockResolvedValue("Act one: the bell rings.");
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

  it("requests a revision in outline-revision mode and previews it", async () => {
    const view = render();
    await flush();

    act(() => {
      view
        .querySelector('button[aria-label="Revise outline"]')
        ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    const field = view.querySelector(
      'textarea, input[aria-label="Revision instruction"]'
    ) as HTMLTextAreaElement | null;
    if (!field) {
      throw new Error("no revision instruction field");
    }
    const setter = Object.getOwnPropertyDescriptor(
      HTMLTextAreaElement.prototype,
      "value"
    )?.set;
    act(() => {
      setter?.call(field, "Add a betrayal in act two.");
      field.dispatchEvent(new Event("input", { bubbles: true }));
    });
    act(() => {
      view
        .querySelector('button[aria-label="Request outline revision"]')
        ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await flush();

    // The request goes in the dedicated revision mode, never guessed.
    expect(createConversation).toHaveBeenCalledWith({
      campaignId: "campaign-1",
    });
    expect(streamAssistantChat).toHaveBeenCalledWith(
      expect.objectContaining({
        conversationId: "conversation-1",
        message: "Add a betrayal in act two.",
        mode: "outline-revision",
      })
    );
    // The reply previews current and proposed side by side; the
    // current side is read fresh from the note server.
    expect(view.textContent).toContain("Current outline");
    expect(view.textContent).toContain("Proposed outline");
    expect(view.textContent).toContain("Act one: the bell rings.");
    expect(view.textContent).toContain("Act one revised.");

    // Applying from the preview keeps the replaced text and replaces the
    // outline, behind the same confirmation as every other preview.
    act(() => {
      Array.from(view.querySelectorAll("button"))
        .find((entry) => entry.textContent === "Apply to outline")
        ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(applyOutlineRevision).not.toHaveBeenCalled();
    act(() => {
      Array.from(view.querySelectorAll("button"))
        .find((entry) => entry.textContent === "Confirm replace")
        ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await flush();

    expect(applyOutlineRevision).toHaveBeenCalledWith({
      campaignId: "campaign-1",
      outlineId: "outline-1",
      currentText: "Act one: the bell rings.",
      proposedText: "Act one revised.",
    });
  });

  it("shows an error when the reply carries no marked revision", async () => {
    vi.mocked(streamAssistantChat).mockResolvedValueOnce({
      text: "Just some chat with no proposal.",
      aborted: false,
    });
    const view = render();
    await flush();

    act(() => {
      view
        .querySelector('button[aria-label="Revise outline"]')
        ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    const field = view.querySelector("textarea");
    if (!field) {
      throw new Error("no revision instruction field");
    }
    const setter = Object.getOwnPropertyDescriptor(
      HTMLTextAreaElement.prototype,
      "value"
    )?.set;
    act(() => {
      setter?.call(field, "Tighten act one.");
      field.dispatchEvent(new Event("input", { bubbles: true }));
    });
    act(() => {
      view
        .querySelector('button[aria-label="Request outline revision"]')
        ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await flush();

    expect(view.textContent).toContain("didn't return a marked revision");
    expect(view.textContent).not.toContain("Proposed outline");
  });

  function requestRevisionFrom(view: HTMLDivElement) {
    act(() => {
      view
        .querySelector('button[aria-label="Revise outline"]')
        ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    const field = view.querySelector("textarea");
    if (!field) {
      throw new Error("no revision instruction field");
    }
    const setter = Object.getOwnPropertyDescriptor(
      HTMLTextAreaElement.prototype,
      "value"
    )?.set;
    act(() => {
      setter?.call(field, "Tighten act one.");
      field.dispatchEvent(new Event("input", { bubbles: true }));
    });
    act(() => {
      view
        .querySelector('button[aria-label="Request outline revision"]')
        ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
  }

  it("shows the server's reference when a revision request fails", async () => {
    vi.mocked(streamAssistantChat).mockRejectedValueOnce(
      new AssistantRequestError("UPSTREAM_ERROR", "The assistant request failed.", {
        status: 502,
        ref: "SRV123",
      })
    );
    const view = render();
    await flush();
    requestRevisionFrom(view);
    await flush();

    expect(view.textContent).toContain("The revision request failed. Try again.");
    expect(view.textContent).toContain("(ref: SRV123)");
  });

  it("shows a generic message with a minted reference for other revision failures", async () => {
    vi.mocked(streamAssistantChat).mockRejectedValueOnce(
      new TypeError("Failed to fetch")
    );
    const view = render();
    await flush();
    requestRevisionFrom(view);
    await flush();

    expect(view.textContent).toContain("The revision request failed. Try again.");
    expect(view.textContent).toMatch(/\(ref: [A-Z0-9]{6}\)/);
    expect(view.textContent).not.toContain("Failed to fetch");
  });

  it("gives the marked-revision error a reference too", async () => {
    vi.mocked(streamAssistantChat).mockResolvedValueOnce({
      text: "Just some chat with no proposal.",
      aborted: false,
    });
    const view = render();
    await flush();
    requestRevisionFrom(view);
    await flush();

    expect(view.textContent).toContain("didn't return a marked revision");
    expect(view.textContent).toMatch(/\(ref: [A-Z0-9]{6}\)/);
  });

  it("shows a reference when the undo fails", async () => {
    vi.mocked(listenToOutlineVersions).mockImplementation(
      (_campaignId, handlers) => {
        handlers.onVersions([
          {
            id: "version-1",
            campaignId: "campaign-1",
            content: "Act one: the bell rings.",
            createdBy: "gm-1",
            createdAt: "2026-11-14T00:00:00Z",
          },
        ]);
        handlers.onLoaded();
        return () => {};
      }
    );
    vi.mocked(undoOutlineRevision).mockRejectedValueOnce(
      new Error("row violates policy")
    );
    const view = render();
    await flush();
    act(() => {
      view
        .querySelector('button[aria-label="Undo outline revision"]')
        ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await flush();

    expect(view.textContent).toContain("couldn't be undone");
    expect(view.textContent).toMatch(/\(ref: [A-Z0-9]{6}\)/);
    expect(view.textContent).not.toContain("row violates policy");
  });

  it("shows a reference when opening the outline fails", async () => {
    vi.mocked(getOrCreateCampaignOutline).mockRejectedValueOnce(
      new Error("no access")
    );
    const view = render();
    await flush();

    expect(view.textContent).toContain("couldn't open the outline");
    expect(view.textContent).toMatch(/\(ref: [A-Z0-9]{6}\)/);
  });

  it("offers undo while a version is kept and undoes the newest one on click", async () => {
    vi.mocked(listenToOutlineVersions).mockImplementation(
      (_campaignId, handlers) => {
        // Deliberately not newest first: the tab picks by time.
        handlers.onVersions([
          {
            id: "version-1",
            campaignId: "campaign-1",
            content: "Act one: the bell rings.",
            createdBy: "gm-1",
            createdAt: "2026-11-14T00:00:00Z",
          },
          {
            id: "version-2",
            campaignId: "campaign-1",
            content: "Act one: the bell cracks.",
            createdBy: "gm-1",
            createdAt: "2026-11-14T00:05:00Z",
          },
        ]);
        handlers.onLoaded();
        return () => {};
      }
    );
    const view = render();
    await flush();

    const undo = view.querySelector(
      'button[aria-label="Undo outline revision"]'
    ) as HTMLButtonElement | null;
    if (!undo) {
      throw new Error("no undo button");
    }
    expect(undo.disabled).toBe(false);
    act(() => {
      undo.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await flush();

    expect(undoOutlineRevision).toHaveBeenCalledWith({
      campaignId: "campaign-1",
      outlineId: "outline-1",
      versionId: "version-2",
    });
  });

  it("disables undo when no version is kept", async () => {
    const view = render();
    await flush();

    const undo = view.querySelector(
      'button[aria-label="Undo outline revision"]'
    ) as HTMLButtonElement | null;
    if (!undo) {
      throw new Error("no undo button");
    }
    expect(undo.disabled).toBe(true);
  });
});

/** @vitest-environment jsdom */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { ThemeProvider, createTheme } from "@mui/material";

import type { AssistantContextChoice } from "api-calls/assistant/_assistant.type";
import type { AssistantContextSize } from "api-calls/assistant/gmAssistantClient";

vi.mock("api-calls/assistant/assistantContextOptions", () => ({
  fetchAssistantContextOptions: vi.fn(),
}));

import { fetchAssistantContextOptions } from "api-calls/assistant/assistantContextOptions";
import { ContextTab } from "../ContextTab";

const theme = createTheme();

(
  globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const choice: AssistantContextChoice = {
  includeOutline: true,
  lore: [{ id: "lore-1", includeGmParts: false }],
  npcs: [],
  locations: [],
  notes: ["note-1"],
  channels: [{ id: "ch-1", postCount: 5 }],
};

const size: AssistantContextSize = {
  items: [
    { key: "outline", label: "Campaign outline", chars: 400, tokens: 100 },
    { key: "lore:lore-1", label: "Lore: Old Vault", chars: 200, tokens: 50 },
    { key: "note:note-1", label: "Note: Session idea", chars: 80, tokens: 20 },
    { key: "channel:ch-1", label: "Channel: In-character (last 5)", chars: 120, tokens: 30 },
  ],
  totalChars: 800,
  totalTokens: 200,
  instructionChars: 200,
  instructionTokens: 50,
  unavailable: [],
};

// Seam under test: the Context tab checklist. World entries, notes and
// channels render grouped with per-item sizes; the eye toggle includes a
// GM-only part; each channel has a post-count field; chips show the
// conversation and instruction overhead; every change saves the choice.
describe("ContextTab", () => {
  let root: Root | undefined;
  let container: HTMLDivElement | undefined;

  beforeEach(() => {
    vi.mocked(fetchAssistantContextOptions).mockResolvedValue({
      worldId: "world-1",
      outlineAvailable: true,
      lore: [{ id: "lore-1", name: "Old Vault" }],
      npcs: [{ id: "npc-1", name: "Keeper" }],
      locations: [],
      notes: [{ id: "note-1", title: "Session idea" }],
      channels: [
        { id: "ch-1", name: "In-character", visibility: "public" },
        { id: "ch-2", name: "Planning", visibility: "private" },
      ],
    });
  });

  function cleanup() {
    act(() => root?.unmount());
    container?.remove();
    root = undefined;
    container = undefined;
  }

  async function render(onSave: (next: AssistantContextChoice) => void) {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => {
      root?.render(
        <ThemeProvider theme={theme}>
          <ContextTab
            campaignId="campaign-1"
            context={choice}
            size={size}
            conversationTokens={30}
            onSave={onSave}
          />
        </ThemeProvider>
      );
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    return container as HTMLDivElement;
  }

  it("groups options with per-item sizes and overhead chips", async () => {
    const view = await render(() => {});
    try {
      for (const heading of [
        "Campaign outline",
        "Lore",
        "NPCs",
        "Notes",
        "Recent posts",
      ]) {
        expect(view.textContent).toContain(heading);
      }
      expect(view.textContent).toContain("Old Vault");
      expect(view.textContent).toContain("Keeper");
      expect(view.textContent).toContain("Session idea");
      expect(view.textContent).toContain("In-character");
      expect(view.textContent).toContain("50");
      expect(view.textContent).toContain("Conversation");
      expect(view.textContent).toContain("30");
      expect(view.textContent).toContain("Instructions");
    } finally {
      cleanup();
    }
  });

  it("toggles an entry and saves the choice", async () => {
    const onSave = vi.fn();
    const view = await render(onSave);
    try {
      const keeper = view.querySelector(
        'input[aria-label="Include Keeper"]'
      ) as HTMLInputElement | null;
      if (!keeper) throw new Error("no Keeper checkbox");
      act(() => {
        keeper.click();
      });
      expect(onSave).toHaveBeenCalledWith({
        ...choice,
        npcs: [{ id: "npc-1", includeGmParts: false }],
      });
    } finally {
      cleanup();
    }
  });

  it("toggles a GM-only part with the eye and saves", async () => {
    const onSave = vi.fn();
    const view = await render(onSave);
    try {
      const eye = view.querySelector(
        'button[aria-label="Include GM-only part of Old Vault"]'
      ) as HTMLButtonElement | null;
      if (!eye) throw new Error("no eye toggle for Old Vault");
      act(() => {
        eye.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      });
      expect(onSave).toHaveBeenCalledWith({
        ...choice,
        lore: [{ id: "lore-1", includeGmParts: true }],
      });
    } finally {
      cleanup();
    }
  });

  it("changes a channel post count and saves", async () => {
    const onSave = vi.fn();
    const view = await render(onSave);
    try {
      const count = view.querySelector(
        'input[aria-label="Post count for In-character"]'
      ) as HTMLInputElement | null;
      if (!count) throw new Error("no post-count field");
      expect(count.value).toBe("5");
      const setter = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value"
      )?.set;
      act(() => {
        setter?.call(count, "10");
        count.dispatchEvent(new Event("input", { bubbles: true }));
      });
      expect(onSave).toHaveBeenCalledWith({
        ...choice,
        channels: [{ id: "ch-1", postCount: 10 }],
      });
    } finally {
      cleanup();
    }
  });
});

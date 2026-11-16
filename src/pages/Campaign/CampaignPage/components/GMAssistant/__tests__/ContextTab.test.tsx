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

vi.mock("api-calls/assistant/gmAssistantClient", async (importOriginal) => ({
  ...(await importOriginal<typeof import("api-calls/assistant/gmAssistantClient")>()),
  fetchAssistantContextSize: vi.fn(),
}));

import { fetchAssistantContextOptions } from "api-calls/assistant/assistantContextOptions";
import { fetchAssistantContextSize } from "api-calls/assistant/gmAssistantClient";
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
    vi.mocked(fetchAssistantContextSize).mockReset();
    vi.mocked(fetchAssistantContextSize).mockResolvedValue({
      items: [
        { key: "lore:lore-1", label: "Lore: Old Vault", chars: 8, tokens: 2 },
        { key: "npc:npc-1", label: "NPC: Keeper", chars: 280, tokens: 70 },
        { key: "note:note-1", label: "Note: Session idea", chars: 8, tokens: 2 },
        { key: "channel:ch-1", label: "Channel: In-character", chars: 8, tokens: 2 },
        { key: "channel:ch-2", label: "Channel: Planning", chars: 360, tokens: 90 },
      ],
      totalChars: 0,
      totalTokens: 0,
      instructionChars: 0,
      instructionTokens: 0,
      unavailable: [],
    });
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

  async function render(
    onSave: (next: AssistantContextChoice) => void,
    options?: { previewCache?: Map<string, Map<string, number>> }
  ) {
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
            previewCache={options?.previewCache}
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

  it("shows a reference, not raw error text, when listing the material fails", async () => {
    vi.mocked(fetchAssistantContextOptions).mockRejectedValue(
      new Error("relation does not exist")
    );
    const view = await render(() => {});

    expect(view.textContent).toContain("couldn't list the campaign material");
    expect(view.textContent).toMatch(/\(ref: [A-Z0-9]{6}\)/);
    expect(view.textContent).not.toContain("relation does not exist");
    cleanup();
  });

  it("shows a size beside every candidate before it is ticked, from one batched request", async () => {
    const view = await render(() => {});
    try {
      // Keeper (NPC) and Planning (channel) are not ticked in `choice`.
      const keeper = view.querySelector('input[aria-label="Include Keeper"]') as HTMLInputElement;
      const planning = view.querySelector('input[aria-label="Include Planning"]') as HTMLInputElement;
      expect(keeper.checked).toBe(false);
      expect(planning.checked).toBe(false);
      const rowText = (input: HTMLInputElement) =>
        input.closest("div[class*='MuiBox']")?.textContent ?? "";
      expect(rowText(keeper)).toContain("~70 tokens");
      expect(rowText(planning)).toContain("~90 tokens");
      // A ticked entry keeps the size of its saved choice.
      expect(view.textContent).toContain("~50 tokens");

      expect(fetchAssistantContextSize).toHaveBeenCalledTimes(1);
      expect(fetchAssistantContextSize).toHaveBeenCalledWith(
        "campaign-1",
        expect.objectContaining({
          preview: {
            includeOutline: true,
            lore: [{ id: "lore-1", includeGmParts: false }],
            npcs: [{ id: "npc-1", includeGmParts: false }],
            locations: [],
            notes: ["note-1"],
            channels: [
              { id: "ch-1", postCount: 5 },
              { id: "ch-2", postCount: 5 },
            ],
          },
        })
      );
    } finally {
      cleanup();
    }
  });

  it("shows a dash, never raw error text, when sizing the candidates fails", async () => {
    vi.mocked(fetchAssistantContextSize).mockRejectedValue(
      new Error("socket hang up at 10.0.0.5")
    );
    const view = await render(() => {});
    try {
      const keeper = view.querySelector('input[aria-label="Include Keeper"]') as HTMLInputElement;
      const row = keeper.closest("div[class*='MuiBox']")?.textContent ?? "";
      expect(row).toContain("–");
      expect(row).not.toContain("tokens");
      expect(
        keeper.closest("div[class*='MuiBox']")?.querySelector('[aria-label="Size unavailable"]')
      ).not.toBeNull();
      expect(view.textContent).not.toContain("socket hang up");
      // The checklist still works.
      expect(view.textContent).toContain("Keeper");
    } finally {
      cleanup();
    }
  });

  // Under load the three sequential slice requests can outlive the default
  // 5 s test timeout (the #177 review asked for an explicit one here).
  it(
    "sizes more than 100 candidates of one kind in slices of at most 100",
    async () => {
      vi.mocked(fetchAssistantContextOptions).mockResolvedValue({
        worldId: "world-1",
        outlineAvailable: false,
        lore: Array.from({ length: 205 }, (_, i) => ({ id: `bulk-${i}`, name: `Entry ${i}` })),
        npcs: [],
        locations: [],
        notes: [],
        channels: [],
      });
      vi.mocked(fetchAssistantContextSize).mockImplementation(async (_id, options) => ({
        items: (options?.preview?.lore ?? []).map((ref) => ({
          key: `lore:${ref.id}`,
          label: ref.id,
          chars: 4,
          tokens: 7,
        })),
        totalChars: 0,
        totalTokens: 0,
        instructionChars: 0,
        instructionTokens: 0,
        unavailable: [],
      }));
      const view = await render(() => {});
      try {
        // Wait for the last slice, not a fixed sleep: under load the three
        // sequential requests can take a while (ticket #151).
        await vi.waitFor(
          () => {
            const boxes = Array.from(
              view.querySelectorAll('input[aria-label^="Include Entry "]')
            ).map((input) => input.closest("div[class*='MuiBox']")?.textContent ?? "");
            expect(boxes.filter((text) => !text.includes("~7 tokens"))).toEqual([]);
          },
          { timeout: 5000, interval: 10 }
        );
        const calls = vi.mocked(fetchAssistantContextSize).mock.calls;
        expect(calls.map(([, o]) => o?.preview?.lore.length)).toEqual([100, 100, 5]);
      } finally {
        cleanup();
      }
    },
    15_000
  );

  it("shows a dash only for the rows of a slice that failed", async () => {
    vi.mocked(fetchAssistantContextOptions).mockResolvedValue({
      worldId: "world-1",
      outlineAvailable: false,
      lore: Array.from({ length: 150 }, (_, i) => ({ id: `bulk-${i}`, name: `Entry ${i}` })),
      npcs: [],
      locations: [],
      notes: [],
      channels: [],
    });
    vi.mocked(fetchAssistantContextSize)
      .mockRejectedValueOnce(new Error("socket hang up on the first slice"))
      .mockImplementation(async (_id, options) => ({
        items: (options?.preview?.lore ?? []).map((ref) => ({
          key: `lore:${ref.id}`,
          label: ref.id,
          chars: 4,
          tokens: 7,
        })),
        totalChars: 0,
        totalTokens: 0,
        instructionChars: 0,
        instructionTokens: 0,
        unavailable: [],
      }));
    const view = await render(() => {});
    try {
      // Slice-two rows are the three-digit ids (bulk-100 and up); slice-one
      // rows are bulk-0 to bulk-99.
      const isSliceTwo = (label: string) => /^Include Entry 1[0-9][0-9]$/.test(label);
      const isSliceOne = (label: string) => /^Include Entry [0-9]?[0-9]$/.test(label);
      await vi.waitFor(
        () => {
          // The second slice answered: every bulk-1xx row shows its size.
          const boxes = Array.from(
            view.querySelectorAll('input[aria-label^="Include Entry "]')
          ).map((input) => ({
            label: input.getAttribute("aria-label") ?? "",
            text: input.closest("div[class*='MuiBox']")?.textContent ?? "",
          }));
          expect(boxes.filter((box) => isSliceTwo(box.label) && !box.text.includes("~7 tokens"))).toEqual([]);
        },
        { timeout: 5000, interval: 10 }
      );
      const boxes = Array.from(
        view.querySelectorAll('input[aria-label^="Include Entry "]')
      ).map((input) => ({
        label: input.getAttribute("aria-label") ?? "",
        text: input.closest("div[class*='MuiBox']")?.textContent ?? "",
      }));
      // The first slice failed: exactly its 100 rows show a dash.
      expect(boxes.filter((box) => isSliceOne(box.label) && box.text.includes("tokens"))).toEqual([]);
      expect(boxes.filter((box) => isSliceOne(box.label) && box.text.includes("–"))).toHaveLength(100);
      expect(view.textContent).not.toContain("socket hang up");
    } finally {
      cleanup();
    }
  });

  it("aborts the in-flight preview request when the tab closes", async () => {
    const signals: AbortSignal[] = [];
    vi.mocked(fetchAssistantContextSize).mockImplementation(
      async (_id, options) =>
        new Promise((_, reject) => {
          options?.signal?.addEventListener("abort", () =>
            reject(new DOMException("Aborted", "AbortError"))
          );
          signals.push(options?.signal as AbortSignal);
        })
    );
    const view = await render(() => {});
    expect(signals.length).toBeGreaterThan(0);
    cleanup();
    expect(signals.every((signal) => signal.aborted)).toBe(true);
    view.remove();
  });

  it("reuses a cached preview for the same candidates without requesting again", async () => {
    const previewCache = new Map<string, Map<string, number>>();
    await render(() => {}, { previewCache });
    try {
      expect(fetchAssistantContextSize).toHaveBeenCalledTimes(1);
    } finally {
      cleanup();
    }
    const view2 = await render(() => {}, { previewCache });
    try {
      // Same candidates, same session: no request at all, sizes shown.
      expect(fetchAssistantContextSize).toHaveBeenCalledTimes(1);
      const keeper = view2.querySelector('input[aria-label="Include Keeper"]') as HTMLInputElement;
      const row = keeper.closest("div[class*='MuiBox']")?.textContent ?? "";
      expect(row).toContain("~70 tokens");
    } finally {
      cleanup();
    }
  });
});

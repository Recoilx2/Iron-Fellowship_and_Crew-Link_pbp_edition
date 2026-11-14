/** @vitest-environment jsdom */
import { describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { ThemeProvider, createTheme } from "@mui/material";

import { ContextSizeBar } from "../ContextSizeBar";

const theme = createTheme();

(
  globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

// Seam under test: the assistant size bar in the panel header. It shows the
// approximate total against the chosen model's context size, warns when the
// total is near or over the budget, and jumps to the Context tab on Edit.
describe("ContextSizeBar", () => {
  let root: Root | undefined;
  let container: HTMLDivElement | undefined;

  function render(totalTokens: number, budgetTokens: number | null) {
    const onEdit = vi.fn();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => {
      root?.render(
        <ThemeProvider theme={theme}>
          <ContextSizeBar
            totalTokens={totalTokens}
            budgetTokens={budgetTokens}
            onEdit={onEdit}
          />
        </ThemeProvider>
      );
    });
    return { view: container as HTMLDivElement, onEdit };
  }

  function cleanup() {
    act(() => root?.unmount());
    container?.remove();
    root = undefined;
    container = undefined;
  }

  it("shows the total against the model's budget with no warning when small", () => {
    const { view } = render(100, 4096);
    try {
      expect(view.textContent).toContain("100");
      expect(view.textContent).toContain("4096");
      expect(view.textContent ?? "").not.toContain("Near");
      expect(view.textContent ?? "").not.toContain("Over");
    } finally {
      cleanup();
    }
  });

  it("warns when the total is near the budget", () => {
    const { view } = render(3500, 4096);
    try {
      expect(view.textContent).toContain("Near");
    } finally {
      cleanup();
    }
  });

  it("warns when the total is over the budget", () => {
    const { view } = render(5000, 4096);
    try {
      expect(view.textContent).toContain("Over");
    } finally {
      cleanup();
    }
  });

  it("jumps to the Context tab on Edit", () => {
    const { view, onEdit } = render(100, 4096);
    try {
      const edit = Array.from(view.querySelectorAll("button")).find(
        (entry) => entry.textContent === "Edit"
      );
      if (!edit) throw new Error("no Edit button");
      act(() => {
        edit.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      });
      expect(onEdit).toHaveBeenCalledTimes(1);
    } finally {
      cleanup();
    }
  });
});

/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, Root } from "react-dom/client";
import { ThemeProvider, createTheme } from "@mui/material";

const getChatImageUrl = vi.fn();

vi.mock("api-calls/chat/chatImages", () => ({
  getChatImageUrl: (...args: unknown[]) => getChatImageUrl(...args),
}));

import { ChatPostImages } from "../ChatPostImages";

const theme = createTheme();

(
  globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

// Seam under test: the feed images readers see. Thumbnails resolve their
// signed URLs (members only, by the bucket rules) and a tap opens the
// image larger. Resolution itself is covered by the storage live tests;
// here it is a stub.
describe("ChatPostImages", () => {
  let root: Root | undefined;
  let container: HTMLDivElement | undefined;

  afterEach(() => {
    act(() => root?.unmount());
    container?.remove();
    root = undefined;
    container = undefined;
    vi.clearAllMocks();
    document.body.innerHTML = "";
  });

  function render(paths: string[]): HTMLDivElement {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => {
      root?.render(
        <ThemeProvider theme={theme}>
          <ChatPostImages paths={paths} />
        </ThemeProvider>
      );
    });
    return container;
  }

  it("shows thumbnails inline and opens the image larger on tap", async () => {
    getChatImageUrl.mockImplementation(async (path: unknown) => `signed:${path}`);
    const view = render(["campaign-1/post-9/one.png"]);
    await act(async () => {});

    const thumbnail = view.querySelector(
      'img[alt="Attached image 1"]'
    ) as HTMLImageElement | null;
    if (!thumbnail) {
      throw new Error("no thumbnail");
    }
    expect(thumbnail.src).toContain("signed:campaign-1/post-9/one.png");

    act(() => {
      thumbnail.click();
    });
    const enlarged = document.body.querySelector(
      'img[alt="Attached image enlarged"]'
    ) as HTMLImageElement | null;
    if (!enlarged) {
      throw new Error("no enlarged image");
    }
    expect(enlarged.src).toContain("signed:campaign-1/post-9/one.png");
  });

  it("stays quiet when an image cannot load", async () => {
    getChatImageUrl.mockRejectedValue(new Error("denied"));
    const view = render(["campaign-1/post-9/missing.png"]);
    await act(async () => {});

    expect(view.querySelector("img")).toBeNull();
  });
});

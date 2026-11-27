/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import {
  applyMountedBranding,
  resetBranding,
} from "config/branding.config";
import { Themes } from "providers/ThemeProvider/themes/theme.types";

(
  globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("hooks/useGameSystem", () => ({ getSystem: () => "ironsworn" }));
vi.mock("react-router-dom", () => ({ useLocation: () => ({ pathname: "/" }) }));
vi.mock("providers/ThemeProvider/useThemeValue", () => ({
  useThemeValue: () => "/theme/eidolon.svg",
}));
// The head side effects belong to react-helmet-async; render its children
// directly so this test pins only the icon choice made by HeadProvider.
vi.mock("react-helmet-async", () => ({
  HelmetProvider: ({ children }: { children: React.ReactNode }) => children,
  Helmet: ({ children }: { children: React.ReactNode }) => children,
}));

import { HeadProvider } from "../HeadProvider";

function renderHead() {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(<HeadProvider>child</HeadProvider>);
  });
  return container.querySelector('link[rel="icon"]')?.getAttribute("href");
}

afterEach(() => {
  resetBranding();
  document.body.innerHTML = "";
});

describe("HeadProvider favicon", () => {
  it("follows the selected theme when no package favicon is set", () => {
    expect(renderHead()).toBe("/theme/eidolon.svg");
  });

  it("uses a ruleset package's favicon when supplied", () => {
    applyMountedBranding({
      title: "Frontier Fellowship",
      faviconPath: "/config/rulesets/frontier-favicon.svg",
      theme: Themes.Hinterlands,
    });
    expect(renderHead()).toBe("/config/rulesets/frontier-favicon.svg");
  });
});

/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, Root } from "react-dom/client";
import { ThemeProvider, createTheme } from "@mui/material";
import { MemoryRouter } from "react-router-dom";
import { AUTH_STATE } from "stores/auth/auth.slice.type";

const state = { auth: { status: AUTH_STATE.AUTHENTICATED } };

vi.mock("stores/store", () => ({
  useStore: (selector: (store: typeof state) => unknown) => selector(state),
}));
vi.mock("hooks/useFooterState", () => ({
  useFooterState: () => ({ isFooterVisible: true, footerHeight: 56 }),
}));
vi.mock("hooks/useAppName", () => ({ useAppName: () => "Iron Fellowship" }));
vi.mock("providers/ThemeProvider/useThemeValue", () => ({
  useThemeValue: () => "/icon.svg",
}));
vi.mock("../SettingsMenu", () => ({ SettingsMenu: () => null }));
vi.mock("../AppsMenu", () => ({ AppsMenu: () => null }));
vi.mock("../NavRailFlyouts", () => ({ NavRailFlyouts: () => null }));

import { NavRail } from "../NavRail";
import { BottomNav } from "../BottomNav";

const grey = {
  light: "#666",
  main: "#444",
  dark: "#222",
  contrastText: "#fff",
};
const theme = createTheme({ palette: { darkGrey: grey }, fontFamilyTitle: "serif" });

(
  globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

describe("Rules navigation entry", () => {
  let root: Root | undefined;
  let container: HTMLDivElement | undefined;

  afterEach(() => {
    act(() => root?.unmount());
    container?.remove();
    state.auth.status = AUTH_STATE.AUTHENTICATED;
  });

  function render(node: React.ReactNode, path = "/characters") {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => {
      root?.render(
        <ThemeProvider theme={theme}>
          <MemoryRouter initialEntries={[path]}>{node}</MemoryRouter>
        </ThemeProvider>
      );
    });
    return container;
  }

  function rulesLink(view: HTMLElement) {
    return Array.from(view.querySelectorAll("a")).find(
      (link) => link.textContent === "Rules"
    );
  }

  it.each([
    ["the nav rail", <NavRail key="rail" />],
    ["the phone bottom bar", <BottomNav key="bottom" />],
  ])("%s links signed-in people to /rules", (_label, nav) => {
    const view = render(nav);
    expect(rulesLink(view)?.getAttribute("href")).toBe("/rules");
  });

  it("marks Rules as the current page on /rules", () => {
    const view = render(<NavRail />, "/rules");
    expect(rulesLink(view)?.getAttribute("aria-current")).toBe("page");
  });

  it.each([
    ["the nav rail", <NavRail key="rail" />],
    ["the phone bottom bar", <BottomNav key="bottom" />],
  ])("%s does not offer Rules when signed out", (_label, nav) => {
    state.auth.status = AUTH_STATE.UNAUTHENTICATED;
    const view = render(nav);
    expect(rulesLink(view)).toBeUndefined();
  });
});

import { expect, type Locator } from "@playwright/test";

/**
 * Waits until the MUI Collapse around `control` has finished opening.
 *
 * Clicking while the Collapse is still animating (300 ms) can lose the
 * click: the control moves between mouse-down and mouse-up, so the click
 * event never reaches React (#141). `reducedMotion: "reduce"` does not help,
 * because the app does not tie MUI transitions to it. MUI adds
 * `MuiCollapse-entered` once the transition is done, which is the stable
 * signal to wait for.
 */
export async function expectCollapseOpen(control: Locator): Promise<void> {
  await expect(
    control.locator("xpath=ancestor::*[contains(@class,'MuiCollapse-root')][1]")
  ).toHaveClass(/MuiCollapse-entered/);
}

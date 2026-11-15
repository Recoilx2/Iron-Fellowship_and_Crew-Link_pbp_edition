import { expect, type Locator } from "@playwright/test";

/**
 * Waits until the MUI Collapse that follows `trigger` (its next sibling, as
 * in ChatRollPost) has finished opening.
 *
 * Clicking inside a Collapse while it is still animating (300 ms) can lose
 * the click: the control moves between mouse-down and mouse-up, so the
 * click event never reaches React (#141). `reducedMotion: "reduce"` does
 * not help, because the app does not tie MUI transitions to it. MUI adds
 * `MuiCollapse-entered` once the transition is done. Scoping to the
 * trigger's own sibling keeps another open Collapse on the page from
 * satisfying the wait.
 */
export async function expectCollapseOpenAfter(trigger: Locator): Promise<void> {
  await expect(
    trigger.locator(
      "xpath=following-sibling::*[contains(@class,'MuiCollapse-root')][1]"
    )
  ).toHaveClass(/MuiCollapse-entered/);
}

import { test, expect } from "@playwright/test";
import type { Locator, Page } from "@playwright/test";
import {
  createPerson,
  deletePerson,
  signInAs,
  stackConfig,
  type E2EPerson,
  type StackConfig,
} from "./fixtures";
import { expectCollapseOpenAfter } from "./collapse";

/**
 * The Rules page as a person with no character and no campaign sees it
 * (ticket #113): opened from the main navigation, it shows the moves with
 * their text expanding in place, the oracles, and the stats and condition
 * meters of the site's game system, and nothing on it rolls.
 *
 * Nothing here may skip: setup throws without a running stack copy, so a
 * misconfigured run fails instead of passing silently.
 */

test.describe("rules page", () => {
  let config: StackConfig;
  let person: E2EPerson;

  test.beforeAll(async () => {
    config = stackConfig();
    person = await createPerson(config, "e2e-rules");
  });

  test.afterAll(async () => {
    if (person) {
      await deletePerson(config, person.userId).catch(() => {});
    }
  });

  /**
   * Scrolls the control to the middle of the screen, so the phone bottom
   * bar that slides in and out cannot sit over it, then clicks it.
   */
  async function clickCentered(control: Locator) {
    await control.evaluate((element) =>
      element.scrollIntoView({ block: "center" })
    );
    await control.click();
  }

  /**
   * Opens a collapsible header or row and waits for its Collapse to finish
   * opening: a click inside it mid-animation can be lost (#141). Both the
   * category headers and the move rows sit in an li whose next sibling is
   * the Collapse, so the li is the trigger.
   */
  async function openAndSettle(control: Locator) {
    await clickCentered(control);
    await expectCollapseOpenAfter(control.locator("xpath=.."));
  }

  const button = (page: Page, name: string) =>
    page.getByRole("button", { name, exact: true });
  // Move rows and category headers carry aria-controls; a link inside a
  // move's text (Face Danger ends with "Pay the Price") is a button too, but
  // does not.
  const row = (page: Page, name: string) =>
    button(page, name).and(page.locator("[aria-controls]"));

  async function readTheRules(page: Page) {
    await expect(page).toHaveURL(/\/rules$/);
    await expect(
      page.getByRole("heading", { name: "Rules", level: 1, exact: true })
    ).toBeVisible();

    // A move opens in place to its text.
    await openAndSettle(row(page, "Adventure Moves"));
    const faceDanger = row(page, "Face Danger");
    await expect(faceDanger).toHaveAttribute("aria-expanded", "false");
    await openAndSettle(faceDanger);
    await expect(faceDanger).toHaveAttribute("aria-expanded", "true");
    await expect(
      page.getByText("When you attempt something risky")
    ).toBeVisible();
    await expect(page).toHaveURL(/\/rules$/);
    await expect(page.getByRole("dialog")).toHaveCount(0);

    // Stats and condition meters, with their descriptions.
    await expect(
      page.getByRole("heading", { name: "Stats", exact: true })
    ).toBeVisible();
    await expect(
      page.getByRole("list", { name: "Stats", exact: true }).getByRole("listitem")
    ).not.toHaveCount(0);
    await expect(
      page.getByRole("heading", { name: "Condition Meters", exact: true })
    ).toBeVisible();
    await expect(
      page
        .getByRole("list", { name: "Condition Meters", exact: true })
        .getByRole("listitem")
    ).not.toHaveCount(0);
    await expect(
      page.getByRole("heading", { name: "Moves", exact: true })
    ).toBeVisible();

    // Oracles to browse.
    await expect(
      page.getByRole("heading", { name: "Oracles", exact: true })
    ).toBeVisible();
    await expect(
      page.getByRole("textbox", { name: "Filter Oracles", exact: true })
    ).toBeVisible();
  }

  const rollButtons = (page: Page) =>
    page.getByRole("button", { name: /^roll\b/i });

  async function nothingRolls(page: Page) {
    // Pay the Price places a rollable table inline. Elsewhere its roll
    // button sits above the table; here the table is read only.
    await openAndSettle(row(page, "Fate Moves"));
    const payThePrice = row(page, "Pay the Price");
    await openAndSettle(payThePrice);
    await expect(
      payThePrice
        .locator(
          "xpath=../following-sibling::*[contains(@class,'MuiCollapse-root')][1]"
        )
        .getByRole("table")
    ).toBeVisible();

    await expect(rollButtons(page)).toHaveCount(0);
    await expect(
      page.getByRole("button", {
        name: /^(Almost Certain|Likely|Unlikely|Small Chance|50\/50)$/,
      })
    ).toHaveCount(0);

    // An oracle opens to read, with nothing to pin and nothing to roll.
    await openAndSettle(row(page, "Action and Theme Oracles"));
    await clickCentered(button(page, "Action"));
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole("button", { name: "Pin Oracle" })).toHaveCount(
      0
    );
    await expect(dialog.getByRole("button", { name: /^roll\b/i })).toHaveCount(
      0
    );
    await expect(dialog.getByRole("button", { name: "Action", exact: true })).toHaveCount(0);
  }

  test("a signed-in person opens Rules from the nav rail on desktop", async ({
    page,
  }) => {
    await signInAs(page, config, person, "/characters");

    await page.getByRole("link", { name: "Rules", exact: true }).click();

    await readTheRules(page);
    await nothingRolls(page);
  });

  test("a signed-in person opens Rules from the bottom navigation on phones", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await signInAs(page, config, person, "/characters");

    await page.getByRole("link", { name: "Rules", exact: true }).click();

    await readTheRules(page);
    await nothingRolls(page);
  });

  test("a signed-out visitor is sent to log in", async ({ page }) => {
    await page.goto("/rules");

    await expect(page).toHaveURL(/\/login/);
  });
});

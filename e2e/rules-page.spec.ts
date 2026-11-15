import { test, expect } from "@playwright/test";
import type { Page } from "@playwright/test";
import {
  createPerson,
  deletePerson,
  signInAs,
  stackConfig,
  type E2EPerson,
  type StackConfig,
} from "./fixtures";

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

  async function readTheRules(page: Page) {
    await expect(page).toHaveURL(/\/rules$/);
    await expect(
      page.getByRole("heading", { name: "Rules", level: 1, exact: true })
    ).toBeVisible();

    // A move opens in place to its text.
    await page.getByRole("button", { name: "Adventure Moves" }).click();
    const faceDanger = page.getByRole("button", {
      name: "Face Danger",
      exact: true,
    });
    await expect(faceDanger).toHaveAttribute("aria-expanded", "false");
    await faceDanger.click();
    await expect(faceDanger).toHaveAttribute("aria-expanded", "true");
    await expect(
      page.getByText("When you attempt something risky")
    ).toBeVisible();
    await expect(page).toHaveURL(/\/rules$/);
    await expect(page.getByRole("dialog")).toHaveCount(0);

    // Stats and condition meters, with their descriptions.
    await expect(page.getByRole("heading", { name: "Stats", exact: true })).toBeVisible();
    await expect(
      page.getByRole("list", { name: "Stats" }).getByRole("listitem")
    ).not.toHaveCount(0);
    await expect(
      page.getByRole("heading", { name: "Condition Meters" })
    ).toBeVisible();
    await expect(
      page.getByRole("list", { name: "Condition Meters" }).getByRole("listitem")
    ).not.toHaveCount(0);

    // Oracles to browse.
    await expect(page.getByRole("heading", { name: "Oracles", exact: true })).toBeVisible();
    await expect(
      page.getByRole("textbox", { name: "Filter Oracles" })
    ).toBeVisible();

    // Nothing on the page rolls.
    await expect(
      page.getByRole("button", { name: /^roll\b/i })
    ).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: /^(Almost Certain|Likely|Unlikely)$/ })
    ).toHaveCount(0);
  }

  test("a signed-in person opens Rules from the nav rail on desktop", async ({
    page,
  }) => {
    await signInAs(page, config, person, "/characters");

    await page.getByRole("link", { name: "Rules", exact: true }).click();

    await readTheRules(page);
  });

  test("a signed-in person opens Rules from the bottom navigation on phones", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await signInAs(page, config, person, "/characters");

    await page.getByRole("link", { name: "Rules", exact: true }).click();

    await readTheRules(page);
  });

  test("a signed-out visitor is sent to log in", async ({ page }) => {
    await page.goto("/rules");

    await expect(page).toHaveURL(/\/login/);
  });
});

import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import {
  createPerson,
  deletePerson,
  signInAs,
  stackConfig,
  type E2EPerson,
  type StackConfig,
} from "./fixtures";

/**
 * A mounted manifest can replace the base ruleset at runtime: the rules on
 * the Rules page and the site's branding both come from the package, with
 * no site rebuild. The replacement fixture is served through a route
 * intercept so the other specs keep running against the shipped Ironsworn
 * stack copy. Nothing here may skip: setup throws without a running stack.
 */
const fixture = (name: string) =>
  readFileSync(new URL(`../supabase/site/config-replacement/${name}`, import.meta.url));

test.describe("replaced base ruleset", () => {
  let config: StackConfig;
  let person: E2EPerson;
  let characterId: string;

  test.beforeAll(async () => {
    config = stackConfig();
    person = await createPerson(config, "e2e-replaced-rules");
    characterId = crypto.randomUUID();
    const { error } = await person.client.from("characters").insert({
      id: characterId,
      owner_id: person.userId,
      name: "E2E Replaced Character",
      expansion_ids: [],
    });
    if (error) {
      throw new Error(`e2e: could not create character: ${error.message}`);
    }
  });

  test.afterAll(async () => {
    if (person) {
      await deletePerson(config, person.userId).catch(() => {});
    }
  });

  test("uses the package's branding and rules content", async ({ page }) => {
    await page.route("**/config/rulesets/manifest.json", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: fixture("manifest.json").toString("utf8"),
      }),
    );
    await page.route("**/config/rulesets/frontier.json", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: fixture("frontier.json").toString("utf8"),
      }),
    );
    await page.route("**/config/rulesets/frontier-favicon.svg", (route) =>
      route.fulfill({
        status: 200,
        contentType: "image/svg+xml",
        body: fixture("frontier-favicon.svg").toString("utf8"),
      }),
    );

    await signInAs(page, config, person, `/characters/${characterId}`);
    await expect(page.getByText("E2E Replaced Character").first()).toBeVisible();

    // Track types and the character's special tracks come from the mounted
    // ruleset, even though this site image was built for Ironsworn.
    await page.getByRole("tab", { name: "Tracks" }).click();
    await expect(page.getByText("Legacy of Oaths")).toBeVisible();
    await page.getByRole("button", { name: "Add Track" }).click();
    await expect(page.getByRole("menuitem", { name: "Oath" })).toBeVisible();
    await expect(page.getByRole("menuitem", { name: "Trail" })).toBeVisible();
    await expect(page.getByRole("menuitem", { name: "Peril" })).toBeVisible();
    await page.keyboard.press("Escape");

    // Title and favicon come from the mounted ruleset package, not the
    // branding baked into the site image at build time.
    await expect(page).toHaveTitle(/Frontier Fellowship/);
    const icon = await page
      .locator('link[rel="icon"]')
      .last()
      .getAttribute("href");
    expect(icon).toContain("frontier-favicon.svg");

    await page.getByRole("link", { name: "Rules", exact: true }).first().click();
    await expect(page).toHaveURL(/\/rules$/);
    await page
      .getByRole("textbox", { name: "Filter Moves" })
      .fill("Swear a Frontier Oath");
    await expect(page.getByText("Frontier Moves", { exact: true })).toBeVisible();
    const move = page.getByRole("button", { name: "Swear a Frontier Oath" });
    await expect(move).toBeVisible();
    await move.click();
    await expect(
      page.getByText("When you swear a frontier oath, write down what you will not yield."),
    ).toBeVisible();
  });
});

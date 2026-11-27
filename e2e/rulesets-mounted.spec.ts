import { test, expect } from "@playwright/test";
import {
  createPerson,
  deletePerson,
  signInAs,
  stackConfig,
  type E2EPerson,
  type StackConfig,
} from "./fixtures";

/**
 * A mounted Datasworn expansion is part of the normal rules pipeline: it can
 * be selected for a character and its moves render on the Rules page (ticket
 * #217). The stack template mounts manifest.json + mounted_e2e.json at
 * /config/rulesets/, so no test-specific configuration is needed.
 *
 * Nothing here may skip: setup throws without a running stack copy.
 */

test.describe("mounted rulesets", () => {
  let config: StackConfig;
  let person: E2EPerson;
  let characterId: string;

  test.beforeAll(async () => {
    config = stackConfig();
    person = await createPerson(config, "e2e-mounted-rules");
    const { data, error } = await person.client
      .from("characters")
      .insert({
        owner_id: person.userId,
        name: "E2E Mounted Character",
        expansion_ids: ["mounted_e2e"],
      })
      .select("id")
      .single();
    if (error || !data) {
      throw new Error(`e2e: could not create character: ${error?.message}`);
    }
    characterId = data.id as string;
  });

  test.afterAll(async () => {
    if (person) {
      await deletePerson(config, person.userId).catch(() => {});
    }
  });

  test("a mounted expansion is selectable and its move renders in Rules", async ({
    page,
  }) => {
    await signInAs(page, config, person, `/characters/${characterId}`);
    await expect(page.getByText("E2E Mounted Character").first()).toBeVisible();

    // The expansion is listed in the same selector as the built-in ones.
    await page.getByRole("button", { name: "Character Settings" }).click();
    await page.getByRole("menuitem", { name: "Expansions & Homebrew" }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    const toggle = dialog.getByRole("checkbox", {
      name: /Mounted Test Expansion/,
    });
    await expect(toggle).toBeVisible();
    await expect(toggle).toBeChecked();
    await dialog.getByRole("button", { name: "Cancel" }).click();

    // The same expansion's content is merged into the rules the page reads.
    await page.getByRole("link", { name: "Rules", exact: true }).first().click();
    await expect(page).toHaveURL(/\/rules$/);
    await page
      .getByRole("textbox", { name: "Filter Moves" })
      .fill("Check the Mount");
    // While the filter is active the category header is a plain list item.
    await expect(page.getByText("Mounted Moves", { exact: true })).toBeVisible();
    const move = page.getByRole("button", { name: "Check the Mount" });
    await expect(move).toBeVisible();
    await move.click();
    await expect(
      page.getByText("When you check the operator-supplied ruleset"),
    ).toBeVisible();
  });
});

import { test, expect, type Locator } from "@playwright/test";
import { basename, dirname, isAbsolute, resolve } from "node:path";
import {
  campaignUrl,
  createCampaignAs,
  createPerson,
  deleteCampaignAsAdmin,
  deletePerson,
  joinCampaignAs,
  signInAs,
  stackConfig,
  type E2EPerson,
  type StackConfig,
} from "./fixtures";
import {
  startFakeAssistantUpstream,
  type FakeAssistantUpstream,
} from "../src/api-calls/testing/fakeAssistantUpstream";
import {
  detectComposeProject,
  readEnvFile,
  recreateFunctionsContainer,
  waitForFunctionsReady,
  type ComposeTarget,
} from "../src/api-calls/testing/liveFunctions";

/**
 * GM assistant panel (spec #10, ticket #130): a GM opens the assistant
 * from the campaign screen, asks something, watches the streamed reply
 * and sends it to the chat composer without posting it. A player in the
 * same campaign sees no Assistant button at all.
 *
 * The fake OpenAI-compatible server stands in for the model (the same
 * pattern as the server-function live tests): the spec points the
 * stack's functions container at it over `host.docker.internal`, then
 * restores the pristine config, so the run never touches a real
 * provider. Nothing here may skip: setup throws without a running
 * stack copy, so a misconfigured run fails instead of passing
 * silently.
 */

const FAKE_PORT = Number(process.env.E2E_FAKE_LLM_PORT ?? 4011);
const TEST_API_KEY = "sk-e2e-gm-assistant-key-001";

/**
 * Where the stack copy's env file is. Playwright runs from the repo
 * root while `ENV_FILE` is written for `supabase/` (which `e2e.sh`
 * enforces and absolutizes before exporting): anchor a relative value
 * at the `supabase/` dir beside the `e2e/` dir instead of the test
 * runner's working directory, so the lookup works from anywhere.
 */
function resolveEnvFile(value: string): string {
  if (isAbsolute(value)) {
    return value;
  }
  return resolve(dirname(__dirname), "supabase", basename(value));
}

/** Waits until two consecutive bounding-box reads are identical. */
async function settled(locator: Locator): Promise<void> {
  let previous = "";
  await expect
    .poll(
      async () => {
        const box = await locator.boundingBox();
        const current = JSON.stringify(box);
        const equal = box !== null && current === previous;
        previous = current;
        return equal;
      },
      { timeout: 5000, intervals: [100, 100, 250, 250, 500] }
    )
    .toBe(true);
}

async function boxOf(
  locator: Locator
): Promise<{ x: number; y: number; width: number; height: number }> {
  const box = await locator.boundingBox();
  if (!box) {
    throw new Error("e2e: element has no bounding box");
  }
  return box;
}

test.describe("gm assistant panel", () => {
  let config: StackConfig;
  let functionsBase: string;
  let target: ComposeTarget | null = null;
  let configured = false;
  let fake: FakeAssistantUpstream | null = null;
  let campaignId: string;
  const campaignName = `E2E Assistant ${Date.now()}`;
  let gm: E2EPerson;
  let player: E2EPerson;
  let people: E2EPerson[] = [];

  test.beforeAll(async () => {
    config = stackConfig();
    functionsBase = `${config.url.replace(/\/+$/, "")}/functions/v1`;
    const envFile = resolveEnvFile(process.env.ENV_FILE ?? ".env.live");
    const vars = readEnvFile(envFile);
    if ((vars.GM_ASSISTANT_ENDPOINT ?? "").trim() !== "") {
      throw new Error(
        "e2e: GM_ASSISTANT_ENDPOINT must be blank in the copy env file so the panel starts from the pristine stack"
      );
    }
    gm = await createPerson(config, "e2e-assistant-gm");
    player = await createPerson(config, "e2e-assistant-player");
    people = [gm, player];
    campaignId = await createCampaignAs(gm, campaignName, "co-op");
    await joinCampaignAs(player, campaignId);

    // Point the functions container at the fake model server. The fake
    // runs on the host; the container reaches it over
    // host.docker.internal, and the API key is a throwaway test value.
    target = detectComposeProject(envFile);
    fake = await startFakeAssistantUpstream(FAKE_PORT);
    recreateFunctionsContainer(target, {
      GM_ASSISTANT_ENDPOINT: fake.containerUrl,
      GM_ASSISTANT_API_KEY: TEST_API_KEY,
      GM_ASSISTANT_ALLOWED_MODELS: "",
    });
    await waitForFunctionsReady(functionsBase);
    configured = true;
  });

  test.afterAll(async () => {
    try {
      if (target && configured) {
        recreateFunctionsContainer(target, {});
        await waitForFunctionsReady(functionsBase).catch(() => undefined);
      }
    } finally {
      await fake?.close().catch(() => undefined);
      fake = null;
      if (campaignId) {
        await deleteCampaignAsAdmin(config, campaignId).catch(() => undefined);
      }
      await Promise.all(
        people.map((person) =>
          deletePerson(config, person.userId).catch(() => undefined)
        )
      );
      people = [];
    }
  });

  test("a GM opens the assistant, sees the streamed reply and sends it to the composer", async ({
    browser,
  }) => {
    const gmContext = await browser.newContext();
    const gmPage = await gmContext.newPage();
    try {
      await signInAs(gmPage, config, gm, campaignUrl(campaignId));
      await expect(gmPage.getByRole("tab", { name: "Chat" })).toBeVisible();

      await expect(
        gmPage.getByRole("button", { name: "Assistant", exact: true })
      ).toBeVisible();
      await gmPage
        .getByRole("button", { name: "Assistant", exact: true })
        .click();
      await expect(gmPage.getByText("GM assistant")).toBeVisible();

      // The server's model list arrives with the fake chat model first.
      await expect(
        gmPage.getByRole("combobox", { name: "Model" })
      ).toHaveValue("live-chat-model");

      await gmPage
        .getByRole("button", { name: "New conversation" })
        .click();
      await gmPage
        .getByPlaceholder(/Ask the assistant/)
        .fill("What happens next?");
      await gmPage
        .getByRole("button", { name: "Send to assistant" })
        .click();

      // The fake streams "Hello traveller" in two chunks.
      await expect(gmPage.getByText("Hello traveller")).toBeVisible();

      await gmPage
        .getByRole("button", { name: "Send to composer" })
        .first()
        .click();
      const composer = gmPage.getByRole("textbox", { name: /Post in #/ });
      await expect(composer).toHaveValue(/Hello traveller/);

      // Filling the composer posts nothing: no post in any of the
      // campaign's channels carries the reply.
      const { data: channels, error: channelsError } = await gm.client
        .from("chat_channels")
        .select("id")
        .eq("campaign_id", campaignId);
      expect(channelsError).toBeNull();
      const ids = ((channels ?? []) as Array<{ id: string }>).map(
        (channel) => channel.id
      );
      expect(ids.length).toBeGreaterThan(0);
      const { data: posts, error: postsError } = await gm.client
        .from("chat_posts")
        .select("text")
        .in("channel_id", ids);
      expect(postsError).toBeNull();
      expect(
        ((posts ?? []) as Array<{ text: string | null }>).some((post) =>
          (post.text ?? "").includes("Hello traveller")
        )
      ).toBe(false);
    } finally {
      await gmContext.close().catch(() => undefined);
    }
  });

  test("on desktop the assistant takes the side pane's place and leaves the chat feed uncovered", async ({
    browser,
  }) => {
    const gmContext = await browser.newContext({
      viewport: { width: 1400, height: 900 },
    });
    const gmPage = await gmContext.newPage();
    try {
      await signInAs(gmPage, config, gm, campaignUrl(campaignId));
      await expect(gmPage.getByRole("tab", { name: "Chat" })).toBeVisible();

      const sidePane = gmPage.getByTestId("chat-side-pane");
      // The post list itself, not the composer under it.
      const feedPane = gmPage.getByLabel(/^Posts in #/);
      await expect(sidePane).toBeVisible();
      await expect(feedPane).toBeVisible();
      await settled(sidePane);
      await settled(feedPane);
      const sideBefore = await boxOf(sidePane);
      const feedBefore = await boxOf(feedPane);

      const trigger = gmPage.getByRole("button", {
        name: "Assistant",
        exact: true,
      });
      await trigger.click();

      // The side pane is swapped out, not covered.
      const dock = gmPage.getByTestId("assistant-dock");
      await expect(dock).toBeVisible();
      await expect(sidePane).toHaveCount(0);
      const panel = gmPage.getByRole("complementary", {
        name: "GM assistant",
        exact: true,
      });
      await expect(panel).toBeFocused();
      await expect(
        gmPage.getByRole("combobox", { name: "Model" })
      ).toBeVisible();

      // Layout settles once the dock and the feed report the same box on
      // two consecutive reads.
      await settled(dock);
      await settled(feedPane);
      const dockBox = await boxOf(dock);
      const feedAfter = await boxOf(feedPane);

      // Same slot as the side pane it replaced.
      expect(Math.abs(dockBox.x - sideBefore.x)).toBeLessThanOrEqual(1);
      expect(Math.abs(dockBox.width - sideBefore.width)).toBeLessThanOrEqual(1);
      // The chat feed's column ends where the panel begins: no overlap.
      expect(feedAfter.x + feedAfter.width).toBeLessThanOrEqual(
        dockBox.x + 1
      );
      expect(feedAfter.x).toBeGreaterThanOrEqual(feedBefore.x - 1);
      // Nothing floats over the page.
      await expect(
        panel.locator("xpath=ancestor::*[contains(@class,'MuiDrawer-')]")
      ).toHaveCount(0);

      // Closing brings the side pane back and focus returns to the button.
      await gmPage.getByRole("button", { name: "Close assistant" }).click();
      await expect(dock).toHaveCount(0);
      await expect(sidePane).toBeVisible();
      await expect(trigger).toBeFocused();
    } finally {
      await gmContext.close().catch(() => undefined);
    }
  });

  test("a GM opens the Context tab, sees option groups and jumps there from the size bar", async ({
    browser,
  }) => {
    const gmContext = await browser.newContext();
    const gmPage = await gmContext.newPage();
    try {
      await signInAs(gmPage, config, gm, campaignUrl(campaignId));
      await expect(gmPage.getByRole("tab", { name: "Chat" })).toBeVisible();

      await gmPage
        .getByRole("button", { name: "Assistant", exact: true })
        .click();
      await expect(gmPage.getByText("GM assistant")).toBeVisible();

      // The size bar shows the approximate total against the fake chat
      // model's context size, with an Edit link beside it.
      await expect(gmPage.getByText(/\/ 4096 tokens/)).toBeVisible();

      // Edit jumps to the Context tab, which lists every option group even
      // with an empty campaign: the outline row plus world, note and
      // channel groups.
      await gmPage.getByRole("button", { name: "Edit context" }).click();
      await expect(
        gmPage.getByRole("tab", { name: "Context" })
      ).toHaveAttribute("aria-selected", "true");
      for (const heading of [
        "Campaign outline",
        "Lore",
        "NPCs",
        "Locations",
        "Notes",
        "Recent posts",
      ]) {
        // Headings, not the campaign screen's own world tabs of similar
        // names: the group titles render as headings inside the panel.
        await expect(
          gmPage.getByRole("heading", { name: heading })
        ).toBeVisible();
      }
    } finally {
      await gmContext.close().catch(() => undefined);
    }
  });

  test("a player in the same campaign sees no Assistant button", async ({
    browser,
  }) => {
    const playerContext = await browser.newContext();
    const playerPage = await playerContext.newPage();
    try {
      await signInAs(playerPage, config, player, campaignUrl(campaignId));
      await expect(playerPage.getByRole("tab", { name: "Chat" })).toBeVisible();

      await expect(
        playerPage.getByRole("button", { name: "Assistant", exact: true })
      ).toHaveCount(0);
      await expect(playerPage.getByText("GM assistant")).toHaveCount(0);
    } finally {
      await playerContext.close().catch(() => undefined);
    }
  });
});

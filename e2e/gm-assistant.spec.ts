import { test, expect } from "@playwright/test";
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
    const envFile =
      process.env.ENV_FILE ??
      (() => {
        throw new Error("e2e: ENV_FILE is not set (run through supabase/tests/e2e.sh)");
      })();
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

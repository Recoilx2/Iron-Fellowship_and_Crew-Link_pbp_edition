import { test, expect } from "@playwright/test";
import { basename, dirname, isAbsolute, resolve } from "node:path";
import * as Y from "yjs";
import { TiptapTransformer } from "@hocuspocus/transformer";
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
 * Outline revisions with the assistant (spec #10, ticket #133): a GM asks
 * for a revision from the Outline tab, sees the current and proposed
 * outline side by side, applies it behind a confirmation, and undoes it.
 * Only the GM's Apply ever changes the outline; Discard would leave it
 * untouched.
 *
 * The fake OpenAI-compatible server stands in for the model (the same
 * pattern as the panel spec): its chunks carry a marked complete
 * replacement, the stack's functions container is pointed at it over
 * `host.docker.internal`, then the pristine config is restored. Nothing
 * here may skip: setup throws without a running stack copy, so a
 * misconfigured run fails instead of passing silently.
 */

const FAKE_PORT = Number(process.env.E2E_FAKE_LLM_PORT ?? 4012);
const TEST_API_KEY = "sk-e2e-gm-assistant-revision-key-001";
const ORIGINAL = `E2E original plan ${Date.now()} the bell rings twice`;
const PROPOSED = "E2E revised plan: the bell cracks in act one.";

function resolveEnvFile(value: string): string {
  if (isAbsolute(value)) {
    return value;
  }
  return resolve(dirname(__dirname), "supabase", basename(value));
}

function inlineText(node: unknown): string {
  if (Array.isArray(node)) {
    return node.map(inlineText).join("");
  }
  if (node && typeof node === "object") {
    const record = node as { text?: unknown; content?: unknown };
    if (typeof record.text === "string") {
      return record.text;
    }
    if (Array.isArray(record.content)) {
      return inlineText(record.content);
    }
  }
  return "";
}

// The editor binds its content to the TipTap `default` fragment (the
// collaboration extension's default field); fixtures that seed bytes by
// hand use the plain `body` text instead. Read the fragment first, then
// the body, mirroring src/api-calls/assistant/outlineText.ts (kept local
// because the browser runner does not resolve the repo's src aliases).
function outlineBytesToText(content: string): string {
  const doc = new Y.Doc();
  Y.applyUpdate(doc, new Uint8Array(Buffer.from(content, "base64")));
  const json = TiptapTransformer.fromYdoc(doc, "default") as {
    content?: unknown;
  };
  const blocks = Array.isArray(json.content) ? json.content : [];
  const tipTap = blocks.map(inlineText).join("\n");
  if (tipTap.trim().length > 0) {
    return tipTap;
  }
  return doc.getText("body").toString();
}

test.describe("outline revisions", () => {
  let config: StackConfig;
  let functionsBase: string;
  let target: ComposeTarget | null = null;
  let configured = false;
  let fake: FakeAssistantUpstream | null = null;
  let campaignId: string;
  const campaignName = `E2E Revision ${Date.now()}`;
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
    gm = await createPerson(config, "e2e-revision-gm");
    player = await createPerson(config, "e2e-revision-player");
    people = [gm, player];
    campaignId = await createCampaignAs(gm, campaignName, "co-op");
    await joinCampaignAs(player, campaignId);

    target = detectComposeProject(envFile);
    fake = await startFakeAssistantUpstream(FAKE_PORT);
    // The model returns a marked complete replacement, the form the
    // client pulls the proposal out of.
    fake.chunks = [
      "<<<OUTLINE-BEGIN>>>\n",
      `${PROPOSED}\n`,
      "<<<OUTLINE-END>>>",
    ];
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

  async function outlineId(): Promise<string> {
    const { data, error } = await gm.client
      .from("campaign_notes")
      .select("id")
      .eq("campaign_id", campaignId)
      .eq("kind", "outline");
    expect(error).toBeNull();
    const id = (data?.[0] as { id?: unknown } | undefined)?.id;
    expect(typeof id).toBe("string");
    return id as string;
  }

  async function outlineContents(): Promise<string | null> {
    const id = await outlineId();
    const { data, error } = await gm.client
      .from("campaign_note_contents")
      .select("content")
      .eq("note_id", id);
    expect(error).toBeNull();
    const content = (data?.[0] as { content?: unknown } | undefined)?.content;
    return typeof content === "string" ? outlineBytesToText(content) : null;
  }

  async function openOutlineTab(page: Parameters<typeof signInAs>[0]) {
    await expect(
      page.getByRole("button", { name: "Assistant", exact: true })
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Assistant", exact: true })
      .click();
    await expect(page.getByText("GM assistant")).toBeVisible();
    await page.getByRole("tab", { name: "Outline" }).click();
    await expect(
      page.getByText("GM-only. Never shared with players.")
    ).toBeVisible();
  }

  test("a GM requests a revision, applies it behind a confirmation, then undoes it", async ({
    browser,
  }) => {
    const gmContext = await browser.newContext();
    try {
      const gmPage = await gmContext.newPage();
      await signInAs(gmPage, config, gm, campaignUrl(campaignId));
      await expect(gmPage.getByRole("tab", { name: "Chat" })).toBeVisible();
      await openOutlineTab(gmPage);

      // Seed the outline by typing into the editor: the text travels
      // through the note server (the only writer its persisted store
      // trusts), unlike a direct row upsert, which the server's next
      // store would clobber with the empty document it already holds.
      const editor = gmPage.getByRole("textbox", { name: "Note text" });
      await expect(editor).toBeVisible();
      await editor.click();
      await gmPage.keyboard.type(ORIGINAL);
      await expect(editor).toContainText(ORIGINAL);

      // Wait until the typed text reaches the contents row before
      // revising, so the preview's "current" side is exact.
      await expect
        .poll(() => outlineContents(), { timeout: 30000 })
        .toBe(ORIGINAL);

      // An explicit revision action sends the instruction in
      // outline-revision mode; the reply previews both versions.
      await gmPage.getByRole("button", { name: "Revise outline" }).click();
      await gmPage
        .getByPlaceholder("How should the outline change?")
        .fill("Tighten act one.");
      await gmPage
        .getByRole("button", { name: "Request outline revision" })
        .click();
      await expect(
        gmPage.getByText("Proposed outline")
      ).toBeVisible();
      await expect(
        gmPage.getByLabel("Current outline text")
      ).toContainText(ORIGINAL);
      await expect(
        gmPage.getByLabel("Proposed outline text")
      ).toContainText(PROPOSED);

      // Apply needs confirmation; only confirming replaces the outline
      // and keeps the previous version. The open editor moves onto the
      // replacement at once.
      await gmPage.getByRole("button", { name: "Apply to outline" }).click();
      await expect(
        gmPage.getByText("Replace the outline?")
      ).toBeVisible();
      expect(await outlineContents()).toBe(ORIGINAL);
      await gmPage.getByRole("button", { name: "Confirm replace" }).click();
      await expect(gmPage.getByText("Applied.")).toBeVisible();
      expect(await outlineContents()).toBe(PROPOSED);
      await expect(
        gmPage.getByRole("textbox", { name: "Note text" })
      ).toContainText(PROPOSED);
      const { data: versions, error: versionsError } = await gm.client
        .from("assistant_outline_versions")
        .select("content")
        .eq("campaign_id", campaignId);
      expect(versionsError).toBeNull();
      expect(
        ((versions ?? []) as Array<{ content: string }>).map(
          (row) => row.content
        )
      ).toEqual([ORIGINAL]);

      // The Outline tab's Undo restores the previous version, and the
      // editor moves back onto it at once. Scope to the tab header's
      // button: the applied preview carries its own Undo.
      await gmPage
        .getByRole("button", {
          name: "Undo outline revision",
          description: "Restore the previous outline version",
        })
        .click();
      expect(await outlineContents()).toBe(ORIGINAL);
      await expect(
        gmPage.getByRole("textbox", { name: "Note text" })
      ).toContainText(ORIGINAL);
      const { data: kept, error: keptError } = await gm.client
        .from("assistant_outline_versions")
        .select("id")
        .eq("campaign_id", campaignId);
      expect(keptError).toBeNull();
      expect(kept ?? []).toEqual([]);

      // The reopened editor reads the restored text.
      await gmPage.reload();
      await expect(gmPage.getByRole("tab", { name: "Chat" })).toBeVisible();
      await openOutlineTab(gmPage);
      await expect(
        gmPage.getByRole("textbox", { name: "Note text" })
      ).toContainText(ORIGINAL);
    } finally {
      await gmContext.close().catch(() => undefined);
    }
  });
});

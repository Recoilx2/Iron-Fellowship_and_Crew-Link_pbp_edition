import { afterEach, describe, expect, it } from "vitest";

import { getSupabaseClient } from "config/supabase.config";
import { createCampaign } from "api-calls/campaign/createCampaign";
import { joinCampaign } from "api-calls/campaign/joinCampaign";
import { updateCampaignGM } from "api-calls/campaign/updateCampaignGM";
import { CampaignType } from "api-calls/campaign/_campaign.type";
import {
  ASSISTANT_CONVERSATIONS_TABLE,
  ASSISTANT_MESSAGES_TABLE,
  ASSISTANT_SETTINGS_TABLE,
} from "api-calls/assistant/_getRef";
import { createConversation } from "api-calls/assistant/createConversation";
import { renameConversation } from "api-calls/assistant/renameConversation";
import { deleteConversation } from "api-calls/assistant/deleteConversation";
import { addAssistantMessage } from "api-calls/assistant/addAssistantMessage";
import {
  fetchAssistantSettings,
  saveAssistantSettings,
} from "api-calls/assistant/assistantSettings";
import { listenToConversations } from "api-calls/assistant/listenToConversations";
import { listenToMessages } from "api-calls/assistant/listenToMessages";
import type { AssistantConversationWithId } from "api-calls/assistant/_assistant.type";
import type { AssistantMessageWithId } from "api-calls/assistant/_assistant.type";
import {
  createPerson,
  deletePerson,
  liveStackConfig,
  waitFor,
  type LivePerson,
  type LiveStackConfig,
} from "api-calls/testing/liveHarness";

const config = liveStackConfig();

async function signInAs(person: LivePerson): Promise<void> {
  const { error } = await getSupabaseClient().auth.signInWithPassword({
    email: person.email,
    password: person.password,
  });
  if (error) throw error;
}

async function signOut(): Promise<void> {
  await getSupabaseClient().auth.signOut();
}

describe.skipIf(!config)("gm assistant data layer end to end", () => {
  const cfg = config as LiveStackConfig;
  let people: LivePerson[] = [];
  const unsubscribes: Array<() => void> = [];

  afterEach(async () => {
    for (const unsubscribe of unsubscribes.splice(0)) unsubscribe();
    await signOut().catch(() => {});
    await Promise.all(
      people.map((person) => deletePerson(cfg, person.userId).catch(() => {}))
    );
    people = [];
  });

  async function setUpCampaign(): Promise<{
    gm: LivePerson;
    coGm: LivePerson;
    player: LivePerson;
    outsider: LivePerson;
    campaignId: string;
  }> {
    const gm = await createPerson(cfg, "gm");
    const coGm = await createPerson(cfg, "cogm");
    const player = await createPerson(cfg, "player");
    const outsider = await createPerson(cfg, "outsider");
    people.push(gm, coGm, player, outsider);
    await signInAs(gm);
    const campaignId = await createCampaign({
      uid: gm.userId,
      campaignName: "Assisted quest",
      campaignType: CampaignType.Coop,
    });
    await signOut();
    await signInAs(coGm);
    await joinCampaign({ campaignId });
    await signOut();
    // The founder promotes the second member to co-GM.
    await signInAs(gm);
    await updateCampaignGM({ campaignId, gmId: coGm.userId });
    await signOut();
    await signInAs(player);
    await joinCampaign({ campaignId });
    await signOut();
    return { gm, coGm, player, outsider, campaignId };
  }

  async function readRowsAs(
    person: LivePerson,
    table: string,
    column: string,
    value: string
  ) {
    const { data, error } = await person.client
      .from(table)
      .select("*")
      .eq(column, value);
    expect(error).toBeNull();
    return (data ?? []) as Array<Record<string, unknown>>;
  }

  it("lets the owning GM manage conversations, messages and settings", { timeout: 120000 }, async () => {
    const { gm, campaignId } = await setUpCampaign();
    await signInAs(gm);

    // No settings until the GM saves a choice.
    await expect(
      fetchAssistantSettings({ campaignId })
    ).resolves.toBeNull();

    const conversationId = await createConversation({
      campaignId,
      title: "Story planning",
    });
    const questionId = await addAssistantMessage({
      conversationId,
      role: "user",
      content: "What happens next?",
    });
    const replyId = await addAssistantMessage({
      conversationId,
      role: "assistant",
      content: "The storm breaks.",
    });
    expect(questionId).not.toBe(replyId);

    await renameConversation({
      conversationId,
      title: "Revised plan",
    });

    await saveAssistantSettings({
      campaignId,
      model: "test-model",
      context: {
        includeOutline: true,
        lore: [],
        npcs: [],
        locations: [],
        notes: [],
        channels: [{ id: "channel-1", postCount: 5 }],
      },
    });
    await expect(
      fetchAssistantSettings({ campaignId })
    ).resolves.toMatchObject({ model: "test-model" });

    // The conversation list streams the GM's own conversation.
    const seen: AssistantConversationWithId[][] = [];
    let loaded = false;
    unsubscribes.push(
      listenToConversations(
        campaignId,
        {
          onConversations: (conversations) => seen.push(conversations),
          onLoaded: () => {
            loaded = true;
          },
        },
        (error) => {
          throw error;
        }
      )
    );
    await waitFor(() =>
      loaded && seen.length >= 1 &&
      seen.at(-1)?.some((c) => c.id === conversationId)
        ? seen
        : null
    );
    expect(seen.at(-1)?.find((c) => c.id === conversationId)).toMatchObject({
      campaignId,
      ownerId: gm.userId,
      title: "Revised plan",
    });

    // The messages stream both turns oldest first.
    const heard: AssistantMessageWithId[][] = [];
    let messagesLoaded = false;
    unsubscribes.push(
      listenToMessages(
        conversationId,
        {
          onMessages: (messages) => heard.push(messages),
          onLoaded: () => {
            messagesLoaded = true;
          },
        },
        (error) => {
          throw error;
        }
      )
    );
    await waitFor(() =>
      messagesLoaded && heard.length >= 1 && heard.at(-1)?.length === 2
        ? heard
        : null
    );
    expect(heard.at(-1)?.map((m) => m.content)).toEqual([
      "What happens next?",
      "The storm breaks.",
    ]);

    // Deleting the conversation removes its messages too.
    await deleteConversation({ conversationId });
    await waitFor(async () =>
      (await readRowsAs(gm, ASSISTANT_CONVERSATIONS_TABLE, "id", conversationId)).length === 0
        ? true
        : null
    );
    expect(
      await readRowsAs(gm, ASSISTANT_MESSAGES_TABLE, "conversation_id", conversationId)
    ).toEqual([]);
  });

  it("gives a co-GM, a player and an outsider nothing, over REST and live", { timeout: 120000 }, async () => {
    const { gm, coGm, player, outsider, campaignId } = await setUpCampaign();
    await signInAs(gm);
    const conversationId = await createConversation({
      campaignId,
      title: "Private thinking",
    });
    await addAssistantMessage({
      conversationId,
      role: "user",
      content: "Secret plans",
    });
    await saveAssistantSettings({
      campaignId,
      model: "gm-model",
      context: {
        includeOutline: false,
        lore: [],
        npcs: [],
        locations: [],
        notes: [],
        channels: [],
      },
    });
    await signOut();

    for (const person of [coGm, player, outsider]) {
      // Reads: no conversations, messages or settings leak.
      expect(
        await readRowsAs(person, ASSISTANT_CONVERSATIONS_TABLE, "campaign_id", campaignId)
      ).toEqual([]);
      expect(
        await readRowsAs(person, ASSISTANT_MESSAGES_TABLE, "conversation_id", conversationId)
      ).toEqual([]);
      expect(
        await readRowsAs(person, ASSISTANT_SETTINGS_TABLE, "campaign_id", campaignId)
      ).toEqual([]);

      // Writes: creating a conversation or a message is refused, and
      // renaming or deleting someone else's conversation matches nothing.
      const created = await person.client
        .from(ASSISTANT_CONVERSATIONS_TABLE)
        .insert({
          id: crypto.randomUUID(),
          campaign_id: campaignId,
          owner_id: person.userId,
          title: "Sneaky",
        });
      expect(created.error).not.toBeNull();
      const messaged = await person.client
        .from(ASSISTANT_MESSAGES_TABLE)
        .insert({
          id: crypto.randomUUID(),
          conversation_id: conversationId,
          role: "user",
          content: "Sneaky",
        });
      expect(messaged.error).not.toBeNull();
      const saved = await person.client.from(ASSISTANT_SETTINGS_TABLE).upsert({
        campaign_id: campaignId,
        gm_id: person.userId,
        model: "sneaky-model",
        context: {},
      });
      expect(saved.error).not.toBeNull();
      const renamed = await person.client
        .from(ASSISTANT_CONVERSATIONS_TABLE)
        .update({ title: "Sneaky" })
        .eq("id", conversationId)
        .select("id");
      expect(renamed.error).toBeNull();
      expect(renamed.data ?? []).toEqual([]);
      const deleted = await person.client
        .from(ASSISTANT_CONVERSATIONS_TABLE)
        .delete()
        .eq("id", conversationId)
        .select("id");
      expect(deleted.error).toBeNull();
      expect(deleted.data ?? []).toEqual([]);
    }

    // Live updates: the co-GM's subscription loads but stays empty, even
    // though the owner's conversation exists.
    await signInAs(coGm);
    const seen: AssistantConversationWithId[][] = [];
    let loaded = false;
    unsubscribes.push(
      listenToConversations(
        campaignId,
        {
          onConversations: (conversations) => seen.push(conversations),
          onLoaded: () => {
            loaded = true;
          },
        },
        (error) => {
          throw error;
        }
      )
    );
    await waitFor(() => (loaded && seen.length >= 1 ? seen : null));
    expect(seen.at(-1)).toEqual([]);

    const heard: AssistantMessageWithId[][] = [];
    let messagesLoaded = false;
    unsubscribes.push(
      listenToMessages(
        conversationId,
        {
          onMessages: (messages) => heard.push(messages),
          onLoaded: () => {
            messagesLoaded = true;
          },
        },
        (error) => {
          throw error;
        }
      )
    );
    await waitFor(() =>
      messagesLoaded && heard.length >= 1 ? heard : null
    );
    expect(heard.at(-1)).toEqual([]);
  });

  it("cuts off a GM who is demoted or removed", { timeout: 120000 }, async () => {
    const { gm, coGm, campaignId } = await setUpCampaign();

    // The co-GM works while still a GM: their own conversation reads back.
    await signInAs(coGm);
    const coConversationId = await createConversation({
      campaignId,
      title: "Co-GM thinking",
    });
    expect(
      await readRowsAs(coGm, ASSISTANT_CONVERSATIONS_TABLE, "campaign_id", campaignId)
    ).toHaveLength(1);
    await signOut();

    // Demotion to player cuts off reads and writes at once.
    await signInAs(gm);
    await updateCampaignGM({
      campaignId,
      gmId: coGm.userId,
      shouldRemove: true,
    });
    await signOut();

    await waitFor(async () =>
      (await readRowsAs(coGm, ASSISTANT_CONVERSATIONS_TABLE, "campaign_id", campaignId)).length === 0
        ? true
        : null
    );
    expect(
      await readRowsAs(coGm, ASSISTANT_MESSAGES_TABLE, "conversation_id", coConversationId)
    ).toEqual([]);
    const demoted = await coGm.client
      .from(ASSISTANT_CONVERSATIONS_TABLE)
      .insert({
        id: crypto.randomUUID(),
        campaign_id: campaignId,
        owner_id: coGm.userId,
        title: "After demotion",
      });
    expect(demoted.error).not.toBeNull();

    // Re-promoted, the co-GM works again; removal from the campaign then
    // cuts them off the same way.
    await signInAs(gm);
    await updateCampaignGM({ campaignId, gmId: coGm.userId });
    await signOut();
    await signInAs(coGm);
    const returnedId = await createConversation({
      campaignId,
      title: "Back again",
    });
    await signOut();

    await signInAs(gm);
    const removed = await gm.client
      .from("campaign_members")
      .delete()
      .eq("campaign_id", campaignId)
      .eq("user_id", coGm.userId)
      .select("user_id");
    expect(removed.error).toBeNull();
    await signOut();

    await waitFor(async () =>
      (await readRowsAs(coGm, ASSISTANT_CONVERSATIONS_TABLE, "campaign_id", campaignId)).length === 0
        ? true
        : null
    );
    expect(
      await readRowsAs(coGm, ASSISTANT_CONVERSATIONS_TABLE, "id", returnedId)
    ).toEqual([]);
    const afterRemoval = await coGm.client
      .from(ASSISTANT_CONVERSATIONS_TABLE)
      .insert({
        id: crypto.randomUUID(),
        campaign_id: campaignId,
        owner_id: coGm.userId,
        title: "After removal",
      });
    expect(afterRemoval.error).not.toBeNull();

    // The owning GM keeps working throughout: a fresh conversation of
    // theirs reads back after all the demote/remove churn.
    await signInAs(gm);
    const gmConversationId = await createConversation({
      campaignId,
      title: "Owner thinking",
    });
    expect(
      await readRowsAs(gm, ASSISTANT_CONVERSATIONS_TABLE, "id", gmConversationId)
    ).toHaveLength(1);
    await signOut();
  });
});

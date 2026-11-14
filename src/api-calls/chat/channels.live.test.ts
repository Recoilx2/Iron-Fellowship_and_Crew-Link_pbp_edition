import { afterEach, describe, expect, it } from "vitest";

import { getSupabaseClient } from "config/supabase.config";
import { createCampaign } from "api-calls/campaign/createCampaign";
import { joinCampaign } from "api-calls/campaign/joinCampaign";
import { CampaignType } from "api-calls/campaign/_campaign.type";
import { CHAT_CHANNELS_TABLE } from "api-calls/chat/_getRef";
import { createChannel } from "api-calls/chat/createChannel";
import { renameChannel } from "api-calls/chat/renameChannel";
import { archiveChannel } from "api-calls/chat/archiveChannel";
import { listenToCampaignChannels } from "api-calls/chat/listenToCampaignChannels";
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

describe.skipIf(!config)("chat channels end to end", () => {
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
    player: LivePerson;
    outsider: LivePerson;
    campaignId: string;
  }> {
    const gm = await createPerson(cfg, "gm");
    const player = await createPerson(cfg, "player");
    const outsider = await createPerson(cfg, "outsider");
    people.push(gm, player, outsider);
    await signInAs(gm);
    const campaignId = await createCampaign({
      uid: gm.userId,
      campaignName: "Chatting quest",
      campaignType: CampaignType.Coop,
    });
    await signOut();
    await signInAs(player);
    await joinCampaign({ campaignId });
    await signOut();
    return { gm, player, outsider, campaignId };
  }

  async function readChannelsAs(person: LivePerson, campaignId: string) {
    const { data, error } = await person.client
      .from(CHAT_CHANNELS_TABLE)
      .select("id, name, kind, is_starting, archived")
      .eq("campaign_id", campaignId)
      .order("name");
    expect(error).toBeNull();
    return (data ?? []) as Array<{
      id: string;
      name: string;
      kind: string;
      is_starting: boolean;
      archived: boolean;
    }>;
  }

  it("creates the starting IC and OOC channels with the campaign", { timeout: 90000 }, async () => {
    const { gm, campaignId } = await setUpCampaign();

    const channels = await readChannelsAs(gm, campaignId);
    expect(channels).toHaveLength(2);
    expect(channels).toContainEqual(
      expect.objectContaining({
        name: "In character",
        kind: "IC",
        is_starting: true,
        archived: false,
      })
    );
    expect(channels).toContainEqual(
      expect.objectContaining({
        name: "Out of character",
        kind: "OOC",
        is_starting: true,
        archived: false,
      })
    );
  });

  it("lets only GMs create, rename and archive channels", { timeout: 120000 }, async () => {
    const { gm, player, campaignId } = await setUpCampaign();

    // The GM creates, renames, archives and reopens a scene channel.
    await signInAs(gm);
    const channelId = await createChannel({
      campaignId,
      name: "Side scene",
      kind: "OOC",
    });
    await renameChannel({ channelId, name: "Harbor side scene" });
    await archiveChannel({ channelId, archived: true });
    let channels = await readChannelsAs(gm, campaignId);
    expect(channels.find((row) => row.id === channelId)).toMatchObject({
      name: "Harbor side scene",
      archived: true,
    });
    await archiveChannel({ channelId, archived: false });
    channels = await readChannelsAs(gm, campaignId);
    expect(channels.find((row) => row.id === channelId)).toMatchObject({
      archived: false,
    });

    // A player can do none of those.
    await signOut();
    await signInAs(player);
    await expect(
      createChannel({ campaignId, name: "Sneaky", kind: "IC" })
    ).rejects.toBeTruthy();
    await expect(
      renameChannel({ channelId, name: "Hijacked" })
    ).rejects.toBeTruthy();
    await expect(
      archiveChannel({ channelId, archived: true })
    ).rejects.toBeTruthy();
    channels = await readChannelsAs(player, campaignId);
    expect(channels.find((row) => row.id === channelId)).toMatchObject({
      name: "Harbor side scene",
      archived: false,
    });

    // Even the GM cannot forge starting channels.
    const forged = await gm.client.from(CHAT_CHANNELS_TABLE).insert({
      id: crypto.randomUUID(),
      campaign_id: campaignId,
      name: "Fake start",
      kind: "IC",
      is_starting: true,
    });
    expect(forged.error).not.toBeNull();
  });

  it("keeps the starting channels unarchivable but renamable", { timeout: 90000 }, async () => {
    const { gm, campaignId } = await setUpCampaign();
    await signInAs(gm);

    const channels = await readChannelsAs(gm, campaignId);
    const starting = channels.filter((row) => row.is_starting);
    expect(starting).toHaveLength(2);

    // The GM renames a starting channel but cannot archive it.
    await renameChannel({
      channelId: starting[0].id,
      name: "Opening scene",
    });
    await expect(
      archiveChannel({ channelId: starting[0].id, archived: true })
    ).rejects.toBeTruthy();
    const reread = await readChannelsAs(gm, campaignId);
    expect(
      reread.find((row) => row.id === starting[0].id)
    ).toMatchObject({ name: "Opening scene", archived: false });
  });

  it("shows every channel to members and nothing to outsiders", { timeout: 90000 }, async () => {
    const { gm, player, outsider, campaignId } = await setUpCampaign();
    await signInAs(gm);
    await createChannel({ campaignId, name: "Side scene", kind: "IC" });

    // A member reads all three channels; an outsider reads none.
    expect(await readChannelsAs(player, campaignId)).toHaveLength(3);
    expect(await readChannelsAs(outsider, campaignId)).toEqual([]);

    // An outsider writes nothing: no rows, no creates, no renames.
    await signOut();
    await signInAs(outsider);
    await expect(
      createChannel({ campaignId, name: "Sneaky", kind: "IC" })
    ).rejects.toBeTruthy();
    const starting = await readChannelsAs(gm, campaignId);
    await expect(
      renameChannel({
        channelId: starting[0].id,
        name: "Hijacked",
      })
    ).rejects.toBeTruthy();
    const direct = await outsider.client
      .from(CHAT_CHANNELS_TABLE)
      .update({ name: "Hijacked" })
      .eq("campaign_id", campaignId)
      .select("id");
    expect(direct.error).toBeNull();
    expect(direct.data ?? []).toEqual([]);
  });

  it("streams new, renamed and archived channels live", { timeout: 120000 }, async () => {
    const { gm, player, campaignId } = await setUpCampaign();
    await signInAs(gm);

    const seen: Array<Array<{ id: string; name: string; archived: boolean }>> =
      [];
    let loaded = false;
    unsubscribes.push(
      listenToCampaignChannels(
        campaignId,
        {
          onChannels: (channels) =>
            seen.push(
              channels.map((channel) => ({
                id: channel.id,
                name: channel.name,
                archived: channel.archived,
              }))
            ),
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
    expect(seen.at(-1)).toHaveLength(2);

    // A channel the GM adds through another client arrives live.
    // No RETURNING clause: the chat_channels SELECT policy re-queries its
    // own table, which cannot see a just-inserted row in the same
    // statement, so insert-then-select always fails RLS (#69).
    const created = await gm.client.from(CHAT_CHANNELS_TABLE).insert({
      id: crypto.randomUUID(),
      campaign_id: campaignId,
      name: "Side scene",
      kind: "OOC",
    });
    expect(created.error).toBeNull();
    await waitFor(() =>
      seen.at(-1)?.some((channel) => channel.name === "Side scene")
        ? seen
        : null
    );

    // Renames and archives arrive live too.
    const added = seen
      .at(-1)
      ?.find((channel) => channel.name === "Side scene");
    expect(added).toBeTruthy();
    await renameChannel({
      channelId: added?.id as string,
      name: "Harbor side scene",
    });
    await waitFor(() =>
      seen.at(-1)?.some((channel) => channel.name === "Harbor side scene")
        ? seen
        : null
    );
    await archiveChannel({ channelId: added?.id as string, archived: true });
    await waitFor(() =>
      seen.at(-1)?.find((channel) => channel.name === "Harbor side scene")
        ?.archived
        ? seen
        : null
    );

    // The player's listener sees the same rows: nothing GM-only hides here.
    expect(await readChannelsAs(player, campaignId)).toHaveLength(3);
  });
});

import { describe, expect, it } from "vitest";

import {
  CHAT_CHANNELS_TABLE,
  CHAT_CHANNEL_MEMBERS_TABLE,
  channelMemberPayloadToChange,
  channelPayloadToChange,
  channelRowToDocument,
  constructCampaignChannelMembersChannelName,
  constructCampaignChannelsChannelName,
  constructCampaignChannelsFilter,
  type ChannelMemberRow,
  type ChannelRow,
} from "api-calls/chat/_getRef";

// Seam under test: the chat data layer is the only place that names the
// channels table, its live-update channel and its row shape. Stores and
// components only ever see channel documents.
function row(overrides: Partial<ChannelRow> = {}): ChannelRow {
  return {
    id: "channel-1",
    campaign_id: "campaign-1",
    name: "In character",
    kind: "IC",
    visibility: "public",
    is_starting: true,
    archived: false,
    created_by: "gm-1",
    created_at: "2026-11-13T12:00:00.000Z",
    updated_at: "2026-11-13T12:00:00.000Z",
    ...overrides,
  };
}

function memberRow(
  overrides: Partial<ChannelMemberRow> = {}
): ChannelMemberRow {
  return {
    channel_id: "channel-1",
    user_id: "player-1",
    created_at: "2026-11-13T12:00:00.000Z",
    ...overrides,
  };
}

describe("chat channel mapping", () => {
  it("names the channels table stores subscribe to", () => {
    expect(CHAT_CHANNELS_TABLE).toBe("chat_channels");
    expect(constructCampaignChannelsChannelName("campaign-1")).toBe(
      "campaign-channels:campaign-1"
    );
    expect(constructCampaignChannelsFilter("campaign-1")).toBe(
      "campaign_id=eq.campaign-1"
    );
  });

  it("reads a row as the channel document the tabs show", () => {
    expect(channelRowToDocument(row())).toEqual({
      name: "In character",
      kind: "IC",
      visibility: "public",
      isStarting: true,
      archived: false,
    });
    expect(
      channelRowToDocument(
        row({ name: "Side plot", kind: "OOC", is_starting: false, archived: true })
      )
    ).toEqual({
      name: "Side plot",
      kind: "OOC",
      visibility: "public",
      isStarting: false,
      archived: true,
    });
  });

  it("reads private and DM rows as restricted documents", () => {
    expect(
      channelRowToDocument(row({ name: "Side quest", visibility: "private" }))
    ).toMatchObject({ visibility: "private" });
    expect(
      channelRowToDocument(row({ name: "Direct message", visibility: "dm" }))
    ).toMatchObject({ visibility: "dm" });
    // Unknown values stay public-shaped rather than leaking a new kind.
    expect(channelRowToDocument(row({ visibility: "whisper" }))).toMatchObject(
      { visibility: "public" }
    );
  });

  it("names the roster channel the member lists subscribe to", () => {
    expect(CHAT_CHANNEL_MEMBERS_TABLE).toBe("chat_channel_members");
    expect(constructCampaignChannelMembersChannelName("campaign-1")).toBe(
      "campaign-channel-members:campaign-1"
    );
  });

  it("turns row events into upserts and deletes into removals", () => {
    const channel = row();
    expect(
      channelPayloadToChange({ eventType: "INSERT", new: channel, old: null })
    ).toEqual({ kind: "upsert", row: channel });
    expect(
      channelPayloadToChange({
        eventType: "DELETE",
        new: {},
        old: { id: "channel-1" },
      })
    ).toEqual({ kind: "remove", key: "channel-1" });
    expect(
      channelPayloadToChange({ eventType: "DELETE", new: {}, old: {} })
    ).toBeNull();
    expect(
      channelPayloadToChange({ eventType: "INSERT", new: {}, old: null })
    ).toBeNull();
  });

  it("turns roster events into upserts and removals keyed by channel and person", () => {
    const membership = memberRow();
    expect(
      channelMemberPayloadToChange({
        eventType: "INSERT",
        new: membership,
        old: null,
      })
    ).toEqual({ kind: "upsert", row: membership });
    expect(
      channelMemberPayloadToChange({
        eventType: "DELETE",
        new: {},
        old: { channel_id: "channel-1", user_id: "player-1" },
      })
    ).toEqual({ kind: "remove", key: "channel-1:player-1" });
    expect(
      channelMemberPayloadToChange({
        eventType: "DELETE",
        new: {},
        old: {},
      })
    ).toBeNull();
    expect(
      channelMemberPayloadToChange({ eventType: "INSERT", new: {}, old: null })
    ).toBeNull();
  });
});

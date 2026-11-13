import { describe, expect, it } from "vitest";

import {
  CHAT_CHANNELS_TABLE,
  channelPayloadToChange,
  channelRowToDocument,
  constructCampaignChannelsChannelName,
  constructCampaignChannelsFilter,
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
    is_starting: true,
    archived: false,
    created_by: "gm-1",
    created_at: "2026-11-13T12:00:00.000Z",
    updated_at: "2026-11-13T12:00:00.000Z",
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
      isStarting: false,
      archived: true,
    });
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
});

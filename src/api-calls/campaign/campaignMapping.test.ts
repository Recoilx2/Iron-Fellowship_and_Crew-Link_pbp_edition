import { describe, expect, it } from "vitest";

import {
  assembleCampaignDocuments,
  campaignMemberPayloadToChange,
  campaignPayloadToChange,
  campaignUpdateToColumns,
  type CampaignMemberRow,
  type CampaignRow,
} from "api-calls/campaign/_getRef";

function makeRow(overrides: Partial<CampaignRow> = {}): CampaignRow {
  return {
    id: "camp-1",
    name: "Fellowship",
    world_id: null,
    type: "guided",
    theme: null,
    custom_tracks: {},
    condition_meters: {},
    special_tracks: {},
    expansion_ids: [],
    hidden_asset_ids: [],
    hidden_oracle_ids: [],
    created_by: "user-1",
    created_at: "2026-11-12T00:00:00.000Z",
    updated_at: "2026-11-12T00:00:00.000Z",
    ...overrides,
  };
}

function makeMember(
  campaign_id: string,
  user_id: string,
  role: string
): CampaignMemberRow {
  return { campaign_id, user_id, role, created_at: "2026-11-12T00:00:00Z" };
}

describe("campaign row mapping", () => {
  it("assembles only the caller's campaigns with roster and characters", () => {
    const assembled = assembleCampaignDocuments(
      [makeRow(), makeRow({ id: "camp-2", name: "Other" })],
      [
        makeMember("camp-1", "user-1", "gm"),
        makeMember("camp-1", "user-2", "player"),
        makeMember("camp-2", "user-9", "gm"),
      ],
      [
        { id: "char-1", owner_id: "user-2", campaign_id: "camp-1" },
        { id: "char-9", owner_id: "user-9", campaign_id: "camp-2" },
      ],
      "user-1"
    );

    expect(assembled).toHaveLength(1);
    expect(assembled[0].id).toBe("camp-1");
    expect(assembled[0].doc).toMatchObject({
      name: "Fellowship",
      users: ["user-1", "user-2"],
      gmIds: ["user-1"],
      characters: [{ uid: "user-2", characterId: "char-1" }],
      type: "guided",
    });
  });

  it("maps optional campaign fields only when set", () => {
    const assembled = assembleCampaignDocuments(
      [
        makeRow({
          world_id: "world-1",
          theme: "dark",
          expansion_ids: ["exp-1"],
          hidden_asset_ids: ["asset-1"],
          hidden_oracle_ids: ["oracle-1"],
          custom_tracks: { doom: 1 },
          condition_meters: { health: 3 },
          special_tracks: { quest: {} },
        }),
      ],
      [makeMember("camp-1", "user-1", "player")],
      [],
      "user-1"
    );

    expect(assembled[0].doc).toMatchObject({
      worldId: "world-1",
      theme: "dark",
      expansionIds: ["exp-1"],
      hiddenAssetIds: ["asset-1"],
      hiddenOracleIds: ["oracle-1"],
      customTracks: { doom: 1 },
      conditionMeters: { health: 3 },
    });
  });

  it("merges dotted updates over the current row", () => {
    const columns = campaignUpdateToColumns(
      makeRow({ condition_meters: { health: 3 } }),
      { name: "Renamed", "conditionMeters.health": 4 } as never
    );

    expect(columns).toEqual({
      name: "Renamed",
      condition_meters: { health: 4 },
    });
  });

  it("ignores roster fields in campaign updates", () => {
    const columns = campaignUpdateToColumns(makeRow(), {
      users: ["user-1"],
      gmIds: ["user-1"],
      characters: [],
    });

    expect(columns).toEqual({});
  });

  it("turns row events into upserts and removals", () => {
    const row = makeRow();
    expect(
      campaignPayloadToChange({ eventType: "INSERT", new: row, old: null })
    ).toEqual({ kind: "upsert", row });
    expect(
      campaignPayloadToChange({
        eventType: "DELETE",
        new: {},
        old: { id: "camp-1" },
      })
    ).toEqual({ kind: "remove", key: "camp-1" });

    const member = makeMember("camp-1", "user-2", "player");
    expect(
      campaignMemberPayloadToChange({ eventType: "INSERT", new: member, old: null })
    ).toEqual({ kind: "upsert", row: member });
    expect(
      campaignMemberPayloadToChange({
        eventType: "DELETE",
        new: {},
        old: { campaign_id: "camp-1", user_id: "user-2" },
      })
    ).toEqual({ kind: "remove", key: "camp-1:user-2" });
  });
});

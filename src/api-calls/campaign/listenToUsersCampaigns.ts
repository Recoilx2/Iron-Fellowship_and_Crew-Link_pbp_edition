import { getSupabaseClient } from "config/supabase.config";
import { Unsubscribe } from "api-calls/helpers.type";
import {
  characterPayloadToChange,
  CHARACTERS_TABLE,
  type CharacterRow,
} from "api-calls/character/_getRef";
import { listenToRows } from "api-calls/realtime/listenToRows";
import { CampaignDocument } from "api-calls/campaign/_campaign.type";
import {
  assembleCampaignDocuments,
  CAMPAIGN_MEMBERS_TABLE,
  CAMPAIGNS_TABLE,
  campaignMemberKey,
  campaignMemberPayloadToChange,
  campaignPayloadToChange,
  constructUserCampaignCharactersChannelName,
  constructUserCampaignMembersChannelName,
  constructUserCampaignsChannelName,
  type CampaignCharacterLink,
  type CampaignMemberRow,
  type CampaignRow,
} from "./_getRef";

/**
 * Follows every campaign one person belongs to. Campaign rows, roster rows
 * and character links stream on three private channels gated by the same
 * access rules as the reads; each event re-assembles the documents, so a
 * lost roster row drops the campaign through onDocRemove at once.
 */
export function listenToUsersCampaigns(
  uid: string,
  dataHandler: {
    onDocChange: (id: string, data: CampaignDocument) => void;
    onDocRemove: (id: string) => void;
    onLoaded: () => void;
  },
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  onError: (error: any) => void
): Unsubscribe {
  const { onDocChange, onDocRemove, onLoaded } = dataHandler;
  if (!uid) {
    onError(new Error("Must be signed in to load your campaigns."));
    return () => {};
  }
  const client = getSupabaseClient();

  let campaignRows = new Map<string, CampaignRow>();
  let memberRows = new Map<string, CampaignMemberRow>();
  let characterLinks = new Map<string, CampaignCharacterLink>();
  let previous = new Map<string, CampaignDocument>();
  let settled = 0;
  let loaded = false;

  const emit = () => {
    const assembled = assembleCampaignDocuments(
      [...campaignRows.values()],
      [...memberRows.values()],
      [...characterLinks.values()],
      uid
    );
    const next = new Map(
      assembled.map((entry) => [entry.id, entry.doc] as const)
    );
    for (const [id, doc] of next) {
      const before = previous.get(id);
      if (!before || JSON.stringify(before) !== JSON.stringify(doc)) {
        onDocChange(id, doc);
      }
    }
    for (const id of previous.keys()) {
      if (!next.has(id)) {
        onDocRemove(id);
      }
    }
    previous = next;
  };

  const settledOnce = () => {
    settled += 1;
    if (settled >= 3 && !loaded) {
      loaded = true;
      onLoaded();
    }
  };

  const campaignsUnsubscribe = listenToRows<CampaignRow>({
    client,
    channelName: constructUserCampaignsChannelName(uid),
    bindings: [
      {
        type: "postgres_changes",
        table: CAMPAIGNS_TABLE,
        toChange: campaignPayloadToChange,
      },
    ],
    fetchRows: async () => {
      const { data, error } = await client.from(CAMPAIGNS_TABLE).select("*");
      if (error) {
        throw error;
      }
      return (data ?? []) as unknown as CampaignRow[];
    },
    getKey: (row) => row.id,
    getUpdatedAt: (row) => row.updated_at,
    onRows: (rows) => {
      campaignRows = new Map(rows.map((row) => [row.id, row]));
      emit();
      settledOnce();
    },
    onError,
  });

  const membersUnsubscribe = listenToRows<CampaignMemberRow>({
    client,
    channelName: constructUserCampaignMembersChannelName(uid),
    bindings: [
      {
        type: "postgres_changes",
        table: CAMPAIGN_MEMBERS_TABLE,
        toChange: campaignMemberPayloadToChange,
      },
    ],
    fetchRows: async () => {
      const { data, error } = await client
        .from(CAMPAIGN_MEMBERS_TABLE)
        .select("campaign_id, user_id, role");
      if (error) {
        throw error;
      }
      return (data ?? []) as unknown as CampaignMemberRow[];
    },
    getKey: (row) => campaignMemberKey(row),
    onRows: (rows) => {
      memberRows = new Map(rows.map((row) => [campaignMemberKey(row), row]));
      emit();
      settledOnce();
    },
    onError,
  });

  const charactersUnsubscribe = listenToRows<CharacterRow>({
    client,
    channelName: constructUserCampaignCharactersChannelName(uid),
    bindings: [
      {
        type: "postgres_changes",
        table: CHARACTERS_TABLE,
        toChange: characterPayloadToChange,
      },
    ],
    fetchRows: async () => {
      const { data, error } = await client
        .from(CHARACTERS_TABLE)
        .select("id, owner_id, campaign_id");
      if (error) {
        throw error;
      }
      return (data ?? []) as unknown as CharacterRow[];
    },
    getKey: (row) => row.id,
    getUpdatedAt: (row) => row.updated_at,
    onRows: (rows) => {
      characterLinks = new Map(
        rows.map((row) => [
          row.id,
          {
            id: row.id,
            owner_id: row.owner_id,
            campaign_id: row.campaign_id,
          } as CampaignCharacterLink,
        ])
      );
      emit();
      settledOnce();
    },
    onError,
  });

  return () => {
    campaignsUnsubscribe();
    membersUnsubscribe();
    charactersUnsubscribe();
  };
}

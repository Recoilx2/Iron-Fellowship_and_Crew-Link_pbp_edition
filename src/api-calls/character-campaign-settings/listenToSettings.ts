import { onSnapshot } from "firebase/firestore";
import { getSupabaseClient } from "config/supabase.config";
import { Unsubscribe } from "api-calls/helpers.type";
import { listenToRows } from "api-calls/realtime/listenToRows";
import { SettingsDocument } from "api-calls/character-campaign-settings/_character-campaign-settings.type";
import {
  getCampaignSettingsDoc,
  CHARACTER_SETTINGS_TABLE,
  characterSettingsPayloadToChange,
  characterSettingsRowToDocument,
  constructCharacterSettingsChannelName,
  constructCharacterSettingsFilter,
  type CharacterSettingsRow,
} from "./_getRef";

export function listenToSettings(
  campaignId: string | undefined,
  characterId: string | undefined,
  onSettings: (settings: SettingsDocument) => void,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  onError: (error: any) => void
): Unsubscribe {
  if (!campaignId && !characterId) {
    onError("Either campaign or character ID must be defined.");
    return () => {};
  }
  // Campaign settings stay on Firebase until the campaigns ticket ports them.
  if (campaignId) {
    return onSnapshot(
      getCampaignSettingsDoc(campaignId as string),
      (snapshot) => {
        onSettings({
          hiddenCustomMoveIds: [],
          hiddenCustomOraclesIds: [],
          customStats: [],
          customTracks: {},
          ...snapshot.data(),
        });
      },
      (error) => onError(error)
    );
  }
  if (!characterId) {
    onError("Either campaign or character ID must be defined.");
    return () => {};
  }
  const client = getSupabaseClient();
  return listenToRows<CharacterSettingsRow>({
    client,
    channelName: constructCharacterSettingsChannelName(characterId),
    bindings: [
      {
        type: "postgres_changes",
        table: CHARACTER_SETTINGS_TABLE,
        filter: constructCharacterSettingsFilter(characterId),
        toChange: characterSettingsPayloadToChange,
      },
    ],
    fetchRows: async () => {
      const { data, error } = await client
        .from(CHARACTER_SETTINGS_TABLE)
        .select("*")
        .eq("character_id", characterId);
      if (error) {
        throw error;
      }
      return (data ?? []) as unknown as CharacterSettingsRow[];
    },
    getKey: (row) => row.character_id,
    getUpdatedAt: (row) => row.updated_at,
    onRows: (rows) => {
      onSettings(characterSettingsRowToDocument(rows[0]));
    },
    onError,
  });
}

import { useEffect, useState } from "react";
import { Box, IconButton, Stack, TextField, Typography } from "@mui/material";
import SendIcon from "@mui/icons-material/Send";
import { useStore } from "stores/store";
import type { ChannelKind } from "api-calls/chat/_chat.type";
import type { ChannelWithId } from "api-calls/chat/listenToCampaignChannels";
import { createPost } from "api-calls/chat/createPost";
import { defaultChatSpeaker } from "./chatSpeaker";

/**
 * The channel composer (spec #9, prototype variant D): a "Posting as ..."
 * line, the text box with send, and nothing else yet. Image and roll
 * buttons join it in later tickets. Players have no speaker picker: the
 * channel kind picks the speaker, so switching channels switches voices.
 * GMs alone get a simple picker over the campaign world's NPC list, and
 * the voice resets whenever the channel switches. The text box keeps its
 * unsent draft per channel for the session.
 */
export function ChatComposer(props: { channel: ChannelWithId }) {
  const { channel } = props;
  const channelId = channel.id;
  const channelKind: ChannelKind = channel.kind;

  const uid = useStore((store) => store.auth.uid);
  const displayName = useStore(
    (store) => store.auth.user?.displayName ?? ""
  );
  const characterMap = useStore(
    (store) =>
      store.campaigns.currentCampaign.characters.characterMap ?? {}
  );
  const gmIds = useStore(
    (store) => store.campaigns.currentCampaign.currentCampaign?.gmIds ?? []
  );
  const worldId = useStore(
    (store) => store.campaigns.currentCampaign.currentCampaign?.worldId
  );
  const npcMap = useStore(
    (store) => store.worlds.currentWorld.currentWorldNPCs.npcMap ?? {}
  );
  const draft = useStore((store) => store.chat.drafts[channelId] ?? "");
  const setDraft = useStore((store) => store.chat.setDraft);

  const [sending, setSending] = useState(false);
  const [npcSpeakerId, setNpcSpeakerId] = useState<string | null>(null);
  useEffect(() => {
    setNpcSpeakerId(null);
  }, [channelId]);

  const myEntry = Object.entries(characterMap).find(
    ([, character]) => character.uid === uid
  );
  const myCharacter = myEntry?.[1];
  const isGM = gmIds.includes(uid);
  const npcs = Object.entries(npcMap).sort(([, a], [, b]) =>
    a.name.localeCompare(b.name)
  );
  // The picker is a GM tool over the campaign's world: players never see
  // it, and neither do GMs with no world or no NPCs to voice.
  const npcPicker = isGM && worldId != null && npcs.length > 0;
  const pickedNpc =
    npcPicker && npcSpeakerId ? (npcMap[npcSpeakerId] ?? undefined) : undefined;
  const speaker =
    pickedNpc && npcSpeakerId
      ? { characterId: null, npcId: npcSpeakerId }
      : defaultChatSpeaker(channelKind, myEntry?.[0]);
  const speakerCharacter = speaker.characterId
    ? characterMap[speaker.characterId]
    : undefined;
  const speakerName =
    pickedNpc?.name ?? speakerCharacter?.name ?? displayName ?? "Someone";

  const canSend = draft.trim().length > 0 && !sending;

  const send = () => {
    if (!canSend) {
      return;
    }
    setSending(true);
    createPost({
      channelId,
      text: draft,
      speakerCharacterId: speaker.characterId,
      speakerNpcId: speaker.npcId,
    })
      .then(() => {
        setDraft(channelId, "");
      })
      .catch(() => {})
      .finally(() => {
        setSending(false);
      });
  };

  return (
    <Box sx={{ borderTop: 1, borderColor: "divider", p: 1 }}>
      <Stack direction={"row"} spacing={1} alignItems={"center"} sx={{ px: 0.5, pb: 0.5 }}>
        <Typography variant={"body2"} color={"text.secondary"}>
          Posting as <b>{speakerName}</b>
          {isGM ? " (GM)" : ""}
          {channelKind === "OOC" && myCharacter
            ? ` · ${myCharacter.name} (out of character)`
            : ""}
        </Typography>
      </Stack>
      {npcPicker && (
        <Box sx={{ px: 0.5, pb: 0.5, maxWidth: 280 }}>
          <TextField
            select
            fullWidth
            size={"small"}
            label={"Voice"}
            value={npcSpeakerId ?? ""}
            onChange={(e) => setNpcSpeakerId(e.target.value || null)}
            SelectProps={{ native: true }}
            inputProps={{ "aria-label": "Posting as" }}
          >
            <option value={""}>Yourself</option>
            {npcs.map(([id, npc]) => (
              <option key={id} value={id}>
                {npc.name}
              </option>
            ))}
          </TextField>
        </Box>
      )}
      <Stack direction={"row"} spacing={1} alignItems={"flex-end"}>
        <TextField
          multiline
          maxRows={8}
          size={"small"}
          fullWidth
          placeholder={`Message # ${channel.name}`}
          inputProps={{ "aria-label": `Message # ${channel.name}` }}
          value={draft}
          onChange={(e) => setDraft(channelId, e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              send();
            }
          }}
        />
        <IconButton color={"primary"} disabled={!canSend} onClick={send} aria-label={"Send"}>
          <SendIcon />
        </IconButton>
      </Stack>
    </Box>
  );
}

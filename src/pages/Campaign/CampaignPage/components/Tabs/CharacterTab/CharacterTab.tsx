import { Button, Container, Grid, Stack, Typography } from "@mui/material";
import { CampaignType } from "api-calls/campaign/_campaign.type";
import { SectionHeading } from "components/shared/SectionHeading";
import { useCampaignType } from "hooks/useCampaignType";
import { useStore } from "stores/store";
import { UserCard } from "./UserCard";
import { useState } from "react";
import { CharacterCard } from "./CharacterCard";
import { AddCharacterDialog } from "./AddCharacterDialog";
import { SharedAssetSection } from "./SharedAssetSection";
import { groupCampaignCharactersByPlayer } from "./characterGrouping";

export interface CharacterTabProps {
  openInviteDialog: () => void;
}

export function CharacterTab(props: CharacterTabProps) {
  const { openInviteDialog } = props;
  const { campaignType } = useCampaignType();

  const users = useStore(
    (store) => store.campaigns.currentCampaign.currentCampaign?.users
  );

  const campaignId = useStore(
    (store) => store.campaigns.currentCampaign.currentCampaignId ?? ""
  );
  const characters = useStore(
    (store) => store.campaigns.currentCampaign.characters.characterMap
  );
  const currentUid = useStore((store) => store.auth.uid);
  const userMap = useStore((store) => store.users.userMap);
  const userName = (uid: string): string | undefined =>
    userMap[uid]?.doc?.displayName;

  const [addCharacterDialogOpen, setAddCharacterDialogOpen] =
    useState<boolean>(false);

  // Each player's characters read active-first (#127): their active
  // character on top, their retired ones under it.
  const groups = groupCampaignCharactersByPlayer(characters, users ?? []);

  return (
    <>
      <Stack spacing={2} sx={{ pb: 2 }}>
        <SectionHeading
          label={"Characters"}
          action={
            <Button
              color={"inherit"}
              variant={"outlined"}
              sx={{ ml: 1 }}
              onClick={() => setAddCharacterDialogOpen(true)}
            >
              Add a Character
            </Button>
          }
        />
        <Container maxWidth={false}>
          {groups.map((group) => (
            <Stack key={group.uid} spacing={1} sx={{ mb: 2 }}>
              <Typography variant={"subtitle1"} component={"h3"}>
                {group.uid === currentUid
                  ? "Your characters"
                  : (userName(group.uid) ?? "Characters")}
              </Typography>
              <Grid container spacing={2}>
                {group.characterIds.map((characterId) => (
                  <Grid item lg={12} xl={6} key={characterId} maxWidth={"100%"}>
                    <CharacterCard
                      characterId={characterId}
                      uid={characters[characterId].uid}
                      character={characters[characterId]}
                    />
                  </Grid>
                ))}
              </Grid>
            </Stack>
          ))}
        </Container>

        <SharedAssetSection />

        {campaignType !== CampaignType.Solo && (
          <>
            <SectionHeading
              label={"Players"}
              action={
                <Button
                  variant={"outlined"}
                  color={"inherit"}
                  onClick={openInviteDialog}
                >
                  Invite Players
                </Button>
              }
            />
            <Container maxWidth={false}>
              <Grid container spacing={2}>
                {(users ?? []).map((userId) => (
                  <Grid item xs={12} sm={6} lg={4} key={userId}>
                    <UserCard uid={userId} />
                  </Grid>
                ))}
              </Grid>
            </Container>
          </>
        )}
      </Stack>

      <AddCharacterDialog
        open={addCharacterDialogOpen}
        handleClose={() => setAddCharacterDialogOpen(false)}
        campaignId={campaignId}
      />
    </>
  );
}

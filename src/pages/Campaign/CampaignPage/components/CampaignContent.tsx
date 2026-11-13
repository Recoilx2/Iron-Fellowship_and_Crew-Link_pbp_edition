import { Card, useMediaQuery, useTheme } from "@mui/material";
import {
  ContainedTabPanel,
  StyledTab,
  StyledTabs,
} from "components/shared/StyledTabs";
import { useCampaignType } from "hooks/useCampaignType";
import { useUpdateQueryStringValueWithoutNavigation } from "hooks/useUpdateQueryStringValueWithoutNavigation";
import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import { CharacterTab, ChatTab, MyNotesTab, TracksTab, WorldTab } from "./Tabs";
import { useStore } from "stores/store";
import { NPCSection } from "components/features/worlds/NPCSection";
import { LoreSection } from "components/features/worlds/Lore";
import { LocationsSection } from "components/features/worlds/Locations";
import { CampaignTabs, DEFAULT_CAMPAIGN_TAB } from "./CampaignTabs";

export interface CampaignContentProps {
  openInviteDialog: () => void;
}

export function CampaignContent(props: CampaignContentProps) {
  const { openInviteDialog } = props;
  const { showGuideTips } = useCampaignType();

  const [searchParams] = useSearchParams();
  const [selectedTab, setSelectedTab] = useState<CampaignTabs>(
    (searchParams.get("tab") as CampaignTabs) ?? DEFAULT_CAMPAIGN_TAB
  );
  useUpdateQueryStringValueWithoutNavigation("tab", selectedTab);
  const handleTabChange = (tab: CampaignTabs) => {
    setSelectedTab(tab);
  };

  const hasWorld = useStore(
    (store) => !!store.campaigns.currentCampaign.currentCampaign?.worldId
  );

  // Phones navigate from the bottom bar inside the Chat panel (ticket
  // #122): the top strip stays out of the way below md, and the Chat tab
  // -- which carries that bottom bar -- is the screen, so a phone deep
  // link into another tab never strands the player without navigation.
  const theme = useTheme();
  const isPhone = useMediaQuery(theme.breakpoints.down("md"));
  const visibleTab = isPhone ? CampaignTabs.Chat : selectedTab;

  return (
    <Card
      variant={"outlined"}
      sx={{
        borderWidth: { xs: 0, md: 1 },
        borderTopWidth: { xs: 1 },
        mx: { xs: -2, sm: -3, md: 0 },
        height: "100%",
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
      }}
    >
      <StyledTabs
        value={selectedTab}
        onChange={(evt, value) => handleTabChange(value)}
        aria-label={"Campaign sections"}
        sx={(theme) => ({
          borderTopRightRadius: theme.shape.borderRadius,
          borderTopLeftRadius: theme.shape.borderRadius,
          // The bottom bar inside Chat is the whole phone navigation.
          display: { xs: "none", md: "flex" },
        })}
      >
        <StyledTab label="Chat" value={CampaignTabs.Chat} />
        <StyledTab label="Characters" value={CampaignTabs.Characters} />
        <StyledTab label="Tracks" value={CampaignTabs.Tracks} />
        {/* My notes is personal (spec #9, ticket #31): every campaign
            member gets the tab, including guided players. */}
        <StyledTab label="My notes" value={CampaignTabs.Notes} />
        <StyledTab label="World" value={CampaignTabs.World} />
        <StyledTab label="Locations" value={CampaignTabs.Locations} />
        <StyledTab label="NPCs" value={CampaignTabs.NPCs} />
        <StyledTab label="Lore" value={CampaignTabs.Lore} />
      </StyledTabs>
      <ContainedTabPanel isVisible={visibleTab === CampaignTabs.Chat}>
        <ChatTab openInviteDialog={openInviteDialog} />
      </ContainedTabPanel>
      <ContainedTabPanel isVisible={visibleTab === CampaignTabs.Characters}>
        <CharacterTab openInviteDialog={openInviteDialog} />
      </ContainedTabPanel>
      <ContainedTabPanel isVisible={visibleTab === CampaignTabs.Tracks}>
        <TracksTab />
      </ContainedTabPanel>
      <ContainedTabPanel
        excludePadding
        isVisible={visibleTab === CampaignTabs.Notes}
      >
        <MyNotesTab />
      </ContainedTabPanel>
      <ContainedTabPanel isVisible={visibleTab === CampaignTabs.World}>
        <WorldTab />
      </ContainedTabPanel>
      <ContainedTabPanel
        isVisible={visibleTab === CampaignTabs.Locations}
        greyBackground={hasWorld}
      >
        <LocationsSection
          showHiddenTag
          openNPCTab={() => setSelectedTab(CampaignTabs.NPCs)}
        />
      </ContainedTabPanel>
      <ContainedTabPanel
        isVisible={visibleTab === CampaignTabs.NPCs}
        greyBackground={hasWorld}
      >
        <NPCSection showHiddenTag={showGuideTips} />
      </ContainedTabPanel>
      <ContainedTabPanel
        isVisible={visibleTab === CampaignTabs.Lore}
        greyBackground={hasWorld}
      >
        <LoreSection showHiddenTag={showGuideTips} />
      </ContainedTabPanel>
    </Card>
  );
}

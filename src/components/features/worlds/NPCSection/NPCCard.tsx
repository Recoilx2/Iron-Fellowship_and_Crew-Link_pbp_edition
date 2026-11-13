import { LocationWithGMProperties } from "stores/world/currentWorld/locations/locations.slice.type";
import { NPCDocumentWithGMProperties } from "stores/world/currentWorld/npcs/npcs.slice.type";
import { CardWithImage } from "../common/CardWithImage";
import { VisibilityToggleButton } from "../common/VisibilityToggleButton";
import { mergeIcons } from "components/shared/GameIcons/mergeIcons";
import { IconColors } from "types/Icon.type";

export interface NPCCardProps {
  npc: NPCDocumentWithGMProperties;
  locations: { [key: string]: LocationWithGMProperties };
  openNPC: () => void;
  showHiddenTag?: boolean;
  showVisibilityToggle?: boolean;
  onVisibilityToggle?: () => void;
}

export function NPCCard(props: NPCCardProps) {
  const {
    npc,
    locations,
    openNPC,
    showHiddenTag,
    showVisibilityToggle,
    onVisibilityToggle,
  } = props;

  const npcLocation = npc.lastLocationId
    ? locations[npc.lastLocationId]
    : undefined;

  const icon = mergeIcons(
    { key: "GiPerson", color: IconColors.White },
    undefined,
    npc.icon
  );

  return (
    <CardWithImage
      name={npc.name}
      secondaryText={npcLocation?.name}
      imageUrl={npc.imageUrl}
      icon={icon}
      showHiddenTag={showHiddenTag && !npc.sharedWithPlayers}
      action={
        showVisibilityToggle && onVisibilityToggle ? (
          <VisibilityToggleButton
            sharedWithPlayers={npc.sharedWithPlayers}
            onToggle={onVisibilityToggle}
          />
        ) : undefined
      }
      handleClick={openNPC}
    />
  );
}

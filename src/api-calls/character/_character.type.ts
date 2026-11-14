import { Nullable } from "api-calls/helpers.type";
import { Themes } from "providers/ThemeProvider/themes/theme.types";

export type StatsMap = Record<string, number>;

export enum InitiativeStatus {
  HasInitiative = "initiative",
  DoesNotHaveInitiative = "noInitiative",
  OutOfCombat = "outOfCombat",
}

export interface SpecialTrack {
  value: number;
  // Starforged only
  spentExperience?: { [index: number]: boolean };
  isLegacy?: boolean;
}

export interface CharacterDocument {
  uid: string;

  campaignId?: Nullable<string>;

  /**
   * Whether the character is the player's active character in its
   * campaign (#127): at most one per player per campaign. Retired
   * characters stay in the campaign as inactive. Absent means active, for
   * documents written before the flag existed.
   */
  isActive?: boolean;

  // If the character is in a campaign, this ID will be ignored
  worldId?: Nullable<string>;

  name: string;
  stats: StatsMap;
  conditionMeters?: Record<string, number>; // Health, Sprit, Supply, etc.

  initiativeStatus?: InitiativeStatus;
  momentum: number;

  specialTracks?: Record<string, SpecialTrack>; // Bonds, Quests, Discoveries, etc.
  // Ironsworn only - starforged XP is stored on specialTracks
  experience?: {
    earned?: number;
    spent?: number;
  };

  debilities?: {
    [key: string]: boolean;
  };
  adds?: number;

  profileImage?: Nullable<{
    filename: string;
    position: {
      x: number;
      y: number;
    };
    scale: number;
  }>;

  expansionIds?: string[];
  customTracks?: {
    [trackName: string]: number;
  };

  theme?: Themes;
}

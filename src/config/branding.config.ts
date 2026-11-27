import { appDetails } from "config/appDetails.config";
import { getActiveRulesetId } from "data/activeRuleset";
import { Themes } from "providers/ThemeProvider/themes/theme.types";
import {
  GAME_SYSTEMS,
  GameSystemChooser,
  getValueForSystem,
} from "types/GameSystems.type";

/** Branding an operator's ruleset package can supply. */
export interface RulesetBranding {
  appName?: string;
  title?: string;
  description?: string;
  faviconPath?: string;
  openGraphPath?: string;
  theme?: Themes;
}

export interface AppBranding {
  appName: string;
  title: string;
  description: string;
  /** Theme-derived default icon; used only when no package favicon is set. */
  faviconPath: string;
  /** Explicit favicon from the active ruleset package, if it supplied one. */
  mountedFaviconPath?: string;
  openGraphPath: string;
  theme: Themes;
}

const shippedAppNames: GameSystemChooser<string> = {
  [GAME_SYSTEMS.IRONSWORN]: "Iron Fellowship",
  [GAME_SYSTEMS.STARFORGED]: "Crew Link",
};

const shippedThemes: GameSystemChooser<Themes> = {
  [GAME_SYSTEMS.IRONSWORN]: Themes.Sunset,
  [GAME_SYSTEMS.STARFORGED]: Themes.Eidolon,
};

const shippedFavicons: Record<Themes, string> = {
  [Themes.Sunset]: "/theme/sunset.svg",
  [Themes.Hinterlands]: "/theme/hinterlands.svg",
  [Themes.Eidolon]: "/theme/eidolon.svg",
  [Themes.Myriad]: "/theme/myriad.svg",
};

let mountedBranding: RulesetBranding | undefined;

export function applyMountedBranding(branding?: RulesetBranding): void {
  mountedBranding = branding;
}

export function resetBranding(): void {
  mountedBranding = undefined;
}

/** Branding for the given ruleset, with the shipped games kept unchanged. */
export function getAppBranding(rulesetId = getActiveRulesetId()): AppBranding {
  const details = getValueForSystem(appDetails, rulesetId);
  const theme = getValueForSystem(shippedThemes, rulesetId);
  const defaultFavicon = shippedFavicons[theme];
  const openGraphFolder = getValueForSystem(
    {
      [GAME_SYSTEMS.IRONSWORN]: "ironsworn",
      [GAME_SYSTEMS.STARFORGED]: "starforged",
    },
    rulesetId,
  );

  return {
    appName: getValueForSystem(shippedAppNames, rulesetId),
    title: details.title,
    description: details.description,
    faviconPath: defaultFavicon,
    ...(mountedBranding?.faviconPath
      ? { mountedFaviconPath: mountedBranding.faviconPath }
      : {}),
    openGraphPath: `/assets/${openGraphFolder}/opengraph-default.png`,
    theme,
    ...(mountedBranding ?? {}),
  };
}

import { Datasworn } from "@datasworn-community/core";
import { logError } from "functions/errorReference";
import {
  getActiveRulesetId,
  setActiveRulesetId,
} from "data/activeRuleset";
import { applyMountedBranding } from "config/branding.config";
import { applyMechanics } from "config/mechanics.config";
import {
  loadMountedManifest,
  parseRulesetBranding,
  parseRulesetMechanics,
} from "./mountedRulesets";

export interface IRulesetConfig {
  id: string;
  name: string;
  type: "ruleset";
  isHomebrew: false;
  load: () => Promise<Datasworn.Ruleset>;
}

export interface IExpansionConfig {
  id: string;
  name: string;
  type: "expansion";
  isHomebrew: boolean;
  /** Advisory text shown as a tooltip beside the expansion's name. */
  note?: string;
  licenseInfo?: {
    license: string;
    licenseUrl: string;
    url?: string;
    author: string;
  };
  load: () => Promise<Datasworn.Expansion>;
}

export type IPackageConfig = IRulesetConfig | IExpansionConfig;

// ─── Rulesets ────────────────────────────────────────────────────────────────

export const ironswornConfig: IRulesetConfig = {
  id: "classic",
  name: "Ironsworn",
  type: "ruleset",
  isHomebrew: false,
  load: async () => {
    const { classic } = await import("@datasworn-community/ironsworn-classic");
    return classic;
  },
};

export const starforgedConfig: IRulesetConfig = {
  id: "starforged",
  name: "Starforged",
  type: "ruleset",
  isHomebrew: false,
  load: async () => {
    const { starforged } = await import("@datasworn-community/starforged");
    return starforged;
  },
};

// ─── Official Ironsworn Expansions ────────────────────────────────────────────

export const ironswornDelveConfig: IExpansionConfig = {
  id: "delve",
  name: "Ironsworn: Delve",
  type: "expansion",
  isHomebrew: false,
  load: async () => {
    const { delve } = await import(
      "@datasworn-community/ironsworn-classic-delve"
    );
    return delve;
  },
};

export const ironswornLodestarConfig: IExpansionConfig = {
  id: "lodestar",
  name: "Ironsworn Lodestar",
  type: "expansion",
  isHomebrew: false,
  note: "Requires Ironsworn: Delve",
  load: async () => {
    const { lodestar } = await import(
      "@datasworn-community/ironsworn-classic-lodestar"
    );
    return lodestar;
  },
};

export const ironswornGiveawaysConfig: IExpansionConfig = {
  id: "giveaways_classic",
  name: "Giveaway Assets",
  type: "expansion",
  isHomebrew: false,
  note: "Some assets reference content from Ironsworn: Delve.",
  load: async () => {
    const { giveaways_classic } = await import(
      "@datasworn-community/ironsworn-classic-giveaways"
    );
    return giveaways_classic;
  },
};

// ─── Official Starforged Expansions ──────────────────────────────────────────

export const sunderedIslesConfig: IExpansionConfig = {
  id: "sundered_isles",
  name: "Sundered Isles",
  type: "expansion",
  isHomebrew: false,
  load: async () => {
    const { sundered_isles } = await import(
      "@datasworn-community/sundered-isles"
    );
    return sundered_isles;
  },
};

export const starforgedGiveawaysConfig: IExpansionConfig = {
  id: "giveaways_starforged",
  name: "Giveaway Assets",
  type: "expansion",
  isHomebrew: false,
  load: async () => {
    const { giveaways_starforged } = await import(
      "@datasworn-community/starforged-giveaways"
    );
    return giveaways_starforged;
  },
};

// ─── Community Content ────────────────────────────────────────────────────────

export const ironsmithConfig: IExpansionConfig = {
  id: "ironsmith",
  name: "Ironsmith",
  type: "expansion",
  isHomebrew: true,
  licenseInfo: {
    license: "CC BY 4.0",
    licenseUrl: "https://creativecommons.org/licenses/by/4.0/",
    url: "https://playeveryrole.com/",
    author: "Eric Bright",
  },
  load: async () => {
    const { ironsmith } = await import("@datasworn-community/ironsmith");
    return ironsmith;
  },
};

export const starsmithConfig: IExpansionConfig = {
  id: "starsmith",
  name: "Starsmith Expanded Oracles",
  type: "expansion",
  isHomebrew: true,
  licenseInfo: {
    license: "CC BY 4.0",
    licenseUrl: "https://creativecommons.org/licenses/by/4.0/",
    url: "https://playeveryrole.com/",
    author: "Eric Bright",
  },
  load: async () => {
    const { starsmith } = await import("@datasworn-community/starsmith");
    return starsmith;
  },
};

// Fe-Runners is not ready to expose yet.
// export const feRunnersConfig: IExpansionConfig = {
//   id: "fe_runners",
//   name: "Fe-Runners",
//   type: "expansion",
//   isHomebrew: true,
//   licenseInfo: {
//     license: "CC BY-NC-SA 4.0",
//     licenseUrl: "https://creativecommons.org/licenses/by-nc-sa/4.0/",
//     url: "https://zombiecraig.itch.io/",
//     author: "Craig Smith",
//   },
//   load: async () => {
//     const { fe_runners } = await import("@datasworn-community/fe-runners");
//     return fe_runners;
//   },
// };

// ─── Organized Collections ───────────────────────────────────────────────────

export const includedRulesets: Record<string, IRulesetConfig> = {
  [ironswornConfig.id]: ironswornConfig,
  [starforgedConfig.id]: starforgedConfig,
};

/** All expansions organized by their parent ruleset id. */
export const includedExpansions: Record<
  string,
  Record<string, IExpansionConfig>
> = {
  [ironswornConfig.id]: {
    [ironswornDelveConfig.id]: ironswornDelveConfig,
    [ironswornLodestarConfig.id]: ironswornLodestarConfig,
    [ironswornGiveawaysConfig.id]: ironswornGiveawaysConfig,
    [ironsmithConfig.id]: ironsmithConfig,
  },
  [starforgedConfig.id]: {
    [sunderedIslesConfig.id]: sunderedIslesConfig,
    [starforgedGiveawaysConfig.id]: starforgedGiveawaysConfig,
    [starsmithConfig.id]: starsmithConfig,
    // [feRunnersConfig.id]: feRunnersConfig,
  },
};

// ─── Backward-Compatible Lazy-Loaded Exports ─────────────────────────────────
// These preserve the existing interface expected by rules.slice.ts,
// homebrew.slice.ts, useDataswornTree.ts, and baseRules.ts.

let ruleset: Datasworn.Ruleset | undefined = undefined;
const defaultExpansions: Record<string, Datasworn.Expansion> = {};
const thirdPartyExpansions: Record<string, Datasworn.Expansion> = {};

const rulesetLoadPromises: Record<string, Promise<Datasworn.Ruleset>> = {};
const expansionLoadPromises: Record<string, Promise<Datasworn.Expansion>> = {};

export function preloadActiveRuleset(): Promise<Datasworn.Ruleset> {
  return loadIncludedRuleset(getActiveRulesetId());
}

export function findIncludedExpansionConfig(
  expansionId: string
): IExpansionConfig | undefined {
  for (const expansions of Object.values(includedExpansions)) {
    const config = expansions[expansionId];
    if (config) {
      return config;
    }
  }
}

let mountedPackagesRegistration: Promise<void> | undefined;

/**
 * Adds operator-supplied packages to the same registries the built-ins use,
 * so rebuildRules(), useDataswornTree(), homebrew loading and the expansion
 * selector all see them. Called from bootstrapRules(), before any consumer
 * reads the derived defaults. A replacing ruleset also becomes the active
 * base id and supplies branding and mechanics overrides from its package.
 */
export function registerMountedPackages(): Promise<void> {
  mountedPackagesRegistration ??= loadMountedManifest(getActiveRulesetId())
    .then(({ packages }) => {
      // Register rulesets first: a replacing ruleset changes the active id
      // that its accompanying expansions must be filed under.
      const ordered = [...packages].sort(
        (a, b) => (b.ref.type === "ruleset" ? 1 : 0) - (a.ref.type === "ruleset" ? 1 : 0),
      );
      for (const { ref, data } of ordered) {
        if (ref.type === "ruleset") {
          if (includedRulesets[ref.id]) {
            logError(
              "rulesets",
              new Error(`mounted ruleset id collides with a built-in: ${ref.id}`),
            );
            continue;
          }
          const ruleset = data as Datasworn.Ruleset;
          includedRulesets[ref.id] = {
            id: ref.id,
            name: ref.name,
            type: "ruleset",
            isHomebrew: false,
            load: async () => ruleset,
          };
          if (ref.replacesBase) {
            setActiveRulesetId(ref.id);
            applyMountedBranding(parseRulesetBranding(data));
            applyMechanics(parseRulesetMechanics(data));
          }
        } else if (findIncludedExpansionConfig(ref.id)) {
          logError(
            "rulesets",
            new Error(`mounted expansion id collides with a known id: ${ref.id}`),
          );
        } else {
          const expansion = data as Datasworn.Expansion;
          const config: IExpansionConfig = {
            id: ref.id,
            name: ref.name,
            type: "expansion",
            isHomebrew: ref.isHomebrew ?? true,
            note: ref.note,
            licenseInfo: ref.licenseInfo,
            load: async () => expansion,
          };
          (includedExpansions[getActiveRulesetId()] ??= {})[ref.id] = config;
          thirdPartyExpansions[ref.id] = expansion;
        }
      }
    })
    .catch((e) => logError("rulesets", e));
  return mountedPackagesRegistration;
}

/** Clears the cached registration for tests that change the mounted manifest. */
export function resetMountedPackagesRegistration(): void {
  mountedPackagesRegistration = undefined;
}

export async function loadIncludedRuleset(
  rulesetId = getActiveRulesetId(),
): Promise<Datasworn.Ruleset> {
  if (ruleset?._id === rulesetId) {
    return ruleset;
  }

  const config = includedRulesets[rulesetId];
  if (!config) {
    throw new Error(`Unknown included ruleset: ${rulesetId}`);
  }

  rulesetLoadPromises[rulesetId] ??= config.load().then((loadedRuleset) => {
    if (rulesetId === getActiveRulesetId()) {
      ruleset = loadedRuleset;
    }
    return loadedRuleset;
  });

  return rulesetLoadPromises[rulesetId];
}

export async function loadIncludedExpansion(
  expansionId: string
): Promise<Datasworn.Expansion | undefined> {
  const existingExpansion =
    defaultExpansions[expansionId] ?? thirdPartyExpansions[expansionId];
  if (existingExpansion) {
    return existingExpansion;
  }

  const config = findIncludedExpansionConfig(expansionId);
  if (!config) {
    return undefined;
  }

  expansionLoadPromises[expansionId] ??= config.load().then((expansion) => {
    if (config.isHomebrew) {
      thirdPartyExpansions[expansion._id] = expansion;
    } else {
      defaultExpansions[expansion._id] = expansion;
    }
    return expansion;
  });

  return expansionLoadPromises[expansionId];
}

preloadActiveRuleset().catch((e) => logError("rulesets", e));

export { ruleset, defaultExpansions, thirdPartyExpansions };

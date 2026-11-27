import { getSystem } from "hooks/useGameSystem";
import { GAME_SYSTEMS } from "types/GameSystems.type";

/** The ruleset config id used by the two shipped game systems. */
export const SHIPPED_RULESET_IDS: Record<string, string> = {
  [GAME_SYSTEMS.IRONSWORN]: "classic",
  [GAME_SYSTEMS.STARFORGED]: "starforged",
};

function configuredRulesetId(): string {
  const system = getSystem();
  return SHIPPED_RULESET_IDS[system] ?? system;
}

/**
 * The id of the base ruleset this site is running. Without a mounted
 * replacement it follows the configured game (including local switching);
 * a manifest declaring `replacesBase` pins it to the operator's ruleset.
 * Keeping the choice in one module lets the formerly two-value helpers —
 * game system, branding, mechanics and homebrew selectors — agree on one id.
 */
let replacingRulesetId: string | undefined;

export function getActiveRulesetId(): string {
  return replacingRulesetId ?? configuredRulesetId();
}

export function setActiveRulesetId(id: string): void {
  replacingRulesetId = id;
}

/** Restores the configured id; used by tests and local development. */
export function resetActiveRulesetId(): void {
  replacingRulesetId = undefined;
}

export function isShippedRuleset(id = getActiveRulesetId()): boolean {
  return id === SHIPPED_RULESET_IDS[GAME_SYSTEMS.IRONSWORN] ||
    id === SHIPPED_RULESET_IDS[GAME_SYSTEMS.STARFORGED];
}

/** Shipped Starforged keeps its legacy/assets/world wording; replacements reuse Ironsworn defaults. */
export function isStarforgedRuleset(id = getActiveRulesetId()): boolean {
  return id === GAME_SYSTEMS.STARFORGED;
}

export function isIronswornRuleset(id = getActiveRulesetId()): boolean {
  return id === SHIPPED_RULESET_IDS[GAME_SYSTEMS.IRONSWORN];
}

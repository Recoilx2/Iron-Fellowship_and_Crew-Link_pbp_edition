export enum GAME_SYSTEMS {
  IRONSWORN = "ironsworn",
  STARFORGED = "starforged",
}

/**
 * A lookup keyed by the two shipped games. Calls for an unknown id (an
 * operator-supplied base ruleset) fall back to the Ironsworn entry: a
 * replacement ruleset reuses Ironsworn mechanics unless it overrides them.
 */
export type GameSystemChooser<T> = { [key in GAME_SYSTEMS]: T } & {
  [key: string]: T | undefined;
};

// The shipped Ironsworn ruleset's config id is "classic", while its game
// system id is "ironsworn". Both address the same chooser entry.
const RULESET_ID_ALIASES: Record<string, string> = { classic: GAME_SYSTEMS.IRONSWORN };

export function getValueForSystem<T>(
  values: GameSystemChooser<T>,
  system: string,
): T {
  const alias = RULESET_ID_ALIASES[system];
  return values[system] ?? (alias ? values[alias] : undefined) ?? values[GAME_SYSTEMS.IRONSWORN];
}

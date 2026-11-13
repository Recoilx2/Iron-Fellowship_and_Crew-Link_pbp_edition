import type { Datasworn } from "@datasworn-community/core";

/**
 * What the chat move picker offers for one move (spec #9, ticket #123): every
 * action roll option across every trigger condition, not just stats.
 * Condition meters roll their meter (Resupply rolls Supply), fixed values
 * roll as-is, and asset-backed options are shown but roll from the character
 * sheet, where the speaker's assets live.
 */
export type ChatMoveRollOption =
  | { kind: "stat"; key: string }
  | { kind: "condition_meter"; key: string }
  | { kind: "custom"; key: string; label: string; value: number }
  | { kind: "asset"; key: string; label: string };

/** Every move with an action roll is offered, whatever it rolls with. */
export function isActionRollMove(move: Datasworn.Move): boolean {
  return move.roll_type === "action_roll";
}

export function getMoveRollOptions(
  move: Datasworn.Move
): ChatMoveRollOption[] {
  // Only action rolls offer options; narrowing here keeps the trigger's
  // option type exact.
  if (move.roll_type !== "action_roll") {
    return [];
  }
  const options: ChatMoveRollOption[] = [];
  const seen = new Set<string>();
  const conditions = move.trigger?.conditions ?? [];
  for (const condition of conditions) {
    for (const option of condition.roll_options ?? []) {
      const found = toChatMoveRollOption(option);
      if (!found) {
        continue;
      }
      const identity = `${found.kind}:${found.key}`;
      if (seen.has(identity)) {
        continue;
      }
      seen.add(identity);
      options.push(found);
    }
  }
  return options;
}

function toChatMoveRollOption(
  option: Datasworn.RollableValue
): ChatMoveRollOption | undefined {
  switch (option.using) {
    case "stat":
      return { kind: "stat", key: option.stat };
    case "condition_meter":
      return { kind: "condition_meter", key: option.condition_meter };
    case "custom":
      return {
        kind: "custom",
        key: `${option.label}:${option.value}`,
        label: option.label,
        value: option.value,
      };
    case "asset_control":
    case "attached_asset_control":
      return { kind: "asset", key: option.control, label: option.control };
    case "asset_option":
    case "attached_asset_option":
      return { kind: "asset", key: option.option, label: option.option };
    default:
      return undefined;
  }
}

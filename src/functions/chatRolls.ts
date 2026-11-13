import {
  lookupRollableOracle,
  resolveOracleRoll,
} from "stores/appState/rollers/resolveOracleRoll";
import {
  CustomDiceRoll,
  OracleTableRoll,
  ROLL_TYPE,
  Roll,
  StatRoll,
} from "types/DieRolls.type";
import { getRollResultLabel } from "components/features/charactersAndCampaigns/RollDisplay/getRollResultLabel";
import { markdownToPlainText } from "functions/rollText";
import { scoreStatRoll } from "stores/appState/rollers/scoreStatRoll";

/**
 * The composer's rolls (spec #9): move, stat, ask-the-oracle, oracle table
 * and custom dice results computed for the draft. A finished roll attaches
 * to the draft, the player adds text, and sending posts both to the current
 * channel as the current speaker. Rolls made elsewhere in a campaign join
 * the same feed: they post to the starting IC channel as chat roll posts
 * (ticket #30).
 *
 * Dice come from an injected roller, so the rules -- odds, outcomes, roll
 * shapes -- are pinned by unit tests with known-good dice. The interface
 * passes the real dice (with their animation and fallback) at roll time.
 */

export interface DiceGroupInput {
  qty: number;
  sides: number;
}

export interface DiceRoller {
  /** Rolls each group in order and returns every die's value. */
  rollGroups(groups: DiceGroupInput[]): Promise<number[]>;
  /** Rolls one expression such as 1d100, or undefined when it is not dice. */
  rollExpression(expression: string): Promise<number | undefined>;
}

export interface ChatRollContext {
  characterId: string | null;
  uid: string;
  /** The GM's eye toggle: hidden GM rolls post GM-only. */
  gmsOnly: boolean;
  /** The rolling character's momentum, for the negative-momentum rule. */
  momentum?: number;
}

export interface ParsedDiceNotation {
  groups: DiceGroupInput[];
  modifier: number;
}

const NOTATION_TERM = /([+-]?)(?:(\d*)d(\d+)|(\d+))/;

function parseTerm(
  term: string
): { qty: number; sides: number } | { modifier: number } | undefined {
  const match = NOTATION_TERM.exec(term);
  if (!match || match[0] !== term) {
    return undefined;
  }
  const [, sign, qtyText, sidesText, modifierText] = match;
  const negative = sign === "-";
  if (modifierText !== undefined) {
    const value = parseInt(modifierText, 10);
    return { modifier: negative ? -value : value };
  }
  const qty = qtyText === "" ? 1 : parseInt(qtyText, 10);
  const sides = parseInt(sidesText, 10);
  if (qty < 1 || qty > 60 || sides < 2) {
    return undefined;
  }
  return { qty, sides };
}

/**
 * Reads dice notation with an optional modifier, extended beyond the
 * single-group parser to mixed dice such as 2d6+1d8+2. Spacing and case
 * are ignored. Anything that is not dice with an optional modifier is
 * refused.
 */
export function parseMixedDiceNotation(
  notation: string
): ParsedDiceNotation | undefined {
  const compact = notation.replace(/\s+/g, "").toLowerCase();
  if (!compact) {
    return undefined;
  }
  const terms = compact.match(/[+-]?[^+-]+/g);
  if (!terms || terms.join("") !== compact) {
    return undefined;
  }
  const groups: DiceGroupInput[] = [];
  let modifier = 0;
  let sawDice = false;
  for (const term of terms) {
    const parsed = parseTerm(term);
    if (!parsed) {
      return undefined;
    }
    if ("sides" in parsed) {
      sawDice = true;
      groups.push({ qty: parsed.qty, sides: parsed.sides });
    } else {
      modifier += parsed.modifier;
    }
  }
  if (!sawDice || groups.reduce((total, g) => total + g.qty, 0) > 60) {
    return undefined;
  }
  return { groups, modifier };
}

/** Keeps the words of a Datasworn result and drops the link markup. */
export function stripDataswornLinks(text: string): string {
  return text.replace(/\[([^\]]+)\]\([^)]*\)/g, "$1");
}

export interface StatRollInput {
  modifier: number;
  adds?: number;
  move?: { name: string; id: string };
}

/**
 * Rolls a stat (a move's stat or a bare stat) with adds: an action die and
 * two challenge dice, capped at ten, with the negative-momentum rule, in
 * the app's existing stat roll shape.
 */
export async function rollChatStat(
  label: string,
  input: StatRollInput,
  context: ChatRollContext,
  roller: DiceRoller
): Promise<StatRoll> {
  const { modifier, adds, move } = input;
  const values = await roller.rollGroups([
    { qty: 2, sides: 10 },
    { qty: 1, sides: 6 },
  ]);
  const [challenge1, challenge2, action] = values;

  const { result, matchedNegativeMomentum } = scoreStatRoll({
    action,
    modifier,
    adds,
    challenge1,
    challenge2,
    momentum: context.momentum,
  });

  const roll: StatRoll = {
    type: ROLL_TYPE.STAT,
    action,
    modifier,
    challenge1,
    challenge2,
    result,
    rollLabel: label,
    timestamp: new Date(),
    characterId: context.characterId,
    uid: context.uid,
    gmsOnly: context.gmsOnly,
    matchedNegativeMomentum,
  };
  if (adds) {
    roll.adds = adds;
  }
  if (move) {
    roll.moveName = move.name;
    roll.moveId = move.id;
  }
  return roll;
}

/**
 * Rolls an oracle table by id in the app's existing oracle roll shape,
 * resolving legacy ids the way the game log roller does. Unrollable
 * collections and unknown tables roll nothing. The resolution is shared with
 * the sheet roller; only the link stripping stays here, as before.
 */
export async function rollChatOracleTable(
  oracleId: string,
  context: ChatRollContext,
  roller: DiceRoller
): Promise<OracleTableRoll | undefined> {
  const oracle = lookupRollableOracle(oracleId);
  const roll = await resolveOracleRoll(oracle, roller, context);
  if (!roll) {
    return undefined;
  }
  const stripped: OracleTableRoll = {
    ...roll,
    result: stripDataswornLinks(roll.result),
  };
  if (roll.text2) {
    stripped.text2 = stripDataswornLinks(roll.text2);
  }
  if (roll.text3) {
    stripped.text3 = stripDataswornLinks(roll.text3);
  }
  return stripped;
}

/**
 * Rolls custom dice notation -- single or mixed -- in the app's existing
 * custom dice shape, extended additively with a per-group breakdown for
 * mixed dice. Old single-group rolls keep their exact shape.
 */
export async function rollChatCustomDice(
  notation: string,
  context: ChatRollContext,
  roller: DiceRoller
): Promise<CustomDiceRoll> {
  const parsed = parseMixedDiceNotation(notation);
  if (!parsed) {
    throw new Error("That is not dice notation. Try 2d6+1d8+2.");
  }
  const clean = notation.replace(/\s+/g, "");
  const values = await roller.rollGroups(parsed.groups);
  const total = values.reduce((sum, value) => sum + value, 0) + parsed.modifier;

  const roll: CustomDiceRoll = {
    type: ROLL_TYPE.CUSTOM_DICE,
    notation: clean,
    dieSides: parsed.groups[0].sides,
    dieValues: values,
    modifier: parsed.modifier,
    total,
    rollLabel: clean,
    timestamp: new Date(),
    characterId: context.characterId,
    uid: context.uid,
    gmsOnly: context.gmsOnly,
  };
  if (parsed.groups.length > 1) {
    let cursor = 0;
    roll.dieGroups = parsed.groups.map((group) => {
      const dieValues = values.slice(cursor, cursor + group.qty);
      cursor += group.qty;
      return { dieSides: group.sides, dieValues };
    });
  }
  return roll;
}

/**
 * The dark one-line summary beside a roll post (spec #9, prototype variant
 * D): the title lives on the button, this is the result beside it, e.g.
 * Face Danger "Weak hit · 6 vs 3, 8".
 */
export function getChatRollSummary(roll: Roll): string {
  switch (roll.type) {
    case ROLL_TYPE.STAT: {
      const total = Math.min(
        10,
        (roll.matchedNegativeMomentum ? 0 : roll.action) +
          (roll.modifier ?? 0) +
          (roll.adds ?? 0)
      );
      return `${getRollResultLabel(roll.result)} · ${total} vs ${roll.challenge1}, ${roll.challenge2}`;
    }
    case ROLL_TYPE.TRACK_PROGRESS:
      return `${getRollResultLabel(roll.result)} · ${roll.trackProgress} vs ${roll.challenge1}, ${roll.challenge2}`;
    case ROLL_TYPE.ORACLE_TABLE:
    case ROLL_TYPE.CLOCK_PROGRESSION: {
      const rolls = Array.isArray(roll.roll) ? roll.roll.join(", ") : roll.roll;
      const result = markdownToPlainText(roll.result);
      return `${result} (${rolls})`;
    }
    case ROLL_TYPE.CUSTOM_DICE:
      return `${roll.total} (${roll.dieValues.join(" + ")})`;
  }
}

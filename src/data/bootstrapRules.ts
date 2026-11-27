import { Datasworn } from "@datasworn-community/core";
import { getActiveRulesetId } from "data/activeRuleset";
import { applyBaseRules } from "stores/rules/baseRules";
import { loadIncludedRuleset, registerMountedPackages } from "./rulesets";

/**
 * The async bootstrap seam. Registration must finish before the active id
 * and the ruleset defaults are read: a mounted manifest may replace the
 * base ruleset outright, and branding/mechanics overrides are applied while
 * it registers. main.tsx awaits this before rendering; the store's
 * loadBaseRuleset() uses the same function so both paths see one ruleset.
 */
export async function bootstrapRules(): Promise<Datasworn.Ruleset> {
  await registerMountedPackages();
  const ruleset = await loadIncludedRuleset();
  applyBaseRules(ruleset, getActiveRulesetId());
  return ruleset;
}

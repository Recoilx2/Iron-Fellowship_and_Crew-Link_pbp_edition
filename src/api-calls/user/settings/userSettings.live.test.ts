import { afterEach, describe, expect, it } from "vitest";

import { getSupabaseClient } from "config/supabase.config";
import { listenToAccessibilitySettings } from "api-calls/user/settings/listenToAccessibilitySettings";
import { updateAccessibilitySettings } from "api-calls/user/settings/updateAccessibilitySettings";
import { listenToOracleSettings } from "api-calls/user/settings/listenToOracleSettings";
import { updatePinnedOracle } from "api-calls/user/settings/updatePinnedOracle";
import {
  createPerson,
  deletePerson,
  liveStackConfig,
  waitFor,
  type LivePerson,
  type LiveStackConfig,
} from "api-calls/testing/liveHarness";

const config = liveStackConfig();

async function signSingletonInAs(person: LivePerson): Promise<void> {
  const { error } = await getSupabaseClient().auth.signInWithPassword({
    email: person.email,
    password: person.password,
  });
  if (error) throw error;
}

async function signSingletonOut(): Promise<void> {
  await getSupabaseClient().auth.signOut();
}

describe.skipIf(!config)("user settings end to end", () => {
  const cfg = config as LiveStackConfig;
  let people: LivePerson[] = [];
  const unsubscribes: Array<() => void> = [];

  afterEach(async () => {
    for (const unsubscribe of unsubscribes.splice(0)) unsubscribe();
    await signSingletonOut().catch(() => {});
    await Promise.all(
      people.map((person) => deletePerson(cfg, person.userId).catch(() => {}))
    );
    people = [];
  });

  it("saves and streams accessibility settings for the owner", { timeout: 60000 }, async () => {
    const owner = await createPerson(cfg, "owner");
    people.push(owner);
    await signSingletonInAs(owner);

    const seen: Array<{ verboseRollResults?: boolean }> = [];
    unsubscribes.push(
      listenToAccessibilitySettings(owner.userId, (settings) =>
        seen.push(settings)
      )
    );
    await waitFor(() => (seen.length >= 1 ? seen : null));
    expect(seen[0]).toEqual({});

    await updateAccessibilitySettings({
      uid: owner.userId,
      settings: { verboseRollResults: true },
    });

    const updated = await waitFor(() =>
      seen.some((settings) => settings.verboseRollResults === true)
        ? seen
        : null
    );
    expect(updated.at(-1)).toEqual({ verboseRollResults: true });
  });

  it("pins and unpins oracle sections live", { timeout: 60000 }, async () => {
    const owner = await createPerson(cfg, "owner");
    people.push(owner);
    await signSingletonInAs(owner);

    const oracleId = "ironsworn/oracles/action";
    const seen: Array<{ pinnedOracleSections?: Record<string, boolean> }> = [];
    const errors: unknown[] = [];
    unsubscribes.push(
      listenToOracleSettings(
        owner.userId,
        (settings) => seen.push(settings),
        (error) => errors.push(error)
      )
    );
    await waitFor(() => (seen.length >= 1 ? seen : null));

    await updatePinnedOracle({ uid: owner.userId, oracleId, pinned: true });
    await waitFor(() =>
      seen.some((settings) => settings.pinnedOracleSections?.[oracleId])
        ? seen
        : null
    );

    await updatePinnedOracle({ uid: owner.userId, oracleId, pinned: false });
    await waitFor(() =>
      seen.some(
        (settings) => settings.pinnedOracleSections?.[oracleId] === false
      )
        ? seen
        : null
    );

    expect(errors).toEqual([]);
    // The id is stored as-is: no encoding round-trip at the edge.
    expect(seen.at(-1)).toEqual({
      pinnedOracleSections: { [oracleId]: false },
    });
  });

  it("keeps one person's settings from everyone else", { timeout: 60000 }, async () => {
    const owner = await createPerson(cfg, "owner");
    const outsider = await createPerson(cfg, "outsider");
    people.push(owner, outsider);

    await signSingletonInAs(owner);
    await updateAccessibilitySettings({
      uid: owner.userId,
      settings: { verboseRollResults: true },
    });
    await signSingletonOut();

    // Signed in as the outsider, the owner's settings read as empty and
    // stay empty even as the owner keeps changing them.
    await signSingletonInAs(outsider);
    const seen: Array<{ verboseRollResults?: boolean }> = [];
    unsubscribes.push(
      listenToAccessibilitySettings(owner.userId, (settings) =>
        seen.push(settings)
      )
    );
    await waitFor(() => (seen.length >= 1 ? seen : null));
    expect(seen[0]).toEqual({});

    await owner.client.from("user_settings").upsert({
      user_id: owner.userId,
      verbose_roll_results: false,
    });
    await new Promise((resolve) => setTimeout(resolve, 3000));
    expect(seen).toEqual([{}]);

    // And the outsider cannot write the owner's row either.
    await expect(
      updateAccessibilitySettings({
        uid: owner.userId,
        settings: { verboseRollResults: true },
      })
    ).rejects.toBeTruthy();
  });
});

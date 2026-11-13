import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const dir = join(dirname(fileURLToPath(import.meta.url)), "..", "migrations");

const campaignsFile = () => {
  const files = readdirSync(dir).filter((f) =>
    f.endsWith("_campaigns.sql")
  );
  assert.ok(files.length > 0, "no *_campaigns.sql migration");
  assert.equal(files.length, 1, "more than one *_campaigns.sql migration");
  return files[0];
};

const text = () => readFileSync(join(dir, campaignsFile()), "utf8");

describe("campaigns migration", () => {
  it("follows the <UTC timestamp>_<short-name>.sql convention", () => {
    assert.match(campaignsFile(), /^\d{14}_campaigns\.sql$/);
  });

  it("creates public.campaigns with the previous document fields as columns", () => {
    const sql = text();
    assert.ok(/CREATE TABLE/i.test(sql), "no CREATE TABLE");
    assert.ok(/public\.campaigns\b/.test(sql), "not in the public schema");
    assert.ok(/name\s+text/i.test(sql), "no name column");
    assert.ok(/world_id\s+uuid/i.test(sql), "no world link column");
    assert.ok(
      /type[^;]*IN\s*\(\s*'solo'\s*,\s*'co-op'\s*,\s*'guided'\s*\)/i.test(sql),
      "type is not restricted to solo/co-op/guided"
    );
    assert.ok(/theme\s+text/i.test(sql), "no theme column");
    for (const column of [
      "custom_tracks",
      "condition_meters",
      "special_tracks",
    ]) {
      assert.ok(
        new RegExp(`${column}\\s+jsonb`, "i").test(sql),
        `no ${column} column`
      );
    }
    for (const column of [
      "expansion_ids",
      "hidden_asset_ids",
      "hidden_oracle_ids",
    ]) {
      assert.ok(
        new RegExp(`${column}\\s+text\\[\\]`, "i").test(sql),
        `no ${column} column`
      );
    }
    assert.ok(/created_by\s+uuid/i.test(sql), "no creator column");
    assert.ok(/updated_at/i.test(sql), "no updated_at for stale-event detection");
    assert.ok(
      /ENABLE ROW LEVEL SECURITY/i.test(sql),
      "row-level security not enabled"
    );
  });

  it("lets members read and update campaigns but nobody outside", () => {
    const sql = text();
    assert.ok(
      /FOR SELECT[\s\S]*?is_campaign_member/i.test(sql),
      "SELECT is not restricted to campaign members"
    );
    assert.ok(
      /FOR UPDATE[\s\S]*?is_campaign_member/i.test(sql),
      "UPDATE is not restricted to campaign members"
    );
    assert.ok(
      /FOR DELETE[\s\S]*?is_campaign_gm/i.test(sql),
      "DELETE does not require the GM role"
    );
    assert.ok(
      /FOR DELETE[\s\S]*?created_by/i.test(sql),
      "DELETE does not let the founding creator remove their campaign"
    );
    assert.ok(!/\bTO\s+anon\b/i.test(sql), "signed-out readers are granted access");
    assert.ok(!/\bTO\s+PUBLIC\b/i.test(text()), "everyone is granted access");
  });

  it("links the roster and characters to their campaign", () => {
    const sql = text();
    assert.ok(
      /campaign_members[\s\S]*?REFERENCES[\s\S]*?public\.campaigns[\s\S]*?ON DELETE CASCADE/i.test(
        sql
      ),
      "the roster does not follow its campaign with ON DELETE CASCADE"
    );
    assert.ok(
      /characters[\s\S]*?campaign_id[\s\S]*?REFERENCES[\s\S]*?public\.campaigns[\s\S]*?ON DELETE SET NULL/i.test(
        sql
      ),
      "characters are not unlinked with ON DELETE SET NULL"
    );
  });

  it("lets members remove themselves from the roster", () => {
    const sql = text();
    assert.ok(
      /FOR DELETE[\s\S]*?campaign_members[\s\S]*?user_id\s*=\s*\(select auth\.uid\(\)\)/i.test(
        sql
      ) ||
        /campaign_members_delete_self/i.test(sql),
      "members cannot remove their own roster row"
    );
  });

  it("keeps campaign tracks, assets, settings and the roll log beside their campaign", () => {
    const sql = text();
    for (const table of [
      "campaign_tracks",
      "campaign_assets",
      "campaign_settings",
      "campaign_rolls",
    ]) {
      assert.ok(
        new RegExp(`public\\.${table}`, "i").test(sql),
        `${table} is not in the public schema`
      );
      assert.ok(
        new RegExp(
          `${table}[\\s\\S]*?REFERENCES[\\s\\S]*?public\\.campaigns[\\s\\S]*?ON DELETE CASCADE`,
          "i"
        ).test(sql),
        `${table} does not follow its campaign with ON DELETE CASCADE`
      );
    }
    assert.ok(/gms_only/i.test(sql), "the roll log has no GM-only flag");
    assert.ok(/roll\s+jsonb/i.test(sql), "rolls are not stored as one JSON document");
  });

  it("restricts every campaign table to members, never outsiders", () => {
    const sql = text();
    for (const table of [
      "campaign_tracks",
      "campaign_assets",
      "campaign_settings",
      "campaign_rolls",
    ]) {
      assert.ok(
        new RegExp(`FOR SELECT[\\s\\S]*?${table}`, "i").test(sql) ||
          new RegExp(`${table}[\\s\\S]*?FOR SELECT`, "i").test(sql),
        `${table} has no SELECT policy`
      );
      assert.ok(
        new RegExp(`is_campaign_member\\(campaign_id\\)`, "i").test(sql),
        `${table} is not gated on campaign membership`
      );
    }
  });

  it("hides GM-only rolls from players by the database", () => {
    const sql = text();
    const selectPolicies = [
      ...sql.matchAll(/CREATE POLICY[^;]*?ON public\.campaign_rolls[^;]*?FOR SELECT[^;]*?;/gi),
    ].join("\n");
    assert.ok(selectPolicies.length > 0, "campaign_rolls has no SELECT policy");
    assert.ok(
      /gms_only/i.test(selectPolicies),
      "the roll SELECT policy ignores the GM-only flag"
    );
    assert.ok(
      /is_campaign_gm/i.test(selectPolicies),
      "the roll SELECT policy does not distinguish GMs"
    );
    for (const op of ["INSERT", "UPDATE", "DELETE"]) {
      assert.ok(
        new RegExp(`ON public\\.campaign_rolls[\\s\\S]*?FOR ${op}`, "i").test(sql),
        `campaign_rolls has no ${op} policy`
      );
    }
    assert.ok(
      /roll\s*->>\s*'uid'/i.test(sql),
      "roll authorship is not checked for changes"
    );
  });

  it("creates campaigns, joins, previews, removals and unlinks through definer functions", () => {
    const sql = text();
    for (const fn of [
      "create_campaign",
      "join_campaign",
      "preview_campaign",
      "remove_campaign_member",
      "unlink_campaign_character",
    ]) {
      assert.ok(
        new RegExp(`FUNCTION public\\.${fn}\\s*\\(`, "i").test(sql),
        `${fn} is missing`
      );
    }
    assert.ok(
      (sql.match(/SECURITY DEFINER/gi) ?? []).length >= 5,
      "RPCs are not security definer"
    );
    assert.ok(
      /search_path\s*=\s*(''|"")/i.test(sql),
      "RPCs do not pin an empty search path"
    );
    assert.ok(
      /\(select auth\.uid\(\)\)/i.test(sql),
      "RPCs do not wrap auth.uid() as a subquery"
    );
    assert.ok(
      /GRANT EXECUTE/i.test(sql),
      "RPCs are not granted to callers"
    );
    assert.ok(
      /ON CONFLICT/i.test(sql),
      "rejoining does not tolerate an existing membership"
    );
  });

  it("streams every campaign table over the shared live-update channel", () => {
    const sql = text();
    assert.ok(
      /ALTER PUBLICATION\s+supabase_realtime\s+ADD TABLE/i.test(sql),
      "tables are not added to the supabase_realtime publication"
    );
    for (const table of [
      "campaigns",
      "campaign_members",
      "campaign_tracks",
      "campaign_assets",
      "campaign_settings",
      "campaign_rolls",
    ]) {
      assert.ok(
        new RegExp(`['"]${table}['"]`, "i").test(sql),
        `${table} is not published for live updates`
      );
    }
    assert.ok(
      /pg_publication_tables/i.test(sql),
      "publication membership is not guarded for re-runs"
    );
    assert.ok(
      /REPLICA IDENTITY FULL/i.test(sql),
      "old row values are not published"
    );
  });
});

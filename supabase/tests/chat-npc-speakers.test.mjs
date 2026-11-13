import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const dir = join(dirname(fileURLToPath(import.meta.url)), "..", "migrations");

const npcSpeakersFile = () => {
  const files = readdirSync(dir).filter((f) => f.endsWith("_chat_npc_speakers.sql"));
  assert.ok(files.length > 0, "no *_chat_npc_speakers.sql migration");
  assert.equal(files.length, 1, "more than one *_chat_npc_speakers.sql migration");
  return files[0];
};

const text = () => readFileSync(join(dir, npcSpeakersFile()), "utf8");

describe("chat NPC speakers migration", () => {
  it("follows the <UTC timestamp>_<short-name>.sql convention", () => {
    assert.match(npcSpeakersFile(), /^\d{14}_chat_npc_speakers\.sql$/);
  });

  it("adds an NPC speaker beside the character speaker", () => {
    const sql = text();
    assert.ok(
      /speaker_npc_id\s+uuid/i.test(sql),
      "no NPC speaker column"
    );
    assert.ok(
      /speaker_npc_id[\s\S]*?REFERENCES[\s\S]*?world_npcs[\s\S]*?ON DELETE SET NULL/i.test(
        sql
      ),
      "the NPC speaker does not follow the world's NPC list"
    );
  });

  it("keeps one voice per post", () => {
    const sql = text();
    assert.ok(
      /CHECK[\s\S]*?speaker_character_id IS NULL OR speaker_npc_id IS NULL/i.test(
        sql
      ),
      "nothing stops a post naming both a character and an NPC speaker"
    );
  });

  it("lets only a campaign GM speak as an NPC of the campaign's world", () => {
    const sql = text();
    assert.ok(
      /FOR INSERT[\s\S]*?speaker_npc_id[\s\S]*?is_campaign_gm/i.test(sql),
      "the NPC speaker is not restricted to campaign GMs"
    );
    assert.ok(
      /speaker_npc_id[\s\S]*?world_npcs/i.test(sql),
      "nothing ties the NPC speaker to the NPC list"
    );
    assert.ok(
      /speaker_npc_id[\s\S]*?campaigns/i.test(sql),
      "nothing ties the NPC speaker to the channel's campaign"
    );
    assert.ok(
      /speaker_npc_id[\s\S]*?world_id/i.test(sql),
      "nothing ties the NPC speaker to the campaign's world"
    );
  });

  it("keeps the existing member, speaker and archive rules", () => {
    const sql = text();
    assert.ok(
      /FOR INSERT[\s\S]*?is_campaign_member/i.test(sql),
      "INSERT no longer requires campaign membership"
    );
    assert.ok(
      /FOR INSERT[\s\S]*?archived/i.test(sql),
      "INSERT no longer refuses archived channels"
    );
    assert.ok(
      /speaker_character_id[\s\S]*?owner_id/i.test(sql),
      "nothing still ties the character speaker to its owner"
    );
  });
});

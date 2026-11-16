import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dir = join(root, "migrations");

// Proposal state (ticket #148, part of spec #10): the GM's outcome for an
// outline proposal is kept on the assistant message that carried it, so a
// reload shows applied and dismissed proposals, and Undo can name the
// version that reply's Apply kept. Additive, re-runnable, owner-GM only.
const stateFile = () => {
  const files = readdirSync(dir).filter((f) =>
    f.endsWith("_assistant_proposal_state.sql")
  );
  assert.equal(files.length, 1, "expected one *_assistant_proposal_state.sql");
  return files[0];
};

const text = () => readFileSync(join(dir, stateFile()), "utf8");

describe("assistant proposal state migration (#148)", () => {
  it("sorts after every migration it builds on", () => {
    const stamp = stateFile().slice(0, 14);
    assert.match(stateFile(), /^\d{14}_assistant_proposal_state\.sql$/);
    for (const other of readdirSync(dir).filter(
      (f) => /^\d{14}_/.test(f) && f !== stateFile()
    )) {
      assert.ok(stamp > other.slice(0, 14), `does not sort after ${other}`);
    }
  });

  it("adds the two columns guardedly, without dropping anything", () => {
    const sql = text();
    assert.ok(/ADD COLUMN IF NOT EXISTS proposal_state text NULL/i.test(sql));
    assert.ok(
      /ADD COLUMN IF NOT EXISTS applied_version_id uuid NULL[\s\S]*?REFERENCES public\.assistant_outline_versions \(id\) ON DELETE SET NULL/i.test(
        sql
      ),
      "applied_version_id does not clear itself when its version goes"
    );
    assert.ok(!/DROP\s+(TABLE|COLUMN)/i.test(sql), "migration is not additive");
    assert.ok(!/DELETE\s+FROM|TRUNCATE/i.test(sql), "migration removes data");
  });

  it("guards the constraint so a re-run is safe", () => {
    const sql = text();
    assert.ok(
      /IF NOT EXISTS \(\s*SELECT 1 FROM pg_constraint[\s\S]*?assistant_messages_proposal_state_valid/i.test(
        sql
      )
    );
    assert.ok(/proposal_state IN \('applied', 'dismissed'\)/.test(sql));
    assert.ok(/role = 'assistant'/.test(sql));
    assert.ok(/applied_version_id IS NULL OR proposal_state = 'applied'/.test(sql));
  });

  it("leaves access to the owner-GM policies and the realtime allow-list as they are", () => {
    const sql = text();
    assert.ok(!/CREATE POLICY|DROP POLICY|GRANT|DISABLE ROW LEVEL SECURITY/i.test(sql));
    assert.ok(/ALTER TABLE public\.assistant_messages/.test(sql));
    const base = readFileSync(
      join(dir, "20261121000004_assistant_conversations.sql"),
      "utf8"
    );
    assert.ok(
      /assistant_messages_update_owner[\s\S]*?is_assistant_conversation_owner/.test(
        base
      ),
      "message updates are not owner-GM only"
    );
  });
});

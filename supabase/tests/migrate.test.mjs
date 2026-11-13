import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const dir = join(dirname(fileURLToPath(import.meta.url)), "..");
const applySh = join(dir, "migrate", "apply.sh");

const STUB = `#!/bin/bash
state="\${PSQL_STUB_STATE:?}"
sql=""
file=""
prev=""
for a in "$@"; do
  if [ "$prev" = "-c" ]; then sql="$a"; fi
  if [ "$prev" = "-f" ]; then file="$a"; fi
  prev="$a"
done
if [ -n "$file" ]; then
  if grep -q "__FAIL__" "$file"; then echo "stub: failing $file" >&2; exit 1; fi
  basename "$file" >> "$state/invoked.txt"
  exit 0
fi
case "$sql" in
  *"SELECT 1 FROM supabase_migrations.applied"*)
    name=$(printf '%s' "$sql" | sed "s/.*name = '//;s/'.*//")
    grep -qx "$name" "$state/applied.txt" 2>/dev/null && echo "1"
    exit 0;;
  *"INSERT INTO supabase_migrations.applied"*)
    name=$(printf '%s' "$sql" | sed "s/.*VALUES ('//;s/').*//")
    echo "$name" >> "$state/applied.txt"
    exit 0;;
  *) exit 0;;
esac
`;

function harness(files) {
  const tmp = mkdtempSync(join(tmpdir(), "migrate-"));
  const mig = join(tmp, "migrations");
  const stubs = join(tmp, "stubs");
  const state = join(tmp, "state");
  mkdirSync(mig, { recursive: true });
  mkdirSync(stubs, { recursive: true });
  mkdirSync(state, { recursive: true });
  writeFileSync(join(stubs, "psql"), STUB, { mode: 0o755 });
  for (const [name, body] of Object.entries(files)) {
    writeFileSync(join(mig, name), body ?? "-- empty\n");
  }
  const run = () => {
    try {
      const out = execFileSync("sh", [applySh], {
        encoding: "utf8",
        env: {
          ...process.env,
          PATH: `${stubs}:${process.env.PATH}`,
          POSTGRES_PASSWORD: "dummy",
          MIGRATIONS_DIR: mig,
          PSQL_STUB_STATE: state,
        },
      });
      return { ok: true, out };
    } catch (e) {
      return { ok: false, out: (e.stdout ?? "") + (e.stderr ?? "") };
    }
  };
  const invoked = () =>
    existsSync(join(state, "invoked.txt"))
      ? readFileSync(join(state, "invoked.txt"), "utf8").split("\n").filter(Boolean)
      : [];
  const applied = () =>
    existsSync(join(state, "applied.txt"))
      ? readFileSync(join(state, "applied.txt"), "utf8").split("\n").filter(Boolean)
      : [];
  return { run, invoked, applied };
}

describe("supabase/migrate/apply.sh", () => {
  let h;
  before(() => {
    h = harness({ "0001_first.sql": null, "0002_second.sql": null });
  });

  it("applies pending migrations in order and records them", () => {
    const r = h.run();
    assert.ok(r.ok, `apply failed: ${r.out}`);
    assert.deepEqual(h.invoked(), ["0001_first.sql", "0002_second.sql"]);
    assert.deepEqual(h.applied(), ["0001_first.sql", "0002_second.sql"]);
    assert.ok(r.out.includes("2 of 2"), `unexpected summary: ${r.out}`);
  });

  it("skips already-applied migrations on rerun", () => {
    const r = h.run();
    assert.ok(r.ok, `rerun failed: ${r.out}`);
    assert.deepEqual(h.invoked(), ["0001_first.sql", "0002_second.sql"], "rerun applied files again");
    assert.ok(r.out.includes("0 of 0"), `unexpected summary: ${r.out}`);
  });

  it("is a no-op for an empty migrations directory", () => {
    const empty = harness({});
    const r = empty.run();
    assert.ok(r.ok, `empty run failed: ${r.out}`);
    assert.ok(r.out.includes("0 of 0"), `unexpected summary: ${r.out}`);
  });

  it("aborts on failure without running later files", () => {
    const failing = harness({
      "0001_ok.sql": null,
      "0002_broken.sql": "__FAIL__\n",
      "0003_later.sql": null,
    });
    const r = failing.run();
    assert.ok(!r.ok, "failing migration did not abort the run");
    assert.deepEqual(failing.invoked(), ["0001_ok.sql"], "later files ran after a failure");
    assert.deepEqual(failing.applied(), ["0001_ok.sql"], "failed file was recorded as applied");
  });
});

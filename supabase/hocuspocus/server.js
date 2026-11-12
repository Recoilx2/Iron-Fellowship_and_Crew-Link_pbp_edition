/**
 * Hocuspocus note server: one container per stack copy holding the live Yjs
 * documents for shared note editing.
 *
 * Each persistent document is one Postgres content row
 * (`character_note_contents` / `campaign_note_contents`, base64 bytes beside
 * each note). The server reads the row on first connect and writes it back
 * on a short debounce, so a lone editor is persisted within seconds and
 * reloads survive restarts. World rooms (which the worlds ticket ports) are
 * transient: they sync live between connected browsers but never touch the
 * database.
 *
 * Authentication and access, per connection:
 * - the client sends its Supabase access token; it is verified as HS256
 *   with the stack's JWT_SECRET (see note-access.js). Anything else --
 *   missing, forged, expired, anon or service-role keys -- is refused.
 * - the server then checks the person's access to that note through the
 *   database's own visibility helpers (the same private.* functions the
 *   row-level security policies use), over a direct privileged connection.
 *   No access means no connection. Readers without write access -- members
 *   viewing a shared character note they do not own -- connect read-only.
 *
 * Live revocation: the database notifies `note_access_revoked` when a note
 * is unshared or deleted (see migration 20261112135000_campaign_notes.sql).
 * The server re-checks every connected reader of that document and closes
 * the ones who just lost access; their reconnect is refused because the
 * access check now fails. Everyone else -- including the owner -- stays
 * connected.
 */

import { Server } from "@hocuspocus/server";
import { Database } from "@hocuspocus/extension-database";
import pg from "pg";

import {
  parseDocumentName,
  scopeConfig,
  verifySupabaseJwt,
} from "./note-access.js";

const PORT = Number(process.env.PORT ?? 1234);
const {
  JWT_SECRET,
  POSTGRES_HOST = "db",
  POSTGRES_PORT = "5432",
  POSTGRES_DB = "postgres",
  POSTGRES_PASSWORD,
} = process.env;

if (!JWT_SECRET) {
  console.error("hocuspocus: JWT_SECRET is required");
  process.exit(1);
}
if (!POSTGRES_PASSWORD) {
  console.error("hocuspocus: POSTGRES_PASSWORD is required");
  process.exit(1);
}

const dbConfig = {
  host: POSTGRES_HOST,
  port: Number(POSTGRES_PORT),
  database: POSTGRES_DB,
  user: "postgres",
  password: POSTGRES_PASSWORD,
};

// The server connects as the database superuser on the stack's internal
// network (the port is never published): access is enforced per connection
// by the checks below, reusing the same private.* helpers the access rules
// use, so the rule logic lives in exactly one place.
const pool = new pg.Pool({ ...dbConfig, max: 5 });

/**
 * Runs `work` with request.jwt.claim.sub set to `userId`, so the private.*
 * visibility helpers answer as that person.
 */
async function asUser(userId, work) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT set_config('request.jwt.claim.sub', $1, true)", [
      userId,
    ]);
    const result = await work(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch {
      // The connection is already broken; releasing is enough.
    }
    throw error;
  } finally {
    client.release();
  }
}

async function checkNoteAccess(userId, scope, noteId) {
  const config = scopeConfig(scope);
  if (!config) return { visible: false, writable: false };
  return asUser(userId, async (client) => {
    const { rows } = await client.query(
      `SELECT ${config.visibleFn}($1) AS visible, ${config.writableFn}($1) AS writable`,
      [noteId]
    );
    return {
      visible: rows[0]?.visible === true,
      writable: rows[0]?.writable === true,
    };
  });
}

const persistence = new Database({
  fetch: async ({ documentName }) => {
    const parsed = parseDocumentName(documentName);
    if (!parsed) return null;
    const { rows } = await pool.query(
      `SELECT content FROM ${scopeConfig(parsed.scope).contentsTable} WHERE note_id = $1`,
      [parsed.noteId]
    );
    const content = rows[0]?.content;
    if (!content) return null;
    return Buffer.from(content, "base64");
  },
  store: async ({ documentName, state }) => {
    const parsed = parseDocumentName(documentName);
    if (!parsed) return;
    const config = scopeConfig(parsed.scope);
    const note = await pool.query(
      `SELECT id FROM ${config.notesTable} WHERE id = $1`,
      [parsed.noteId]
    );
    if (note.rowCount === 0) {
      // The note was deleted while someone still had it open: drop the
      // bytes instead of resurrecting the row.
      console.log(`hocuspocus: dropping store for deleted note ${documentName}`);
      return;
    }
    await pool.query(
      `INSERT INTO ${config.contentsTable} (note_id, content) VALUES ($1, $2)
       ON CONFLICT (note_id) DO UPDATE SET content = EXCLUDED.content`,
      [parsed.noteId, Buffer.from(state).toString("base64")]
    );
  },
});

async function onAuthenticate(data) {
  const claims = verifySupabaseJwt(data.token, JWT_SECRET);
  if (!claims) {
    throw new Error("hocuspocus: invalid sign-in token");
  }
  const parsed = parseDocumentName(data.documentName);
  if (!parsed) {
    // Transient world rooms until the worlds ticket ports them: any
    // signed-in person may sync, nothing is persisted.
    return { userId: claims.sub };
  }
  const access = await checkNoteAccess(claims.sub, parsed.scope, parsed.noteId);
  if (!access.visible) {
    throw new Error("hocuspocus: no access to this note");
  }
  if (!access.writable) {
    data.connectionConfig.readOnly = true;
    if (data.connection) {
      data.connection.readOnly = true;
    }
  }
  return { userId: claims.sub };
}

async function revokeConnections(hocuspocus, documentName) {
  const parsed = parseDocumentName(documentName ?? "");
  if (!parsed) return;
  const doc = hocuspocus.documents.get(documentName);
  if (!doc) return;
  for (const connection of doc.getConnections()) {
    const userId = connection.context?.userId;
    try {
      const access = userId
        ? await checkNoteAccess(userId, parsed.scope, parsed.noteId)
        : { visible: false };
      if (!access.visible) {
        console.log(
          `hocuspocus: closing ${documentName} for a reader who lost access`
        );
        connection.close({ code: 4401, reason: "Note access revoked" });
      }
    } catch (error) {
      console.error("hocuspocus: revocation check failed", error);
    }
  }
}

async function watchRevocations(hocuspocus) {
  // Self-healing loop, never rejects: when the database is unreachable the
  // server still syncs transient rooms and refuses persistent connects
  // (fail closed), and revocation resumes once the database is back.
  for (;;) {
    try {
      await listenOnce(hocuspocus);
    } catch (error) {
      console.error(
        "hocuspocus: revocation listener lost, retrying in 5s",
        error
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 5000));
  }
}

async function listenOnce(hocuspocus) {
  const listener = new pg.Client(dbConfig);
  try {
    listener.on("notification", (message) => {
      void revokeConnections(hocuspocus, message.payload);
    });
    await listener.connect();
    await listener.query("LISTEN note_access_revoked");
    console.log("hocuspocus: listening for note_access_revoked");
    await new Promise((resolve, reject) => {
      listener.on("error", reject);
      listener.on("end", () => reject(new Error("listener ended")));
    });
  } finally {
    try {
      await listener.end();
    } catch {
      // Already gone; the loop reconnects.
    }
  }
}

const server = new Server({
  name: "notes",
  port: PORT,
  timeout: 60000,
  debounce: 2000,
  maxDebounce: 10000,
  quiet: true,
  extensions: [persistence],
  onAuthenticate,
});

await server.listen(PORT);
console.log(`hocuspocus: listening on port ${PORT}`);
void watchRevocations(server.hocuspocus);

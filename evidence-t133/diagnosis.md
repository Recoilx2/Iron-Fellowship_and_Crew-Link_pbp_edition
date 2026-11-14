# Ticket #133: first CI e2e failure (run 43617908821, job e2e)

Symptom: `e2e/gm-assistant-outline-revision.spec.ts` failed at line 193 --
after seeding the outline via a direct `campaign_note_contents` upsert and
reloading, the Outline tab editor was empty (expected the seeded text).

The upsert itself succeeded (its error assertion passed), so something
emptied the row between the upsert and the post-reload fetch. The only
other writer is the Hocuspocus note server (`supabase/hocuspocus/server.js`):
it loads the row on connect (`fetch`) and writes its in-memory document
back on a 2s debounce plus at unload (`store`). The Outline tab had a
provider connected with an empty document, whose unload-time store
clobbered the seeded row.

Consequence for the feature: Apply/Undo must converge the server's
in-memory document too, not just the row -- otherwise the next
unload-store resurrects the pre-Apply text. Fix: seed by typing into the
editor (client sync carries the text into the server doc, the proven #131
pattern), and remount the editor with locally-recomputed bytes after every
Apply/Undo so the provider syncs the new text back to the server.

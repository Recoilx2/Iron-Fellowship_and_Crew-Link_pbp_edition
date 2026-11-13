# Database Structure

The backend is Postgres (self-hosted Supabase), not Firestore. The schema
lives in `supabase/migrations/` (applied automatically on stack start, one
migration per area); each data area's `api-calls/<area>/_getRef.ts` names its
tables, live-update channels and row mappings. Stores, pages and components
never name tables directly.

```
profiles                     one row per person (display name)
user_settings                one row per person (accessibility, oracle pins)
characters                   one row per character (+ assets, tracks, notes,
                             note contents, settings, solo roll log)
campaigns                    one row per campaign (+ members, assets, tracks,
                             notes, note contents, settings, roll log)
worlds                       one row per world (+ locations, lore, npcs,
                             notes, images metadata; no sectors: Starforged
                             locations replaced them, see ticket #21)
homebrew_collections         one row per collection (+ stats, moves, oracles,
                             assets, editors, viewers, invite keys)
```

## Type Links

| Type                         | File                                                                                                     |
| ---------------------------- | -------------------------------------------------------------------------------------------------------- |
| CharacterDocument            | [\_character.type](./character/_character.type.ts)                                                       |
| CampaignDocument             | [\_campaign.type](./campaign/_campaign.type.ts)                                                          |
| AssetDocument                | [\_asset.type](./assets/_asset.type.ts)                                                                  |
| NoteDocument                 | [\_notes.type](./notes/_notes.type.ts)                                                                   |
| SettingsDocument             | [\_character-campaign-settings.type](./character-campaign-settings/_character-campaign-settings.type.ts) |
| **Worlds**                   |                                                                                                          |
| WorldDocument                | [\_world.type](./world/_world.type.ts)                                                                   |
| Location (and related)         | [Locations.type](../types/Locations.type.ts)                                                            |
| Lore (and related)           | [Lore.type](../types/Lore.type.ts)                                                                        |
| NPC (and related)            | [NPCs.type](../types/NPCs.type.ts)                                                                        |
| **Homebrew**                 |                                                                                                          |
| HomebrewCollectionDocument   | [\_homebrewCollection.type](./homebrew/_homebrewCollection.type.ts)                                      |
| UserDocument (device prefs)  | [\_user.type](./user/_user.type.ts)                                                                      |
| Profile                      | [\_profile.type](./profiles/_profile.type.ts)                                                            |
| AccessibilitySettingsDocument | [\_settings.type](./user/settings/_settings.type.ts)                                                    |
| OracleSettingsDocument       | [\_settings.type](./user/settings/_settings.type.ts)                                                     |

Device preferences (`UserDocument`: sidebar side, seen update version, dice
animation choice) live in the browser's local storage, not in the database.

---

# Related Notes

## Converting Yjs bytes to another format

Rich text across the app (not including homebrew) is stored as Yjs update
bytes in note/world content rows, and then converted to markdown or HTML.
The reason for doing this instead of using a more common form (like markdown), is so that I can take advantage of the realtime collaboration features from [YDocs](https://yjs.dev/) and [TipTap](https://tiptap.dev/docs/editor/guide/output#introduction).
If you are looking to export one of these fields (Hi Kat!), you can convert this either to JSON (in a structure very specific to Prosemirror Rich Text) or to HTML.

In order to do this, you will need to read it into a TipTap editor (using the same extensions as the original), and then call the [export function](https://tiptap.dev/docs/editor/guide/output#introduction) of your choice.
I've done this once before, so feel free to reach out if you need a hand!

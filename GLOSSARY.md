# Iron Fellowship / Crew Link (play-by-post edition)

A companion app for Ironsworn and Starforged, reshaped so a group plays a campaign by posting in chat rather than at the same table.

## Language

### Play

**Game system**:
The ruleset a deployment runs: Ironsworn or Starforged. One deployment runs one game system.
_Avoid_: Ruleset (in prose), app, flavour

**Campaign**:
A shared game run by one or more GMs with a group of players and their characters. Play-by-post happens only inside a campaign.
_Avoid_: Game, table, group

**GM**:
A person running a campaign. A campaign can have more than one.
_Avoid_: DM, narrator, guide

**Player**:
A person in a campaign who plays one character in it.
_Avoid_: User (when meaning a campaign member)

**Roll**:
A dice result from a move, stat, progress track or oracle. In a campaign, a roll appears in chat as a post.
_Avoid_: Log entry, game log (for a single roll)

### Chat

**Channel**:
A named stream of posts within a campaign. Every campaign has an in-character channel and an out-of-character channel; GMs can create more.
_Avoid_: Room, thread, chat (for a single stream)

**Private channel**:
A channel visible only to the people on its roster plus the campaign's GMs. A GM creates it for chosen members and can add or remove people at any time; someone removed loses access straight away, including live updates.
_Avoid_: Secret channel

**Direct message**:
A channel between exactly two campaign members, opened from the People list. Only those two people can read it; even a GM who is not in it cannot read it or see that it exists.
_Avoid_: DM (in prose), private message, whisper

The code shortens "direct message" to `dm` in identifiers only: the `dm`
value of `ChannelVisibility` (see `api-calls/chat/_chat.type.ts`), the
database function `get_or_create_dm_channel`, and the `getOrCreateDirectChannel`
data-layer wrapper. That `dm` never means "dungeon master" (the glossary
avoids DM for GM, above), and it never appears in user-facing prose, which
says "direct message". Renaming those identifiers would touch stored
visibility values, access rules and the client wrapper, so the docs say
this instead.

**In-character (IC)**:
Speech or action written as a character in the fiction.

**Out-of-character (OOC)**:
Speech written as the real person, under their own name, outside the fiction.
_Avoid_: Meta, table talk

**Post**:
A single entry in a channel: text, images, a roll, or a mix. It can be edited by whoever posted it.
_Avoid_: Message, entry

### GM tools

**GM assistant**:
An AI helper open only to GMs, shown as a pop-out sidebar. It reads campaign material the GM chooses, talks things through with the GM, and drafts text; it never posts or changes anything by itself.
_Avoid_: AI GM, bot, narrator

**Campaign outline**:
A GM-only note holding the planned story of a campaign, which the GM can revise with the GM assistant.
_Avoid_: Plot, script, story bible

**Assistant context**:
The campaign material the GM has chosen to let the GM assistant read, such as specific lore, NPCs, notes or channels.
_Avoid_: Memory, knowledge base

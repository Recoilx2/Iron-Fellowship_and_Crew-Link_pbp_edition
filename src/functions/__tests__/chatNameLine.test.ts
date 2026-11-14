import { describe, expect, it } from "vitest";

import { resolveChatNameLine } from "functions/chatNameLine";

// Seam under test: the feed's name line. In-character posts lead with the
// speaking character, then the player. Out-of-character posts and direct
// messages lead with the author's display name, then their campaign
// character (looked up by author, because posting as self names no speaker),
// then the GM tag for GMs. An NPC voice leads with the NPC in any channel.
describe("chat name line", () => {
  const characterMap = {
    kira: { uid: "player-1", name: "Kira Vey" },
    brannoc: { uid: "player-2", name: "Brannoc" },
  };

  it("leads in character with the speaking character, then the player", () => {
    expect(
      resolveChatNameLine({
        channel: { kind: "IC", visibility: "public" },
        post: {
          authorId: "player-1",
          speakerCharacterId: "kira",
          speakerNpcId: null,
        },
        characterMap,
        authorName: "Sam",
        isGM: false,
      })
    ).toEqual({ title: "Kira Vey", subtitle: "Sam", showGM: false });
  });

  it("falls back to the author in character with no speaker", () => {
    expect(
      resolveChatNameLine({
        channel: { kind: "IC", visibility: "public" },
        post: {
          authorId: "player-1",
          speakerCharacterId: null,
          speakerNpcId: null,
        },
        characterMap,
        authorName: "Sam",
        isGM: false,
      })
    ).toEqual({ title: "Sam", subtitle: undefined, showGM: false });
  });

  it("leads out of character with the display name, then the campaign character", () => {
    expect(
      resolveChatNameLine({
        channel: { kind: "OOC", visibility: "public" },
        post: {
          authorId: "player-1",
          speakerCharacterId: null,
          speakerNpcId: null,
        },
        characterMap,
        authorName: "Sam",
        isGM: false,
      })
    ).toEqual({ title: "Sam", subtitle: "Kira Vey", showGM: false });
  });

  it("shows no character beside the display name for authors without one", () => {
    expect(
      resolveChatNameLine({
        channel: { kind: "OOC", visibility: "public" },
        post: {
          authorId: "stranger-1",
          speakerCharacterId: null,
          speakerNpcId: null,
        },
        characterMap,
        authorName: "Rin",
        isGM: false,
      })
    ).toEqual({ title: "Rin", subtitle: undefined, showGM: false });
  });

  it("tags the GM out of character after the campaign character", () => {
    expect(
      resolveChatNameLine({
        channel: { kind: "OOC", visibility: "public" },
        post: {
          authorId: "gm-1",
          speakerCharacterId: null,
          speakerNpcId: null,
        },
        characterMap: { ...characterMap, elder: { uid: "gm-1", name: "Sage" } },
        authorName: "Grem",
        isGM: true,
      })
    ).toEqual({ title: "Grem", subtitle: "Sage", showGM: true });
  });

  it("leads a direct message with the display name, then the campaign character", () => {
    expect(
      resolveChatNameLine({
        channel: { kind: "OOC", visibility: "dm" },
        post: {
          authorId: "player-2",
          speakerCharacterId: null,
          speakerNpcId: null,
        },
        characterMap,
        authorName: "Ash",
        isGM: false,
      })
    ).toEqual({ title: "Ash", subtitle: "Brannoc", showGM: false });
  });

  it("leads an NPC voice with the NPC and the author behind it", () => {
    expect(
      resolveChatNameLine({
        channel: { kind: "IC", visibility: "public" },
        post: {
          authorId: "gm-1",
          speakerCharacterId: null,
          speakerNpcId: "elder",
        },
        characterMap,
        npcName: "Elder Moss",
        authorName: "Grem",
        isGM: true,
      })
    ).toEqual({ title: "Elder Moss", subtitle: "Grem", showGM: true });
  });

  it("leads an NPC voice with the NPC in out-of-character channels too", () => {
    // Ticket #108 shows the NPC as speaker with a GM tag in any channel;
    // ticket #121 leaves in-character posts unchanged but does not move the
    // NPC voice behind the author out of character, so OOC keeps the NPC
    // first with the GM behind it.
    expect(
      resolveChatNameLine({
        channel: { kind: "OOC", visibility: "public" },
        post: {
          authorId: "gm-1",
          speakerCharacterId: null,
          speakerNpcId: "elder",
        },
        characterMap: { ...characterMap, sage: { uid: "gm-1", name: "Sage" } },
        npcName: "Elder Moss",
        authorName: "Grem",
        isGM: true,
      })
    ).toEqual({ title: "Elder Moss", subtitle: "Grem", showGM: true });
  });

  it("leads an NPC voice with the NPC in a direct message too", () => {
    expect(
      resolveChatNameLine({
        channel: { kind: "OOC", visibility: "dm" },
        post: {
          authorId: "gm-1",
          speakerCharacterId: null,
          speakerNpcId: "elder",
        },
        characterMap,
        npcName: "Elder Moss",
        authorName: "Grem",
        isGM: true,
      })
    ).toEqual({ title: "Elder Moss", subtitle: "Grem", showGM: true });
  });
});

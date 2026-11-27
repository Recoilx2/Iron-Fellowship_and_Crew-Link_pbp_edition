import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { escapeHtml, renderPostEmail, shouldEmail } from "./render.js";

const CAMPAIGN_ID = "22222222-2222-2222-2222-222222222222";
const CHANNEL_ID = "33333333-3333-3333-3333-333333333333";
const POST_ID = "44444444-4444-4444-4444-444444444444";
const SITE_URL = "http://localhost:8080/";

function candidate(overrides = {}) {
  return {
    userId: "11111111-1111-1111-1111-111111111111",
    email: "player@example.com",
    displayName: "Sam",
    channelId: CHANNEL_ID,
    channelName: "In character",
    campaignId: CAMPAIGN_ID,
    campaignName: "The Bog Quest",
    postId: POST_ID,
    postText: "We push on through the bog.",
    roll: null,
    gmsOnly: false,
    globalOptIn: true,
    channelOptIn: true,
    isAuthor: false,
    isGm: false,
    ...overrides,
  };
}

describe("shouldEmail", () => {
  it("sends only when both switches are on and the reader is not the author", () => {
    assert.equal(shouldEmail(candidate()), true);
    assert.equal(shouldEmail(candidate({ isGm: true })), true);
    assert.equal(shouldEmail(candidate({ isAuthor: true })), false);
    assert.equal(shouldEmail(null), false);
    assert.equal(shouldEmail(candidate({ email: "" })), false);
  });

  it("lets a global opt-out win over a per-channel opt-in", () => {
    assert.equal(
      shouldEmail(candidate({ globalOptIn: false, channelOptIn: true })),
      false
    );
  });

  it("does not send with no preference row, or with an opted-out channel row", () => {
    // A missing row maps to null: "no row = no email", even when the global
    // switch is on. An explicit false row says the same thing.
    assert.equal(shouldEmail(candidate({ channelOptIn: null })), false);
    assert.equal(shouldEmail(candidate({ channelOptIn: undefined })), false);
    assert.equal(shouldEmail(candidate({ channelOptIn: false })), false);
  });

  it("never mails GM-only content to a non-GM, even if both switches are on", () => {
    assert.equal(shouldEmail(candidate({ gmsOnly: true })), false);
    assert.equal(shouldEmail(candidate({ gmsOnly: true, isGm: true })), true);
  });
});

describe("renderPostEmail", () => {
  it("links to the exact post in the right channel and tab", () => {
    const { subject, text, html } = renderPostEmail(candidate(), SITE_URL);
    const link = `http://localhost:8080/campaign/${CAMPAIGN_ID}?tab=chat&channel=${CHANNEL_ID}&post=${POST_ID}`;
    assert.match(subject, /In character/);
    assert.match(subject, /The Bog Quest/);
    assert.ok(text.includes(link), "plain text lacks the deep link");
    assert.ok(html.includes(`href="${link.replace(/&/g, "&amp;")}"`), "HTML lacks the escaped deep link");
  });

  it("escapes post text and names in HTML", () => {
    const hostile = '<script>alert("x")</script> & \'bog\'';
    const { text, html } = renderPostEmail(
      candidate({ postText: hostile, displayName: "<Sam>", channelName: "A & B" }),
      SITE_URL
    );
    assert.ok(text.includes(hostile), "plain text must stay readable");
    assert.ok(!html.includes("<script>"), "raw script tag leaked into HTML");
    assert.ok(html.includes("&lt;script&gt;"), "post text was not escaped");
    assert.ok(html.includes("&lt;Sam&gt;"), "display name was not escaped");
    assert.ok(html.includes("A &amp; B"), "channel name was not escaped");
    assert.equal(escapeHtml('&<>"\''), "&amp;&lt;&gt;&quot;&#39;");
  });

  it("leaves GM-only words and rolls out of a player's email", () => {
    const roll = { move: "Face Danger", result: "strong hit" };
    const player = renderPostEmail(
      candidate({ postText: "The secret door opens.", roll, gmsOnly: true }),
      SITE_URL
    );
    for (const body of [player.text, player.html]) {
      assert.ok(!body.includes("The secret door opens."), "GM-only text leaked");
      assert.ok(!body.includes("Face Danger"), "roll leaked");
      assert.ok(!body.includes("strong hit"), "roll result leaked");
    }

    const gm = renderPostEmail(
      candidate({ postText: "The secret door opens.", roll, gmsOnly: true, isGm: true }),
      SITE_URL
    );
    assert.ok(gm.text.includes("The secret door opens."));
    assert.ok(gm.text.includes("Face Danger"));

    // A plain player roll (not GM-only) is ordinary post content.
    const open = renderPostEmail(candidate({ roll }), SITE_URL);
    assert.ok(open.text.includes("Face Danger"));
  });
});

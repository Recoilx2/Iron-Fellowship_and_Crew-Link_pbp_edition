import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { createServer, type Socket } from "node:net";

import { getSupabaseClient } from "config/supabase.config";
import { CampaignType } from "api-calls/campaign/_campaign.type";
import { createCampaign } from "api-calls/campaign/createCampaign";
import { joinCampaign } from "api-calls/campaign/joinCampaign";
import { createPost } from "api-calls/chat/createPost";
import { createPrivateChannel } from "api-calls/chat/createPrivateChannel";
import { getOrCreateDirectChannel } from "api-calls/chat/getOrCreateDirectChannel";
import {
  adminClient,
  createPerson,
  deletePerson,
  grantMembership,
  liveStackConfig,
  waitFor,
  type LivePerson,
  type LiveStackConfig,
} from "api-calls/testing/liveHarness";

/**
 * Delivery path for opt-in chat email (ticket #203). A tiny fake SMTP server
 * runs on the Docker host; CI points the mailer container at it through the
 * host gateway and enables the worker. Every person has their own client so
 * sessions never clash, while the data-layer calls use the singleton client
 * signed in as the actor.
 *
 * The test skips without a stack AND an explicit capture port, so plain
 * `npm test` stays green. `supabase/tests/live.sh` fails on any skip, and CI
 * sets LIVE_SMTP_CAPTURE_PORT=2525, so a misconfigured job cannot pass.
 */

interface CapturedMessage {
  to: string[];
  raw: string;
}

interface FakeSmtp {
  messages: CapturedMessage[];
  close: () => Promise<void>;
}

async function startFakeSmtp(port: number): Promise<FakeSmtp> {
  const messages: CapturedMessage[] = [];
  const sockets = new Set<Socket>();
  const server = createServer((socket) => {
    sockets.add(socket);
    socket.setEncoding("utf8");
    socket.write("220 localhost fake-smtp\r\n");
    let buffer = "";
    let recipients: string[] = [];
    let inData = false;
    let body = "";

    socket.on("data", (chunk: string) => {
      buffer += chunk;
      for (;;) {
        if (inData) {
          const end = buffer.indexOf("\r\n.\r\n");
          if (end === -1) break;
          body += buffer.slice(0, end + 2);
          buffer = buffer.slice(end + 5);
          messages.push({ to: [...recipients], raw: body });
          body = "";
          recipients = [];
          inData = false;
          socket.write("250 OK\r\n");
          continue;
        }
        const end = buffer.indexOf("\r\n");
        if (end === -1) break;
        const line = buffer.slice(0, end);
        buffer = buffer.slice(end + 2);
        const command = line.split(" ")[0].toUpperCase();
        if (command === "EHLO" || command === "HELO") {
          socket.write("250-localhost\r\n250 OK\r\n");
        } else if (command === "MAIL") {
          recipients = [];
          socket.write("250 OK\r\n");
        } else if (command === "RCPT") {
          const address = line.match(/<([^>]+)>/);
          if (address) recipients.push(address[1]);
          socket.write("250 OK\r\n");
        } else if (command === "DATA") {
          inData = true;
          body = "";
          socket.write("354 End data with <CR><LF>.<CR><LF>\r\n");
        } else if (command === "RSET") {
          recipients = [];
          socket.write("250 OK\r\n");
        } else if (command === "QUIT") {
          socket.write("221 Bye\r\n");
          socket.end();
        } else {
          socket.write("250 OK\r\n");
        }
      }
    });
    socket.on("close", () => sockets.delete(socket));
    socket.on("error", () => sockets.delete(socket));
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "0.0.0.0", () => resolve());
  });
  return {
    messages,
    close: async () => {
      for (const socket of sockets) socket.destroy();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

function decode(message: string): string {
  // nodemailer uses quoted-printable for non-ASCII subjects and long lines.
  return message
    .replace(/=\r?\n/g, "")
    .replace(/=([0-9A-Fa-f]{2})/g, (_, hex: string) =>
      String.fromCharCode(parseInt(hex, 16))
    );
}

const config = liveStackConfig();
const capturePort = Number(process.env.LIVE_SMTP_CAPTURE_PORT ?? 0);
const canRun = !!config && Number.isInteger(capturePort) && capturePort > 0;

describe.skipIf(!canRun)("chat post email end to end", () => {
  const cfg = config as LiveStackConfig;
  let smtp: FakeSmtp;
  let people: LivePerson[] = [];

  beforeAll(async () => {
    smtp = await startFakeSmtp(capturePort);
  });

  afterAll(async () => {
    await smtp?.close();
  });

  afterEach(async () => {
    for (const person of people) {
      await deletePerson(cfg, person.userId).catch(() => {});
    }
    people = [];
    smtp.messages.length = 0;
  });

  async function signInAs(person: LivePerson): Promise<void> {
    const { error } = await getSupabaseClient().auth.signInWithPassword({
      email: person.email,
      password: person.password,
    });
    if (error) throw error;
  }

  async function signOut(): Promise<void> {
    await getSupabaseClient().auth.signOut();
  }

  async function setUp(): Promise<{
    gm: LivePerson;
    player: LivePerson;
    outsider: LivePerson;
    campaignId: string;
    channelId: string;
  }> {
    const gm = await createPerson(cfg, "gm");
    const player = await createPerson(cfg, "player");
    const outsider = await createPerson(cfg, "outsider");
    people.push(gm, player, outsider);

    await signInAs(gm);
    const campaignId = await createCampaign({
      uid: gm.userId,
      campaignName: "Email quest",
      campaignType: CampaignType.Coop,
    });
    await signOut();
    await signInAs(player);
    await joinCampaign({ campaignId });
    await signOut();

    await signInAs(gm);
    const { data, error } = await gm.client
      .from("chat_channels")
      .select("id")
      .eq("campaign_id", campaignId)
      .eq("kind", "IC")
      .limit(1);
    expect(error).toBeNull();
    const channelId = data?.[0]?.id;
    expect(channelId).toBeTruthy();
    return { gm, player, outsider, campaignId, channelId: channelId as string };
  }

  async function optIn(person: LivePerson, channelId: string, optedIn = true) {
    const { error } = await person.client
      .from("chat_channel_email_prefs")
      .upsert(
        {
          user_id: person.userId,
          channel_id: channelId,
          opted_in: optedIn,
        },
        { onConflict: "user_id,channel_id" }
      );
    expect(error).toBeNull();
  }

  function messagesTo(person: LivePerson): string[] {
    return smtp.messages
      .filter((message) =>
        message.to.some(
          (address) => address.toLowerCase() === person.email.toLowerCase()
        )
      )
      .map((message) => decode(message.raw));
  }

  async function waitForMessage(
    person: LivePerson,
    marker: string,
    timeoutMs = 30000
  ): Promise<string> {
    return waitFor(() => {
      const found = messagesTo(person).find((message) => message.includes(marker));
      return found ?? null;
    }, timeoutMs);
  }

  async function expectNoMessage(person: LivePerson, waitMs = 5000) {
    const before = messagesTo(person).length;
    await new Promise((resolve) => setTimeout(resolve, waitMs));
    expect(messagesTo(person).length).toBe(before);
  }

  it("delivers an opted-in reader's email with a link to the exact post", { timeout: 120000 }, async () => {
    const { gm, player, channelId } = await setUp();
    await optIn(player, channelId);

    await signInAs(gm);
    const marker = `bog-crossing-${Date.now()}`;
    const postId = await createPost({ channelId, text: marker });
    await signOut();

    const message = await waitForMessage(player, marker);
    expect(message).toContain("tab=chat");
    expect(message).toContain(`channel=${channelId}&post=${postId}`);
    expect(messagesTo(gm)).toHaveLength(0); // authors are never mailed

    const outbox = await adminClient(cfg)
      .from("chat_post_email_outbox")
      .select("recipient_user_id, sent_at, attempts")
      .eq("post_id", postId);
    expect(outbox.error).toBeNull();
    expect(
      outbox.data?.find((row) => row.recipient_user_id === player.userId)
        ?.sent_at
    ).toBeTruthy();
  });

  it("honours a global opt-out even when the channel is opted in", { timeout: 120000 }, async () => {
    const { gm, player, channelId } = await setUp();
    await optIn(player, channelId);
    const { error } = await player.client.from("user_settings").upsert({
      user_id: player.userId,
      email_notifications_enabled: false,
    });
    expect(error).toBeNull();

    await signInAs(gm);
    const marker = `silent-channel-${Date.now()}`;
    await createPost({ channelId, text: marker });
    await signOut();

    await expectNoMessage(player);
  });

  it("sends nothing with no preference row or an opted-out channel row", { timeout: 150000 }, async () => {
    const { gm, player, channelId } = await setUp();

    await signInAs(gm);
    await createPost({ channelId, text: `no-row-${Date.now()}` });
    await signOut();
    await expectNoMessage(player);

    await optIn(player, channelId, false);
    await signInAs(gm);
    await createPost({ channelId, text: `opted-out-${Date.now()}` });
    await signOut();
    await expectNoMessage(player);
  });

  it("never sends GM-only posts or rolls to players, but does send them to GMs", { timeout: 150000 }, async () => {
    const { gm, player, campaignId, channelId } = await setUp();
    const secondGM = await createPerson(cfg, "second-gm");
    people.push(secondGM);
    await grantMembership(cfg, campaignId, secondGM.userId, "gm");
    await optIn(player, channelId);
    await optIn(secondGM, channelId);

    await signInAs(gm);
    const marker = `gm-only-secret-${Date.now()}`;
    await createPost({ channelId, text: marker, gmsOnly: true });
    await signOut();

    await expectNoMessage(player);
    const gmMessage = await waitForMessage(secondGM, marker);
    expect(gmMessage).toContain(marker);
  });

  it("keeps private channels and direct messages out of outsiders' inboxes", { timeout: 180000 }, async () => {
    const { gm, player, outsider, campaignId } = await setUp();

    await signInAs(gm);
    const privateId = await createPrivateChannel({
      campaignId,
      name: "Hidden side quest",
      kind: "IC",
      memberIds: [player.userId],
    });
    const dmId = await getOrCreateDirectChannel({
      campaignId,
      otherUserId: player.userId,
    });
    await signOut();
    // An outsider who opts into both channels still receives nothing: the
    // candidate function checks channel access, not just preferences.
    await optIn(outsider, privateId);
    await optIn(outsider, dmId);
    await optIn(player, privateId);
    await optIn(player, dmId);

    await signInAs(gm);
    const privateMarker = `private-secret-${Date.now()}`;
    await createPost({ channelId: privateId, text: privateMarker });
    const dmMarker = `dm-secret-${Date.now()}`;
    await createPost({ channelId: dmId, text: dmMarker });
    await signOut();

    await expectNoMessage(outsider);
    const privateMessage = await waitForMessage(player, privateMarker);
    expect(privateMessage).toContain(privateMarker);
    const dmMessage = await waitForMessage(player, dmMarker);
    expect(dmMessage).toContain(dmMarker);
  });
});

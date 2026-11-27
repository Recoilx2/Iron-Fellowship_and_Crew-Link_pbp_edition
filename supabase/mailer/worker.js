/**
 * Chat-post email worker: LISTEN + outbox poll, one process per stack copy.
 *
 * A Postgres trigger queues one outbox row per candidate and NOTIFYs with a
 * post id only. This worker claims pending rows, re-runs the database's
 * candidate function at send time (so an opt-out or a removed channel roster
 * between posting and sending is honoured), applies the pure preference
 * check, and sends through the operator's SMTP settings. Failures retry a
 * bounded number of times with backoff. Logs carry ids and error codes only:
 * no recipient address, post text, roll or SMTP credential is ever printed.
 */

import { fileURLToPath } from "node:url";
import path from "node:path";
import { Client, Pool } from "pg";
import nodemailer from "nodemailer";
import { renderPostEmail, shouldEmail } from "./render.js";

export const MAX_ATTEMPTS = 5;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;

/** Any text that might come from a person, an address or a mail server. */
export function redact(value) {
  return String(value ?? "")
    .replace(EMAIL, "[email]")
    .replace(/(password|pass|secret|token)=[^\s&]+/gi, "$1=[redacted]");
}

function positiveInt(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function configFromEnv(env = process.env) {
  const port = positiveInt(env.SMTP_PORT, 587);
  return {
    connectionString: env.DATABASE_URL ?? "",
    enabled: String(env.EMAIL_NOTIFICATIONS_ENABLED ?? "false").toLowerCase() === "true",
    pollSeconds: positiveInt(env.MAILER_POLL_SECONDS, 30),
    siteUrl: env.SITE_URL ?? "",
    smtp: {
      host: env.SMTP_HOST ?? "",
      port,
      secure: port === 465,
      auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASS ?? "" } : undefined,
      fromAddress: env.SMTP_ADMIN_EMAIL ?? "",
      fromName: env.SMTP_SENDER_NAME ?? "Iron Fellowship",
    },
  };
}

/** pg's snake_case row -> the camelCase shape render.js expects. */
export function mapCandidate(row) {
  return {
    userId: row.recipient_user_id,
    email: row.recipient_email,
    displayName: row.recipient_display_name,
    channelId: row.post_channel_id,
    channelName: row.channel_name,
    campaignId: row.post_campaign_id,
    campaignName: row.campaign_name,
    postId: row.post_id,
    postText: row.post_text,
    gmsOnly: row.was_gms_only,
    roll: row.post_roll,
    globalOptIn: row.global_opt_in,
    channelOptIn: row.channel_opt_in,
    isAuthor: row.is_author,
    isGm: row.is_gm,
  };
}

function errorCode(error) {
  return redact(error?.code ?? error?.name ?? "unknown error").slice(0, 200);
}

export function createWorker(config, { pool, listener, transporter }) {
  let closed = false;

  async function claim(postId) {
    const sql = `
      UPDATE public.chat_post_email_outbox AS o
      SET next_attempt_at = now() + interval '2 minutes'
      WHERE o.id IN (
        SELECT q.id FROM public.chat_post_email_outbox AS q
        WHERE q.sent_at IS NULL
          AND q.next_attempt_at <= now()
          AND q.attempts < $1
          ${postId ? "AND q.post_id = $2" : ""}
        ORDER BY q.id
        LIMIT 50
        FOR UPDATE SKIP LOCKED
      )
      RETURNING o.id, o.post_id, o.recipient_user_id, o.attempts
    `;
    const { rows } = await pool.query(sql, postId ? [MAX_ATTEMPTS, postId] : [MAX_ATTEMPTS]);
    return rows;
  }

  async function markSkipped(id, reason) {
    await pool.query(
      "UPDATE public.chat_post_email_outbox SET sent_at = now(), last_error = $2 WHERE id = $1",
      [id, reason]
    );
  }

  async function markRetry(id, attempts, error) {
    if (attempts >= MAX_ATTEMPTS) {
      await markSkipped(id, `abandoned after ${attempts} attempts: ${error}`);
      return;
    }
    const backoffSeconds = Math.min(60, 2 ** (attempts - 1));
    await pool.query(
      `UPDATE public.chat_post_email_outbox
       SET attempts = $2, next_attempt_at = now() + ($3 * interval '1 second'), last_error = $4
       WHERE id = $1`,
      [id, attempts, backoffSeconds, error]
    );
  }

  async function deliver(row) {
    try {
      // Re-check with the database's own access + preference function: a
      // reader who lost access or opted out after the post is not mailed.
      const { rows } = await pool.query(
        "SELECT * FROM public.chat_post_email_candidates($1)",
        [row.post_id]
      );
      const found = rows.find((r) => r.recipient_user_id === row.recipient_user_id);
      const candidate = found ? mapCandidate(found) : null;
      if (!candidate || !shouldEmail(candidate)) {
        await markSkipped(row.id, "recipient no longer eligible");
        console.log(`[mailer] skipped outbox=${row.id} post=${row.post_id}: no longer eligible`);
        return;
      }

      const { subject, text, html } = renderPostEmail(candidate, config.siteUrl);
      const from = config.smtp.fromName
        ? `"${config.smtp.fromName.replace(/["\r\n]/g, "")}" <${config.smtp.fromAddress}>`
        : config.smtp.fromAddress;
      await transporter.sendMail({
        from,
        to: candidate.email,
        subject,
        text,
        html,
      });
      await pool.query(
        "UPDATE public.chat_post_email_outbox SET sent_at = now(), last_error = NULL WHERE id = $1",
        [row.id]
      );
      console.log(`[mailer] sent outbox=${row.id} post=${row.post_id}`);
    } catch (error) {
      await markRetry(row.id, row.attempts + 1, errorCode(error)).catch(() => {});
      console.error(`[mailer] failed outbox=${row.id} post=${row.post_id}: ${errorCode(error)}`);
    }
  }

  async function poll(postId) {
    if (closed || !config.enabled) return;
    for (const row of await claim(postId)) {
      await deliver(row);
    }
  }

  async function start() {
    if (!config.connectionString) {
      throw new Error("DATABASE_URL is required when email notifications are enabled");
    }
    if (!config.enabled) {
      console.log("[mailer] email notifications disabled (EMAIL_NOTIFICATIONS_ENABLED=false)");
      // Stay up as a healthy no-op service so `compose up` stays stable.
      setInterval(() => {}, 60_000);
      return;
    }

    listener.on("notification", (message) => {
      const postId = message.payload ?? "";
      if (!UUID.test(postId)) return;
      void poll(postId).catch((error) =>
        console.error(`[mailer] poll failed: ${errorCode(error)}`)
      );
    });
    listener.on("error", (error) =>
      console.error(`[mailer] listen error: ${errorCode(error)}`)
    );
    await listener.connect();
    await listener.query("LISTEN chat_post_email");
    console.log(`[mailer] listening; polling every ${config.pollSeconds}s`);

    await poll().catch((error) =>
      console.error(`[mailer] boot poll failed: ${errorCode(error)}`)
    );
    setInterval(() => {
      void poll().catch((error) =>
        console.error(`[mailer] poll failed: ${errorCode(error)}`)
      );
    }, config.pollSeconds * 1000);

    const stop = () => {
      closed = true;
      void listener.end().catch(() => {});
      void pool.end().catch(() => {});
      process.exit(0);
    };
    process.once("SIGTERM", stop);
    process.once("SIGINT", stop);
  }

  return { poll, start, stop: () => { closed = true; } };
}

function main() {
  const config = configFromEnv();
  const pool = new Pool({ connectionString: config.connectionString, max: 4 });
  const listener = new Client({ connectionString: config.connectionString });
  const transporter = nodemailer.createTransport({
    host: config.smtp.host,
    port: config.smtp.port,
    secure: config.smtp.secure,
    auth: config.smtp.auth,
    connectionTimeout: 5000,
    greetingTimeout: 5000,
    socketTimeout: 10000,
  });
  createWorker(config, { pool, listener, transporter })
    .start()
    .catch((error) => {
      console.error(`[mailer] startup failed: ${errorCode(error)}`);
      process.exit(1);
    });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main();
}

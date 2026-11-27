/**
 * Pure preference resolution and email rendering for chat-post notifications.
 *
 * No database, SMTP or environment access lives here: the worker maps the
 * snake_case rows from chat_post_email_candidates into this shape, then uses
 * these functions. Keeping the seam pure is what lets the unit tests pin the
 * two safety rules without Docker -- never email a reader who opted out, and
 * never put GM-only words or a roll in a player's message.
 */

const HTML_ESCAPES = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

export function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => HTML_ESCAPES[char]);
}

/**
 * Global opt-out wins; a missing channel row ("no row = no email") and an
 * opted-out row both refuse. The author never gets an email about their own
 * post, and a player never gets GM-only content even if a candidate row
 * somehow reached this layer.
 */
export function shouldEmail(candidate) {
  if (!candidate || typeof candidate !== "object") return false;
  if (!candidate.email) return false;
  if (candidate.globalOptIn !== true) return false;
  if (candidate.channelOptIn !== true) return false;
  if (candidate.isAuthor === true) return false;
  if (candidate.gmsOnly === true && candidate.isGm !== true) return false;
  return true;
}

/** Deep link into the exact post; other tab/query values stay untouched by the client. */
export function postLink(candidate, siteUrl) {
  const base = String(siteUrl ?? "").replace(/\/+$/, "");
  const campaignId = encodeURIComponent(candidate?.campaignId ?? "");
  const channelId = encodeURIComponent(candidate?.channelId ?? "");
  const postId = encodeURIComponent(candidate?.postId ?? "");
  return `${base}/campaign/${campaignId}?tab=chat&channel=${channelId}&post=${postId}`;
}

function describeRoll(roll) {
  if (roll == null) return null;
  if (typeof roll === "string") return roll;
  try {
    return JSON.stringify(roll);
  } catch {
    return "A roll was attached";
  }
}

/**
 * Renders one post email. Both bodies are plain post text -- markdown is
 * left to the app, where the reader's renderer handles it -- and the HTML
 * body escapes every value that came from a post, a name or the site URL.
 */
export function renderPostEmail(candidate, siteUrl) {
  const source = candidate ?? {};
  // Belt and braces: a player must never receive GM-only words or rolls,
  // even if a caller passes a candidate it should have filtered out.
  const maySeeRestricted = !(source.gmsOnly === true && source.isGm !== true);
  const postText = maySeeRestricted ? String(source.postText ?? "") : "";
  const roll = maySeeRestricted ? describeRoll(source.roll) : null;

  const channelName = String(source.channelName ?? "a channel");
  const campaignName = String(source.campaignName ?? "a campaign");
  const displayName = String(source.displayName ?? "Someone");
  const link = postLink(source, siteUrl);

  const subject = `New post in ${channelName} — ${campaignName}`;
  const text = [
    `${displayName} posted in ${channelName} (${campaignName}).`,
    "",
    ...(postText ? [postText] : []),
    ...(roll ? [`Roll: ${roll}`] : []),
    "",
    `Open the post: ${link}`,
  ].join("\n");

  const html = [
    `<p><strong>${escapeHtml(displayName)}</strong> posted in <strong>${escapeHtml(channelName)}</strong> (${escapeHtml(campaignName)}).</p>`,
    postText ? `<p>${escapeHtml(postText).replace(/\n/g, "<br>")}</p>` : "",
    roll ? `<p>Roll: ${escapeHtml(roll)}</p>` : "",
    `<p><a href="${escapeHtml(link)}">Open the post</a></p>`,
  ]
    .filter(Boolean)
    .join("\n");

  return { subject, text, html };
}

import type { Page } from "@playwright/test";
import {
  createClient,
  type Session,
  type SupabaseClient,
} from "@supabase/supabase-js";

/**
 * Browser-test setup for the campaign screen (spec #9).
 *
 * People are created with the service key through the Auth Admin API with
 * confirmed emails -- the same pattern as
 * src/api-calls/testing/liveHarness.ts -- so no mail server is involved.
 * Each person gets their own anon-key client, and the browser is signed in
 * by storing that person's session in localStorage under the app's Supabase
 * storage key before navigating, exactly as the site's own client persists
 * it. Tests never skip: missing stack variables throw, so a misconfigured
 * run fails instead of passing silently.
 */

export interface StackConfig {
  url: string;
  anonKey: string;
  serviceRoleKey: string;
}

export function stackConfig(): StackConfig {
  const url = process.env.SUPABASE_URL;
  const anonKey = process.env.SUPABASE_ANON_KEY;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !anonKey || !serviceRoleKey) {
    throw new Error(
      "e2e: SUPABASE_URL, SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY " +
        "must be set (supabase/tests/e2e.sh exports them from the per-copy env file)."
    );
  }
  return { url, anonKey, serviceRoleKey };
}

/**
 * The localStorage key the site's Supabase client persists its session
 * under. supabase-js derives it from the connection URL's hostname
 * (`sb-<first hostname label>-auth-token`); for the local stack that is
 * `sb-localhost-auth-token`.
 */
export function storageKeyFor(supabaseUrl: string): string {
  return `sb-${new URL(supabaseUrl).hostname.split(".")[0]}-auth-token`;
}

function adminClient(config: StackConfig): SupabaseClient {
  return createClient(config.url, config.serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

function personClient(config: StackConfig): SupabaseClient {
  return createClient(config.url, config.anonKey, {
    auth: { persistSession: false, autoRefreshToken: true },
  });
}

export interface E2EPerson {
  tag: string;
  email: string;
  userId: string;
  session: Session;
  client: SupabaseClient;
}

function randomToken(): string {
  return crypto.randomUUID().replace(/-/g, "");
}

export async function createPerson(
  config: StackConfig,
  tag: string
): Promise<E2EPerson> {
  const email = `${tag}-${Date.now()}-${randomToken().slice(0, 8)}@example.com`;
  const password = `pw-${randomToken()}`;
  const { data, error } = await adminClient(config).auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { display_name: tag },
  });
  if (error || !data.user) {
    throw new Error(`e2e: could not create ${tag}: ${error?.message}`);
  }
  const client = personClient(config);
  const { error: signInError } = await client.auth.signInWithPassword({
    email,
    password,
  });
  if (signInError) {
    throw new Error(`e2e: could not sign in ${tag}: ${signInError.message}`);
  }
  const { data: sessionData, error: sessionError } =
    await client.auth.getSession();
  if (sessionError || !sessionData.session) {
    throw new Error(`e2e: no session for ${tag}: ${sessionError?.message}`);
  }
  return {
    tag,
    email,
    userId: data.user.id,
    session: sessionData.session,
    client,
  };
}

export async function deletePerson(
  config: StackConfig,
  userId: string
): Promise<void> {
  const { error } = await adminClient(config).auth.admin.deleteUser(userId);
  if (error) {
    throw new Error(`e2e: could not delete test person: ${error.message}`);
  }
}

/**
 * Creates a campaign as the person, the way the app does (the
 * create_campaign function bootstraps the founder's roster row), and
 * returns its id.
 */
export async function createCampaignAs(
  person: E2EPerson,
  name: string
): Promise<string> {
  const { data, error } = await person.client.rpc("create_campaign", {
    cname: name,
    ctype: "guided",
  });
  if (error || !data) {
    throw new Error(`e2e: could not create campaign: ${error?.message}`);
  }
  const id = Array.isArray(data) ? data[0] : data;
  if (typeof id !== "string" || id.length === 0) {
    throw new Error("e2e: could not create campaign: empty id");
  }
  return id;
}

/**
 * Joins a campaign as the person through the invite-link function, so the
 * roster row is created exactly as it is for a real invitee.
 */
export async function joinCampaignAs(
  person: E2EPerson,
  campaignId: string
): Promise<void> {
  const { error } = await person.client.rpc("join_campaign", {
    cid: campaignId,
  });
  if (error) {
    throw new Error(`e2e: could not join campaign: ${error.message}`);
  }
}

export async function deleteCampaignAsAdmin(
  config: StackConfig,
  campaignId: string
): Promise<void> {
  const { error } = await adminClient(config)
    .from("campaigns")
    .delete()
    .eq("id", campaignId);
  if (error) {
    throw new Error(`e2e: could not delete campaign: ${error.message}`);
  }
}

export function campaignUrl(campaignId: string): string {
  return `/campaigns/${campaignId}`;
}

/**
 * Signs the browser in as the person by storing their session where the
 * site's own Supabase client persists it, then navigating to `target`.
 * The first navigation only establishes the site origin; an unauthenticated
 * visit lands on the login page, which shares the origin, so the stored
 * session is picked up on the second navigation.
 */
export async function signInAs(
  page: Page,
  config: StackConfig,
  person: E2EPerson,
  target: string
): Promise<void> {
  await page.goto("/");
  await page.evaluate(
    ([key, value]: string[]) => window.localStorage.setItem(key, value),
    [storageKeyFor(config.url), JSON.stringify(person.session)]
  );
  await page.goto(target);
}

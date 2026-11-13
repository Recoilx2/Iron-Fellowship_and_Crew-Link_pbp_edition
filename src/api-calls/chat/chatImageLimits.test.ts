import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Seam under test: the pure selection rules for chat attachments. The cap
// comes from the VITE_CHAT_IMAGE_MAX_MB deployment setting (default 10 MB),
// the same setting the chat-images bucket reads, so the browser and the
// server refuse the same files. What the bucket enforces is covered by the
// storage live tests; here only the client-side reading and error text are
// specified.
describe("chat image limits", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllEnvs();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  async function loadWithEnv(env: Record<string, string>) {
    for (const [key, value] of Object.entries(env)) {
      vi.stubEnv(key, value);
    }
    return import("api-calls/chat/chatImageLimits");
  }

  function file(overrides: Partial<{ type: string; size: number }> = {}): File {
    return {
      type: "image/png",
      size: 1024,
      name: " Lantern.png ",
      ...overrides,
    } as File;
  }

  it("accepts PNG, JPEG, GIF and WebP", async () => {
    const { ACCEPTED_CHAT_IMAGE_TYPES, validateChatImageFile } =
      await loadWithEnv({});
    expect([...ACCEPTED_CHAT_IMAGE_TYPES].sort()).toEqual(
      ["image/gif", "image/jpeg", "image/png", "image/webp"].sort()
    );
    for (const type of ACCEPTED_CHAT_IMAGE_TYPES) {
      expect(validateChatImageFile(file({ type }))).toBeNull();
    }
  });

  it("refuses other types with a clear error", async () => {
    const { validateChatImageFile } = await loadWithEnv({});
    expect(validateChatImageFile(file({ type: "image/svg+xml" }))).toMatch(
      /PNG, JPEG, GIF or WebP/i
    );
    expect(validateChatImageFile(file({ type: "application/pdf" }))).toMatch(
      /PNG, JPEG, GIF or WebP/i
    );
  });

  it("caps the pre-shrink selection at the deployment default of 10 MB", async () => {
    const { MAX_CHAT_IMAGE_BYTES, MAX_CHAT_IMAGE_LABEL, validateChatImageFile } =
      await loadWithEnv({});
    expect(MAX_CHAT_IMAGE_BYTES).toBe(10 * 1024 * 1024);
    expect(MAX_CHAT_IMAGE_LABEL).toBe("10 MB");
    expect(
      validateChatImageFile(file({ size: MAX_CHAT_IMAGE_BYTES }))
    ).toBeNull();
    expect(
      validateChatImageFile(file({ size: MAX_CHAT_IMAGE_BYTES + 1 }))
    ).toMatch(/10 MB/);
  });

  it("reads a larger deployment cap for both the bytes and the label", async () => {
    const { MAX_CHAT_IMAGE_BYTES, MAX_CHAT_IMAGE_LABEL, validateChatImageFile } =
      await loadWithEnv({ VITE_CHAT_IMAGE_MAX_MB: "25" });
    expect(MAX_CHAT_IMAGE_BYTES).toBe(25 * 1024 * 1024);
    expect(MAX_CHAT_IMAGE_LABEL).toBe("25 MB");
    expect(
      validateChatImageFile(file({ size: MAX_CHAT_IMAGE_BYTES }))
    ).toBeNull();
    expect(
      validateChatImageFile(file({ size: MAX_CHAT_IMAGE_BYTES + 1 }))
    ).toMatch(/25 MB/);
  });

  it("falls back to the default on a missing or broken deployment value", async () => {
    for (const value of ["", "huge", "0", "-4"]) {
      const { MAX_CHAT_IMAGE_BYTES, MAX_CHAT_IMAGE_LABEL } =
        await loadWithEnv({ VITE_CHAT_IMAGE_MAX_MB: value });
      expect(MAX_CHAT_IMAGE_BYTES).toBe(10 * 1024 * 1024);
      expect(MAX_CHAT_IMAGE_LABEL).toBe("10 MB");
      vi.resetModules();
      vi.unstubAllEnvs();
    }
  });
});

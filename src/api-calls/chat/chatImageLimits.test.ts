import { describe, expect, it } from "vitest";

import {
  ACCEPTED_CHAT_IMAGE_TYPES,
  MAX_CHAT_IMAGE_BYTES,
  MAX_CHAT_IMAGE_LABEL,
  validateChatImageFile,
} from "api-calls/chat/chatImageLimits";

// Seam under test: the pure selection rules for chat attachments. What the
// bucket enforces is covered by the storage live tests; here only the
// client-side error text is specified.
function file(overrides: Partial<{ type: string; size: number }> = {}): File {
  return {
    type: "image/png",
    size: 1024,
    name: " Lantern.png ",
    ...overrides,
  } as File;
}

describe("chat image limits", () => {
  it("accepts PNG, JPEG, GIF and WebP", () => {
    expect([...ACCEPTED_CHAT_IMAGE_TYPES].sort()).toEqual(
      ["image/gif", "image/jpeg", "image/png", "image/webp"].sort()
    );
    for (const type of ACCEPTED_CHAT_IMAGE_TYPES) {
      expect(validateChatImageFile(file({ type }))).toBeNull();
    }
  });

  it("refuses other types with a clear error", () => {
    expect(validateChatImageFile(file({ type: "image/svg+xml" }))).toMatch(
      /PNG, JPEG, GIF or WebP/i
    );
    expect(validateChatImageFile(file({ type: "application/pdf" }))).toMatch(
      /PNG, JPEG, GIF or WebP/i
    );
  });

  it("caps the pre-shrink selection at 10 MB", () => {
    expect(MAX_CHAT_IMAGE_BYTES).toBe(10 * 1024 * 1024);
    expect(MAX_CHAT_IMAGE_LABEL).toBe("10 MB");
    expect(
      validateChatImageFile(file({ size: MAX_CHAT_IMAGE_BYTES }))
    ).toBeNull();
    expect(
      validateChatImageFile(file({ size: MAX_CHAT_IMAGE_BYTES + 1 }))
    ).toMatch(/10 MB/);
  });
});

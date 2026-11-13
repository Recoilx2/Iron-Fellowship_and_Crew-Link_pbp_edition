import { describe, expect, it } from "vitest";

import {
  CHAT_IMAGES_BUCKET,
  chatImageFilePath,
} from "api-calls/chat/chatImages";

// Seam under test: the chat data layer is the only place that names the
// chat-images bucket and its paths. Uploads and access rules are covered by
// the storage live tests; here only the path shape is specified.
describe("chat image paths", () => {
  it("names the chat-images bucket", () => {
    expect(CHAT_IMAGES_BUCKET).toBe("chat-images");
  });

  it("scopes an attachment to its campaign and post", () => {
    expect(
      chatImageFilePath("campaign-1", "post-1", "Lantern.png")
    ).toBe("campaign-1/post-1/Lantern.png");
  });
});

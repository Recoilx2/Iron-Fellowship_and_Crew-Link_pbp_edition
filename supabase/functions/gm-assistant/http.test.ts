/**
 * Unit tests for the GM assistant HTTP helpers: the capped body read
 * (ticket #163) and the `errorName` hardening (ticket #151).
 */
import { describe, expect, it } from "vitest";

import { errorName, readBodyCapped } from "./http";

const MAX_PREVIEW_BODY_BYTES = 64 * 1024;

function chunkedRequest(chunks: Uint8Array[]): Request {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(chunk);
      controller.close();
    },
  });
  // No Content-Length header, so the body arrives chunked.
  return new Request("http://x/gm-assistant/context-size", {
    method: "POST",
    body: stream,
    duplex: "half",
  } as RequestInit);
}

describe("readBodyCapped", () => {
  it("reads a chunked body with no Content-Length that is under the cap", async () => {
    const payload = JSON.stringify({
      campaignId: "22222222-2222-4222-8222-222222222222",
    });
    const req = chunkedRequest([new TextEncoder().encode(payload)]);
    expect(await readBodyCapped(req, MAX_PREVIEW_BODY_BYTES)).toBe(payload);
  });

  it("gives up once more than the cap arrives, with no Content-Length", async () => {
    // One byte more than the cap, split into 1 KB chunks: no single read
    // proves the size, so only the running count can stop it.
    const chunk = new TextEncoder().encode("x".repeat(1024));
    const chunks = Array.from(
      { length: MAX_PREVIEW_BODY_BYTES / 1024 + 1 },
      () => chunk
    );
    const req = chunkedRequest(chunks);
    expect(await readBodyCapped(req, MAX_PREVIEW_BODY_BYTES)).toBeNull();
  });

  it("stops reading at the cap and cancels the rest of the stream", async () => {
    let cancelled = false;
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        // Far more than the cap, never closed: reading it all would
        // buffer an unbounded body.
        for (let i = 0; i < 100; i++) {
          controller.enqueue(new TextEncoder().encode("x".repeat(64 * 1024)));
        }
      },
      cancel() {
        cancelled = true;
      },
    });
    const req = new Request("http://x/gm-assistant/context-size", {
      method: "POST",
      body: stream,
      duplex: "half",
    } as RequestInit);
    expect(await readBodyCapped(req, MAX_PREVIEW_BODY_BYTES)).toBeNull();
    expect(cancelled).toBe(true);
  });

  it("rethrows a failed body read, so the caller can answer 400", async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.error(new Error("stream blew up"));
      },
    });
    const req = new Request("http://x/gm-assistant/context-size", {
      method: "POST",
      body: stream,
      duplex: "half",
    } as RequestInit);
    await expect(readBodyCapped(req, MAX_PREVIEW_BODY_BYTES)).rejects.toThrow(
      "stream blew up"
    );
  });
});

describe("errorName", () => {
  it("keeps a short plain-word Error name", () => {
    expect(errorName(new TypeError("nope"))).toBe("TypeError");
  });

  it("reads a hostile Error name as Error", () => {
    const hostile = new Error("boom");
    hostile.name = "TypeError\nAuthorization: Bearer sk-secret";
    expect(errorName(hostile)).toBe("Error");
  });

  it("logs unknown for a non-Error throw", () => {
    expect(errorName("a string")).toBe("unknown");
    expect(errorName(undefined)).toBe("unknown");
    expect(errorName({ message: "shape" })).toBe("unknown");
  });
});

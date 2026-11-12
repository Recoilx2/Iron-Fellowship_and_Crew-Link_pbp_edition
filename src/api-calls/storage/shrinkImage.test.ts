import { describe, expect, it } from "vitest";

import {
  computeShrunkDimensions,
  shrinkImageFile,
} from "api-calls/storage/shrinkImage";

describe("browser-side image shrinking", () => {
  it("leaves small images at their own size", () => {
    expect(computeShrunkDimensions(800, 600)).toEqual({
      width: 800,
      height: 600,
    });
  });

  it("shrinks the long edge to the limit", () => {
    expect(computeShrunkDimensions(2048, 1024)).toEqual({
      width: 1024,
      height: 512,
    });
    expect(computeShrunkDimensions(768, 3072)).toEqual({
      width: 256,
      height: 1024,
    });
  });

  it("leaves degenerate sizes alone", () => {
    expect(computeShrunkDimensions(0, 0)).toEqual({ width: 0, height: 0 });
  });

  it("returns the original file where browser image APIs are missing", async () => {
    const file = new File(["pixels"], "portrait.png", {
      type: "image/png",
    });
    await expect(shrinkImageFile(file)).resolves.toBe(file);
  });
});

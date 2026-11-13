/** @vitest-environment jsdom */
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { IdParser } from "@datasworn-community/core";
import { classic } from "@datasworn-community/ironsworn-classic";
import { MarkdownRenderer } from "../MarkdownRenderer";

IdParser.tree = { [classic._id]: classic };

function html(markdown: string): string {
  return renderToStaticMarkup(<MarkdownRenderer markdown={markdown} />);
}

describe("MarkdownRenderer blocks unsafe link schemes (ticket #119)", () => {
  it.each([
    ["javascript:", "[click me](javascript:alert(1))"],
    ["mixed-case javascript:", "[click me](JaVaScRiPt:alert(1))"],
    ["space-padded javascript:", "[click me](   javascript:alert(1)   )"],
    [
      "space-padded mixed-case javascript:",
      "[click me](  JaVaScRiPt:alert(1)  )",
    ],
    ["data:", "[click me](data:text/html;base64,SGVsbG8=)"],
    ["mixed-case data:", "[click me](DaTa:text/html;base64,SGVsbG8=)"],
    ["space-padded data:", "[click me](  data:text/html;base64,SGVsbG8=  )"],
    ["vbscript:", "[click me](vbscript:msgbox(1))"],
    ["mixed-case vbscript:", "[click me](VbScRiPt:msgbox(1))"],
    ["space-padded vbscript:", "[click me](  vbscript:msgbox(1)  )"],
  ])("%s renders with no clickable href", (_label, markdown) => {
    const rendered = html(markdown);
    // The link text survives, but no anchor carries the payload.
    expect(rendered).toContain("click me");
    expect(rendered).not.toMatch(/<a\b/i);
    expect(rendered.toLowerCase()).not.toContain("javascript:");
    expect(rendered.toLowerCase()).not.toContain("vbscript:");
  });

  it("data: payload leaves no href behind", () => {
    const rendered = html("[click me](data:text/html;base64,SGVsbG8=)");
    expect(rendered).toContain("click me");
    expect(rendered).not.toMatch(/<a\b/i);
    expect(rendered).not.toContain("base64");
  });
});

describe("MarkdownRenderer keeps safe links clickable (ticket #119)", () => {
  it.each([
    ["https:", "[site](https://example.com/map)"],
    ["http:", "[site](http://example.com/map)"],
    ["mailto:", "[mail](mailto:gm@example.com)"],
    ["relative path:", "[room](/campaigns/abc/channels/ic)"],
    ["anchor:", "[down](#rules-heading)"],
  ])("%s still renders as a link", (_label, markdown) => {
    const rendered = html(markdown);
    expect(rendered).toMatch(/<a\b[^>]*href=/i);
  });

  it("external links carry rel=noopener noreferrer", () => {
    const rendered = html("[site](https://example.com/map)");
    expect(rendered).toMatch(/rel="noopener noreferrer"/);
  });

  it("datasworn: links still open the rules dialog", () => {
    const rendered = html(
      "[Ask the Oracle](datasworn:move.oracle_rollable:classic/fate/ask_the_oracle.likely)",
    );
    // Datasworn links render as buttons that open the rules dialog.
    expect(rendered).toMatch(/<button\b/i);
    expect(rendered).toContain("Ask the Oracle");
  });
});

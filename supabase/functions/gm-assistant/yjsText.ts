/**
 * The one Yjs decoder on the server side (ticket #151): note text is
 * stored as base64 Yjs updates — the note server's format, beside each
 * note row — and this module decodes those bytes to plain text. The
 * browser has its own TipTap-faithful decoder for previews and editing
 * (`src/api-calls/assistant/outlineText.ts`); the server side must stay
 * dependency-free (it runs in the Edge Runtime with web-standard APIs
 * only), so this scanner is the server's single decoder of that format.
 *
 * Split out of `handler.ts` (ticket #151).
 */

const YJS_STRUCTURAL_TOKENS = new Set([
  "body",
  "default",
  "doc",
  "paragraph",
  "heading",
  "text",
  "title",
  "bulletList",
  "orderedList",
  "listItem",
  "blockquote",
  "codeBlock",
  "hardBreak",
  "horizontalRule",
  "image",
  "mention",
]);

function readVarInt(bytes: Uint8Array, start: number): { value: number; next: number } | null {
  let value = 0;
  let shift = 0;
  let pos = start;
  for (let i = 0; i < 5; i++) {
    if (pos >= bytes.length) return null;
    const byte = bytes[pos++];
    value += (byte & 0x7f) * 2 ** shift;
    shift += 7;
    if (byte < 0x80) return { value, next: pos };
  }
  return null;
}

const PRINTABLE_RUN = /^[\p{L}\p{N}\p{P}\p{S} \t\n\r.,;:!?'"“”‘’—–()\-…]+$/u;

/**
 * Decodes note-server Yjs bytes (base64 of a Yjs update, the format the
 * note server persists beside each note) to plain text. Yjs stores strings
 * as variable-length-prefixed UTF-8 runs, so scanning for those runs
 * recovers plain-text inserts and TipTap text nodes alike in document
 * order, in both Deno and Node with no dependency. Structural type names
 * (`body`, `default`, `paragraph`, ...) are filtered out; pieces are joined
 * without a separator across whitespace and with a newline otherwise.
 * Anything undecodable reads as empty, never as an error.
 */
export function yjsBase64ToPlainText(content: string | null | undefined): string {
  if (!content) return "";
  let bytes: Uint8Array;
  try {
    const binary = atob(content);
    bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  } catch {
    return "";
  }
  const pieces: string[] = [];
  const decoder = new TextDecoder();
  let i = 0;
  while (i < bytes.length) {
    const length = readVarInt(bytes, i);
    if (!length || length.value < 2 || length.value > 4000 || length.next + length.value > bytes.length) {
      i++;
      continue;
    }
    const slice = bytes.subarray(length.next, length.next + length.value);
    let text = "";
    try {
      text = decoder.decode(slice);
    } catch {
      i++;
      continue;
    }
    if (!PRINTABLE_RUN.test(text) || YJS_STRUCTURAL_TOKENS.has(text)) {
      i++;
      continue;
    }
    // Runs of binary metadata can alias as short printable strings; a run
    // that is entirely enclosed by an already-kept piece adds nothing.
    if (pieces.some((kept) => kept.includes(text))) {
      i = length.next + length.value;
      continue;
    }
    pieces.push(text);
    i = length.next + length.value;
  }
  let out = "";
  for (const piece of pieces) {
    if (!out) {
      out = piece;
    } else if (/\s$/.test(out) || /^\s/.test(piece)) {
      out += piece;
    } else {
      out += `\n${piece}`;
    }
  }
  return out;
}

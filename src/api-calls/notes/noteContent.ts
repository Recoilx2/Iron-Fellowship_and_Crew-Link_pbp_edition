/**
 * Note contents travel as base64 text in a single row beside each note; the
 * bytes stay opaque to the database. The client encodes and decodes them at
 * its edge, in chunks so large notes never overflow the argument limit.
 */

const CHUNK_SIZE = 0x8000;

export function encodeNoteContent(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += CHUNK_SIZE) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK_SIZE));
  }
  return btoa(binary);
}

export function decodeNoteContent(content: string): Uint8Array {
  const binary = atob(content);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

// ─── Double-encoded text ("mojibake") detection ──────────────────────────────
//
// The 0.2.3 release shipped six package descriptions whose em-dash had been
// saved as UTF-8, read back as Windows-1252, and saved as UTF-8 again. npm
// rendered a three-character smear where each em-dash should have been, on
// every package page. A description is baked into the published tarball and a
// published version cannot be overwritten, so the defect was permanent the
// moment it shipped.
//
// The first fix searched for the literal string "â€" — the Windows-1252
// rendering of the UTF-8 lead pair E2 80. That works, but only for the block
// that lead pair encodes: U+2000–U+203F. It catches the em-dash, en-dash, both
// curly quote pairs, the ellipsis and the bullet, and nothing else. An accented
// letter (C3 xx → Ã©), a non-breaking space or © (C2 xx → Â©), an arrow
// (E2 86 92 → â†’), a trademark sign (E2 84 A2 → â„¢) and every emoji
// (F0 9F 94 A7 → ðŸ”§) all render as visible garbage and all passed.
//
// So this module does not look for a signature. It undoes the transform:
// re-encode the text as Windows-1252 bytes, then decode those bytes as strict
// UTF-8. If that succeeds and yields *different* text, the text is what a
// mangled round-trip produces, whatever character it started as.
//
// The inverse direction is what makes this safe rather than merely broad. A
// correctly-encoded em-dash is U+2014, which is one Windows-1252 byte (0x97);
// 0x97 alone is not valid UTF-8, the decode throws, and the text is left alone.
// Pure ASCII is a fixed point of the whole round-trip and returns early.

/**
 * Windows-1252 decoding table for bytes 0x80–0x9F. Every other byte decodes to
 * the codepoint of the same value — 0x00–0x7F is ASCII and 0xA0–0xFF is
 * Latin-1 — so only this range needs a table.
 *
 * The five bytes Windows-1252 leaves undefined (0x81 0x8D 0x8F 0x90 0x9D) map
 * to their own codepoint here, which is what the WHATWG encoding standard and
 * every browser do. Real mojibake does contain them, so a table that dropped
 * them would fail to recognise some of the very strings this exists to find.
 */
const CP1252_HIGH = [
  0x20ac, 0x0081, 0x201a, 0x0192, 0x201e, 0x2026, 0x2020, 0x2021, // 0x80–0x87
  0x02c6, 0x2030, 0x0160, 0x2039, 0x0152, 0x008d, 0x017d, 0x008f, // 0x88–0x8F
  0x0090, 0x2018, 0x2019, 0x201c, 0x201d, 0x2022, 0x2013, 0x2014, // 0x90–0x97
  0x02dc, 0x2122, 0x0161, 0x203a, 0x0153, 0x009d, 0x017e, 0x0178, // 0x98–0x9F
];

/** Codepoint → byte: the inverse of CP1252_HIGH. */
const TO_CP1252 = new Map(CP1252_HIGH.map((cp, i) => [cp, 0x80 + i]));

const STRICT_UTF8 = new TextDecoder("utf-8", { fatal: true });

const NON_ASCII_RUN = /[^\x00-\x7F]+/g;

/**
 * Re-encode text as Windows-1252 bytes.
 *
 * @returns the bytes, or null if any character has no Windows-1252 byte — in
 *   which case the text cannot be the output of a Windows-1252 decode, so it
 *   cannot be mojibake of this kind.
 */
function toCp1252Bytes(text) {
  const out = [];
  for (const ch of text) {
    const cp = ch.codePointAt(0);
    if (cp <= 0x7f || (cp >= 0xa0 && cp <= 0xff)) {
      out.push(cp);
      continue;
    }
    const byte = TO_CP1252.get(cp);
    if (byte === undefined) return null;
    out.push(byte);
  }
  return Uint8Array.from(out);
}

/**
 * Undo one UTF-8 → Windows-1252 → UTF-8 round-trip.
 *
 * @returns what the text should have been, or null if it is not double-encoded.
 */
export function decodeDoubleEncoded(text) {
  if (typeof text !== "string" || text.length === 0) return null;
  const bytes = toCp1252Bytes(text);
  if (bytes === null) return null;
  let decoded;
  try {
    decoded = STRICT_UTF8.decode(bytes);
  } catch {
    // Not valid UTF-8, so the text is simply itself — a real em-dash lands here.
    return null;
  }
  return decoded === text ? null : decoded;
}

/**
 * Every double-encoded run in a string.
 *
 * Works run by run rather than on the whole string, so a mangled character
 * still gets found when it sits next to a legitimate one that has no
 * Windows-1252 byte. "core → ui, cafÃ©" is the case that matters: the arrow
 * makes the whole string un-encodable, but the `Ã©` run is still mojibake.
 *
 * @returns [{ found, shouldBe, index }], empty when the string is clean.
 */
export function findDoubleEncoded(text) {
  if (typeof text !== "string") return [];
  const hits = [];
  for (const match of text.matchAll(NON_ASCII_RUN)) {
    const shouldBe = decodeDoubleEncoded(match[0]);
    if (shouldBe !== null) {
      hits.push({ found: match[0], shouldBe, index: match.index });
    }
  }
  return hits;
}

/** True when a string contains any double-encoded run. */
export function looksDoubleEncoded(text) {
  return findDoubleEncoded(text).length > 0;
}

/**
 * A one-line description of what is wrong, for an error message.
 * Returns null when the text is clean.
 */
export function describeDoubleEncoding(text) {
  const hits = findDoubleEncoded(text);
  if (hits.length === 0) return null;
  const shown = hits
    .slice(0, 3)
    .map((h) => `${JSON.stringify(h.found)} should be ${JSON.stringify(h.shouldBe)}`)
    .join("; ");
  const rest = hits.length > 3 ? ` (+${hits.length - 3} more)` : "";
  return `${shown}${rest}`;
}

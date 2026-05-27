// Minimal parser for Valve KeyValues (VDF / .acf) format. Steam stores its
// library catalog and per-app manifests in this format. We only need the
// subset that lets us pull installed-app metadata, so we hand-roll a small
// recursive descent parser rather than pulling in a dependency.
//
// Spec we support:
//   - "key"  "value"          → string field
//   - "key"  { ... }           → nested object
//   - // line comments         → ignored
//   - Escaped quotes (\") inside values
// Anything weirder, we'll punt to null and the caller can fall back.

export type VdfValue = string | VdfObject;
export type VdfObject = { [k: string]: VdfValue };

class Cursor {
  pos = 0;
  constructor(public src: string) {}
  peek(): string | undefined {
    return this.src[this.pos];
  }
  next(): string | undefined {
    return this.src[this.pos++];
  }
  eof(): boolean {
    return this.pos >= this.src.length;
  }
}

function skipWhitespace(c: Cursor): void {
  while (!c.eof()) {
    const ch = c.peek();
    if (ch === " " || ch === "\t" || ch === "\r" || ch === "\n") {
      c.next();
      continue;
    }
    // Line comment
    if (ch === "/" && c.src[c.pos + 1] === "/") {
      while (!c.eof() && c.peek() !== "\n") c.next();
      continue;
    }
    break;
  }
}

function readQuotedString(c: Cursor): string {
  if (c.next() !== '"') throw new Error("expected opening quote");
  let out = "";
  while (!c.eof()) {
    const ch = c.next();
    if (ch === '"') return out;
    if (ch === "\\") {
      const esc = c.next();
      if (esc === "n") out += "\n";
      else if (esc === "t") out += "\t";
      else out += esc ?? "";
      continue;
    }
    out += ch;
  }
  throw new Error("unterminated string");
}

function readObject(c: Cursor): VdfObject {
  if (c.next() !== "{") throw new Error("expected {");
  const obj: VdfObject = {};
  while (true) {
    skipWhitespace(c);
    if (c.peek() === "}") {
      c.next();
      return obj;
    }
    if (c.eof()) throw new Error("unterminated object");
    const key = readQuotedString(c);
    skipWhitespace(c);
    if (c.peek() === "{") {
      obj[key] = readObject(c);
    } else if (c.peek() === '"') {
      obj[key] = readQuotedString(c);
    } else {
      throw new Error(`unexpected token after key "${key}"`);
    }
  }
}

/**
 * Parse a VDF document. Returns the top-level object (after the outer wrapper
 * key, which Valve always wraps everything in — e.g. `libraryfolders { ... }`).
 * Returns null on parse failure rather than throwing — caller decides whether
 * a missing manifest is fatal or just "skip this library."
 */
export function parseVdf(text: string): VdfObject | null {
  try {
    const c = new Cursor(text);
    skipWhitespace(c);
    if (c.eof()) return null;
    // Outer key
    readQuotedString(c);
    skipWhitespace(c);
    return readObject(c);
  } catch {
    return null;
  }
}

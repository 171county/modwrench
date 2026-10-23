// LOOT's conditions, answered true, false or "unknown". The grammar is LOOT's
// (libloot docs/metadata, "Condition Syntax"):
//
//   expression ::= compound ( "or" compound )*
//   compound   ::= condition ( "and" condition )*
//   condition  ::= [ "not" ] ( function | "(" expression ")" )
//   function   ::= name "(" argument ( "," argument )* ")"
//
// so "and" binds tighter than "or". An argument is a double-quoted string (a
// path, a regex or a version, with no escapes) or a bare word (a checksum, a
// comparator, a size). Unknown combines by Kleene's rules: false and unknown is
// false, true or unknown is true, not unknown is unknown.
//
// The facts are the plugins the caller says are active, and whether that is
// all of them. So active() and many_active() can be answered, and file() and
// many() can be true for active plugins (an active plugin's file is there; an
// inactive one's may be too). Every other function LOOT has needs the game's
// files, which these tools don't read: checksum(), version(),
// product_version(), filename_version(), readable(), is_executable(),
// is_master(), file_size() and description_contains() are unknown. So is a
// path in a folder ("SKSE/Plugins/x.dll", "../SkyrimSE.exe"), a function
// LOOT doesn't have, and a call ModWrench can't read, such as one with the
// wrong arguments. A condition that doesn't parse is unknown as a whole.
//
// The text comes from the fetched masterlist, so it is bounded: one over
// MAX_LENGTH characters, or with more than MAX_DEPTH brackets and "not"s inside
// one another, isn't read. In LOOT's v0.29 lists for all seven games the
// longest of the 5,529 conditions is 680 characters, the deepest has two
// brackets inside one another, and every one of them parses here.

const MAX_LENGTH = 2000;
const MAX_DEPTH = 16;

export type Truth = boolean | "unknown";

export type LootFacts = {
  /** Plugins known to be active, as named. */
  active: readonly string[];
  /** Whether `active` is every active plugin, so that any other plugin is known to be inactive. */
  allActive: boolean;
};

export type Condition = (facts: LootFacts) => Truth;

type Arg = { quoted: boolean; text: string };

const UNKNOWN: Condition = () => "unknown";

// LOOT reads a path as a regex when it holds any of : \ * ? |, and matches it
// against the whole file name, case-insensitively. many() and many_active()
// always take a regex.
const REGEX_PATH = /[:\\*?|]/;

/**
 * A regex from the masterlist, anchored as LOOT anchors it, or null. LOOT's regex
 * engine (Rust's) never backtracks; JavaScript's does, so a pattern LOOT runs in
 * no time can run here for ever. One that repeats a group holding a repeat or an
 * alternative, (a+)+ or (a|b)*, refers back to a group, or has more than three
 * open-ended repeats, isn't run.
 */
export function safeRegex(pattern: string): RegExp | null {
  const groups: Array<{ risky: boolean }> = [{ risky: false }];
  let open = 0;
  for (let i = 0; i < pattern.length; i++) {
    const ch = pattern[i]!;
    if (ch === "\\") {
      if (/[1-9k]/.test(pattern[i + 1] ?? "")) return null;
      i++;
    } else if (ch === "[") {
      for (i++; i < pattern.length && pattern[i] !== "]"; i++) if (pattern[i] === "\\") i++;
    } else if (ch === "(") {
      groups.push({ risky: false });
      if (pattern[i + 1] === "?") i++;
    } else if (ch === ")" && groups.length > 1) {
      const group = groups.pop()!;
      const repeat = /^(?:[*+]|\{\d+,\})/.exec(pattern.slice(i + 1));
      if (repeat && group.risky) return null;
      if (group.risky) groups[groups.length - 1]!.risky = true;
    } else if (ch === "|") {
      groups[groups.length - 1]!.risky = true;
    } else if (ch === "*" || ch === "+" || ch === "?" || ch === "{") {
      groups[groups.length - 1]!.risky = true;
      if (ch === "*" || ch === "+" || /^\{\d+,\}/.test(pattern.slice(i))) open++;
    }
  }
  if (open > 3) return null;
  try {
    return new RegExp(`^${pattern}$`, "iu");
  } catch {
    return null;
  }
}

/** How many of the active plugins a path or regex matches, or null when ModWrench can't tell. */
function matcher(arg: Arg | undefined, alwaysRegex: boolean): ((facts: LootFacts) => number) | null {
  if (!arg?.quoted || arg.text.includes("/")) return null;
  if (alwaysRegex || REGEX_PATH.test(arg.text)) {
    const regex = safeRegex(arg.text);
    if (!regex) return null;
    return (facts) => facts.active.filter((p) => regex.test(p)).length;
  }
  const name = arg.text.toLowerCase();
  return (facts) => facts.active.filter((p) => p.toLowerCase() === name).length;
}

/** One function call. */
function call(name: string, args: Arg[]): Condition {
  if (args.length !== 1) return UNKNOWN;
  const one = name === "active" || name === "file";
  const many = name === "many_active" || name === "many";
  if (!one && !many) return UNKNOWN;
  const count = matcher(args[0], many);
  if (!count) return UNKNOWN;
  const least = one ? 1 : 2;
  // Only the active plugins are known, so file() and many() can't be false.
  const canBeFalse = name === "active" || name === "many_active";
  return (facts) => (count(facts) >= least ? true : canBeFalse && facts.allActive ? false : "unknown");
}

const not = (a: Condition): Condition => (facts) => {
  const v = a(facts);
  return v === "unknown" ? v : !v;
};

const and = (parts: Condition[]): Condition => (facts) => {
  let result: Truth = true;
  for (const part of parts) {
    const v = part(facts);
    if (v === false) return false;
    if (v === "unknown") result = v;
  }
  return result;
};

const or = (parts: Condition[]): Condition => (facts) => {
  let result: Truth = false;
  for (const part of parts) {
    const v = part(facts);
    if (v === true) return true;
    if (v === "unknown") result = v;
  }
  return result;
};

function fail(): never {
  throw new Error("unreadable condition");
}

/** LOOT's condition, ready to answer. One that can't be read is unknown whatever the facts. */
export function parseCondition(text: string): Condition {
  if (text.length > MAX_LENGTH) return UNKNOWN;
  let pos = 0;
  const space = (): void => {
    while (pos < text.length && /\s/.test(text[pos]!)) pos++;
  };
  const word = (): string => {
    space();
    const m = /^[A-Za-z_][A-Za-z0-9_]*/.exec(text.slice(pos));
    return m ? m[0] : "";
  };
  const expect = (ch: string): void => {
    space();
    if (text[pos] !== ch) fail();
    pos++;
  };
  const argument = (): Arg => {
    space();
    if (text[pos] === '"') {
      const end = text.indexOf('"', pos + 1);
      if (end < 0) fail();
      const arg = { quoted: true, text: text.slice(pos + 1, end) };
      pos = end + 1;
      return arg;
    }
    const m = /^[^\s,()"]+/.exec(text.slice(pos));
    if (!m) fail();
    pos += m[0].length;
    return { quoted: false, text: m[0] };
  };
  const condition = (depth: number): Condition => {
    if (depth > MAX_DEPTH) fail();
    if (word() === "not") {
      pos += 3;
      return not(condition(depth + 1));
    }
    space();
    if (text[pos] === "(") {
      pos++;
      const inner = expression(depth + 1);
      expect(")");
      return inner;
    }
    const name = word();
    if (!name || name === "and" || name === "or") fail();
    pos += name.length;
    expect("(");
    const args = [argument()];
    for (space(); text[pos] === ","; space()) {
      pos++;
      args.push(argument());
    }
    expect(")");
    return call(name, args);
  };
  const compound = (depth: number): Condition => {
    const parts = [condition(depth)];
    while (word() === "and") {
      pos += 3;
      parts.push(condition(depth));
    }
    return parts.length === 1 ? parts[0]! : and(parts);
  };
  const expression = (depth: number): Condition => {
    const parts = [compound(depth)];
    while (word() === "or") {
      pos += 2;
      parts.push(compound(depth));
    }
    return parts.length === 1 ? parts[0]! : or(parts);
  };
  try {
    const result = expression(0);
    space();
    return pos === text.length ? result : UNKNOWN;
  } catch {
    return UNKNOWN;
  }
}

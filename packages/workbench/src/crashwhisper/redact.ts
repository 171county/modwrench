import { isIPv6 } from "node:net";
import { homedir, hostname, userInfo } from "node:os";
import { basename } from "node:path";
import { performance } from "node:perf_hooks";

// ─── Taking the person out of a crash log ────────────────────────────────────
// A crash log is written for helpers, and it was written by a program that knows
// nothing about who is posting it. Paths carry the Windows account name
// (C:\Users\Jane Doe\...), BepInEx and .NET stack traces carry the folder a mod
// was compiled in, and game logs can carry a computer name, an address a mod
// connected to, or a key a mod printed. Crash Whisperer builds a "Help Packet"
// the person pastes into a forum, an issue or a chat, so everything that goes
// into one passes through here first.
//
// What this does and does not promise, in the same words TRUST.md uses:
//   - It removes what it recognises: this machine's own account and computer
//     name, and the names the log's labelled lines give, when they stand alone
//     as a word, folder paths (the folders go, the file name stays), network
//     addresses, email addresses, keys and passwords, account IDs. It reports
//     how many of each, never what they were.
//   - It cannot know that a mod called "Jane's Followers.esp" is personal. Names
//     are kept as written; the packet is shown in full so the person reads it
//     before posting.
//   - "Recognises" is the honest word. Every rule below matches a shape. A secret
//     printed bare, with no label and no familiar shape, can get through, and so
//     can a path written in a way no rule here expects. TRUST.md lists what is known.
//
// Pure: text in, text and a report out. The names it learns about this machine can
// be passed in, so every rule here is testable without a machine.

export type RedactionKind = "user" | "machine" | "path" | "network" | "contact" | "secret" | "id";

export const REDACTION_KINDS: readonly RedactionKind[] = [
  "user",
  "machine",
  "path",
  "network",
  "contact",
  "secret",
  "id",
];

/**
 * What each kind is replaced with. Plain capital words with a hyphen: nothing a
 * forum, GitHub or Discord would treat as markup (no angle brackets, underscores
 * or square brackets), and obvious to a helper reading the post.
 */
export const PLACEHOLDER: Record<RedactionKind, string> = {
  user: "REDACTED-USER",
  machine: "REDACTED-MACHINE",
  path: "REDACTED-PATH",
  network: "REDACTED-NETWORK",
  contact: "REDACTED-EMAIL",
  secret: "REDACTED-SECRET",
  id: "REDACTED-ID",
};

export type RedactionReport = {
  /** How many things were replaced. */
  total: number;
  /** How many of each kind. These are counts only: what was removed is never recorded. */
  byKind: Record<RedactionKind, number>;
  /**
   * Places where this machine's account or computer name still appears inside a
   * longer word (a mod called "JaneArmor.esp", say). They are left alone, because
   * the rest of the word isn't ours to rewrite, but the person should look.
   */
  leftover: number;
  /** Lines longer than the limit, cut short before they were checked. */
  cutLines: number;
  /**
   * Lines at the end that were never cleaned, and so are not in the result at all, because
   * the time allowed ran out. Dropping is the safe way to stop: nothing uncleaned is returned.
   */
  skippedLines: number;
};

export type RedactOptions = {
  /** Account names to remove wherever they appear. Default: the one running this process. */
  users?: string[];
  /** Computer names to remove wherever they appear. Default: this machine's. */
  machines?: string[];
  /** Skip learning this machine's own names (for tests, and for text from another machine). */
  ownNames?: boolean;
  /** The most time to spend, in milliseconds (default 20,000). Lines not reached are dropped, never returned as they were. */
  budgetMs?: number;
  /** For passes that share one time allowance: the moment (performance.now()) to stop by, in place of budgetMs. */
  deadline?: number;
  /** For tests: run every rule on every line, to prove the quick checks that skip rules change nothing. */
  unsafeNoShortcuts?: boolean;
};

const MAX_LINE = 6000;
/** When a long line is cut, back up to a space this close to the cut, so no half-address or half-name is left at its end. */
const CUT_BACKOFF = 300;
/** What an email, network address or name is written with: a line is not cut between two of these. */
const ADDRESS_CHAR = /[\p{L}\p{N}._%+@:-]/u;
const DEFAULT_BUDGET_MS = 20_000;
/** How often (in lines) the clock is looked at. */
const CLOCK_EVERY = 64;
/** How many names labelled lines may add to those looked for in the whole log, and how long each may be. */
const MAX_LEARNED = 16;
const MAX_LEARNED_LENGTH = 64;
const BT = "\u0060";

// Names that identify nobody, because every machine of that kind has them. Replacing
// them everywhere would only damage the log ("Steam Deck" would read "Steam REDACTED-USER").
// Paths containing them are still handled by the path rules.
const COMMON_NAMES = new Set([
  "user", "users", "admin", "administrator", "owner", "default", "guest", "root", "steamuser", "deck",
  "pc", "desktop", "laptop", "home", "gamer", "player", "public", "localhost", "system", "windows",
  "game", "games", "mods", "steam", "skyrim", "fallout", "data", "temp", "test", "main", "me", "my",
  // The factory host name of a Steam Deck, and defaults a fresh install of a common system ships with.
  "steamdeck", "workgroup", "azuread", "microsoftaccount", "builtin", "nobody", "ubuntu", "debian",
  "fedora", "archlinux", "manjaro", "raspberrypi", "wsl", "vagrant", "runner", "docker",
]);

/** What a labelled field says when it has no name to give. */
const NOT_A_NAME = new Set([
  "default", "unknown", "none", "null", "nil", "n/a", "na", "-", "—", "unset", "unspecified", "empty",
  "anonymous", "system", "localhost", "not available", "(not available)", "(none)", "(unknown)",
  "(null)", "(unset)", "<none>", "<null>", "<unknown>", "[none]", "[unknown]",
]);

/** The game's own files. A person whose account is called "Dragonborn" has not made "Dragonborn.esm" personal. */
const OFFICIAL_FILE =
  /\b(?:Skyrim|Update|Dawnguard|HearthFires|Dragonborn|Fallout4|DLCRobot|DLCCoast|DLCNukaWorld|DLCworkshop0[1-3]|Starfield|Constellation|OldMars)\.(?:esm|esp|esl|bsa|ba2)\b/gi;
const OFFICIAL_BASE =
  /^(?:skyrim|update|dawnguard|hearthfires|dragonborn|fallout4|dlcrobot|dlccoast|dlcnukaworld|dlcworkshop0[1-3]|starfield|constellation|oldmars)$/;

// ─── Secrets ─────────────────────────────────────────────────────────────────
// Written as patterns, so none of this file is a credential. Test files build their
// examples at run time so no source line looks like a key.

const PLACEHOLDER_NAMES = "USER|MACHINE|PATH|NETWORK|EMAIL|SECRET|ID";
/** Exactly one of our own placeholders, and nothing glued to it. Anything else after "REDACTED-" is just text. */
const EXACT_PLACEHOLDER = new RegExp(`^REDACTED-(?:${PLACEHOLDER_NAMES})$`);
const STARTS_WITH_PLACEHOLDER = new RegExp(`^REDACTED-(?:${PLACEHOLDER_NAMES})(?![A-Za-z0-9_-])`);

const PEM_ONE_LINE = /-----BEGIN [A-Z ]*PRIVATE KEY(?: BLOCK)?-----.*?-----END [A-Z ]*PRIVATE KEY(?: BLOCK)?-----/g;
const PEM_BEGIN = /-----BEGIN [A-Z ]*PRIVATE KEY(?: BLOCK)?-----/;
const PEM_END = /-----END [A-Z ]*PRIVATE KEY(?: BLOCK)?-----/;
/** A line of a key's body, with or without a log prefix ("[Info   :Mod] MIIE…"): base64, or one of the header lines of an old-style key. A blank line counts too. */
const PEM_BODY = /^(?:(?:[^\r\n]{0,80}?[ \]])?(?:[A-Za-z0-9+/=]{16,}|(?:Proc-Type|DEK-Info|Comment|Version|Charset)\b.*|\s*)|\s*)$/;
/** How many lines after a BEGIN line are still taken to be a key. A 4096-bit key is about 55. */
const PEM_MAX_LINES = 400;
/** The last line of a key's body is short, and so is an armored key's checksum ("=Ab1C"): once the body has begun they belong to it. */
const PEM_TAIL = /^(?:[^\r\n]{0,80}?[ \]])?=?[A-Za-z0-9+/=]{1,15}$/;
const PEM_LONG = /[A-Za-z0-9+/=]{16,}/;

const SECRET_SHAPES: RegExp[] = [
  /\bgh[pousr]_[A-Za-z0-9_]{20,}\b/g,
  /\bgithub_pat_[A-Za-z0-9_]{20,}\b/g,
  /\bglpat-[A-Za-z0-9_-]{20,}/g,
  /\bnpm_[A-Za-z0-9]{30,}\b/g,
  /\bsk-[A-Za-z0-9_-]{20,}\b/g,
  /\b[sr]k_(?:live|test)_[A-Za-z0-9]{16,}\b/g,
  /\bwhsec_[A-Za-z0-9]{16,}\b/g,
  /\bxox[abprs]-[A-Za-z0-9-]{10,}\b/g,
  /https?:\/\/hooks\.slack\.com\/services\/[A-Za-z0-9/_-]{20,}/gi,
  /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g,
  /\bAIza[0-9A-Za-z_-]{35}\b/g,
  // A Telegram bot token: a numeric bot id, a colon and about 35 characters.
  /(?<![\w:])\d{8,10}:[A-Za-z0-9_-]{34,40}\b/g,
  // A JWT: three base64url runs, the first starting "eyJ" (a JSON object). Anchoring on that keeps long .NET names out.
  /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g,
  // A Discord bot token: user id, six-character timestamp, signature, in those lengths.
  /\b[MNO][A-Za-z0-9_-]{23,27}\.[A-Za-z0-9_-]{6}\.[A-Za-z0-9_-]{27,38}\b/g,
  // "Bearer" and a token. A short one has to carry a digit, so that "Ring Bearer Chronicles" stays a mod name.
  /\bBearer\s+(?:(?=[A-Za-z0-9._~+/=-]*\d)[A-Za-z0-9._~+/=-]{8,}|[A-Za-z0-9._~+/=-]{16,})/gi,
  // A Discord webhook, with or without the API version in it (v6 and later have one).
  /https?:\/\/(?:ptb\.|canary\.)?discord(?:app)?\.com\/api(?:\/v\d+)?\/webhooks\/\d+\/[A-Za-z0-9_-]+/gi,
];

// What a name ends in when it says its value is secret. Only the END of the name is matched, whatever it
// begins with: STEAM_TOKEN, db_password, NexusApiKey and sessionToken all say what they hold.
const KEYISH = String.raw`(?:access|secret|private|signing|encryption|master|licen[cs]e|session|bot|app|account|client|consumer|shared|auth|service|api|nexus|modio|steam|discord|github)[_ -]?key`;
const SECRET_WORDS = String.raw`token|secret|apikey|${KEYISH}|credentials?|bearer`;
// A connection string or a webhook address carries its own secret, whatever the rest of the value is: take it to the end of the word.
const PASS_WORDS = String.raw`passw(?:or)?d|passwort|passphrase|passcode|pwd|pw|connection[_ -]?string|webhook[_ -]?url|dsn`;

/**
 * "name = value" for names that say they hold a secret. A quoted value is taken whole, spaces and all, up to its
 * closing quote (or the end of the line when the quote is never closed): a passphrase is words. A JSON string that
 * was itself put inside a string (\"key\":\"value\") has escaped quotes and is read the same way. An unquoted
 * value runs to whitespace or a quote, because where it ends isn't something a log says.
 */
function assignment(words: string, unquoted: string): RegExp {
  return new RegExp(
    String.raw`((?:${words})(?:\\?["'])?[ \t]*(?:=>|->|:=|[:=])[ \t]*)(?:(\\?["'])((?:(?!\2)(?:\\.|[^\r\n])){1,4000})|(${unquoted}))`,
    "gi"
  );
}
const SECRET_ASSIGNMENT = assignment(SECRET_WORDS, `[^\\s"'${BT},;&]+`);
// A password may hold any punctuation, so its unquoted value ends only at whitespace, a quote or "&".
const PASSWORD_ASSIGNMENT = assignment(PASS_WORDS, `[^\\s"'${BT}&]+`);
// Headers carry a scheme and a value (Authorization: ApiKey x) or several (Cookie: a=1; b=2): take the line.
const HEADER_LINE =
  /\b((?:(?:proxy-)?authorization|set-cookie|cookie)(?:\\?["'])?[ \t]*[:=][ \t]*)(?:(\\?["'])((?:(?!\2)(?:\\.|[^\r\n])){1,4000})|([^\r\n]+))/gi;
const XML_SECRET = new RegExp(
  String.raw`(<((?:[A-Za-z_][\w.:-]*)?(?:${SECRET_WORDS}|${PASS_WORDS}))(?:\s[^<>\r\n]*)?>)([^<\r\n]{1,2000})(<\/\2\s*>)`,
  "gi"
);
// An attribute pair in a config file: <add key="ApiKey" value="..." />, <setting name="Password" value="..." />.
const XML_ATTR_SECRET = new RegExp(
  String.raw`(<[A-Za-z_][\w.:-]*\s[^<>\r\n]{0,80}?\b(?:key|name|id)=(["'])[^"'<>\r\n]{0,60}?(?:${SECRET_WORDS}|${PASS_WORDS})\2[^<>\r\n]{0,80}?\bvalue=)(["'])([^"'<>\r\n]{1,2000})\3`,
  "gi"
);
// A command line: --password hunter2, -Password "hunter 2". The flag's name says what the next word is.
const CLI_SECRET = new RegExp(
  String.raw`((?<![\w-])--?(?:password|passwd|pwd|passphrase|pass|token|secret|api[_-]?key|apikey|access[_-]?token|auth[_-]?token|client[_-]?secret)[ \t]+)(?!-)("[^"\r\n]{1,300}"|'[^'\r\n]{1,300}'|[^\s"'${BT},;&]+)`,
  "gi"
);
// "set password hunter2", "SetPassword("hunter2")": said outright, or handed to a function of that name.
const SET_SECRET = new RegExp(
  String.raw`(\bset[ \t]+(?:the[ \t]+)?(?:password|passwd|passphrase|pwd|token|secret|api[_ -]?key)[ \t]+)(?!REDACTED-)([^\s"'${BT},;&]+)`,
  "gi"
);
const CALL_SECRET = new RegExp(
  String.raw`((?:${SECRET_WORDS}|${PASS_WORDS})\([ \t]*)(["'])((?:(?!\2)[^\r\n]){1,300})`,
  "gi"
);
// "the password is hunter2": a value that is not a plain word ("the password is required" is a message, not a secret).
const PASSWORD_IS = /\b((?:password|passwd|passphrase|pwd)[ \t]+(?:is|was)[ \t]*[:=]?[ \t]+)(?!REDACTED-)([^\s"'`,;&]*[^A-Za-z\s"'`,;&][^\s"'`,;&]*)/gi;
// A key in a web address: ?key=..., &token=..., ;sid=...
const QUERY_SECRET =
  /([?&;])((?:key|api[_-]?key|apikey|token|access[_-]?token|id[_-]?token|refresh[_-]?token|auth[_-]?token|auth|code|session|session[_-]?id|sessionid|sid|signature|sig|x-amz-signature|x-amz-credential|x-amz-security-token|password|passwd|pass|pwd|secret|client[_-]?secret|jwt|bearer|ticket|otp)=)([^&\s#"'<>]{1,2000})/gi;
// user:password@ inside a URL.
const URL_CREDENTIALS = /(?<![a-z0-9+.-])([a-z][a-z0-9+.-]*:\/\/)[^\s/@:]+:[^\s/@]+@/gi;
// "key 0123abcd..." (a mod.io or Steam Web API key is 32 hex characters), "secret wJalr…": the word says what the value is.
const KEY_THEN_HEX =
  /\b((?:api[_ -]?key|key|token|secret|password|account(?:[_ -]?id)?|epic|user[_ -]?id|machine[_ -]?id)[ \t]+(?:is[ \t]+|=[ \t]*)?)([0-9A-Fa-f]{32,128})(?![\w])/gi;
const KEY_THEN_TOKEN =
  /\b((?:api[_ -]?key|apikey|access[_ -]?token|auth[_ -]?token|secret[_ -]?key|private[_ -]?key|key|token|secret|password)[ \t]+(?:is[ \t]+|=[ \t]*)?)(?=[A-Za-z0-9_+/=-]*\d)([A-Za-z0-9_+/=-]{16,})(?![\w])/gi;
// A long mixed-case token with no spaces: how an API key looks when nothing labels it. Pure hex (hashes) and plain words
// are left alone, and so is a long identifier made of words (an IL2CPP method name is 100 characters of Words_Joined_Like_This).
const LONG_TOKEN = /(?<![A-Za-z0-9_+/-])[A-Za-z0-9_+/-]{80,}={0,2}(?![A-Za-z0-9_+/=-])/g;

/** Is this value one that carries no secret: nothing, a mask, a placeholder of ours, a word like "null", a small number? */
function emptyValue(value: string, family: "secret" | "password" | "query"): boolean {
  const v = value.trim();
  if (v === "") return true;
  if (EXACT_PLACEHOLDER.test(v)) return true;
  if (/^(?:null|none|nil|undefined|empty|true|false|unset|n\/a|na|redacted|hidden|masked|\(null\)|\(none\)|<null>|<none>|<empty>|\[hidden\]|\[redacted\])$/i.test(v)) return true;
  if (/^[*\u2022#._-]{3,}$/.test(v)) return true;
  if (family !== "password") {
    // A .NET metadata token (0x06000123) or a small number: an id, not a credential.
    if (/^0x[0-9A-Fa-f]{1,16}$/.test(v)) return true;
    if (/^\d{1,5}$/.test(v)) return true;
  }
  if (family === "query" && /^\d{1,4}$/.test(v)) return true;
  return false;
}

/** A name made of Words_Joined_Like_This is a code identifier, not a key: most of its pieces are plain words. */
function looksLikeIdentifier(token: string): boolean {
  const parts = token.split(/[_-]/).filter((p) => p !== "");
  if (parts.length < 5) return false;
  let wordy = 0;
  for (const part of parts) {
    if (/^(?:[A-Za-z]{1,24}\d{0,3}[A-Za-z]{0,24}\d{0,3}|\d{1,3})$/.test(part)) wordy++;
  }
  return wordy / parts.length >= 0.7;
}

// ─── Contact and identity ────────────────────────────────────────────────────

const OCTET = String.raw`(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)`;
const IPV4_TEXT = String.raw`${OCTET}(?:\.${OCTET}){3}`;
const EMAIL_TLD = String.raw`(?:\p{L}{2,}|xn--[A-Za-z0-9-]{2,})`;
const EMAIL_DOMAIN = String.raw`(?:\[${IPV4_TEXT}\]|[\p{L}\p{N}-]+(?:\.[\p{L}\p{N}-]+)*\.${EMAIL_TLD})`;
// Not one of our own placeholders followed by a host: "REDACTED-SECRET@example.com" is what is left of a URL's login.
const EMAIL = new RegExp(
  String.raw`(?<![\p{L}\p{N}._%+-])(?!REDACTED-(?:${PLACEHOLDER_NAMES})@)[\p{L}\p{N}._%+-]+@${EMAIL_DOMAIN}`,
  "gu"
);
const EMAIL_ENCODED = new RegExp(
  String.raw`(?<![\p{L}\p{N}._%+-])[\p{L}\p{N}._+-]+%40[\p{L}\p{N}-]+(?:\.[\p{L}\p{N}-]+)*\.${EMAIL_TLD}`,
  "giu"
);
// jane[at]example.com, jane (at) example (dot) com, jane at example dot com
const EMAIL_SPELLED = new RegExp(
  String.raw`(?<![\p{L}\p{N}._%+-])[\p{L}\p{N}._+-]{2,}[ \t]*(?:\[at\]|\(at\)|\{at\})[ \t]*[\p{L}\p{N}-]+(?:[ \t]*(?:\[dot\]|\(dot\)|\{dot\}|\.)[ \t]*[\p{L}\p{N}-]+)+` +
    String.raw`|(?<![\p{L}\p{N}._%+-])[\p{L}\p{N}._+-]{2,}[ \t]+at[ \t]+[\p{L}\p{N}-]{2,}[ \t]+dot[ \t]+\p{L}{2,}(?![\p{L}\p{N}])`,
  "giu"
);
// git@host.example:owner/repo.git: the host, the owner and the repository are all someone's.
const SCP_ADDRESS = /(?<![\p{L}\p{N}._%+-])[\p{L}\p{N}._-]+@[\p{L}\p{N}-]+(?:\.[\p{L}\p{N}-]+)+:(?!\d)[\p{L}\p{N}_./~-]+/gu;
/** A file name's ending is not a top-level domain: "icon@2x.png" and "Preloader@ver2.dll" are not addresses. */
const FILE_ENDINGS = new Set([
  "png", "jpg", "jpeg", "gif", "bmp", "tga", "dds", "nif", "hkx", "dll", "exe", "esp", "esm", "esl", "pex", "psc",
  "ini", "cfg", "toml", "json", "yaml", "yml", "xml", "txt", "log", "pdb", "lib", "obj", "dat", "bin", "bsa", "ba2",
  "wav", "ogg", "xwm", "fuz", "mp3", "mp4", "bik", "dylib", "pyc", "cpp", "hpp", "swf", "svg", "css", "html", "htm",
]);
/** The ending right after the "@" (or "(at)") and one name, where the file name ends. "jane@example.com.esl" has a domain before its ending, so it has none. */
const AT_FILE = /(?:@|\[at\]|\(at\)|\{at\})[ \t]*[\p{L}\p{N}-]+\.([A-Za-z0-9]{1,5})(?![\p{L}\p{N}-]|\.[\p{L}\p{N}])/iu;

const STEAM_ID64 = /(?<!\d)7656119\d{10}(?!\d)/g;
const STEAM3_ID = /\[?\bU:1:\d{3,12}\]?/g;
const STEAM2_ID = /\bSTEAM_[0-5]:[01]:\d{3,12}\b/g;
const WINDOWS_SID = /\bS-1-(?:5-21|12-1)(?:-\d+){3,5}\b/g;
const DISCORD_MENTION = /<@!?\d{15,20}>/g;
// "account id: 52079950", "MachineGuid = {…}": the label says what the value is. The value must carry a digit,
// so "Client ID: SkyrimSE" stays. After a label and only a space it must be eight characters or more: a game's own
// Steam number is printed that way too ("Using environment steamid 892970").
const ID_LABEL =
  /\b((?:(?:account|user|player|steam|discord|xbox|epic|machine|device|hardware|install(?:ation)?)[_ -]?(?:id|uid|guid|uuid)|uuid|xuid|steamid(?:64)?|accountid|userid|playerid|discordid|device[_ -]?unique[_ -]?identifier|serial(?:[_ -]?number)?|product[_ -]?key|volume[_ -]?serial(?:[_ -]?number)?|(?:cpu|processor)[_ -]?id|bios[_ -]?serial)(?:["'])?(?:[ \t]*[:=][ \t]*["']?|[ \t]+(?=[A-Za-z0-9{}_-]{8})))([A-Za-z0-9{}_-]{6,64})/gi;
// A long id after a word that says whose it is: "user 123456789012345678 joined".
const WORD_THEN_SNOWFLAKE = /\b((?:user|member|player|account|discord|steam|owner|author|sender|recipient|guild)(?:[_ -]?id)?[ \t:=#]+)(\d{17,19})(?!\d)/gi;
// ─── Network ─────────────────────────────────────────────────────────────────

// A dotted number, with the port after it when it has one ("203.0.113.5:2456" is replaced whole: a port is not an address).
const QUAD = /(?<![\w.-])\d{1,3}(?:\.\d{1,3}){3}(?::\d{2,5}(?!\d))?(?![\w-]|\.\d)/g;
// Words that say the number after them is a machine. ("from" and "to" are not here: they are as likely to say "from 1.5.97.0 to 1.6.1170.0".)
const ADDRESS_WORD =
  /\b(?:ip|ipv4|address|addr|host|server|endpoint|remote|peer|client|source|src|dest|dst|gateway|gw|dns|proxy|connect(?:ing|ed)?(?:[ \t]+to)?)[ \t:=[\]"'(]{0,6}$/i;
const VERSION_WORD = /\b(?:v|ver|version|build|release|rev|revision)[ \t.:=]*$/i;
const VERSION_AFTER = /^[ \t]+(?:build|version|release)\b/i;

function isPrivateV4(a: number, b: number): boolean {
  return a === 10 || (a === 192 && b === 168) || (a === 172 && b >= 16 && b <= 31) || (a === 169 && b === 254) || (a === 100 && b >= 64 && b <= 127);
}

/**
 * Is this dotted number somebody's address? Version numbers look the same, so it depends on what is around it: an
 * address has a port after it or a word like "from" or "server" before it, or it is in a private range (the
 * player's own network); a "version" word before it says it isn't one. With no hint at all it counts as an address
 * when it looks like one a person could have (not a first number under 11, which is where versions live, and not
 * one ending in .0, which is a network and never a machine).
 */
function isAddress(match: string, offset: number, whole: string): boolean {
  const port = /:\d{2,5}$/.test(match);
  const parts = (port ? match.slice(0, match.lastIndexOf(":")) : match).split(".").map(Number);
  if (parts.some((p) => p > 255)) return false;
  const [a = 0, b = 0, c = 0, d = 0] = parts;
  if (a === 127 || a === 0 || (a === 255 && b === 255 && c === 255 && d === 255)) return false;
  if (port || isPrivateV4(a, b) || /^\/\d{1,2}(?!\d)/.test(whole.slice(offset + match.length, offset + match.length + 3))) return true;
  const before = whole.slice(Math.max(0, offset - 30), offset);
  if (VERSION_WORD.test(before) || VERSION_AFTER.test(whole.slice(offset + match.length, offset + match.length + 12))) return false;
  if (ADDRESS_WORD.test(before)) return true;
  return a >= 11 && d !== 0;
}

// An IPv6 address in any of its spellings: candidate runs of hex digits, colons and dots, checked by the real parser.
const IPV6_CANDIDATE = /(?<![\w:.%-])[0-9A-Fa-f:][0-9A-Fa-f:.]{1,44}(?:%[A-Za-z0-9._-]{1,16})?/g;
function isLoopbackV6(text: string): boolean {
  return /^(?:0{1,4}:){7}0{0,3}1$/.test(text) || text === "::1" || text === "::" || /^::ffff:127\./i.test(text);
}
/**
 * Where an address ends inside a candidate run, or null when it holds none. A sentence's full stop or colon after the
 * address doesn't count as part of it; a zone ("%eth0") does.
 */
function v6End(candidate: string): number | null {
  const zone = candidate.indexOf("%");
  const core = zone >= 0 ? candidate.slice(0, zone) : candidate;
  const attempts: Array<[string, number]> = [
    [core, candidate.length],
    [core.replace(/\.+$/, ""), -1],
    [core.replace(/[.:]+$/, ""), -1],
  ];
  for (const [attempt, end] of attempts) {
    if (attempt.length < 3 || (attempt.match(/:/g) ?? []).length < 2 || !/\d/.test(attempt)) continue;
    if (isIPv6(attempt) && !isLoopbackV6(attempt)) return end === -1 ? attempt.length : end;
  }
  return null;
}

const MAC = /(?<![\w:-])(?:[0-9A-Fa-f]{2}[:-]){5}[0-9A-Fa-f]{2}(?![\w:-])/g;
// Names that only exist on a private network, and the dynamic-DNS services where a person's own server gets a name of its own.
const LAN_HOST = /(?<![\w.-])(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?\.)+(?:local|lan|internal|localdomain|home\.arpa)(?![\w-]|\.\w)/g;
const DYNAMIC_HOST =
  /(?<![\w.-])(?:[A-Za-z0-9-]+\.)+(?:duckdns\.org|no-ip\.(?:com|org|biz|info)|ddns\.net|dyndns\.(?:org|biz|info|tv)|hopto\.org|zapto\.org|myftp\.(?:org|biz)|serveo\.net|ngrok(?:-free)?\.(?:io|app|dev)|trycloudflare\.com|playit\.gg|ply\.gg|freeddns\.org|gotdns\.com|servegame\.com|sytes\.net|webhop\.me|bounceme\.net|ts\.net)(?![\w-])/gi;

// ─── Labelled names ──────────────────────────────────────────────────────────
// "Computer Name: JANES-PC", "USERNAME=jane": the label says what the value is,
// whatever the value looks like.

const MACHINE_LABEL =
  /\b((?:computer|machine|host|pc)[ _-]?name|hostname|computername)(\s*[:=]\s*)(?!REDACTED-)[^\r\n,;|]+/gi;
const USER_LABEL =
  /\b((?:user|account|login|profile)[ _-]?name)(\s*[:=]\s*)(?!REDACTED-)[^\r\n,;|]+/gi;
const LOGGED_IN_AS = /\b(logged[ _]in[ _]as\s+)(?!REDACTED-)[^\s,;|]+/gi;
// The environment variables that hold the account name on Linux and macOS, written as they are set.
const ENV_USER = /\b(USER|LOGNAME)(=)(?!REDACTED-)[^\s,;|]+/g;
// Windows' own default computer names, at their real lengths: DESKTOP-4F9K2LQ, LAPTOP-RS7P8E2D, WIN-3KT5F2NU7QO.
const DEFAULT_MACHINE = /\b(?:DESKTOP-[A-Z0-9]{7}|LAPTOP-[A-Z0-9]{8}|WIN-[A-Z0-9]{11})\b/g;

// ─── Paths ───────────────────────────────────────────────────────────────────
// Where does a path end? Folder names hold spaces ("Program Files (x86)", "My Games"),
// so "up to the next space" cuts the wrong place and leaves the account name behind.
// Instead: folders are runs of anything but a separator or a character Windows forbids,
// each closed by a separator, and the path ends at the first file name with an
// extension. Everything before that file name goes; the file name stays, because
// "SomeMod.dll" is what a helper needs. A path with no file name at its end loses the
// rest of its line: dropping too much is the safe way to be wrong.

const FOLDER = String.raw`[^\\/:*?"<>|\r\n]+`;
// The extension must not be followed by another separator: "Some Mod 2.1\\SKSE" is a folder that happens to hold a dot.
// A domain name's ending is not an extension either: "OneDrive - contoso.com" is a folder.
const FILE_NAME = String.raw`[^\\/:*?"<>|\r\n()]+?\.(?!(?:com|net|org|edu|gov|info|biz)(?![A-Za-z0-9]))[A-Za-z0-9]{1,5}(?![A-Za-z0-9\\/])`;
const SEP = String.raw`[\\/]+`;
// A path with more folders than this is cut at the end of its line instead: bounded, so a line of many path starts can't make the search quadratic.
const MAX_FOLDERS = 40;
// A drive, with the prefixes Windows, Wine and Proton print: \\?\C:, \??\C:, \\?\unix (Wine's view of the Linux file system), \Device\HarddiskVolume3.
const WIN_PREFIX = String.raw`(?:\\\\[?.]\\|\\\?\?\\)`;
const DRIVE = String.raw`(?:${WIN_PREFIX}?[A-Za-z]:|${WIN_PREFIX}unix(?=[\\/])|\\Device\\HarddiskVolume\d+(?=[\\/]))`;
const ROOTS = String.raw`(?:home|Users|root|mnt|media|run[\\/]media|var[\\/]home|Volumes|srv|opt|storage|sdcard|cygdrive|System[\\/]Volumes[\\/]Data|private[\\/]var|Library|Applications|[A-Za-z](?=[\\/](?:Users|Documents and Settings)[\\/]))`;
// Where a rooted path may start. Not glued to a word or a dot (that is a relative path or a web address), and not in the
// middle of a run of slashes (which would make every slash of a long run a new place to start looking). "path:/home/x" is
// allowed, but "https://home/x" is not: after a colon only a single slash counts.
const ROOT_SEP = String.raw`(?:(?<![A-Za-z0-9_.~$:\\/-])[\\/]+|(?<=:)[\\/](?![\\/]))`;
// ~/Documents/x, $HOME/x, %USERPROFILE%\x, %HOMEDRIVE%%HOMEPATH%\x: where the variable points is the person's own folder.
const VAR_ROOT = String.raw`(?:~|\$HOME|\$\{HOME\}|%(?:USERPROFILE|APPDATA|LOCALAPPDATA|HOMEDRIVE%%HOMEPATH|HOMEDRIVE|HOMEPATH|TEMP|TMP|ONEDRIVE|PROGRAMDATA|ALLUSERSPROFILE|PUBLIC)%)`;
const VAR_START = String.raw`(?<![A-Za-z0-9_.~$%\\/-])`;
// A network path starts \\server\share (or \\?\UNC\server\share, or //server/share): two separators that don't follow a drive letter, another path or a word.
// A WebDAV server is written with what it is reached by after it: \\server@SSL@8443\DavWWWRoot.
const UNC_START = String.raw`(?<![A-Za-z0-9:\\/.$_-])(?:\\\\\?\\UNC\\|\\\\(?![?.]\\))[A-Za-z0-9_.$-]+(?:@[A-Za-z0-9]+)*`;
const UNC_FWD_START = String.raw`(?<![A-Za-z0-9:\\/.$_-])\/\/(?!\/)[A-Za-z0-9_.$-]+`;

const FILE_SCHEME_DRIVE = /\bfile:\/{1,3}(?:localhost\/)?(?=[A-Za-z]:)/gi;
const FILE_SCHEME = /\bfile:(?:\/\/(?:localhost)?)?(?=\/)/gi;
const SHARE_URL = /\b(?:smb|nfs|afp|cifs):\/\/[^\s"'<>]+/gi;
const UNC_PRECISE = new RegExp(String.raw`${UNC_START}(?:\\${FOLDER}){1,${MAX_FOLDERS}}\\(${FILE_NAME})`, "g");
const UNC_ANY = new RegExp(String.raw`${UNC_START}\\[^\r\n]*`, "g");
const UNC_FWD_PRECISE = new RegExp(String.raw`${UNC_FWD_START}(?:\/${FOLDER}){1,${MAX_FOLDERS}}\/(${FILE_NAME})`, "g");
const UNC_FWD_ANY = new RegExp(String.raw`${UNC_FWD_START}\/[^\r\n]*`, "g");
const DRIVE_PRECISE = new RegExp(String.raw`(?<![A-Za-z0-9])${DRIVE}${SEP}(?:${FOLDER}${SEP}){0,${MAX_FOLDERS}}(${FILE_NAME})`, "g");
const DRIVE_ANY = new RegExp(String.raw`(?<![A-Za-z0-9])${DRIVE}${SEP}[^\r\n]*`, "g");
const ROOTED_PRECISE = new RegExp(String.raw`${ROOT_SEP}${ROOTS}${SEP}(?:${FOLDER}${SEP}){0,${MAX_FOLDERS}}(${FILE_NAME})`, "g");
const ROOTED_ANY = new RegExp(String.raw`${ROOT_SEP}${ROOTS}${SEP}(?=\S)[^\r\n]*`, "g");
const VAR_PRECISE = new RegExp(String.raw`${VAR_START}${VAR_ROOT}${SEP}(?:${FOLDER}${SEP}){0,${MAX_FOLDERS}}(${FILE_NAME})`, "gi");
const VAR_ANY = new RegExp(String.raw`${VAR_START}${VAR_ROOT}${SEP}(?=\S)[^\r\n]*`, "gi");

// ─── Quick checks ────────────────────────────────────────────────────────────
// Each is a superset of what the rules it guards need to match, and only decides whether a line is worth running them on.

const SHAPE_HINT =
  /gh[pousr]_|github_pat_|glpat-|npm_|sk-|[sr]k_|whsec_|xox|hooks\.slack|AKIA|ASIA|AIza|\d:[A-Za-z0-9_-]{34}|eyJ|\.[A-Za-z0-9_-]{6}\.|bearer|webhooks/i;
const SECRET_HINT = /token|secret|key|pass|pwd|pw|credential|bearer|cookie|authorization|connection|webhook|dsn/i;
const QUERY_HINT = /[?&;][A-Za-z_-]+=/;
const HEX_HINT = /[0-9A-Fa-f]{32}/;
const AT_HINT = /\(at\)|\[at\]|\{at\}|[ \t]at[ \t]/i;
const PATH_HINT = /[\\/~]/;
const QUAD_HINT = /\d\.\d{1,3}\.\d{1,3}\.\d/;
const COLONS_HINT = /:[^:]*:/;
const MAC_HINT = /[0-9A-Fa-f]{2}[:-][0-9A-Fa-f]{2}[:-]/;
const LAN_HINT = /\.(?:local|lan|internal|localdomain|arpa)\b/;
const DYNAMIC_HINT =
  /duckdns|no-ip|ddns|dyndns|hopto|zapto|myftp|serveo|ngrok|trycloudflare|playit|ply\.gg|freeddns|gotdns|servegame|sytes|webhop|bounceme|ts\.net/i;
const STEAM_HINT = /U:1:|STEAM_|S-1-|<@/;
const ID_HINT = /id|serial|key/i;
const LONG_DIGITS_HINT = /\d{17}/;
const NAME_HINT = /name|logged|user=/i;
const DEFAULT_MACHINE_HINT = /(?:DESKTOP|LAPTOP|WIN)-/;

// ─── Reading the text in ─────────────────────────────────────────────────────

/**
 * Control characters, format characters (zero-width, direction marks, tag characters, soft hyphens), fillers, and the
 * marks that print nothing (Mongolian variation selectors, Khmer inherent vowels, the blank Braille cell): nothing a log
 * needs, and each can hide a name or a message.
 */
const INVISIBLE = /(?![\n\t])[\p{Cc}\p{Cf}\u034F\u115F\u1160\u17B4\u17B5\u180B-\u180F\u2800\u3164\uFFA0\uFE00-\uFE0F\u{E0100}-\u{E01EF}]/gu;

/** One kind of line ending, one spelling of each character, nothing invisible. */
function prepare(input: string): string {
  return input
    .replace(/\r\n?|[\u2028\u2029\u0085]/g, "\n")
    .normalize("NFC")
    .replace(INVISIBLE, "");
}

// ─── The work ────────────────────────────────────────────────────────────────

function emptyCounts(): Record<RedactionKind, number> {
  return { user: 0, machine: 0, path: 0, network: 0, contact: 0, secret: 0, id: 0 };
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const CJK_ONLY = /^[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}\p{Script=Thai}\u30FC\u00B7\u30FB\s]+$/u;

/** The names this machine goes by: the account, the profile folder, the computer and the domain it is joined to. */
function ownNames(): { users: string[]; machines: string[] } {
  const users: string[] = [];
  const machines: string[] = [];
  const add = (list: string[], value: unknown): void => {
    if (typeof value === "string" && value.trim() !== "") list.push(value.trim());
  };
  try {
    add(users, userInfo().username);
  } catch {
    // No account entry for this process (a container, say): the environment still knows.
  }
  add(users, process.env.USERNAME);
  add(users, process.env.USER);
  add(users, process.env.LOGNAME);
  try {
    add(users, basename(homedir()));
  } catch {
    // No home folder either.
  }
  try {
    const host = hostname();
    add(machines, host);
    add(machines, host.split(".")[0]);
  } catch {
    // Unreadable host name: the environment is next.
  }
  add(machines, process.env.COMPUTERNAME);
  add(machines, process.env.HOSTNAME);
  // A work or school domain names an employer. On a home machine these are the computer's own name.
  add(machines, process.env.USERDOMAIN);
  add(machines, process.env.USERDNSDOMAIN);
  add(machines, process.env.USERDNSDOMAIN?.split(".")[0]);
  add(machines, process.env.LOGONSERVER?.replace(/^\\+/, ""));
  return { users, machines };
}

/**
 * The names worth replacing everywhere: three or more characters (two, for names written in a script that has no
 * spaces between words), not a name every machine has, and not a bare number that is also part of a version.
 * Shorter names are still removed inside folder paths and after labels like "User Name:".
 */
function worthReplacing(names: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of names) {
    const name = raw.normalize("NFC").trim();
    const key = name.toLowerCase();
    const tooShort = CJK_ONLY.test(name) ? Array.from(name.replace(/\s/g, "")).length < 2 : key.length < 3;
    if (tooShort || COMMON_NAMES.has(key) || (/^\d+$/.test(key) && key.length < 8) || seen.has(key)) continue;
    seen.add(key);
    out.push(name);
  }
  // Longest first, so "Jane Doe" goes before "Jane".
  return out.sort((a, b) => b.length - a.length);
}

/**
 * Every spelling of a name worth catching: as written, with any apostrophe, percent-encoded as in a web address,
 * with a different separator between its words (Jane_Doe, jane.doe, JaneDoe), last name first, with a first initial
 * (jdoe), and as the short 8.3 name Windows makes for it (JANEDO~1). `inside` finds the same spellings inside a longer word.
 */
function nameRegex(name: string, inside = false): RegExp {
  const esc = (s: string): string => escapeRegex(s).replace(/['\u2019\u2018\u02bc]/g, "['\u2019\u2018\u02bc]");
  const sep = String.raw`(?:[\s._-]|%20|\+)*`;
  const forms = new Set<string>([esc(name)]);
  try {
    const encoded = encodeURIComponent(name);
    if (encoded !== name) forms.add(escapeRegex(encoded));
  } catch {
    // A lone surrogate can't be encoded; the plain form is still there.
  }
  const tokens = name.split(/[\s._-]+/).filter((t) => t !== "");
  // A one-letter word ("Jane Q Doe") is joined like any other, as long as the joined name is not shorter than a name worth replacing.
  if (tokens.length >= 2 && Array.from(tokens.join("")).length >= 3) {
    forms.add(tokens.map(esc).join(sep));
    if (tokens.length === 2 && tokens.every((t) => Array.from(t).length >= 2)) {
      forms.add(`${esc(tokens[1]!)}\\s*,\\s*${esc(tokens[0]!)}`);
      forms.add(`${esc(Array.from(tokens[0]!)[0]!)}\\.?${sep}${esc(tokens[1]!)}`);
    }
  }
  if (/[\s']/.test(name) || name.length > 8) {
    const short = name.replace(/[^A-Za-z0-9_!#$%&()@^{}-]/g, "").toUpperCase().slice(0, 6);
    if (short.length >= 3) forms.add(`${escapeRegex(short)}~[1-9]`);
  }
  const body = [...forms].join("|");
  if (CJK_ONLY.test(name) || inside) return new RegExp(`(?:${body})`, "giu");
  return new RegExp(String.raw`(?<![\p{L}\p{N}])(?:${body})(?![\p{L}\p{N}])`, "giu");
}

/** When cleaning has to stop: the deadline given, or the time allowance from now. */
export function cleaningDeadline(options: RedactOptions = {}): number {
  return options.deadline ?? performance.now() + (options.budgetMs ?? DEFAULT_BUDGET_MS);
}

/** Remove what identifies the person. Text in, text and a count of what was removed out. */
export function redact(input: string, options: RedactOptions = {}): { text: string; report: RedactionReport } {
  const byKind = emptyCounts();
  let cutLines = 0;
  let skippedLines = 0;
  const mark = (kind: RedactionKind): string => {
    byKind[kind]++;
    return PLACEHOLDER[kind];
  };

  const own = options.ownNames === false ? { users: [], machines: [] } : ownNames();
  // An account name of several words after "logged in as", "USER=" or "LOGNAME=" goes whole: the rules for those take one
  // word, and the rest of the name left behind would no longer be found by the whole-name pass.
  const spacedUsers = worthReplacing([...(options.users ?? []), ...own.users]).filter((name) => /\s/.test(name));
  const spacedAfterLabel =
    spacedUsers.length > 0
      ? new RegExp(String.raw`(\b(?:logged[ _]in[ _]as\s+|(?:USER|LOGNAME)=))(?:${spacedUsers.map((name) => nameRegex(name).source).join("|")})`, "giu")
      : null;
  // The names the log's own labelled lines give ("User Name: Jane Doe"), so they go wherever else the log has them too.
  // Only a few short ones, without their quotes: each is looked for in the whole log.
  const learned: Record<"user" | "machine", string[]> = { user: [], machine: [] };
  const learn = (kind: "user" | "machine", value: string): void => {
    const name = value.replace(/^["'`]+|["'`]+$/g, "");
    if (name.length > MAX_LEARNED_LENGTH || name.includes("redacted-") || learned[kind].includes(name)) return;
    if (learned.user.length + learned.machine.length < MAX_LEARNED) learned[kind].push(name);
  };

  const redactPath = (matched: string, file: string | undefined): string => {
    const sep = matched.includes("\\") ? "\\" : "/";
    return file === undefined ? mark("path") : `${mark("path")}${sep}${file}`;
  };
  // "C:\Users\bob.smith" ends in an account's folder, which only looks like a file name.
  const redactFilePath = (matched: string, file: string): string =>
    /(?:^|[\\/])(?:Users|home)[\\/]+$/i.test(matched.slice(0, matched.length - file.length))
      ? redactPath(matched, undefined)
      : redactPath(matched, file);

  /** Replace a value that is a secret with the placeholder, unless it carries nothing. */
  const secretValue =
    (family: "secret" | "password" | "query") =>
    (match: string, prefix: string, quote: string | undefined, quoted: string | undefined, unquoted: string | undefined): string => {
      const value = quoted ?? unquoted ?? "";
      return emptyValue(value, family) ? match : `${prefix}${quote ?? ""}${mark("secret")}`;
    };

  // Most lines of a log have nothing to take out. Each group of rules below runs only on a line that holds something it
  // could match (a quick check, written to be a superset of what the rules need), so a 10 MB log is not 60 passes per line.
  // `unsafeNoShortcuts` runs every rule on every line, and a test holds the two to the same answer.
  const everything = options.unsafeNoShortcuts === true;

  const redactLine = (line: string): string => {
    // A path written with its separators percent-encoded (C:%5CUsers%5C...) is the same path.
    let out = line.includes("%") && /%(?:5C|2F|3A)/i.test(line) ? line.replace(/%5C/gi, "\\").replace(/%2F/gi, "/").replace(/%3A/gi, ":") : line;
    const maybe = (hint: RegExp): boolean => everything || hint.test(out);

    // Secrets first: a key must be gone before another rule reshapes the text around it.
    if (maybe(SHAPE_HINT)) for (const shape of SECRET_SHAPES) out = out.replace(shape, () => mark("secret"));
    if (out.includes("://")) out = out.replace(URL_CREDENTIALS, (_m, scheme: string) => `${scheme}${mark("secret")}@`);
    if (maybe(QUERY_HINT)) {
      out = out.replace(QUERY_SECRET, (m, lead: string, key: string, value: string) =>
        emptyValue(value, "query") ? m : `${lead}${key}${mark("secret")}`
      );
    }
    if (maybe(SECRET_HINT)) {
      out = out.replace(HEADER_LINE, secretValue("secret"));
      out = out.replace(XML_SECRET, (m, open: string, _name: string, value: string, close: string) =>
        emptyValue(value, "secret") ? m : `${open}${mark("secret")}${close}`
      );
      out = out.replace(XML_ATTR_SECRET, (m, lead: string, _q: string, quote: string, value: string) =>
        emptyValue(value, "secret") ? m : `${lead}${quote}${mark("secret")}${quote}`
      );
      out = out.replace(CLI_SECRET, (m, flag: string, value: string) =>
        emptyValue(value.replace(/^["']|["']$/g, ""), "secret") ? m : `${flag}${mark("secret")}`
      );
      out = out.replace(SET_SECRET, (_m, lead: string) => `${lead}${mark("secret")}`);
      out = out.replace(CALL_SECRET, (m, lead: string, quote: string, value: string) =>
        emptyValue(value, "password") ? m : `${lead}${quote}${mark("secret")}`
      );
      out = out.replace(PASSWORD_IS, (_m, lead: string) => `${lead}${mark("secret")}`);
      out = out.replace(PASSWORD_ASSIGNMENT, secretValue("password"));
      out = out.replace(SECRET_ASSIGNMENT, secretValue("secret"));
      out = out.replace(KEY_THEN_TOKEN, (_m, lead: string) => `${lead}${mark("secret")}`);
    }
    if (maybe(HEX_HINT)) out = out.replace(KEY_THEN_HEX, (_m, lead: string) => `${lead}${mark("secret")}`);
    if (everything || out.length >= 80) {
      out = out.replace(LONG_TOKEN, (token) => {
        if (!(/[A-Z]/.test(token) && /[a-z]/.test(token) && /\d/.test(token))) return token;
        // A "/" alone is a path. With a "+" or "=" it is base64.
        if (token.includes("/") && !/[+=]/.test(token)) return token;
        return looksLikeIdentifier(token) ? token : mark("secret");
      });
    }

    // Contact. A git address goes before the email rule, which would otherwise leave the owner and repository behind.
    // A file name's ending is not a top-level domain, written with "@" or, as the help posts write it, with "(at)".
    const unlessFile = (m: string): string => (FILE_ENDINGS.has(AT_FILE.exec(m)?.[1]?.toLowerCase() ?? "") ? m : mark("contact"));
    if (everything || out.includes("@")) {
      out = out.replace(SCP_ADDRESS, () => mark("network"));
      out = out.replace(EMAIL, unlessFile);
    }
    if (everything || out.includes("%40")) out = out.replace(EMAIL_ENCODED, () => mark("contact"));
    if (maybe(AT_HINT)) out = out.replace(EMAIL_SPELLED, unlessFile);

    // Paths, most specific first. A file: address is the path with its scheme taken off.
    if (maybe(PATH_HINT)) {
      out = out.replace(FILE_SCHEME_DRIVE, "").replace(FILE_SCHEME, "");
      out = out.replace(SHARE_URL, (uri) => {
        const file = /[\\/]([^\\/?#]+\.[A-Za-z0-9]{1,5})(?:[?#].*)?$/.exec(uri)?.[1];
        return redactPath(uri, file);
      });
      out = out.replace(UNC_PRECISE, (m, file: string) => redactFilePath(m, file));
      out = out.replace(UNC_ANY, (m) => redactPath(m, undefined));
      out = out.replace(UNC_FWD_PRECISE, (m, file: string) => redactFilePath(m, file));
      out = out.replace(UNC_FWD_ANY, (m) => redactPath(m, undefined));
      out = out.replace(DRIVE_PRECISE, (m, file: string) => redactFilePath(m, file));
      out = out.replace(DRIVE_ANY, (m) => redactPath(m, undefined));
      out = out.replace(ROOTED_PRECISE, (m, file: string) => redactFilePath(m, file));
      out = out.replace(ROOTED_ANY, (m) => redactPath(m, undefined));
      out = out.replace(VAR_PRECISE, (m, file: string) => redactFilePath(m, file));
      out = out.replace(VAR_ANY, (m) => redactPath(m, undefined));
    }

    // Network addresses. Loopback is not anyone's address; a bare dotted version number is not one either.
    if (maybe(QUAD_HINT)) out = out.replace(QUAD, (m, offset: number, whole: string) => (isAddress(m, offset, whole) ? mark("network") : m));
    if (maybe(COLONS_HINT)) {
      out = out.replace(IPV6_CANDIDATE, (m, offset: number, whole: string) => {
        const end = v6End(m);
        if (end === null) return m;
        // Inside a longer word ("fe80::1g") it is not an address.
        if (end === m.length && /\w/.test(whole[offset + m.length] ?? "")) return m;
        return `${mark("network")}${m.slice(end)}`;
      });
    }
    if (maybe(MAC_HINT)) out = out.replace(MAC, () => mark("network"));
    if (maybe(LAN_HINT)) out = out.replace(LAN_HOST, () => mark("network"));
    if (maybe(DYNAMIC_HINT)) out = out.replace(DYNAMIC_HOST, () => mark("network"));

    out = out.replace(STEAM_ID64, () => mark("id"));
    if (maybe(STEAM_HINT)) {
      out = out.replace(STEAM3_ID, () => mark("id"));
      out = out.replace(STEAM2_ID, () => mark("id"));
      out = out.replace(WINDOWS_SID, () => mark("id"));
      out = out.replace(DISCORD_MENTION, () => mark("id"));
    }
    if (maybe(ID_HINT)) {
      out = out.replace(ID_LABEL, (m, lead: string, value: string) =>
        (/\d/.test(value) || value.length >= 20) && !emptyValue(value, "password") ? `${lead}${mark("id")}` : m
      );
    }
    if (maybe(LONG_DIGITS_HINT)) out = out.replace(WORD_THEN_SNOWFLAKE, (_m, lead: string) => `${lead}${mark("id")}`);

    if (maybe(NAME_HINT)) {
      const named = (kind: "machine" | "user") => (m: string, label: string, sep: string): string => {
        const value = m.slice(label.length + sep.length).trim().toLowerCase();
        if (NOT_A_NAME.has(value) || COMMON_NAMES.has(value)) return m;
        learn(kind, value);
        return `${label}${sep}${mark(kind)}`;
      };
      out = out.replace(MACHINE_LABEL, named("machine"));
      out = out.replace(USER_LABEL, named("user"));
      if (spacedAfterLabel) out = out.replace(spacedAfterLabel, (_m, label: string) => `${label}${mark("user")}`);
      out = out.replace(ENV_USER, named("user"));
      out = out.replace(LOGGED_IN_AS, (m, label: string) => named("user")(m, label, ""));
    }
    if (maybe(DEFAULT_MACHINE_HINT)) out = out.replace(DEFAULT_MACHINE, () => mark("machine"));
    return out;
  };

  // The log, a line at a time. A private key spans lines, so a line that opens one starts a stretch of lines that are dropped.
  const deadline = cleaningDeadline(options);
  const lines = prepare(input).split("\n");
  const kept: string[] = [];
  let keyLinesLeft = 0;
  let keyBodySeen = false;
  // The line that ends the key, when it is within reach. Until it, a line of another kind (a second thread writing to the
  // same log) is kept and the key goes on; with no end in sight the key ends at the first line that isn't part of one.
  let keyEnd = -1;
  let ends: number[] | undefined;
  let nextEnd = 0;
  for (let i = 0; i < lines.length; i++) {
    if (i % CLOCK_EVERY === 0 && performance.now() >= deadline) {
      skippedLines = lines.length - i;
      break;
    }
    let line = lines[i]!;

    if (keyLinesLeft > 0) {
      if (PEM_END.test(line)) {
        keyLinesLeft = 0;
        continue;
      }
      if (PEM_BODY.test(line) || (keyBodySeen && PEM_TAIL.test(line))) {
        if (PEM_LONG.test(line)) keyBodySeen = true;
        keyLinesLeft--;
        continue;
      }
      if (i > keyEnd) keyLinesLeft = 0;
    }

    if (line.length > MAX_LINE) {
      const space = line.lastIndexOf(" ", MAX_LINE);
      let at = space >= MAX_LINE - CUT_BACKOFF ? space : MAX_LINE;
      // With no space near, back up past the characters an address is written with, so none is cut in half.
      while (at > 0 && ADDRESS_CHAR.test(line[at]!) && ADDRESS_CHAR.test(line[at - 1]!)) at--;
      line = `${line.slice(0, at)}…`;
      cutLines++;
    }

    if (line.includes("-----BEGIN ")) {
      line = line.replace(PEM_ONE_LINE, () => mark("secret"));
      const open = PEM_BEGIN.exec(line);
      if (open) {
        line = `${line.slice(0, open.index)}${mark("secret")}`;
        keyLinesLeft = PEM_MAX_LINES;
        keyBodySeen = false;
        ends ??= lines.flatMap((l, j) => (l.includes("-----END ") && PEM_END.test(l) ? [j] : []));
        while (nextEnd < ends.length && ends[nextEnd]! <= i) nextEnd++;
        const end = ends[nextEnd];
        keyEnd = end !== undefined && end <= i + PEM_MAX_LINES ? end : -1;
      }
    }
    kept.push(redactLine(line));
  }
  let text = kept.join("\n");
  const userNames = worthReplacing([...(options.users ?? []), ...own.users, ...learned.user]);
  const machineNames = worthReplacing([...(options.machines ?? []), ...own.machines, ...learned.machine]);

  // This machine's own names, and the ones labelled lines gave, wherever else they still appear (after the structured rules, so a path counts once).
  // The game's own files are set aside first: an account called "Dragonborn" does not make "Dragonborn.esm" personal.
  const aside: string[] = [];
  if ([...userNames, ...machineNames].some((n) => OFFICIAL_BASE.test(n.toLowerCase()))) {
    text = text.replace(OFFICIAL_FILE, (file) => `\u0001${aside.push(file) - 1}\u0002`);
  }
  for (const name of userNames) text = text.replace(nameRegex(name), () => mark("user"));
  for (const name of machineNames) text = text.replace(nameRegex(name), () => mark("machine"));

  // Whatever of those names is left, in any of its spellings, sits inside a longer word. Say so; don't rewrite someone's
  // mod name. All the names are looked for at once, so a word two of them share is counted once.
  let leftover = 0;
  const unmarked = text.replace(/REDACTED-[A-Z]+/g, " ").replace(/\u0001\d+\u0002/g, " ");
  const names = [...userNames, ...machineNames];
  if (names.length > 0) {
    leftover = (unmarked.match(new RegExp(names.map((name) => nameRegex(name, true).source).join("|"), "giu")) ?? []).length;
  }
  if (aside.length > 0) text = text.replace(/\u0001(\d+)\u0002/g, (_m, i: string) => aside[Number(i)] ?? "");

  const total = REDACTION_KINDS.reduce((sum, kind) => sum + byKind[kind], 0);
  return { text, report: { total, byKind, leftover, cutLines, skippedLines } };
}

/** Redact and keep only the text, for the many small strings that don't need a report. */
export function scrub(input: string, options: RedactOptions = {}): string {
  return redact(input, options).text;
}

const NOUN: Record<RedactionKind, [string, string]> = {
  user: ["user name", "user names"],
  machine: ["computer name", "computer names"],
  path: ["folder path", "folder paths"],
  network: ["network address", "network addresses"],
  contact: ["email address", "email addresses"],
  secret: ["key or password", "keys or passwords"],
  id: ["account ID", "account IDs"],
};

/** One plain sentence on what was removed, for the answer and the page. */
export function describeRedaction(report: Omit<RedactionReport, "skippedLines"> & { skippedLines?: number }): string {
  const parts = REDACTION_KINDS.filter((kind) => report.byKind[kind] > 0).map((kind) => {
    const n = report.byKind[kind];
    return `${n} ${NOUN[kind][n === 1 ? 0 : 1]}`;
  });
  let text =
    parts.length === 0
      ? "Nothing personal was recognised, so nothing was removed. That isn't a promise there is nothing: read it before you post it."
      : `Removed ${parts.join(", ")}. Read it before you post it: names of mods and files are kept as written.`;
  if (report.leftover > 0) {
    text += ` Your account or computer name still appears inside ${report.leftover === 1 ? "another word" : `${report.leftover} other words`} (a mod or file name, probably); check ${report.leftover === 1 ? "it" : "them"}.`;
  }
  if (report.cutLines > 0) {
    text += ` ${report.cutLines === 1 ? "One very long line was" : `${report.cutLines} very long lines were`} cut short.`;
  }
  if ((report.skippedLines ?? 0) > 0) {
    text += ` Cleaning took too long, so ${report.skippedLines === 1 ? "the last line was" : `the last ${report.skippedLines} lines were`} left out of what was read.`;
  }
  return text;
}

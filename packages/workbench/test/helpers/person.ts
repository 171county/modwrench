import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import { summarizeCrashWhisper, whisper, type CrashWhisperReport } from "../../src/crashwhisper/index.js";
import { VENUES } from "../../src/crashwhisper/types.js";
import type { RedactOptions } from "../../src/crashwhisper/redact.js";

// A made-up person and everything a crash log might carry of them, for the tests that prove none of it
// comes out the other side. The values are put together at run time: no line of any file looks like a key
// or an address to a secret scanner, and none of it is anyone's.

const HERE = dirname(fileURLToPath(import.meta.url));
export const fixture = (name: string): string => readFileSync(resolve(HERE, "..", "fixtures", name), "utf8");

export const NOW = Date.parse("2026-10-02T12:00:00Z");

// ─── The person, and what the logs might carry of them ───────────────────────

export const PERSON = {
  name: ["Jane", "Doe"].join(" "),
  account: ["jane", "doe"].join(""),
  machine: ["JANES", "RIG"].join("-"),
};
export const names: RedactOptions = { users: [PERSON.name, PERSON.account], machines: [PERSON.machine], ownNames: false };

export const GITHUB = ["gh", "p_", "A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8"].join("");
export const AWS = ["AK", "IA", "ABCDEFGHIJKLMNOP"].join("");
export const BEARER = ["abcdEFGH1234", "ijklMNOP5678"].join("");
export const PASSWORD = ["hunter", "2pass"].join("");
export const API_VALUE = ["Zx9Qw8Er7Ty6", "Ui5Op4As3Df2"].join("");
export const WEBHOOK_SECRET = ["AbCdEfGhIjKlMnOpQrSt", "UvWxYz0123456789"].join("");
export const JWT = ["eyJhbGciOiJIUzI1NiJ9", "eyJzdWIiOiJqYW5lIn0", "c2lnbmF0dXJlMTIzNDU2"].join(".");
export const NEXUS_KEY = ["Qm9x", "RGVhZGJlZWY", "T3BlbkFQSUtleQ", "WmVsZGFOZXZlckdpdmVz", "QnJpbmdzVGhlVHJpZm9yY2U", "AbC123XyZ"].join("");
export const STEAM_ID = ["7656119", "8012345678"].join("");
export const STEAM3 = ["[U:1:", "52079950]"].join("");
export const SID = ["S-1-5-21", "1234567890", "123456789", "123456789", "1001"].join("-");
export const PUBLIC_IP = ["203", "0", "113", "45"].join(".");
export const PEER_IP = ["198", "51", "100", "7"].join(".");
export const LAN_IP = ["192", "168", "1", "77"].join(".");
export const IPV6 = ["2001", "0db8", "85a3", "0000", "0000", "8a2e", "0370", "7334"].join(":");
export const MAC_ADDRESS = ["aa", "bb", "cc", "dd", "ee", "ff"].join(":");
export const EMAIL = ["jane", "doe"].join(".") + "@" + ["example", "com"].join(".");

/** Everything that must be gone. Compared case-insensitively. */
export const FORBIDDEN = [
  PERSON.name,
  PERSON.account,
  PERSON.machine,
  "SecretFolder",
  "PrivateFolder",
  "LibraryNine",
  "NAS-HOME",
  "Share-Private",
  "BackupDrive",
  "My Games",
  GITHUB,
  GITHUB.slice(0, 12),
  AWS,
  BEARER,
  PASSWORD,
  API_VALUE,
  WEBHOOK_SECRET,
  JWT.slice(0, 20),
  NEXUS_KEY.slice(0, 30),
  STEAM_ID,
  STEAM3.slice(5, 13),
  SID,
  PUBLIC_IP,
  PEER_IP,
  LAN_IP,
  IPV6.slice(10),
  MAC_ADDRESS,
  EMAIL,
  "example.com",
];

/** Lines a log of any layout might carry, put together the way each kind of thing is written. */
export function personalLines(): string[] {
  return [
    `Computer Name: ${PERSON.machine}`,
    `User Name: ${PERSON.name}`,
    `Logged in as ${PERSON.account}`,
    `Loaded config from C:\\Users\\${PERSON.name}\\Documents\\My Games\\Skyrim Special Edition\\SKSE\\Plugins\\SecretFolder\\Thing.dll`,
    `Opened /home/${PERSON.account}/.local/share/Steam/steamapps/common/PrivateFolder/Other.dll`,
    `Proton path Z:\\home\\${PERSON.account}\\games\\LibraryNine\\x.dll`,
    `Network copy \\\\NAS-HOME\\Share-Private\\Skyrim\\file.esp`,
    `Backup at D:\\BackupDrive\\${PERSON.name}'s mods\\config.json`,
    `Connecting to ${PUBLIC_IP}:27015 as peer`,
    `server ${PEER_IP}`,
    `local ${LAN_IP}`,
    `ipv6 ${IPV6}`,
    `adapter ${MAC_ADDRESS}`,
    `contact: ${EMAIL}`,
    `token = ${GITHUB}`,
    `aws ${AWS}`,
    `Authorization: Bearer ${BEARER}`,
    `api_key = "${API_VALUE}"`,
    `password: ${PASSWORD}`,
    `proxy https://${PERSON.account}:${PASSWORD}@proxy.test/path`,
    `webhook https://discord.com/api/webhooks/123456789012345678/${WEBHOOK_SECRET}`,
    `jwt ${JWT}`,
    `nexus ${NEXUS_KEY}`,
    `steam ${STEAM_ID} ${STEAM3}`,
    `sid ${SID}`,
    `crash dump written to C:\\Users\\${PERSON.name}\\AppData\\Local\\CrashDumps\\SkyrimSE.exe.6120.dmp`,
  ];
}


/** Every string value in a structure, so a check isn't fooled by the escapes JSON puts in them. */
export function valuesOf(value: unknown, into: string[] = []): string[] {
  if (typeof value === "string") into.push(value);
  else if (Array.isArray(value)) for (const v of value) valuesOf(v, into);
  else if (value && typeof value === "object") for (const v of Object.values(value)) valuesOf(v, into);
  return into;
}

/** Every string the person can be handed: the structured answer, the plain text and each packet. */
export function everythingOut(report: CrashWhisperReport): Record<string, string> {
  const out: Record<string, string> = {
    json: valuesOf(report).join("\n"),
    "json as written": JSON.stringify(report),
    text: summarizeCrashWhisper(report),
  };
  for (const venue of VENUES) {
    out[`packet:${venue}`] = report.packets[venue].text;
    out[`packet title:${venue}`] = report.packets[venue].title;
    out[`text with packet:${venue}`] = summarizeCrashWhisper(report, { packet: venue });
  }
  return out;
}

export function found(text: string): string[] {
  const lower = text.toLowerCase();
  return FORBIDDEN.filter((f) => lower.includes(f.toLowerCase()));
}

export function ok(result: ReturnType<typeof whisper>): CrashWhisperReport {
  assert.equal(result.ok, true, result.ok ? "" : `${result.error} ${result.hint ?? ""}`);
  return result as CrashWhisperReport;
}

export const options = (extra: Parameters<typeof whisper>[0] = {}) => ({
  compareRecent: 0,
  checkInstall: false,
  redactOptions: names,
  now: NOW,
  ...extra,
});


import { createInterface } from "node:readline/promises";
import {
  getRawSecret,
  setRawSecret,
  setStoredToken,
  getStoredToken,
  deleteStoredToken,
  redactSensitiveText,
} from "@modwrench/core";

const MODIO_BASE = "https://api.mod.io/v1";
const SERVICE = "modio";

async function prompt(question: string): Promise<string> {
  // Without a TTY, readline's question() never settles on EOF — the process
  // would hang forever instead of failing. Refuse up front so piping this
  // command, or launching it from an MCP client, produces a clear error.
  if (!process.stdin.isTTY) {
    process.stderr.write(
      "This command needs an interactive terminal to read your input.\n" +
        "Run it directly in a terminal — not through a pipe, and not from\n" +
        "inside your MCP client.\n"
    );
    process.exit(1);
  }
  const rl = createInterface({ input: process.stdin, output: process.stderr });
  try {
    return (await rl.question(question)).trim();
  } finally {
    rl.close();
  }
}

// ─── Subcommands ──────────────────────────────────────────────────────────────

/**
 * Store a mod.io API key in the OS credential manager.
 *
 * This is the entry point for mod.io auth: authLogin()'s email exchange is
 * *initiated* with an API key, so without this command there was no way to get
 * one into the keychain and `auth login` could never run. Read-only tools work
 * off the API key alone; `auth login` is only needed for user-scoped calls.
 */
export async function authKey(): Promise<void> {
  process.stderr.write(
    "Paste your mod.io API key.\n" +
      "Get one at https://mod.io/me/access (under 'API Access').\n\n" +
      "It is stored only in your OS credential manager — never in a file,\n" +
      "never in this repo, never sent anywhere except api.mod.io.\n\n"
  );

  const key = await prompt("mod.io API key: ");
  if (!key) {
    process.stderr.write("No key entered. Nothing stored.\n");
    process.exit(1);
  }

  // Validate before storing so a bad paste fails here rather than at first use.
  const res = await fetch(
    `${MODIO_BASE}/games?api_key=${encodeURIComponent(key)}&_limit=1`,
    { headers: { Accept: "application/json" } }
  );
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    process.stderr.write(
      `mod.io rejected that key (${res.status}): ` +
        `${redactSensitiveText(body).slice(0, 200)}\nNothing was stored.\n`
    );
    process.exit(1);
  }

  setRawSecret(SERVICE, key);

  process.stderr.write(
    "\nKey verified and stored in your OS credential manager.\n" +
      "Restart your MCP client and the mod.io tools will activate.\n" +
      "For user-scoped access, you can now also run: modwrench auth login modio\n"
  );
}

export async function authLogin(): Promise<void> {
  // mod.io's OAuth email exchange is initiated with the account's API key.
  // ModWrench never reads that key from .env — the user stores it in their OS
  // credential manager (service `modwrench-modio`) and we read it from there.
  const stored = getRawSecret(SERVICE);
  const apiKey = stored && !stored.trim().startsWith("{") ? stored.trim() : "";
  if (!apiKey) {
    process.stderr.write(
      "A mod.io API key is required to start the email exchange.\n\n" +
        "Run this first:\n\n" +
        "    modwrench auth key modio\n\n" +
        "That stores your key (https://mod.io/me/access) in your OS credential\n" +
        "manager. Then re-run auth login.\n"
    );
    process.exit(1);
  }

  const email = await prompt("mod.io account email: ");
  if (!email || !email.includes("@")) {
    process.stderr.write("Invalid email.\n");
    process.exit(1);
  }

  process.stderr.write("Requesting security code...\n");
  const reqRes = await fetch(`${MODIO_BASE}/oauth/emailrequest`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ api_key: apiKey, email }),
  });
  if (!reqRes.ok) {
    const body = await reqRes.text().catch(() => "");
    process.stderr.write(
      `mod.io rejected the email request (${reqRes.status}): ${redactSensitiveText(body).slice(0, 300)}\n`
    );
    process.exit(1);
  }

  process.stderr.write("Check your inbox for a 5-digit code from mod.io.\n");
  const code = await prompt("Enter the code: ");
  if (!/^\d{5}$/.test(code)) {
    process.stderr.write("Code must be exactly 5 digits.\n");
    process.exit(1);
  }

  const exchRes = await fetch(`${MODIO_BASE}/oauth/emailexchange`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ api_key: apiKey, security_code: code }),
  });
  if (!exchRes.ok) {
    const body = await exchRes.text().catch(() => "");
    process.stderr.write(
      `Token exchange failed (${exchRes.status}): ${redactSensitiveText(body).slice(0, 300)}\n`
    );
    process.exit(1);
  }
  const exchData = (await exchRes.json()) as {
    access_token: string;
    date_expires?: number; // unix seconds
  };

  // Confirm by fetching /me
  const meRes = await fetch(`${MODIO_BASE}/me`, {
    headers: {
      Authorization: `Bearer ${exchData.access_token}`,
      Accept: "application/json",
    },
  });
  const meData = meRes.ok
    ? ((await meRes.json()) as { username?: string; id?: number })
    : null;

  setStoredToken(SERVICE, {
    access_token: exchData.access_token,
    expires_at: exchData.date_expires ? exchData.date_expires * 1000 : null,
    saved_at: Date.now(),
  });

  if (meData?.username) {
    process.stderr.write(
      `\nSigned in as ${meData.username} (user_id ${meData.id}).\n`
    );
  } else {
    process.stderr.write("\nSigned in. (Could not fetch profile metadata.)\n");
  }
  process.stderr.write("Token stored in OS keychain.\n");
}

export async function authStatus(): Promise<void> {
  const stored = getStoredToken(SERVICE);
  if (!stored) {
    process.stderr.write("Not signed in. Run: modwrench auth login modio\n");
    process.exit(1);
  }

  const res = await fetch(`${MODIO_BASE}/me`, {
    headers: {
      Authorization: `Bearer ${stored.access_token}`,
      Accept: "application/json",
    },
  });
  if (!res.ok) {
    process.stderr.write(
      `Token rejected by mod.io (${res.status}). Run: modwrench auth login modio\n`
    );
    process.exit(1);
  }
  const data = (await res.json()) as { username: string; id: number };
  process.stderr.write(`Signed in as ${data.username} (user_id ${data.id}).\n`);
  if (stored.expires_at) {
    const remaining = stored.expires_at - Date.now();
    if (remaining > 0) {
      const days = Math.floor(remaining / (24 * 60 * 60 * 1000));
      process.stderr.write(`Token expires in ~${days} day(s).\n`);
    } else {
      process.stderr.write(
        `Token may have expired (saved ${new Date(stored.saved_at).toISOString()}).\n`
      );
    }
  }
}

export async function authLogout(): Promise<void> {
  const removed = deleteStoredToken(SERVICE);
  process.stderr.write(
    removed
      ? "Signed out. Token removed from keychain.\n"
      : "No stored token to remove.\n"
  );
}

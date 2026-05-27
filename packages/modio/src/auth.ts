import { createInterface } from "node:readline/promises";
import {
  getEnv,
  setStoredToken,
  getStoredToken,
  deleteStoredToken,
} from "@mcpwrench/core";

const MODIO_BASE = "https://api.mod.io/v1";
const SERVICE = "modio";

async function prompt(question: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stderr });
  const answer = await rl.question(question);
  rl.close();
  return answer.trim();
}

// ─── Subcommands ──────────────────────────────────────────────────────────────

export async function authLogin(): Promise<void> {
  const apiKey = getEnv("MODIO_API_KEY", "");
  if (!apiKey) {
    process.stderr.write(
      "MODIO_API_KEY required to initiate email exchange. Set it in .env first.\n"
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
      `mod.io rejected the email request (${reqRes.status}): ${body.slice(0, 300)}\n`
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
      `Token exchange failed (${exchRes.status}): ${body.slice(0, 300)}\n`
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

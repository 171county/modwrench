import { createHash, randomBytes } from "node:crypto";
import { createServer } from "node:http";
import { exec } from "node:child_process";
import { createInterface } from "node:readline/promises";
import { URL } from "node:url";
import {
  getEnv,
  setStoredToken,
  getStoredToken,
  getRawSecret,
  setRawSecret,
  deleteStoredToken,
  redactSensitiveText,
} from "@modwrench/core";

const NEXUS_AUTH_BASE = "https://users.nexusmods.com";
const NEXUS_API_BASE = "https://api.nexusmods.com/v1";
const SERVICE = "nexus";
const SCOPE = "public"; // read-only — writes require a deliberate later phase

// ─── PKCE helpers ─────────────────────────────────────────────────────────────

function base64url(buf: Buffer): string {
  return buf
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function makeVerifier(): string {
  return base64url(randomBytes(32));
}

function makeChallenge(verifier: string): string {
  return base64url(createHash("sha256").update(verifier).digest());
}

function openBrowser(url: string): void {
  // Best-effort browser launch. User can also paste the URL manually.
  const cmd =
    process.platform === "win32"
      ? `start "" "${url}"`
      : process.platform === "darwin"
        ? `open "${url}"`
        : `xdg-open "${url}"`;
  exec(cmd);
}

// ─── Local callback server ────────────────────────────────────────────────────

type CallbackResult = { code: string; redirectUri: string };

function captureCallback(
  expectedState: string,
  buildAuthUrl: (port: number) => string
): Promise<CallbackResult> {
  return new Promise((resolve, reject) => {
    const server = createServer((req, res) => {
      try {
        const reqUrl = new URL(req.url ?? "/", "http://127.0.0.1");
        if (reqUrl.pathname !== "/callback") {
          res.writeHead(404).end("not found");
          return;
        }
        const error = reqUrl.searchParams.get("error");
        if (error) {
          res
            .writeHead(200, { "Content-Type": "text/html" })
            .end(
              `<h1>Authorization failed</h1><p>${error}</p>` +
                `<p>You can close this tab.</p>`
            );
          server.close();
          reject(new Error(`Authorization denied: ${error}`));
          return;
        }
        const code = reqUrl.searchParams.get("code");
        const state = reqUrl.searchParams.get("state");
        if (!code || state !== expectedState) {
          res.writeHead(400).end("invalid response");
          server.close();
          reject(new Error("Missing code or state mismatch"));
          return;
        }
        res
          .writeHead(200, { "Content-Type": "text/html" })
          .end(
            "<h1>ModWrench connected to Nexus Mods</h1>" +
              "<p>You can close this tab and return to the terminal.</p>"
          );
        server.close();
        resolve({ code, redirectUri: (server as unknown as { _redirectUri: string })._redirectUri });
      } catch (err) {
        res.writeHead(500).end("server error");
        server.close();
        reject(err);
      }
    });

    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      if (!addr || typeof addr === "string") {
        reject(new Error("Could not bind local callback server"));
        return;
      }
      const redirectUri = `http://127.0.0.1:${addr.port}/callback`;
      (server as unknown as { _redirectUri: string })._redirectUri = redirectUri;
      const authUrl = buildAuthUrl(addr.port);
      process.stderr.write(
        `\nOpening browser to authorize ModWrench with Nexus Mods...\n` +
          `If it doesn't open, paste this URL into your browser:\n${authUrl}\n\n`
      );
      openBrowser(authUrl);
    });

    setTimeout(
      () => {
        server.close();
        reject(new Error("Authorization timed out (5 minutes)"));
      },
      5 * 60 * 1000
    );
  });
}

// ─── Subcommands ──────────────────────────────────────────────────────────────

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

/**
 * Store a Nexus personal API key in the OS credential manager.
 *
 * This is the auth path that works for everyone. Nexus issues personal API keys
 * self-service, whereas OAuth client IDs must be requested from Nexus by email —
 * so for a tool distributed to arbitrary modders, this is the primary route and
 * authLogin() is the optional upgrade.
 *
 * The key is stored raw rather than JSON-wrapped, which is what makes
 * loadCredential() resolve it as `source: "apikey"` so register.ts sends the
 * `apikey` header instead of an OAuth Bearer token.
 */
export async function authKey(): Promise<void> {
  process.stderr.write(
    "Paste your Nexus personal API key.\n" +
      "Get one at https://www.nexusmods.com/users/myaccount?tab=api+access\n" +
      "(scroll to 'Personal API Key').\n\n" +
      "HEADS UP, so you can decide with full information:\n" +
      "Nexus's API policy tolerates personal API keys for testing and personal\n" +
      "use, but asks public applications to register and use their own client\n" +
      "ID instead. ModWrench is not a registered Nexus application yet, so\n" +
      "right now this is the personal-use path. Nexus reserves the right to\n" +
      "limit personal keys used this way — that would affect YOUR key, not\n" +
      "ModWrench's. If you would rather not take that on, skip Nexus; every\n" +
      "Thunderstore and local diagnostic tool works without it.\n" +
      "Policy: https://help.nexusmods.com/article/114-api-acceptable-use-policy\n\n" +
      "The key is stored only in your OS credential manager — never in a file,\n" +
      "never in this repo, never sent anywhere except api.nexusmods.com.\n\n"
  );

  const key = await prompt("Nexus API key: ");
  if (!key) {
    process.stderr.write("No key entered. Nothing stored.\n");
    process.exit(1);
  }

  // Validate before storing so a truncated paste fails here, loudly, rather
  // than as a confusing 401 on the user's first tool call.
  const res = await fetch(`${NEXUS_API_BASE}/users/validate.json`, {
    headers: { apikey: key, Accept: "application/json" },
  });
  if (!res.ok) {
    process.stderr.write(
      `Nexus rejected that key (${res.status}). Nothing was stored.\n` +
        "Check that you copied the Personal API Key in full.\n"
    );
    process.exit(1);
  }
  const data = (await res.json()) as {
    name?: string;
    user_id?: number;
    is_premium?: boolean;
  };

  setRawSecret(SERVICE, key);

  process.stderr.write(
    `\nVerified as ${data.name ?? "your account"}` +
      (data.user_id ? ` (user_id ${data.user_id})` : "") +
      `${data.is_premium ? " [premium]" : ""}\n` +
      "Key stored in your OS credential manager.\n" +
      "Restart your MCP client and the Nexus tools will activate.\n"
  );
}

export async function authLogin(): Promise<void> {
  const clientId = getEnv("NEXUS_OAUTH_CLIENT_ID", "");
  if (!clientId) {
    process.stderr.write(
      "Nexus OAuth needs a client ID that Nexus issues on request.\n\n" +
        "This is the correct path for a shared application: email\n" +
        "support@nexusmods.com with your app name, description, logo, source\n" +
        "link, and callback URI, then set NEXUS_OAUTH_CLIENT_ID and re-run.\n" +
        "The PKCE flow here is complete and will work as soon as you have one.\n\n" +
        "Alternative, for testing or personal use only:\n\n" +
        "    modwrench auth key nexus\n\n" +
        "That uses your personal API key. Nexus tolerates personal keys for\n" +
        "personal use but not for public applications — read the policy and\n" +
        "decide for yourself:\n" +
        "https://help.nexusmods.com/article/114-api-acceptable-use-policy\n"
    );
    process.exit(1);
  }
  const clientSecret = getEnv("NEXUS_OAUTH_CLIENT_SECRET", "");

  const verifier = makeVerifier();
  const challenge = makeChallenge(verifier);
  const state = base64url(randomBytes(16));

  const { code, redirectUri } = await captureCallback(state, (port) => {
    const url = new URL(`${NEXUS_AUTH_BASE}/oauth/authorize`);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("client_id", clientId);
    url.searchParams.set("redirect_uri", `http://127.0.0.1:${port}/callback`);
    url.searchParams.set("scope", SCOPE);
    url.searchParams.set("state", state);
    url.searchParams.set("code_challenge", challenge);
    url.searchParams.set("code_challenge_method", "S256");
    return url.toString();
  });

  // Exchange code for token. Include client_secret only if registered as a
  // confidential client (some Nexus OAuth apps; public clients use PKCE alone).
  const tokenBody: Record<string, string> = {
    grant_type: "authorization_code",
    code,
    redirect_uri: redirectUri,
    client_id: clientId,
    code_verifier: verifier,
  };
  if (clientSecret) tokenBody.client_secret = clientSecret;

  const tokenRes = await fetch(`${NEXUS_AUTH_BASE}/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(tokenBody),
  });

  if (!tokenRes.ok) {
    const body = await tokenRes.text().catch(() => "");
    process.stderr.write(
      `Token exchange failed (${tokenRes.status}): ${redactSensitiveText(body).slice(0, 300)}\n`
    );
    process.exit(1);
  }

  const tokenData = (await tokenRes.json()) as {
    access_token: string;
    refresh_token?: string;
    expires_in?: number;
    token_type?: string;
  };

  // Confirm the token works by hitting the validate endpoint as the OAuth user.
  const validateRes = await fetch(`${NEXUS_API_BASE}/users/validate.json`, {
    headers: {
      Authorization: `Bearer ${tokenData.access_token}`,
      Accept: "application/json",
    },
  });
  const validateData = validateRes.ok
    ? ((await validateRes.json()) as { name?: string; user_id?: number; is_premium?: boolean })
    : null;

  setStoredToken(SERVICE, {
    access_token: tokenData.access_token,
    refresh_token: tokenData.refresh_token,
    expires_at: tokenData.expires_in ? Date.now() + tokenData.expires_in * 1000 : null,
    saved_at: Date.now(),
  });

  if (validateData?.name) {
    process.stderr.write(
      `\nSigned in as ${validateData.name} (user_id ${validateData.user_id})` +
        `${validateData.is_premium ? " [premium]" : ""}\n`
    );
  } else {
    process.stderr.write("\nSigned in. (Could not fetch profile metadata.)\n");
  }
  process.stderr.write("Token stored in OS keychain.\n");
}

export async function authStatus(): Promise<void> {
  const raw = getRawSecret(SERVICE);
  if (!raw) {
    process.stderr.write(
      "Not signed in to Nexus.\n\n" +
        "  modwrench auth key nexus     personal API key — self-service, works today\n" +
        "  modwrench auth login nexus   OAuth — needs a client ID issued by Nexus\n"
    );
    process.exit(1);
  }

  // A JSON blob is an OAuth token written by `auth login`; anything else is a
  // raw personal API key written by `auth key`. The two take different auth
  // headers, so read the shape before choosing one.
  const stored = getStoredToken(SERVICE);
  const viaOAuth = Boolean(stored?.access_token);
  const res = await fetch(`${NEXUS_API_BASE}/users/validate.json`, {
    headers: viaOAuth
      ? {
          Authorization: `Bearer ${stored!.access_token}`,
          Accept: "application/json",
        }
      : { apikey: raw.trim(), Accept: "application/json" },
  });
  if (!res.ok) {
    process.stderr.write(
      `Credential rejected by Nexus (${res.status}). ` +
        `Run: modwrench auth key nexus\n`
    );
    process.exit(1);
  }
  const data = (await res.json()) as {
    name: string;
    user_id: number;
    is_premium: boolean;
  };
  process.stderr.write(
    `Signed in as ${data.name} (user_id ${data.user_id})` +
      `${data.is_premium ? " [premium]" : ""} ` +
      `via ${viaOAuth ? "OAuth token" : "personal API key"}.\n`
  );
  if (stored?.expires_at) {
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

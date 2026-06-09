import { createHash, randomBytes } from "node:crypto";
import { createServer } from "node:http";
import { exec } from "node:child_process";
import { URL } from "node:url";
import {
  getEnv,
  setStoredToken,
  getStoredToken,
  deleteStoredToken,
  redactSensitiveText,
} from "@mcpwrench/core";

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

export async function authLogin(): Promise<void> {
  const clientId = getEnv("NEXUS_OAUTH_CLIENT_ID", "");
  if (!clientId) {
    process.stderr.write(
      "Missing NEXUS_OAUTH_CLIENT_ID. Register a Nexus OAuth app at\n" +
        "https://www.nexusmods.com/users/myaccount?tab=api+access\n" +
        "and set NEXUS_OAUTH_CLIENT_ID in your .env, then re-run this command.\n"
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
  const stored = getStoredToken(SERVICE);
  if (!stored) {
    process.stderr.write(
      "Not signed in. Run: modwrench auth login nexus\n"
    );
    process.exit(1);
  }

  const res = await fetch(`${NEXUS_API_BASE}/users/validate.json`, {
    headers: {
      Authorization: `Bearer ${stored.access_token}`,
      Accept: "application/json",
    },
  });
  if (!res.ok) {
    process.stderr.write(
      `Token rejected by Nexus (${res.status}). Run: modwrench auth login nexus\n`
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
      `${data.is_premium ? " [premium]" : ""}\n`
  );
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

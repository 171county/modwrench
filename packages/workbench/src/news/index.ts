import { appIdentity, createHttpClient, getEnv, log, ModWrenchError } from "@modwrench/core";
import { findGameById, KNOWN_GAMES } from "../detect/games.js";
import { clean } from "../patchday/summary.js";

// ─── News: what's new for this game and its modding tools? ───────────────────
// The game's latest official announcements on Steam, patch notes among them, and the
// latest releases of the modding tools that game's players use, from GitHub. Both are
// public and need no key. Nothing is sent until the call says confirm: without it the
// answer is the plan (which hosts, how many requests, what each carries), so the person
// can say yes first. Steam gets the game's app number; GitHub gets each tool's
// repository name; neither gets anything of the player's. TRUST.md, "News", says the same.

const APP = appIdentity(import.meta.url);

/** The most recent official posts asked for. */
const STEAM_POSTS = 5;
/** Steam cuts each post to a blurb this long. */
const BLURB_ASK = 300;
/** How many of a repository's newest releases are read, to find the newest full release among them. */
const RELEASES_ASKED = 10;

export type NewsTool = { name: string; repo: string };

// Each of these publishes its builds as GitHub releases (checked on 2026-10-31). CodeWalker
// and the script extenders don't, so they aren't here.
const LOOT: NewsTool = { name: "LOOT", repo: "loot/loot" };
const XEDIT: NewsTool = { name: "xEdit", repo: "TES5Edit/TES5Edit" };
const MO2: NewsTool = { name: "Mod Organizer 2", repo: "ModOrganizer2/modorganizer" };
const BEPINEX: NewsTool = { name: "BepInEx", repo: "BepInEx/BepInEx" };
const MELONLOADER: NewsTool = { name: "MelonLoader", repo: "LavaGang/MelonLoader" };
const R2MODMAN: NewsTool = { name: "r2modman", repo: "ebkr/r2modmanPlus" };
const SHVDN: NewsTool = { name: "ScriptHookVDotNet", repo: "scripthookvdotnet/scripthookvdotnet" };

type NewsGame = { name: string; steamAppId: string; tools: NewsTool[] };

// GTA V's two editions aren't in the detection catalogue; Patch Day knows them by these app numbers.
// ScriptHookVDotNet's own releases are for Legacy; Enhanced has a fork of its own, not listed yet.
const GTA: Record<string, NewsGame> = {
  gta5: { name: "GTA V Legacy", steamAppId: "271590", tools: [SHVDN] },
  gta5enhanced: { name: "GTA V Enhanced", steamAppId: "3240220", tools: [] },
};

/** The game's name, Steam app number and the tools whose releases are checked, or undefined for a game ModWrench doesn't know. */
export function newsGame(gameId: string): NewsGame | undefined {
  if (GTA[gameId]) return GTA[gameId];
  const def = findGameById(gameId);
  if (!def) return undefined;
  const tools =
    def.family === "bethesda"
      ? [LOOT, XEDIT, MO2]
      : def.loaderChecks.some((c) => c.loader === "melonloader")
        ? [MELONLOADER, R2MODMAN]
        : def.r2modmanFolder
          ? [BEPINEX, R2MODMAN]
          : [];
  return { name: def.displayName, steamAppId: def.steamAppId, tools };
}

export const NEWS_GAMES: string[] = [...KNOWN_GAMES.map((g) => g.gameId), ...Object.keys(GTA)];

export type NewsInput = { gameId: string; confirm?: boolean };

export type NewsPost = {
  /** YYYY-MM-DD, UTC. */
  date?: string;
  title: string;
  /** Steam tagged the post as patch notes. */
  patchNotes: boolean;
  blurb: string;
  url?: string;
};

export type NewsRelease = { tag: string; name?: string; date?: string; url?: string };

export type NewsToolResult = NewsTool & {
  state:
    | "ok"
    /** The repository has no published releases. */
    | "none"
    /** GitHub answered that there is no such repository. */
    | "gone"
    /** GitHub refused: its limit for requests without an account is likely used up. */
    | "limited"
    /** The request failed for another reason. */
    | "failed";
  latest?: NewsRelease;
  /** A pre-release newer than `latest`. */
  preRelease?: NewsRelease;
};

export type NewsResult =
  | { ok: false; reason: string }
  | {
      ok: true;
      confirmed: false;
      game: string;
      steamAppId: string;
      steamHost: string;
      githubHost: string;
      tools: NewsTool[];
    }
  | {
      ok: true;
      confirmed: true;
      game: string;
      steamHost: string;
      githubHost: string;
      steam: { ok: true; posts: NewsPost[] } | { ok: false };
      tools: NewsToolResult[];
    };

type SteamItem = { title?: unknown; url?: unknown; contents?: unknown; date?: unknown; tags?: unknown };
type GitHubRelease = { tag_name?: unknown; name?: unknown; html_url?: unknown; published_at?: unknown; prerelease?: unknown; draft?: unknown };

/** Images, BBCode and HTML tags out of a Steam blurb, so it reads as a sentence. */
function plain(text: string): string {
  return text
    .replace(/\[img\][\s\S]*?(?:\[\/img\]|$)|\{STEAM_CLAN_IMAGE\}\S*/gi, " ")
    .replace(/\[[^\]]*\]|<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .replace(/ ([.,;:!?])/g, "$1")
    .trim();
}

function release(r: GitHubRelease): NewsRelease {
  return {
    tag: typeof r.tag_name === "string" ? r.tag_name : "",
    ...(typeof r.name === "string" && r.name.trim() !== "" ? { name: r.name } : {}),
    ...(typeof r.published_at === "string" && /^\d{4}-\d{2}-\d{2}/.test(r.published_at) ? { date: r.published_at.slice(0, 10) } : {}),
    ...(typeof r.html_url === "string" ? { url: r.html_url } : {}),
  };
}

export async function runNews(input: NewsInput): Promise<NewsResult> {
  const game = newsGame(input.gameId);
  if (!game) {
    return {
      ok: false,
      reason: `News doesn't know the game "${clean(input.gameId)}". It knows: ${NEWS_GAMES.join(", ")}. mw_detect_environment lists the games on this computer.`,
    };
  }
  const steamBase = getEnv("STEAM_API_BASE_URL", "https://api.steampowered.com");
  const githubBase = getEnv("GITHUB_API_BASE_URL", "https://api.github.com");
  const base = { ok: true as const, game: game.name, steamHost: new URL(steamBase).host, githubHost: new URL(githubBase).host };

  if (input.confirm !== true) return { ...base, confirmed: false, steamAppId: game.steamAppId, tools: game.tools };

  const client = (baseUrl: string, errorCodePrefix: string) =>
    createHttpClient({ baseUrl, userAgent: APP.userAgent, defaultHeaders: APP.headers, errorCodePrefix });
  const steamHttp = client(steamBase, "steam");
  const githubHttp = client(githubBase, "github");

  const steamCall = steamHttp
    .request<{ appnews?: { newsitems?: unknown } }>("/ISteamNews/GetNewsForApp/v2/", {
      query: { appid: game.steamAppId, count: STEAM_POSTS, maxlength: BLURB_ASK, feeds: "steam_community_announcements", format: "json" },
    })
    .then((body) => {
      const items = Array.isArray(body?.appnews?.newsitems) ? (body.appnews.newsitems as SteamItem[]) : [];
      const posts = items.slice(0, STEAM_POSTS).map((p): NewsPost => ({
        ...(typeof p.date === "number" && p.date > 0 ? { date: new Date(p.date * 1000).toISOString().slice(0, 10) } : {}),
        title: typeof p.title === "string" ? p.title : "",
        patchNotes: Array.isArray(p.tags) && p.tags.includes("patchnotes"),
        blurb: typeof p.contents === "string" ? plain(p.contents) : "",
        ...(typeof p.url === "string" ? { url: p.url } : {}),
      }));
      return { ok: true as const, posts };
    })
    .catch(() => ({ ok: false as const }));

  const toolCalls = game.tools.map(async (tool): Promise<NewsToolResult> => {
    try {
      const list = await githubHttp.request<unknown>(`/repos/${tool.repo}/releases`, {
        query: { per_page: RELEASES_ASKED },
        headers: { Accept: "application/vnd.github+json" },
      });
      const releases = (Array.isArray(list) ? (list as GitHubRelease[]) : []).filter((r) => r.draft !== true && typeof r.tag_name === "string");
      const full = releases.findIndex((r) => r.prerelease !== true);
      if (releases.length === 0) return { ...tool, state: "none" };
      // GitHub lists the newest first, so a pre-release ahead of the newest full release is newer than it.
      const pre = releases.findIndex((r) => r.prerelease === true);
      return {
        ...tool,
        state: "ok",
        ...(full >= 0 ? { latest: release(releases[full]!) } : {}),
        ...(pre >= 0 && (full < 0 || pre < full) ? { preRelease: release(releases[pre]!) } : {}),
      };
    } catch (err) {
      const status = err instanceof ModWrenchError ? err.status : undefined;
      return { ...tool, state: status === 404 ? "gone" : status === 403 || status === 429 ? "limited" : "failed" };
    }
  });

  const [steam, tools] = await Promise.all([steamCall, Promise.all(toolCalls)]);
  log("debug", "workbench.news", { posts: steam.ok ? steam.posts.length : -1, tools: tools.length, failed: tools.filter((t) => t.state !== "ok" && t.state !== "none").length });
  return { ...base, confirmed: true, steam, tools };
}

// ─── The text answer ─────────────────────────────────────────────────────────

// Titles, blurbs and release names are the publishers' words, so each is flattened to one line and cut short
// before it goes into the answer, and links are shown only when they point where they should.

const STEAM_LINK = /^https?:\/\/(?:store\.steampowered\.com|steamcommunity\.com|steamstore-a\.akamaihd\.net)\/[^\s<>"]*$/;
const GITHUB_LINK = /^https:\/\/github\.com\/[^\s<>"]+$/;

function link(url: string | undefined, pattern: RegExp): string {
  return url && pattern.test(url) ? ` — ${clean(url.replace(/^http:/, "https:"), 200)}` : "";
}

function rel(r: NewsRelease): string {
  const label = r.name && r.name !== r.tag ? `${clean(r.tag, 40)} (${clean(r.name)})` : clean(r.tag, 40);
  return `${label}${r.date ? `, released ${r.date}` : ""}${link(r.url, GITHUB_LINK)}`;
}

function toolLine(t: NewsToolResult): string {
  switch (t.state) {
    case "ok":
      return [
        `- ${t.name}: ${t.latest ? rel(t.latest) : "no full release yet"}`,
        ...(t.preRelease ? [`  Newer pre-release: ${rel(t.preRelease)}`] : []),
      ].join("\n");
    case "none":
      return `- ${t.name}: no releases published on GitHub (${t.repo})`;
    case "gone":
      return `- ${t.name}: GitHub has no repository ${t.repo} any more`;
    case "limited":
      return `- ${t.name}: GitHub refused this time. Its limit for requests without an account is 60 an hour per address, so try again later.`;
    case "failed":
      return `- ${t.name}: couldn't be checked this time (GitHub didn't answer)`;
  }
}

export function summarizeNews(result: NewsResult): string {
  if (!result.ok) return result.reason;

  if (!result.confirmed) {
    const n = result.tools.length;
    const list = result.tools.map((t) => `${t.name} (${t.repo})`).join(", ");
    return [
      `News for ${result.game}: nothing has been sent yet.`,
      "",
      `Checking would send ${1 + n} request${n === 0 ? "" : "s"}, none with a key or anything of the user's:`,
      `- 1 to ${result.steamHost}, carrying the game's Steam app number (${result.steamAppId}), for its ${STEAM_POSTS} latest official announcements, patch notes among them.`,
      ...(n > 0 ? [`- ${n} to ${result.githubHost}, one per modding tool, carrying the tool's repository name, for its latest releases: ${list}.`] : []),
      "",
      "Ask the user whether to go ahead, and call mw_news again with confirm=true only after they say yes.",
    ].join("\n");
  }

  const out: string[] = [`What's new for ${result.game}, from ${result.steamHost}${result.tools.length > 0 ? ` and ${result.githubHost}` : ""}:`];

  out.push("", `Official announcements on Steam (newest first, the publisher's own words, cut short):`);
  if (!result.steam.ok) out.push("- Steam didn't answer this time.");
  else if (result.steam.posts.length === 0) out.push("- Steam has no official announcements for this game.");
  else {
    for (const p of result.steam.posts) {
      const head = `${p.date ? `${p.date} ` : ""}${p.patchNotes ? "[patch notes] " : ""}${clean(p.title, 120) || "(no title)"}`;
      out.push(`- ${head}${link(p.url, STEAM_LINK)}`);
      if (p.blurb) out.push(`  ${clean(p.blurb, 200)}`);
    }
  }

  if (result.tools.length > 0) out.push("", "Modding tools' latest releases on GitHub:", ...result.tools.map(toolLine));

  out.push(
    "",
    "News reads and asks only: it doesn't download or install anything. Whether a game update breaks your mods is " +
      "Patch Day's question (mw_patch_day), which reads the files on this computer."
  );
  return out.join("\n");
}

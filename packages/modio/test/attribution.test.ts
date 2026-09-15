import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// ─── Every output naming a mod carries a link back to its page ───────────────
// README.md, under "For mod authors": "Every output that mentions a mod carries
// the author's name, the platform it came from, and a link to the mod page."
//
// The three mod.io discovery tools — modio_list_mods, modio_search_mods and
// modio_popular — hand-build a summary object rather than returning the raw
// response. That summary kept `author` and dropped `profile_url`, which mod.io
// returns on every mod object. Nexus and Thunderstore both carry their link.
//
// The consequence is specific: on the three paths most likely to surface an
// author's work to a stranger, the link back to that author was stripped before
// the model ever saw it, so the assistant could not cite it even when asked
// directly. The UI card helper had the same hole — ModCard has had a pageUrl
// field all along and mod.io never populated it.
//
// Hand-built summaries are exactly the shape that drops fields silently, so
// the guard is per-builder rather than a single blanket check.

const REGISTER = new URL("../src/register.ts", import.meta.url).pathname.replace(
  /^\/([A-Za-z]:)/,
  "$1"
);

const MOD_TOOLS = ["modio_list_mods", "modio_search_mods", "modio_popular"];

function toolBody(src: string, name: string): string {
  const start = src.indexOf(`"${name}"`);
  assert.ok(start > -1, `${name} not found — this guard would pass vacuously`);
  const next = src.indexOf("server.tool(", start);
  return src.slice(start, next === -1 ? undefined : next);
}

for (const tool of MOD_TOOLS) {
  test(`${tool} carries the mod's page URL into its summary`, () => {
    const body = toolBody(readFileSync(REGISTER, "utf8"), tool);

    assert.match(
      body,
      /pageUrl: m\.profile_url/,
      `${tool} builds a summary without profile_url — README promises every output ` +
        `naming a mod links back to its page, and mod.io returns that URL on every ` +
        `mod object`
    );
    assert.match(
      body,
      /profile_url: string;/,
      `${tool}'s response type no longer declares profile_url — the field will be ` +
        `undefined at runtime even if the summary asks for it`
    );
    // The author was never the missing half; keep it pinned so a future edit
    // does not trade one attribution field for another.
    assert.match(
      body,
      /author: m\.submitted_by\?\.username/,
      `${tool} no longer carries the author name`
    );
  });
}

test("the mod.io UI card carries the page URL too", () => {
  const src = readFileSync(REGISTER, "utf8");
  const start = src.indexOf("function modioModsUI");
  assert.ok(start > -1, "modioModsUI not found — this guard would pass vacuously");
  const body = src.slice(start, src.indexOf("createUIResource", start));

  assert.match(
    body,
    /pageUrl: r\.pageUrl/,
    "the mod.io card no longer sets pageUrl — ModCard has the field and the rendered " +
      "card will show no link back to the author"
  );
});

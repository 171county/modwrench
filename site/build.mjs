// Builds the website into site/dist: public/ copied as it is, src/try.ts bundled into try.js, the page's one script,
// and TRUST.md made into the trust page, trust.html, which Cloudflare serves at /trust. Run it with
// `npm run site:build`; site/dist is what gets deployed. The site is not an npm workspace and is never published to
// npm.
//
// The crash reading and Crew Check code it bundles is shared with the installed tools, and imports Node's built-in
// modules for reading from disk. Each node: import is pointed at a stub in src/stubs/; one with no stub fails the build.

import { build } from "esbuild";
import { Marked } from "marked";
import { cpSync, existsSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const SITE = dirname(fileURLToPath(import.meta.url));
const STUBS = join(SITE, "src", "stubs");

/**
 * The esbuild settings for the page's script, shared with site/test so the tests run the same bundle.
 * @param {string} entry
 * @returns {import("esbuild").BuildOptions}
 */
export function bundleOptions(entry) {
  return {
    entryPoints: [entry],
    bundle: true,
    platform: "browser",
    target: "es2020",
    minify: true,
    legalComments: "none",
    // The sample crash log the page offers is bundled as text, since the page may not fetch anything.
    loader: { ".log": "text" },
    logLevel: "warning",
    plugins: [
      {
        name: "node-stubs",
        setup(b) {
          b.onResolve({ filter: /^node:/ }, (args) => {
            const stub = join(STUBS, `${args.path.slice("node:".length)}.ts`);
            if (!existsSync(stub)) return { errors: [{ text: `${args.path} has no browser stub in site/src/stubs (imported by ${args.importer})` }] };
            return { path: stub };
          });
        },
      },
    ],
  };
}

const TRUST_CSS = `
.trust { padding-top: 40px; padding-bottom: 40px; max-width: 820px; overflow-wrap: anywhere; }
.trust h1 { font-size: clamp(30px, 5vw, 44px); line-height: 1.1; letter-spacing: -0.02em; margin: 0 0 12px; }
.trust h2 { font-size: clamp(22px, 3vw, 28px); margin: 44px 0 10px; padding-top: 20px; border-top: 1px solid var(--line); letter-spacing: -0.01em; }
.trust h3 { font-size: 19px; margin: 28px 0 8px; }
.trust h4 { font-size: 17px; margin: 22px 0 6px; }
.trust hr { border: 0; border-top: 1px solid var(--line); margin: 32px 0; }
.trust hr + h2 { border-top: 0; padding-top: 0; margin-top: 0; }
.trust li { margin-bottom: 6px; }
.trust .source { color: var(--muted); font-size: 15px; }
.trust pre code { background: none; padding: 0; }
.trust table { display: block; overflow-x: auto; overflow-wrap: normal; border-collapse: collapse; margin: 16px 0; font-size: 15px; }
.trust th, .trust td { border: 1px solid var(--line); padding: 6px 10px; text-align: left; vertical-align: top; }
.trust th { background: var(--panel-2); }
.trust td code { background: var(--panel-2); padding: 1px 5px; border-radius: 4px; }
`;

/** @param {string} text @param {string} from @param {string} to */
function swap(text, from, to) {
  if (!text.includes(from)) throw new Error(`site/build.mjs: found no ${JSON.stringify(from)} to replace`);
  return text.replace(from, to);
}

/** @param {string} text @param {string} open @param {string} close */
function inside(text, open, close) {
  const start = text.indexOf(open);
  const end = text.indexOf(close, start);
  if (start < 0 || end < 0) throw new Error(`site/build.mjs: the home page has no ${open}…${close}`);
  return text.slice(start + open.length, end);
}

/**
 * GitHub's id for a heading, so TRUST.md's own #links work on the site as they do on GitHub.
 * @param {string} html the heading's content
 */
function headingId(html) {
  const text = html.replace(/<[^>]*>/g, "").replace(/&(amp|lt|gt|quot|#39);/g, (_, e) => ({ amp: "&", lt: "<", gt: ">", quot: '"', "#39": "'" })[e]);
  return text.toLowerCase().replace(/[^\p{L}\p{N}\s_-]/gu, "").replace(/\s/g, "-");
}

/**
 * The trust page: TRUST.md as HTML, inside the home page's head, header and footer. It is built from the file on
 * every build, so the site can't show promises that differ from the repository's.
 * @param {string} markdown TRUST.md
 * @param {string} home the home page, index.html
 */
export function trustPage(markdown, home) {
  const used = new Map();
  const marked = new Marked({
    renderer: {
      heading({ tokens, depth }) {
        const inner = this.parser.parseInline(tokens);
        const id = headingId(inner);
        const n = used.get(id) ?? 0;
        used.set(id, n + 1);
        return `<h${depth} id="${n ? `${id}-${n}` : id}">${inner}</h${depth}>\n`;
      },
    },
  });
  const title = /^# (.+)$/m.exec(markdown)?.[1];
  let head = inside(home, "<head>", "</head>");
  head = swap(head, "<title>ModWrench</title>", `<title>${title} · ModWrench</title>`);
  head = head.replace(/<meta name="description" content="[^"]*">/, '<meta name="description" content="Every promise ModWrench makes, checked against its code, and how to check each one yourself.">');
  head = swap(head, '<script src="/try.js" defer></script>\n', "");
  head = swap(head, "</style>", `${TRUST_CSS}</style>`);
  const header = inside(home, '<header class="top">', "</header>").replaceAll('href="#', 'href="/#');
  const footer = inside(home, "<footer>", "</footer>");
  const article = swap(
    /** @type {string} */ (marked.parse(markdown)),
    "</h1>\n",
    '</h1>\n<p class="source">This page is <a href="https://github.com/171county/modwrench/blob/main/TRUST.md">TRUST.md</a> from ModWrench\'s source, built into this site. On GitHub you can see every change made to it.</p>\n',
  );
  return `<!doctype html>\n<html lang="en">\n<head>${head}</head>\n<body>\n\n<header class="top">${header}</header>\n\n<main class="wrap trust">\n${article}</main>\n\n<footer>${footer}</footer>\n\n</body>\n</html>\n`;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const dist = join(SITE, "dist");
  rmSync(dist, { recursive: true, force: true });
  cpSync(join(SITE, "public"), dist, { recursive: true });
  await build({ ...bundleOptions(join(SITE, "src", "try.ts")), format: "iife", outfile: join(dist, "try.js") });
  console.log(`site/dist/try.js: ${statSync(join(dist, "try.js")).size.toLocaleString("en-US")} bytes`);
  writeFileSync(join(dist, "trust.html"), trustPage(readFileSync(join(SITE, "..", "TRUST.md"), "utf8"), readFileSync(join(dist, "index.html"), "utf8")));
  console.log(`site/dist/trust.html: ${statSync(join(dist, "trust.html")).size.toLocaleString("en-US")} bytes, from TRUST.md`);
}

// Builds the website into site/dist: public/ copied as it is, and src/try.ts bundled into try.js, the page's one
// script. Run it with `npm run site:build`; site/dist is what gets deployed. The site is not an npm workspace and is
// never published to npm.
//
// The crash reading and Crew Check code it bundles is shared with the installed tools, and imports Node's built-in
// modules for reading from disk. Each node: import is pointed at a stub in src/stubs/; one with no stub fails the build.

import { build } from "esbuild";
import { cpSync, existsSync, rmSync, statSync } from "node:fs";
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

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const dist = join(SITE, "dist");
  rmSync(dist, { recursive: true, force: true });
  cpSync(join(SITE, "public"), dist, { recursive: true });
  await build({ ...bundleOptions(join(SITE, "src", "try.ts")), format: "iife", outfile: join(dist, "try.js") });
  console.log(`site/dist/try.js: ${statSync(join(dist, "try.js")).size.toLocaleString("en-US")} bytes`);
}

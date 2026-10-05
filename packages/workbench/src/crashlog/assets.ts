// Game files a crash log names in passing: Crash Logger SSE, Buffout 4 and NetScriptFramework print what a register or
// stack slot points at, and a string is printed in double quotes: (char*) "textures\terrain\tamriel\skyrim.dds".
// What the game was loading when it stopped is often the best clue a log has.

// Bethesda game data: textures, meshes, terrain LOD, animation, FaceGen, materials, scripts, sound, UI, archives, plugins.
const ASSET = /\.(?:dds|nif|btr|bto|hkx|tri|egm|egt|bgsm|bgem|pex|psc|wav|xwm|fuz|lip|swf|seq|bsa|ba2|esp|esm|esl)$/i;

/**
 * The game files named in these lines, each once (the first spelling kept), at most 10. Only paths inside the game's
 * data: a path with a drive, a leading slash or a folder ModWrench took out would say where things are on the
 * player's drive, so it is left out. So is one with an empty folder ("textures\\NAS-HOME\..."): no game file has one,
 * and it can hold a network share glued after a folder name, where the redactor doesn't look for one.
 */
export function assetPaths(lines: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const line of lines) {
    for (const m of line.matchAll(/"([^"\r\n]{1,260})"/g)) {
      const path = m[1]?.trim() ?? "";
      if (!ASSET.test(path) || /^(?:[A-Za-z]:|[\\/])|REDACTED-|\.\.|[\\/]{2}/.test(path)) continue;
      const key = path.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(path);
      if (out.length === 10) return out;
    }
  }
  return out;
}

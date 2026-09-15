import { test } from "node:test";
import assert from "node:assert/strict";
import { renderShell } from "../src/shell.js";

// ─── The register grid has to fit a 64-bit value ─────────────────────────────
// Found by rendering the crash panel and looking at it, which had never been
// done. The registers block used grid tracks of minmax(120px, 1fr), but a real
// cell is a 34px label + a 7px gap + "0x" plus 16 hex digits — 18 monospace
// characters, about 119px at 11px — so roughly 160px. Every cell overflowed its
// own 120px track and ran into the next column:
//
//   RAX  0x0000000000000000RBX  0x000001F4A2B3C4D0RCX  0x00000000000000
//
// Two things were wrong with that. It reads as garbage, and the overflow
// truncated values — RCX held 0x18, the exact address the exception line says
// it failed to read, and a modder could not see it.
//
// A screenshot test would be the direct way to catch this and is not worth the
// infrastructure here, so the guard is on the two properties that caused it:
// the track has to be wide enough for the real content, and the value must not
// be allowed to spill out of its cell.

function styleBlock(): string {
  const html = renderShell({
    theme: "skyrim",
    view: "crash",
    crash: {
      ok: true,
      exception: { type: "EXCEPTION_ACCESS_VIOLATION", address: "0x7FF7A2C4B3D0" },
      registers: { RAX: "0x0000000000000000", RCX: "0x0000000000000018" },
    },
  });
  const start = html.indexOf("<style");
  const end = html.indexOf("</style>", start);
  assert.ok(start > -1 && end > start, "no style block found — this guard would pass vacuously");
  return html.slice(start, end);
}

test("the register grid track fits a full 64-bit value", () => {
  const css = styleBlock();

  const rule = css.match(/\.mw-regs\{[^}]*\}/)?.[0];
  assert.ok(rule, ".mw-regs rule not found");

  const min = rule.match(/minmax\((\d+)px/)?.[1];
  assert.ok(min, ".mw-regs no longer uses a minmax track — cannot verify it fits");

  // 34px label + 7px gap + ~119px for "0x" + 16 hex digits at 11px mono.
  assert.ok(
    Number(min) >= 160,
    `.mw-regs track is ${min}px; a 64-bit register cell needs ~160px. Below that, ` +
      `each cell spills into the next column and register values collide with the ` +
      `following register's name`
  );
});

test("a register value cannot spill out of its cell", () => {
  const css = styleBlock();

  const value = css.match(/\.mw-reg-v\{[^}]*\}/)?.[0];
  assert.ok(value, ".mw-reg-v rule not found");
  assert.match(
    value,
    /white-space:\s*nowrap/,
    ".mw-reg-v may wrap — a wrapped hex value breaks the column alignment that makes " +
      "this block readable"
  );
  assert.match(
    value,
    /overflow:\s*hidden/,
    ".mw-reg-v can overflow its cell again — that is the original bug"
  );

  const key = css.match(/\.mw-reg-k\{[^}]*\}/)?.[0];
  assert.ok(key, ".mw-reg-k rule not found");
  assert.match(
    key,
    /flex:\s*none/,
    ".mw-reg-k can be compressed by a long value, which collapses the register name"
  );
});

test("the rendered registers actually carry their full values", () => {
  const html = renderShell({
    theme: "skyrim",
    view: "crash",
    crash: {
      ok: true,
      exception: { type: "EXCEPTION_ACCESS_VIOLATION", address: "0x7FF7A2C4B3D0" },
      registers: { RCX: "0x0000000000000018" },
    },
  });

  // The faulting address matters most: the exception says what it failed to
  // read, and a register usually holds it. Truncating that loses the finding.
  assert.match(
    html,
    /0x0000000000000018/,
    "the full register value is not in the output — it is being truncated before render"
  );
});

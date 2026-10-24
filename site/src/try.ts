import {
  checkCrew,
  CREW_MAX_LISTS,
  formatName,
  MAX_FILE_BYTES,
  MAX_PASTE,
  readCrashLog,
  VENUES,
  type Basis,
  type CrashWhisperReport,
  type CrewCompare,
  type Lead,
} from "./run.js";
// A made-up Skyrim crash from ModWrench's own tests, for a visitor with no crash log to hand.
import SAMPLE_LOG from "../../packages/workbench/test/fixtures/crash-sse-real-format.log";

// The Try section of the website. Everything a log or a crew list holds is someone else's text, so it reaches the page
// only through text nodes (el() below): never as markup. The page sends nothing; its Content-Security-Policy (site/
// public/_headers) has no connect-src, so it couldn't if it tried.

type Child = Node | string | undefined | false;

/** Adds children to a node: a string becomes a text node, never markup. */
function add(node: HTMLElement, ...children: Child[]): void {
  for (const child of children) if (child !== undefined && child !== false) node.append(child);
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, props: Partial<HTMLElementTagNameMap[K]> = {}, ...children: Child[]): HTMLElementTagNameMap[K] {
  const node = Object.assign(document.createElement(tag), props);
  add(node, ...children);
  return node;
}

function byId<T extends HTMLElement>(id: string): T {
  return document.getElementById(id) as T;
}

function say(status: HTMLElement, text: string, error = false): void {
  status.textContent = text;
  status.classList.toggle("error", error);
}

const n = (value: number): string => value.toLocaleString("en-US");

// ─── Crash log reader ────────────────────────────────────────────────────────

const BASIS_WORD: Record<Basis, string> = { log: "log", install: "your files", rule: "rule", guess: "guess" };
const STRENGTH_WORD: Record<Lead["strength"], string> = { strong: "Strong lead", possible: "Possible lead", faint: "Faint lead" };
const VENUE_WORD: Record<(typeof VENUES)[number], string> = {
  forum: "Forum post",
  github: "GitHub issue",
  discord: "Discord message",
  author: "Message to the mod's author",
};

function leadItem(lead: Lead): HTMLLIElement {
  return el(
    "li",
    {},
    el(
      "div",
      { className: "lead-head" },
      el("span", { className: "lead-rank" }, `${lead.rank}.`),
      el("span", { className: "lead-name" }, lead.name, lead.mod ? ` (${lead.mod})` : undefined),
      el("span", { className: `strength ${lead.strength}` }, STRENGTH_WORD[lead.strength])
    ),
    el("p", {}, lead.summary),
    el("ul", { className: "evidence" }, ...lead.evidence.map((e) => el("li", {}, el("span", { className: "basis" }, BASIS_WORD[e.basis]), e.text)))
  );
}

function copyButton(text: string, area: HTMLTextAreaElement): HTMLElement {
  const done = el("span", { className: "copied" });
  done.setAttribute("role", "status");
  const button = el("button", { type: "button", className: "btn" }, "Copy");
  button.addEventListener("click", () => {
    const fallback = (): void => {
      area.focus();
      area.select();
      done.textContent = "Selected: press Ctrl+C (or Cmd+C) to copy.";
    };
    if (!navigator.clipboard) return fallback();
    navigator.clipboard.writeText(text).then(() => {
      done.textContent = "Copied.";
    }, fallback);
  });
  return el("div", { className: "row" }, button, done);
}

function drawReport(r: CrashWhisperReport, out: HTMLElement): void {
  const c = r.crash;
  const facts: Array<[string, string]> = [["Game", `${c.game.name}${c.game.version ? ` ${c.game.version}` : ""}`], ["Log", `${formatName(c.format)}${c.logger ? ` (${c.logger})` : ""}`]];
  if (c.time) facts.push(["Crashed", `${c.time}, by the log's own clock`]);
  if (c.exception?.type) facts.push(["Exception", c.exception.type]);
  if (c.pluginCount > 0) facts.push(["Plugins", `${n(c.pluginCount)} loaded`]);

  add(
    out,
    el("h4", {}, "What happened"),
    el("p", { className: "headline" }, r.headline),
    c.exception?.plain ? el("p", {}, c.exception.plain) : undefined,
    el("dl", { className: "facts" }, ...facts.flatMap(([k, v]) => [el("dt", {}, k), el("dd", {}, v)])),
    el("h4", {}, "Leads"),
    el("p", { className: "small" }, "Names the log points at, ranked by ModWrench's own scoring. A lead is not a finding: the top one can be innocent. Each reason says what it rests on: the log itself, a published rule, or ModWrench's own guess."),
    r.leads.length > 0 ? el("ol", { className: "leads" }, ...r.leads.map(leadItem)) : el("p", {}, "None. Nothing the log shows points at a mod by name.")
  );

  if (r.checks.length > 0) {
    add(
      out,
      el("h4", {}, "What else the log shows"),
      el(
        "ul",
        { className: "checks" },
        ...r.checks.map((k) =>
          el(
            "li",
            {},
            el("span", { className: `sev ${k.severity}` }, k.severity === "problem" ? "Problem" : k.severity === "note" ? "Note" : "Info"),
            el("span", { className: "basis" }, BASIS_WORD[k.basis]),
            el("b", {}, k.title),
            el("br"),
            k.detail,
            k.fix ? el("span", { className: "fix" }, ` ${k.fix}`) : undefined
          )
        )
      )
    );
  }

  add(
    out,
    el("h4", {}, "Help posts"),
    el("p", { className: "small" }, `One for each place you might ask, built from the log's facts. ${r.redaction.summary}`),
    ...VENUES.map((venue, i) => {
      const packet = r.packets[venue];
      const area = el("textarea", { readOnly: true, rows: 12, spellcheck: false, value: packet.text });
      area.setAttribute("aria-label", `${VENUE_WORD[venue]} text`);
      return el(
        "details",
        { className: "post", open: i === 0 },
        el("summary", {}, `${VENUE_WORD[venue]} (${n(packet.chars)} characters${packet.trimmed ? ", shortened to fit" : ""})`),
        el("div", { className: "body" }, el("p", { className: "small" }, packet.where), el("p", {}, el("b", {}, "Title: "), packet.title), area, copyButton(packet.text, area))
      );
    }),
    el(
      "p",
      { className: "small" },
      "This page read the log alone. Where a check mentions the Doctors, Patch Day or a /mw- command, that is ModWrench installed in your AI app, which can also check your install and talk the crash through with you."
    )
  );
}

function setUpCrashReader(): void {
  const text = byId<HTMLTextAreaElement>("log-text");
  const file = byId<HTMLInputElement>("log-file");
  const status = byId<HTMLElement>("log-status");
  const out = byId<HTMLElement>("log-result");

  const run = (): void => {
    out.replaceChildren();
    out.hidden = true;
    say(status, "Reading the log…");
    // Let the status paint before the work, which runs on this thread.
    setTimeout(() => {
      const result = readCrashLog(text.value);
      if (!result.ok) {
        say(status, [result.error, result.hint].filter(Boolean).join(" "), true);
        return;
      }
      say(status, "");
      drawReport(result, out);
      out.hidden = false;
      out.scrollIntoView({ block: "start" });
    }, 20);
  };

  const load = (f: File): void => {
    if (f.size > MAX_FILE_BYTES) {
      say(status, `That file is too big to be one crash log: Crash Whisperer reads up to ${n(MAX_PASTE)} characters.`, true);
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      text.value = typeof reader.result === "string" ? reader.result : "";
      run();
    };
    reader.onerror = () => say(status, "Your browser couldn't read that file.", true);
    reader.readAsText(f);
  };

  byId("log-read").addEventListener("click", run);
  byId("log-sample").addEventListener("click", () => {
    text.value = SAMPLE_LOG;
    file.value = "";
    run();
  });
  byId("log-clear").addEventListener("click", () => {
    text.value = "";
    file.value = "";
    out.replaceChildren();
    out.hidden = true;
    say(status, "");
  });
  file.addEventListener("change", () => {
    if (file.files?.[0]) load(file.files[0]);
  });
  text.addEventListener("dragover", (e) => {
    if (e.dataTransfer?.types.includes("Files")) e.preventDefault();
  });
  text.addEventListener("drop", (e) => {
    const f = e.dataTransfer?.files[0];
    if (!f) return;
    e.preventDefault();
    load(f);
  });
}

// ─── Crew Check ──────────────────────────────────────────────────────────────

function names(labels: string[]): string {
  return labels.length <= 2 ? labels.join(" and ") : `${labels.slice(0, -1).join(", ")} and ${labels[labels.length - 1]}`;
}

function drawCrew(r: CrewCompare, out: HTMLElement): void {
  const clash = r.missing.length + r.versions.length;
  add(
    out,
    el("h4", {}, r.game ? `Crew Check for ${r.game}` : "Crew Check"),
    el(
      "p",
      { className: "headline" },
      clash === 0
        ? `All ${r.players.length} lists have the same ${n(r.same)} mod${r.same === 1 ? "" : "s"} at the same versions.`
        : `${n(r.missing.length)} mod${r.missing.length === 1 ? " isn't" : "s aren't"} on everyone's list, and ${n(r.versions.length)} ${r.versions.length === 1 ? "is" : "are"} on different versions. ${n(r.same)} match.`
    )
  );
  if (r.missing.length > 0) {
    add(
      out,
      el("h4", {}, "Not on everyone's list"),
      el(
        "ul",
        { className: "crew-out" },
        ...r.missing.map((m) => el("li", {}, el("b", {}, m.id), el("br"), `${names(m.has)} ${m.has.length === 1 ? "has" : "have"} it; ${names(m.lacks)} ${m.lacks.length === 1 ? "doesn't" : "don't"}.`))
      )
    );
  }
  if (r.versions.length > 0) {
    add(
      out,
      el("h4", {}, "Different versions"),
      el("ul", { className: "crew-out" }, ...r.versions.map((v) => el("li", {}, el("b", {}, v.id), el("br"), v.byPlayer.map(([p, ver]) => `${p}: ${ver}`).join(", "))))
    );
  }
  if (r.warnings.length > 0) add(out, el("ul", { className: "small notes" }, ...r.warnings.map((w) => el("li", {}, w))));
  add(
    out,
    el("p", { className: "small" }, "Crew Check compares the lists only: it doesn't download, install or change anything. In most co-op lobbies everyone needs the same mods at the same versions, but some mods are client-side only.")
  );
}

function setUpCrewCheck(): void {
  const holder = byId<HTMLElement>("crew-lists");
  const add = byId<HTMLButtonElement>("crew-add");
  const status = byId<HTMLElement>("crew-status");
  const out = byId<HTMLElement>("crew-result");
  const lists: Array<{ name: HTMLInputElement; list: HTMLTextAreaElement }> = [];

  const addList = (): void => {
    const i = lists.length + 1;
    const name = el("input", { type: "text", id: `crew-name-${i}`, maxLength: 40, autocomplete: "off", placeholder: "Optional" });
    const list = el("textarea", { id: `crew-list-${i}`, rows: 6, spellcheck: false, placeholder: "ModWrench crew list 1 · …" });
    holder.append(
      el(
        "div",
        { className: "crew-list" },
        el("label", { className: "field", htmlFor: name.id }, `Crewmate ${i}'s name`),
        name,
        el("label", { className: "field", htmlFor: list.id }, `Crewmate ${i}'s crew list`),
        list
      )
    );
    lists.push({ name, list });
    add.disabled = lists.length >= CREW_MAX_LISTS;
  };

  addList();
  addList();
  add.addEventListener("click", () => {
    addList();
    lists[lists.length - 1]!.list.focus();
  });
  byId("crew-compare").addEventListener("click", () => {
    out.replaceChildren();
    out.hidden = true;
    // An unnamed list is called what its box is called, even when an empty box before it is skipped.
    const result = checkCrew(lists.map((l, i) => ({ list: l.list.value, name: l.name.value.trim() !== "" ? l.name.value : `Crewmate ${i + 1}` })));
    if (!result.ok) {
      say(status, result.error, true);
      return;
    }
    say(status, "");
    drawCrew(result, out);
    out.hidden = false;
    out.scrollIntoView({ block: "start" });
  });
}

setUpCrashReader();
setUpCrewCheck();

import assert from "node:assert/strict";
import { runInNewContext } from "node:vm";

// ─── A page, driven like a host drives it ────────────────────────────────────
// A DOM stand-in just big enough to run a page's own script, runtime included: the
// host's answers arrive as postMessage events, buttons are pressed by calling their
// click listeners, and what the page draws or sends is read back. It covers what
// every page does (the frame, the skins, the buttons, the requests to the host); how
// a page looks in a browser is checked by hand.

export type Message = {
  jsonrpc: string;
  id?: number;
  method?: string;
  params?: Record<string, unknown>;
  result?: unknown;
  error?: { code: number; message: string };
};
type Listener = (event: unknown) => void;

export type Fake = {
  tag: string;
  children: Fake[];
  attrs: Record<string, string>;
  classes: Set<string>;
  listeners: Record<string, Listener[]>;
  textContent: string;
  hidden: boolean;
  value: string;
  checked: boolean;
  disabled: boolean;
  open: boolean;
  firstChild: Fake | null;
  offsetWidth: number;
  style: Record<string, string>;
  classList: { add(c: string): void; remove(c: string): void; toggle(c: string, on?: boolean): boolean; contains(c: string): boolean };
  appendChild(n: Fake): Fake;
  removeChild(n: Fake): Fake;
  setAttribute(k: string, v: string): void;
  getAttribute(k: string): string | null;
  removeAttribute(k: string): void;
  addEventListener(type: string, fn: Listener): void;
  getBoundingClientRect(): { width: number; height: number };
  focus(): void;
  select(): void;
};

export const tick = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

/** All the text an element and what is inside it show. */
export const textOf = (node: Fake): string => node.textContent + node.children.map(textOf).join("");

export function loadPage(html: string) {
  const byId = new Map<string, Fake>();
  /** Every element the page's script created, in order. */
  const created: Fake[] = [];
  const make = (tag: string, text = ""): Fake => {
    const classes = new Set<string>();
    const node: Fake = {
      tag,
      children: [],
      attrs: {},
      classes,
      listeners: {},
      textContent: text,
      hidden: false,
      value: "",
      checked: false,
      disabled: false,
      open: false,
      firstChild: null,
      offsetWidth: 0,
      style: {},
      classList: {
        add: (c) => void classes.add(c),
        remove: (c) => void classes.delete(c),
        toggle: (c, on) => {
          const want = on ?? !classes.has(c);
          if (want) classes.add(c);
          else classes.delete(c);
          return want;
        },
        contains: (c) => classes.has(c),
      },
      appendChild(n) {
        node.children.push(n);
        node.firstChild = node.children[0] ?? null;
        return n;
      },
      removeChild(n) {
        node.children = node.children.filter((c) => c !== n);
        node.firstChild = node.children[0] ?? null;
        return n;
      },
      setAttribute(k, v) {
        node.attrs[k] = v;
        if (k === "id") byId.set(v, node);
      },
      getAttribute: (k) => node.attrs[k] ?? null,
      removeAttribute(k) {
        delete node.attrs[k];
      },
      addEventListener(type, fn) {
        (node.listeners[type] ??= []).push(fn);
      },
      getBoundingClientRect: () => ({ width: 300, height: 200 }),
      focus() {},
      select() {},
    };
    return node;
  };
  // The static markup's own elements, with the attributes the scripts read back.
  for (const m of html.matchAll(/<([a-z0-9]+)\b([^>]*)\sid="([a-z-]+)"([^>]*)>/g)) {
    const node = make(m[1]!);
    const attrs = `${m[2]} ${m[4]}`;
    node.hidden = /\shidden(?:[\s=]|$)/.test(` ${attrs}`);
    node.checked = /\schecked(?:[\s=]|$)/.test(` ${attrs}`);
    node.open = /\sopen(?:[\s=]|$)/.test(` ${attrs}`);
    for (const a of attrs.matchAll(/\s(aria-[a-z]+|data-[a-z]+|class)="([^"]*)"/g)) node.attrs[a[1]!] = a[2]!;
    for (const c of (node.attrs.class ?? "").split(/\s+/)) if (c) node.classes.add(c);
    // An element that holds only text starts with that text.
    const text = new RegExp(`^([^<]*)</${m[1]}>`).exec(html.slice(m.index + m[0].length));
    if (text) node.textContent = text[1]!.replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
    byId.set(m[3]!, node);
  }

  const posted: Message[] = [];
  const parent = { postMessage: (m: Message) => void posted.push(JSON.parse(JSON.stringify(m)) as Message) };
  const windowListeners: Record<string, Listener[]> = {};
  const timers: Array<() => void> = [];
  /** The attributes set on <html>: `data-game` (the skin) and `data-theme` (the host's light or dark). */
  const htmlAttrs: Record<string, string> = {};
  const sandbox: Record<string, unknown> = {
    parent,
    addEventListener: (type: string, fn: Listener) => void (windowListeners[type] ??= []).push(fn),
    requestAnimationFrame: (fn: () => void) => {
      fn();
      return 1;
    },
    // Kept, not run: runTimers() runs them, as if the time had passed.
    setTimeout: (fn: () => void) => timers.push(fn),
    navigator: {},
    document: {
      documentElement: {
        setAttribute: (k: string, v: string) => void (htmlAttrs[k] = v),
        getAttribute: (k: string) => htmlAttrs[k] ?? null,
        style: { setProperty() {}, colorScheme: "" },
      },
      getElementById: (id: string) => byId.get(id) ?? null,
      createElement: (tag: string) => {
        const node = make(tag);
        created.push(node);
        return node;
      },
      createTextNode: (text: string) => make("#text", text),
    },
  };
  sandbox.window = sandbox;
  const script = /<script>([\s\S]*?)<\/script>/.exec(html)![1]!;
  runInNewContext(script, sandbox);

  const fromHost = (data: unknown): void => {
    for (const fn of windowListeners.message ?? []) fn({ source: parent, data });
  };
  const el = (id: string): Fake => {
    const node = byId.get(id);
    assert.ok(node, `no element #${id}`);
    return node;
  };
  const sent = (method: string): Message[] => posted.filter((m) => m.method === method);
  const press = (node: Fake): void => (node.listeners.click ?? []).forEach((fn) => fn({ preventDefault() {} }));
  /** Answer the page's introduction, once, with the host capabilities and context given. */
  const init = async (hostCapabilities: Record<string, unknown> = { message: {} }, hostContext: Record<string, unknown> = {}): Promise<void> => {
    const request = sent("ui/initialize")[0];
    if (request && !posted.some((m) => m.method === "ui/notifications/initialized")) {
      fromHost({ jsonrpc: "2.0", id: request.id, result: { protocolVersion: "2026-01-26", hostCapabilities, hostContext } });
      await tick();
    }
  };
  /** Hand the page a tool result exactly as given: `{ content, structuredContent?, isError? }`. */
  const result = async (params: Record<string, unknown>): Promise<void> => {
    fromHost({ jsonrpc: "2.0", method: "ui/notifications/tool-result", params });
    await tick();
  };
  return {
    el,
    sent,
    /** Every message the page posted to the host, in order. */
    posted,
    created,
    htmlAttrs,
    /** A global the page's script defined, such as mwSkin. */
    global: (name: string): unknown => sandbox[name],
    /** Every element reachable from the static markup. */
    all: (): Fake[] => {
      const out: Fake[] = [];
      const walk = (n: Fake): void => {
        out.push(n);
        n.children.forEach(walk);
      };
      for (const node of byId.values()) walk(node);
      return out;
    },
    click: (id: string): void => press(el(id)),
    press,
    fromHost,
    init,
    result,
    answer: (request: Message, value: unknown): void => fromHost({ jsonrpc: "2.0", id: request.id, result: value }),
    /** Refuse a request the page sent, with a JSON-RPC error. */
    refuse: (request: Message, message = "denied"): void =>
      fromHost({ jsonrpc: "2.0", id: request.id, error: { code: -32000, message } }),
    cancel: async (): Promise<void> => {
      fromHost({ jsonrpc: "2.0", method: "ui/notifications/tool-cancelled", params: { reason: "stopped" } });
      await tick();
    },
    /** Run every timer the page set, as if the time had passed. */
    runTimers: (): void => timers.splice(0).forEach((fn) => fn()),
    /** Answer the page's introduction (with the capabilities given) and hand it a tool result. */
    show: async (structuredContent: unknown, hostCapabilities: Record<string, unknown> = { message: {} }): Promise<void> => {
      await init(hostCapabilities);
      await result({ content: [{ type: "text", text: "the text answer" }], structuredContent });
    },
  };
}

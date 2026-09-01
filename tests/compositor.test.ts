import test from "node:test";
import assert from "node:assert/strict";
import { SidebarCompositor } from "../compositor.ts";
import type { SidebarContext } from "../types.ts";

const BEGIN = "\x1b[?2026h";
const END = "\x1b[?2026l";
const SAVE = "\x1b7";     // DECSC
const RESTORE = "\x1b8";  // DECRC

function makeCtx(): SidebarContext {
  return {
    sessionTitle: null, sessionId: null, todos: [], subagents: [],
    branch: "main", aheadCount: 0, untrackedCount: 0, workspaceFiles: [],
    cwd: "/workspace/test", model: null, thinkingLevel: null,
    contextTokens: null, contextPercent: null, contextWindow: null,
    tokensIn: 0, tokensOut: 0, cacheRead: 0, cacheWrite: 0,
    sessionCost: 0, turnCount: 0, activeTool: null, autoCompactEnabled: null,
    sessionStartMs: Date.now(), mcpServers: [], modelProvider: null,
    liveTps: null, lastTps: null, lastTurnMs: null,
  };
}

// Real prototype structure: write and doRender live on prototypes, columns is
// a prototype getter — mirroring ProcessTerminal / TuiMainScreen.
class FakeTerminal {
  writes: string[] = [];
  cols: number;
  rows: number;
  constructor(cols: number, rows: number) {
    this.cols = cols;
    this.rows = rows;
  }
  get columns() { return this.cols; }
  write(data: string) { this.writes.push(data); }
}

class FakeTui {
  terminal: FakeTerminal;
  constructor(terminal: FakeTerminal) {
    this.terminal = terminal;
  }
  doRender() {
    this.terminal.write(BEGIN + "\x1b[2Kstreaming" + END);
    this.terminal.write("\x1b[5;3H"); // frame-external cursor positioning
  }
}

function makeHarness() {
  const terminal = new FakeTerminal(120, 30);
  const raw = new FakeTui(terminal);
  // Wrap the raw renderer in the REAL proxy semantics (get wraps functions in
  // fresh forwarding closures that self-bind `this`), exactly like Pi does.
  let renderer: any = raw;
  const tui = createInteractiveTuiReference(() => renderer);
  const comp = new SidebarCompositor(tui, makeCtx, 40);
  return { terminal, tui, raw, comp };
}

/** Concatenated stream, since the tail mechanism may split writes. */
function stream(terminal: FakeTerminal): string {
  return terminal.writes.join("");
}

// Exact copy of pi-coding-agent 0.84.4 createInteractiveTuiReference: get
// wraps functions in fresh forwarding closures EVERY time, set/has forward to
// the raw renderer, non-function values pass through unchanged. This is what
// the compositor actually runs against in real Pi.
function createInteractiveTuiReference(getTui: () => any) {
  return new Proxy({}, {
    get: (_t: any, p: PropertyKey) => {
      const tui = getTui();
      const v = Reflect.get(tui, p, tui);
      if (typeof v !== "function") return v;
      let mt = tui, m = v;
      return (...args: unknown[]) => {
        const c = getTui();
        if (c !== mt) {
          const cm = Reflect.get(c, p, c);
          if (typeof cm !== "function") throw new TypeError(`TUI property ${String(p)} is not callable`);
          mt = c; m = cm;
        }
        return Reflect.apply(m, mt, args);
      };
    },
    set: (_t: any, p: PropertyKey, v: unknown) => { const tui = getTui(); return Reflect.set(tui, p, v, tui); },
    has: (_t: any, p: PropertyKey) => Reflect.has(getTui(), p),
    getPrototypeOf: () => Reflect.getPrototypeOf(getTui()),
  });
}

const STATE_SYM = Symbol.for("pi-sidebar-tui:compositor-state:v1");

function makeProxyHarness() {
  const terminal = new FakeTerminal(120, 30);
  const raw = new FakeTui(terminal);
  let renderer: any = raw;
  const proxy = createInteractiveTuiReference(() => renderer);
  return { terminal, raw, proxy, setRenderer: (r: any) => { renderer = r; } };
}

test("permanent dispatcher installs only once across reloads", () => {
  const { terminal, raw, proxy } = makeProxyHarness();
  const c1 = new SidebarCompositor(proxy, makeCtx, 40);
  c1.install();
  const permanent = raw.doRender;
  assert.ok(typeof permanent === "function");
  c1.dispose();

  const c2 = new SidebarCompositor(proxy, makeCtx, 40);
  c2.install();
  assert.equal(raw.doRender, permanent, "second install must NOT re-wrap doRender");
  c2.dispose();
});

test("reload regression: main content survives, no freeze", () => {
  const { terminal, raw, proxy } = makeProxyHarness();
  // proto render (like TuiMainScreen.doRender): writes a sync frame
  let protoCalls = 0;
  raw.doRender = () => {
    protoCalls++;
    raw.terminal.write(BEGIN + "MAIN-CONTENT" + END);
  };

  const c1 = new SidebarCompositor(proxy, makeCtx, 40);
  c1.install();
  terminal.writes.length = 0; protoCalls = 0;
  proxy.doRender();
  assert.equal(protoCalls, 1, "original render called once");
  assert.ok(stream(terminal).includes("MAIN-CONTENT"), "main content rendered");
  assert.ok(stream(terminal).includes(SAVE), "sidebar body merged");
  c1.dispose();

  // /reload: new compositor on same renderer
  const c2 = new SidebarCompositor(proxy, makeCtx, 40);
  c2.install();
  terminal.writes.length = 0; protoCalls = 0;
  proxy.doRender();
  assert.equal(protoCalls, 1, "original render called once after reload");
  assert.ok(stream(terminal).includes("MAIN-CONTENT"), "main content survives reload (no freeze)");
  assert.ok(stream(terminal).includes(SAVE), "sidebar body still merged");
  c2.dispose();
});

test("50 repeated reloads: render ok, columns/write restore, dispatcher+state stable", () => {
  const { terminal, raw, proxy } = makeProxyHarness();
  let protoCalls = 0;
  raw.doRender = () => {
    protoCalls++;
    raw.terminal.write(BEGIN + "MAIN" + END);
  };
  const first = new SidebarCompositor(proxy, makeCtx, 40);
  first.install();
  const permanent = raw.doRender;
  const stateFirst = raw[STATE_SYM];
  first.dispose();

  for (let i = 0; i < 50; i++) {
    const comp = new SidebarCompositor(proxy, makeCtx, 40);
    comp.install();
    assert.equal(terminal.columns, 120 - 40 - 1, "columns narrowed while active");
    terminal.writes.length = 0; protoCalls = 0;
    proxy.doRender();
    assert.equal(protoCalls, 1, "original render called exactly once");
    assert.ok(stream(terminal).includes("MAIN"), "main content present");
    comp.dispose();
    assert.equal(terminal.columns, 120, "columns restored after dispose");
    assert.equal(terminal.write, FakeTerminal.prototype.write, "write restored");
  }
  assert.equal(raw.doRender, permanent, "permanent dispatcher identity stable");
  assert.equal(raw[STATE_SYM], stateFirst, "state identity stable");
});

test("inactive passthrough: no sidebar drawn, dispatcher intact", () => {
  const { terminal, raw, proxy } = makeProxyHarness();
  let protoCalls = 0;
  raw.doRender = () => {
    protoCalls++;
    raw.terminal.write(BEGIN + "MAIN" + END);
  };
  const comp = new SidebarCompositor(proxy, makeCtx, 40);
  comp.install();
  const permanent = raw.doRender;
  comp.dispose();
  terminal.writes.length = 0; protoCalls = 0;
  proxy.doRender();
  assert.equal(protoCalls, 1, "passthrough still reaches original");
  assert.ok(stream(terminal).includes("MAIN"));
  assert.ok(!stream(terminal).includes(SAVE), "no sidebar body when inactive");
  assert.equal(raw.doRender, permanent, "dispatcher identity unchanged");
});

test("interop: external wrapper before sidebar is preserved", () => {
  const { terminal, raw, proxy } = makeProxyHarness();
  const P = FakeTui.prototype.doRender;
  const X = function (this: any) { this.terminal.write("X:"); return P.call(this); };
  raw.doRender = X;
  const comp = new SidebarCompositor(proxy, makeCtx, 40);
  comp.install();
  terminal.writes.length = 0;
  proxy.doRender();
  assert.ok(stream(terminal).startsWith("X:"), "external wrapper X still runs first");
  comp.dispose();
});

test("interop: external wrapper after permanent dispatcher is not clobbered on reinstall", () => {
  const { terminal, raw, proxy } = makeProxyHarness();
  const comp1 = new SidebarCompositor(proxy, makeCtx, 40);
  comp1.install();
  const permanent = raw.doRender;
  comp1.dispose();
  // external X wraps the permanent dispatcher
  const X2 = function (this: any) { this.terminal.write("X2:"); return permanent.call(raw); };
  raw.doRender = X2;
  // second sidebar install must NOT overwrite X2
  const comp2 = new SidebarCompositor(proxy, makeCtx, 40);
  comp2.install();
  assert.equal(raw.doRender, X2, "reinstall must not clobber external wrapper");
  terminal.writes.length = 0;
  proxy.doRender();
  assert.ok(stream(terminal).startsWith("X2:"), "X2 still runs");
  assert.ok(stream(terminal).includes("MAIN-CONTENT") || stream(terminal).includes("\x1b[2Kstreaming"), "sidebar still functions through X2->dispatcher");
  comp2.dispose();
});

test("interop: external wrapper while sidebar active survives dispose", () => {
  const { terminal, raw, proxy } = makeProxyHarness();
  const comp = new SidebarCompositor(proxy, makeCtx, 40);
  comp.install();
  const permanent = raw.doRender;
  const X3 = function (this: any) { this.terminal.write("X3:"); return permanent.call(raw); };
  raw.doRender = X3;
  comp.dispose();
  assert.equal(raw.doRender, X3, "dispose must not clobber external wrapper");
  terminal.writes.length = 0;
  proxy.doRender();
  assert.ok(stream(terminal).startsWith("X3:"), "X3 still runs after dispose");
});

test("renderer switching follows Pi 0.84.4 lifecycle: states are per-renderer, late dispose is safe", () => {
  const { terminal, raw, proxy, setRenderer } = makeProxyHarness();

  // Set the render behavior BEFORE install so it is captured as
  // state.originalDoRender (mirrors the real TuiMainScreen.prototype.doRender).
  let protoCalls = 0;
  raw.doRender = () => {
    protoCalls++;
    raw.terminal.write(BEGIN + "MAIN" + END);
  };

  // 1-3. renderer A active, compositor A install
  const compA = new SidebarCompositor(proxy, makeCtx, 40);
  compA.install();
  assert.equal(terminal.columns, 120 - 40 - 1, "columns narrowed while A active");
  const stateA = raw[STATE_SYM];
  assert.ok(stateA, "A owns renderer-local state");
  terminal.writes.length = 0; protoCalls = 0;
  proxy.doRender();
  assert.equal(protoCalls, 1, "original render ran once on A");
  assert.ok(stream(terminal).includes("MAIN"), "main content on A");
  assert.ok(stream(terminal).includes(SAVE), "sidebar compositing on A");

  // 4. switch proxy getTui() to a freshly created renderer B (switchTuiMode).
  //    Real Pi does NOT dispose or reinstall the compositor here.
  const rawB = new FakeTui(terminal);
  setRenderer(rawB);
  assert.ok(!Object.hasOwn(rawB, "doRender"), "B starts with no permanent dispatcher");
  assert.equal(rawB[STATE_SYM], undefined, "B starts with no renderer-local state");

  // 5-6. B not installed yet; A not disposed yet. The columns patch lives on
  //      the SHARED terminal, so it stays narrowed across the switch.
  assert.equal(terminal.columns, 120 - 40 - 1, "shared terminal remains narrowed after switch");

  // 7. simulate /reload: dispose compositor A while the proxy now points at B.
  compA.dispose();
  assert.equal(stateA.activeOwner, null, "A's saved compositorState cleared on dispose");
  assert.equal(stateA.activeRender, null, "A's activeRender delegate cleared");
  assert.equal(terminal.columns, 120, "columns restored to original width after A dispose");

  // 8-9. install compositor B
  rawB.doRender = () => {
    protoCalls++;
    rawB.terminal.write(BEGIN + "MAIN" + END);
  };
  const compB = new SidebarCompositor(proxy, makeCtx, 40);
  compB.install();
  const stateB = rawB[STATE_SYM];
  assert.ok(stateB, "B gets its own renderer-local state");
  assert.notEqual(stateA, stateB, "stateA !== stateB (per-renderer state)");
  assert.ok(Object.hasOwn(rawB, "doRender"), "B gets its own permanent dispatcher");
  assert.equal(terminal.columns, 120 - 40 - 1, "columns narrowed while B active");

  terminal.writes.length = 0; protoCalls = 0;
  proxy.doRender();
  assert.equal(protoCalls, 1, "original render runs exactly once on B");
  assert.ok(stream(terminal).includes("MAIN"), "main content on B");
  assert.ok(stream(terminal).includes(SAVE), "sidebar compositing works on B");

  // 10-11. dispose B; columns and write must restore.
  compB.dispose();
  assert.equal(terminal.columns, 120, "columns restored after B dispose");
  assert.equal(terminal.write, FakeTerminal.prototype.write, "write restored after B dispose");
});

test("install narrows columns and installs permanent doRender dispatcher", () => {
  const { terminal, tui, raw, comp } = makeHarness();
  const protoRender = FakeTui.prototype.doRender;
  comp.install();
  assert.equal(terminal.columns, 120 - 40 - 1);
  // On the real Pi proxy, Object.hasOwn(proxy, "doRender") is always false
  // (no getOwnPropertyDescriptor trap). Check the RAW renderer instead.
  assert.ok(Object.hasOwn(raw, "doRender"), "permanent dispatcher must be an own property on the raw renderer");
  assert.notEqual(raw.doRender, protoRender);
  comp.dispose();
});

test("single synchronized frame: BEGIN and END each preserved exactly once, sidebar body merged inside, cursor after END", () => {
  const { terminal, tui, comp } = makeHarness();
  comp.install();
  tui.doRender();
  const s = stream(terminal);
  assert.ok(terminal.writes.length >= 2, "chunks must stream through, not be cached whole");
  assert.equal(s.split(BEGIN).length - 1, 1, "BEGIN must be preserved exactly once");
  assert.equal(s.split(END).length - 1, 1, "END must be preserved exactly once (not swallowed)");
  assert.ok(s.indexOf(BEGIN) < s.indexOf(SAVE), "BEGIN before sidebar body");
  assert.ok(s.indexOf(SAVE) < s.indexOf(RESTORE), "sidebar body complete");
  assert.ok(s.indexOf(RESTORE) < s.indexOf(END), "full END marker after sidebar body");
  assert.ok(s.indexOf("\x1b[5;3H") > s.lastIndexOf(END), "cursor positioning after END");
  assert.equal(s.split(SAVE).length - 1, 1, "sidebar painted exactly once");
  comp.dispose();
});

test("END marker split across two chunks: exactly one complete END, sidebar before it", () => {
  const { terminal, tui, comp } = makeHarness();
  // Custom render set BEFORE install so it is wrapped by the compositor.
  tui.doRender = () => {
    tui.terminal.write(BEGIN + "\x1b[2Kabc\x1b[?2");   // END prefix, first chunk
    tui.terminal.write("026l");                          // END suffix, second chunk
    tui.terminal.write("\x1b[3;1H");
  };
  comp.install();
  tui.doRender();
  const s = stream(terminal);
  assert.equal(s.split(END).length - 1, 1, "split marker must reassemble into exactly one END");
  const lastEnd = s.lastIndexOf(END);
  assert.ok(lastEnd !== -1, "complete END must be emitted");
  assert.ok(s.slice(0, lastEnd).includes(SAVE), "sidebar body must precede END");
  assert.ok(s.indexOf("\x1b[3;1H") > lastEnd, "cursor positioning after END");
  comp.dispose();
});

test("complete END at chunk end: no marker tail is left", () => {
  const { terminal, tui, comp } = makeHarness();
  tui.doRender = () => {
    tui.terminal.write(BEGIN + "abc" + END); // END exactly at end of this chunk
    tui.terminal.write("next");
  };
  comp.install();
  tui.doRender();
  const s = stream(terminal);
  assert.equal(s.split(END).length - 1, 1, "exactly one END");
  assert.ok(s.includes("next"), "later chunk flows through");
  comp.dispose();
});

test("multiple frames: every original END preserved, sidebar body before each", () => {
  const { terminal, tui, comp } = makeHarness();
  tui.doRender = () => {
    tui.terminal.write(BEGIN + "a" + END);
    tui.terminal.write(BEGIN + "b" + END);
  };
  comp.install();
  tui.doRender();
  const s = stream(terminal);
  assert.equal(s.split(END).length - 1, 2, "both original ENDs preserved");
  assert.equal(s.split(BEGIN).length - 1, 2, "both original BEGINs preserved");
  assert.equal(s.split(SAVE).length - 1, 2, "sidebar body before every END");
  const firstEnd = s.indexOf(END);
  const secondEnd = s.lastIndexOf(END);
  assert.ok(s.slice(0, firstEnd).includes(SAVE), "body before first END");
  assert.ok(s.slice(firstEnd, secondEnd).includes(SAVE), "body before second END");
  comp.dispose();
});

test("no END marker: falls back to a standalone sidebar frame", () => {
  const { terminal, tui, comp } = makeHarness();
  tui.doRender = () => {
    tui.terminal.write("plain output without markers");
  };
  comp.install();
  tui.doRender();
  const s = stream(terminal);
  assert.ok(s.startsWith("plain output without markers"));
  const frameStart = s.indexOf(BEGIN);
  assert.ok(frameStart !== -1, "standalone frame emitted");
  assert.ok(s.endsWith(END), "standalone frame closed");
  assert.ok(s.slice(frameStart).includes(SAVE));
  comp.dispose();
});

test("standalone paint() emits one complete frame", () => {
  const { terminal, comp } = makeHarness();
  comp.install();
  comp.paint();
  assert.equal(terminal.writes.length, 1);
  assert.ok(terminal.writes[0].startsWith(BEGIN));
  assert.ok(terminal.writes[0].endsWith(END));
  assert.ok(terminal.writes[0].includes(SAVE));
  comp.dispose();
});

test("dispose restores columns/write; permanent doRender dispatcher remains as inactive passthrough", () => {
  const { terminal, tui, raw, comp } = makeHarness();
  comp.install();
  const permanent = raw.doRender; // the installed dispatcher (own property on raw renderer)
  assert.ok(Object.hasOwn(raw, "doRender"));
  assert.ok(Object.hasOwn(terminal, "columns"));
  assert.ok(!Object.hasOwn(terminal, "write"));
  comp.dispose();
  // Candidate E: the permanent dispatcher is intentionally retained on the
  // renderer (inactive passthrough). Its identity must not change.
  assert.ok(Object.hasOwn(raw, "doRender"), "permanent dispatcher stays installed");
  assert.equal(raw.doRender, permanent, "permanent dispatcher identity unchanged");
  assert.ok(!Object.hasOwn(terminal, "columns"), "columns own property removed");
  assert.equal(terminal.columns, 120, "columns getter restored");
  assert.equal(terminal.write, FakeTerminal.prototype.write, "write untouched");
  terminal.write("after-dispose");
  assert.equal(terminal.writes.at(-1), "after-dispose");
  // Inactive passthrough: render still reaches the original doRender and does
  // not draw a sidebar.
  terminal.writes.length = 0;
  tui.doRender();
  const s = stream(terminal);
  assert.ok(s.includes("\x1b[2Kstreaming"), "original render still runs through the dispatcher");
  assert.ok(!s.includes(SAVE), "no sidebar body drawn when inactive");
});

test("dispose during in-flight capture flushes pending tail and restores write", () => {
  const { terminal, tui, comp } = makeHarness();
  // Custom own doRender set BEFORE install; it becomes the dispatcher's
  // originalDoRender. During a render, dispose happens mid-capture: the
  // pending tail must be flushed and terminal.write restored.
  const customRender = () => {
    // Ordinary text (no BEGIN/END markers) that ends in a partial END_SYNC
    // prefix, so the interceptor holds back a pending tail.
    tui.terminal.write("partial...\x1b[?2");
    comp.dispose(); // capture in progress: pending tail must be flushed
    tui.terminal.write("rest");
  };
  tui.doRender = customRender;
  comp.install();
  tui.doRender();
  const s = stream(terminal);
  assert.ok(s.includes("partial...\x1b[?2rest"), "pending tail flushed, later writes pass through");
  assert.equal(terminal.write, FakeTerminal.prototype.write, "write restored to prototype");
});

test("re-entrant doRender: inner render does not end the outer capture", () => {
  const { terminal, tui, comp } = makeHarness();
  // Simulates a prototype doRender that re-enters via this.doRender() while a
  // render is in progress (this.doRender resolves to the wrapper). A guard
  // (like pi's own renderRequested/stopped flags) prevents true recursion.
  // The wrapper's capture must be opened once and closed once: the inner call
  // sees capturing=true, starts no new capture, and must not end the outer one.
  const protoRender = function (this: any) {
    if (this._rendering) return;
    this._rendering = true;
    try {
      this.terminal.write(BEGIN + "outer-a" + END);
      this.doRender(); // re-entrant through the wrapper
      this.terminal.write(BEGIN + "outer-b" + END);
    } finally {
      this._rendering = false;
    }
  };
  tui.doRender = protoRender;
  comp.install();
  tui.doRender();
  const s = stream(terminal);
  assert.equal(s.split(END).length - 1, 2, "both frames preserved");
  assert.equal(s.split(BEGIN).length - 1, 2, "both BEGINs preserved");
  assert.equal(s.split(SAVE).length - 1, 2, "sidebar body before every END");
  const firstEnd = s.indexOf(END);
  const secondEnd = s.lastIndexOf(END);
  assert.ok(s.slice(0, firstEnd).includes(SAVE), "body before first END");
  assert.ok(s.slice(firstEnd, secondEnd).includes(SAVE), "body before second END");
  assert.equal(terminal.write, FakeTerminal.prototype.write, "write restored to prototype after re-entrant render");
});

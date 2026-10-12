import test from "node:test";
import assert from "node:assert/strict";
import type { SidebarContext } from "../types.ts";
import { SidebarCompositor } from "../compositor.ts";

function makeCtx(): SidebarContext {
  return {
    sessionTitle: null,
    sessionId: null,
    todos: [],
    todosMax: 10,
    branch: "main",
    aheadCount: 0,
    untrackedCount: 0,
    workspaceFiles: [],
    cwd: "/tmp/test",
    model: null,
    thinkingLevel: null,
    contextTokens: null,
    contextPercent: null,
    contextWindow: null,
    tokensIn: 0,
    tokensOut: 0,
    cacheRead: 0,
    cacheWrite: 0,
    sessionCost: 0,
    turnCount: 0,
    activeTool: null,
    autoCompactEnabled: null,
    sessionStartMs: Date.now(),
    mcpServers: [],
    modelProvider: null,
    cavemanLevel: null,
    cavemanFrame: 0,
    agentActive: false,
    spinnerFrame: 0,
    liveTps: null,
    lastTps: null,
    lastTurnMs: null,
    ctxSamples: [],
  };
}

// A terminal whose width can change like a resized window, and a TUI whose
// render records the width it was given and erases a line the way pi-tui does.
class FakeTerminal {
  width: number;
  rows = 24;
  output = "";
  constructor(width: number) {
    this.width = width;
  }
  get columns(): number {
    return this.width;
  }
  write(data: string): void {
    this.output += data;
  }
}

function makeTui(width: number) {
  const terminal = new FakeTerminal(width);
  const tui = {
    terminal,
    renderedWidths: [] as number[],
    wheelDeltas: [] as number[],
    routeWheel(_event: any, delta: number) {
      tui.wheelDeltas.push(delta);
    },
    doRender() {
      tui.renderedWidths.push(terminal.columns);
      terminal.write("\x1b[2Kmain");
    },
  };
  return tui;
}

const SEPARATOR = "│";

function frame(tui: ReturnType<typeof makeTui>): string {
  tui.terminal.output = "";
  tui.doRender();
  return tui.terminal.output;
}

test("compositor narrows pi's width and paints the sidebar when the main area keeps its minimum", () => {
  const tui = makeTui(120);
  new SidebarCompositor(tui, makeCtx, 45, 40).install();
  const out = frame(tui);
  assert.equal(tui.renderedWidths.at(-1), 120 - 45 - 1);
  assert.ok(out.includes(SEPARATOR), "sidebar separator not painted");
});

test("compositor hands pi the full width and paints nothing when the main area would fall below its minimum", () => {
  const tui = makeTui(62);
  new SidebarCompositor(tui, makeCtx, 45, 40).install();
  const out = frame(tui);
  assert.equal(tui.renderedWidths.at(-1), 62);
  assert.ok(!out.includes(SEPARATOR), "sidebar painted on a terminal too narrow for it");
  assert.ok(out.includes("\x1b[2K"), "pi's full-line erase was rewritten although no sidebar is shown");
});

function separatorRows(out: string): number {
  return (out.match(new RegExp(`\\x1b\\[\\d+;\\d+H[^\\x1b]*\\x1b\\[2m${SEPARATOR}`, "g")) ?? []).length;
}

test("compositor brings the sidebar back, every row, when the terminal widens again", () => {
  const tui = makeTui(120);
  new SidebarCompositor(tui, makeCtx, 45, 40).install();
  frame(tui);
  tui.terminal.width = 62;
  assert.ok(!frame(tui).includes(SEPARATOR), "sidebar painted after narrowing");
  tui.terminal.width = 120;
  const out = frame(tui);
  assert.equal(tui.renderedWidths.at(-1), 74);
  assert.equal(separatorRows(out), tui.terminal.rows, "not every sidebar row repainted after widening");
});

test("compositor's standalone repaint writes nothing while the sidebar is hidden", () => {
  const tui = makeTui(62);
  const compositor = new SidebarCompositor(tui, makeCtx, 45, 40);
  compositor.install();
  tui.terminal.output = "";
  compositor.paint();
  assert.equal(tui.terminal.output, "");
});

test("compositor never hides the sidebar when the minimum main width is 0", () => {
  const tui = makeTui(50);
  new SidebarCompositor(tui, makeCtx, 45, 0).install();
  const out = frame(tui);
  assert.equal(tui.renderedWidths.at(-1), 4);
  assert.ok(out.includes(SEPARATOR));
});

test("compositor shows the sidebar when the main area is exactly its minimum", () => {
  const tui = makeTui(45 + 1 + 40);
  new SidebarCompositor(tui, makeCtx, 45, 40).install();
  frame(tui);
  assert.equal(tui.renderedWidths.at(-1), 40);
});

test("compositor leaves a wheel over the sidebar's columns to pi while the sidebar is hidden", () => {
  const tui = makeTui(62);
  new SidebarCompositor(tui, makeCtx, 45, 40).install();
  frame(tui);
  tui.routeWheel({ x: 60, y: 3 }, 1);
  assert.deepEqual(tui.wheelDeltas, [1]);
});

test("compositor keeps a wheel over the sidebar's columns from pi while the sidebar is shown", () => {
  const tui = makeTui(120);
  new SidebarCompositor(tui, makeCtx, 45, 40).install();
  frame(tui);
  tui.routeWheel({ x: 110, y: 3 }, 1);
  assert.deepEqual(tui.wheelDeltas, []);
});

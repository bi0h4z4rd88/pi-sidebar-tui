import test from "node:test";
import assert from "node:assert/strict";
import { SidebarCompositor } from "../compositor.ts";
import { renderSidebar } from "../sidebar.ts";
import type { SidebarContext } from "../types.ts";

function makeCtx(overrides: Partial<SidebarContext> = {}): SidebarContext {
  return {
    sessionTitle: null,
    sessionId: null,
    todos: [],
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
    liveTps: null,
    lastTps: null,
    lastTurnMs: null,
    ctxSamples: [],
    ...overrides,
  };
}

// 30 todos (todosMax 100) + branch-less workspace => the todos panel alone is
// taller than any realistic viewport, so it scrolls internally.
function tallCtx(): SidebarContext {
  const todos = Array.from({ length: 30 }, (_, i) => ({
    id: String(i + 1),
    content: `todo number ${i + 1}`,
    status: "pending" as const,
  }));
  return makeCtx({ todos, todosMax: 100, branch: null, workspaceFiles: [] });
}

function makeTerminal(cols: number, rows: number) {
  return {
    columns: cols,
    rows,
    writes: [] as string[],
    write(data: string) {
      this.writes.push(data);
    },
  };
}

// A fake TUI whose routeWheel records every call that falls through to it.
function makeComp(ctx: SidebarContext, rows: number, width: number, cols = 80) {
  const terminal = makeTerminal(cols, rows);
  const routeWheelCalls: { event: any; delta: number }[] = [];
  const tui: any = {
    terminal,
    mode: "fullscreen",
    doRender() {},
    routeWheel(event: any, delta: number) {
      routeWheelCalls.push({ event, delta });
    },
  };
  const comp = new SidebarCompositor(tui, () => ctx, width);
  comp.install();
  return { comp, terminal, tui, routeWheelCalls };
}

test("renderSidebar fits visibleRows (adaptive viewports) once past the min panel height", () => {
  const ctx = tallCtx();
  // The minimum total (session + headers + separators + empty content) is 22
  // rows for this context; at/above it the water-filler always fits.
  for (const visibleRows of [22, 24, 28, 39, 59, 99]) {
    const { lines } = renderSidebar(ctx, 25, visibleRows, {});
    assert.ok(lines.length <= visibleRows, `visibleRows=${visibleRows}: ${lines.length} lines > ${visibleRows}`);
  }
});

test("renderSidebar fits visibleRows even when a panel is scrolled to the middle", () => {
  const ctx = tallCtx();
  // offset=1 lands in the middle window (not at top) for the small viewports
  // where the todos panel is squeezed to vp=1 — the case that would otherwise
  // emit two indicator rows.
  for (const visibleRows of [22, 24, 28, 39]) {
    const { lines } = renderSidebar(ctx, 25, visibleRows, { todos: 1 });
    assert.ok(lines.length <= visibleRows, `visibleRows=${visibleRows}: ${lines.length} lines > ${visibleRows}`);
  }
});

test("scrollable panels fill the available rows (no dead gap) when content is plentiful", () => {
  // 15 todos (capped at 10) + 20 workspace files + 1 mcp server: enough
  // content that the scrollable panels absorb every spare row down to the cwd.
  const ctx = makeCtx({
    branch: "main",
    todos: Array.from({ length: 15 }, (_, i) => ({ id: String(i + 1), content: `todo ${i + 1}`, status: "pending" as const })),
    todosMax: 10,
    workspaceFiles: Array.from({ length: 20 }, (_, i) => ({ path: `src/f${i}.ts`, added: 1, removed: 0 })),
    mcpServers: [{ name: "ctx7", connected: true, directCount: 3, totalCount: 5, tokenEstimate: 100, disabled: false }],
  });
  for (const visibleRows of [30, 40, 50]) {
    const { lines } = renderSidebar(ctx, 25, visibleRows, {});
    assert.equal(lines.length, visibleRows, `expected panels to fill ${visibleRows} rows, got ${lines.length}`);
  }
});

test("compositor clips to the terminal on a very short window (never overflows)", () => {
  const { comp, terminal } = makeComp(tallCtx(), 10, 25);
  comp.paint();
  const seps = terminal.writes.join("").split("│").length - 1;
  assert.ok(seps <= 10, `should not overflow a 10-row terminal, got ${seps} rows`);
});

test("no overflow => all maxOffset 0 and no indicators", () => {
  const { comp, terminal } = makeComp(makeCtx({}), 40, 25);
  comp.paint();
  assert.equal(comp.getPanelMax("todos"), 0);
  const out = terminal.writes.join("");
  assert.ok(!out.includes("lines below"), "unexpected bottom indicator");
  assert.ok(!out.includes("lines above"), "unexpected top indicator");
});

test("overflowing todos => maxOffset > 0 and scrollPanelBy clamps", () => {
  const { comp } = makeComp(tallCtx(), 40, 25);
  comp.paint();
  const max = comp.getPanelMax("todos");
  assert.ok(max > 0, `expected todos maxOffset > 0, got ${max}`);
  comp.scrollPanelBy("todos", 99999);
  assert.equal(comp.getPanelOffset("todos"), max);
  comp.scrollPanelBy("todos", -99999);
  assert.equal(comp.getPanelOffset("todos"), 0);
});

test("scrolling todos shows a top indicator", () => {
  const { comp, terminal } = makeComp(tallCtx(), 40, 25);
  comp.paint();
  const max = comp.getPanelMax("todos");
  assert.ok(max > 0);
  comp.scrollPanelBy("todos", Math.max(1, Math.floor(max / 2)));
  const out = terminal.writes.join("");
  assert.ok(out.includes("lines above"), "expected top indicator after scrolling");
});

test("panelAtRow maps a todos content row to 'todos' and a session row to null", () => {
  const ctx = tallCtx();
  const { comp } = makeComp(ctx, 40, 25);
  comp.paint();
  // The compositor renders for visiblePanelRows = rows - 1 (cwd present).
  const { layout } = renderSidebar(ctx, 25, 39, {});
  const todosSlot = layout.find((s) => s.id === "todos");
  const sessionSlot = layout.find((s) => s.id === "session");
  assert.ok(todosSlot && sessionSlot, "expected todos + session slots");
  const todosRow = todosSlot!.startRow + 3; // 1-based content row (after 2 header rows)
  assert.equal(comp.panelAtRow(todosRow), "todos");
  assert.equal(comp.panelAtRow(sessionSlot!.startRow + 1), null, "session is pinned (not scrollable)");
});

test("scrollPanelAtRow scrolls the panel under the cursor, false off-panels", () => {
  const ctx = tallCtx();
  const { comp } = makeComp(ctx, 40, 25);
  comp.paint();
  const { layout } = renderSidebar(ctx, 25, 39, {});
  const todosSlot = layout.find((s) => s.id === "todos")!;
  const row = todosSlot.startRow + 3;
  assert.equal(comp.scrollPanelAtRow(row, 3), true, "should hit a panel");
  assert.ok(comp.getPanelOffset("todos") > 0, "todos should have scrolled");
  assert.equal(comp.scrollPanelAtRow(999, 3), false, "off-panel row should miss");
});

test("scrollFocused targets the first scrollable panel by default", () => {
  const { comp } = makeComp(tallCtx(), 40, 25);
  comp.paint();
  assert.equal(comp.getFocusedPanel(), "todos", "first scrollable present should be todos");
  assert.equal(comp.scrollFocused(2), true);
  assert.ok(comp.getPanelOffset("todos") > 0);
});

test("mouse wheel over sidebar scrolls the panel and consumes; over main falls through", () => {
  const ctx = tallCtx();
  const { comp, tui, routeWheelCalls } = makeComp(ctx, 40, 25);
  comp.paint();
  const { layout } = renderSidebar(ctx, 25, 39, {});
  const todosSlot = layout.find((s) => s.id === "todos")!;
  const y0 = todosSlot.startRow + 2; // 0-based y for a todos content row
  // sepCol = 80 - 25 = 55 (1-based); sidebar 0-based x >= 54.
  tui.routeWheel({ x: 60, y: y0, direction: 1, button: 0 }, 3);
  assert.ok(comp.getPanelOffset("todos") > 0, "todos should scroll from the wheel");
  assert.equal(comp.getFocusedPanel(), "todos", "wheel should focus the panel it scrolled");
  assert.equal(routeWheelCalls.length, 0, "sidebar wheel should be consumed");
  tui.routeWheel({ x: 5, y: 5, direction: 1, button: 0 }, 3);
  assert.equal(routeWheelCalls.length, 1, "main-viewport wheel should fall through");
});

test("dispose restores the original routeWheel", () => {
  const ctx = tallCtx();
  const terminal = makeTerminal(80, 40);
  const routeWheelCalls: number[] = [];
  const tui: any = {
    terminal,
    mode: "fullscreen",
    doRender() {},
    routeWheel() {
      routeWheelCalls.push(1);
    },
  };
  const original = tui.routeWheel;
  const comp = new SidebarCompositor(tui, () => ctx, 25);
  comp.install();
  assert.notEqual(tui.routeWheel, original, "routeWheel should be wrapped");
  comp.dispose();
  assert.equal(tui.routeWheel, original, "routeWheel should be restored on dispose");
  // After dispose, the original handles everything (records the call).
  tui.routeWheel({ x: 60, y: 5, direction: 1, button: 0 }, 3);
  assert.equal(routeWheelCalls.length, 1);
});

test("doRender wrapper forces full repaint when pi emits a cursor-scroll sequence", () => {
  const terminal = makeTerminal(80, 15);
  let emitScrollSeq = false;
  const tui: any = {
    terminal,
    mode: "fullscreen",
    doRender() {
      if (emitScrollSeq) terminal.write("\x1bM");
    },
  };
  const comp = new SidebarCompositor(tui, () => makeCtx({}), 25);
  comp.install();
  const countSeps = () => terminal.writes.join("").split("│").length - 1;

  tui.doRender();
  assert.equal(countSeps(), 15, "first render should paint all rows");

  terminal.writes.length = 0;
  tui.doRender();
  assert.equal(countSeps(), 0, "unchanged render should paint no rows");

  emitScrollSeq = true;
  terminal.writes.length = 0;
  tui.doRender();
  assert.equal(countSeps(), 15, "scroll sequence should force a full repaint");

  comp.dispose();
});

test("doRender wrapper keeps pi's full-line erase instead of rewriting it", () => {
  const terminal = makeTerminal(80, 15);
  const tui: any = {
    terminal,
    mode: "fullscreen",
    doRender() {
      terminal.write("\x1b[10;1H\x1b[2Ktyped text");
    },
  };
  const comp = new SidebarCompositor(tui, () => makeCtx({}), 25);
  comp.install();

  tui.doRender();
  const out = terminal.writes.join("");
  assert.ok(out.includes("\x1b[2Ktyped text"), "pi's \\x1b[2K should reach the terminal unchanged");
  assert.ok(!/\x1b\[\d+Xtyped text/.test(out), "\\x1b[2K must not be rewritten into a bounded erase");

  comp.dispose();
});

test("doRender wrapper repaints the sidebar when pi erases a full line", () => {
  const terminal = makeTerminal(80, 15);
  let erase = false;
  const tui: any = {
    terminal,
    mode: "fullscreen",
    doRender() {
      if (erase) terminal.write("\x1b[10;1H\x1b[2Ktyped text");
    },
  };
  const comp = new SidebarCompositor(tui, () => makeCtx({}), 25);
  comp.install();
  const countSeps = () => terminal.writes.join("").split("│").length - 1;

  tui.doRender();
  assert.equal(countSeps(), 15, "first render should paint all rows");

  terminal.writes.length = 0;
  tui.doRender();
  assert.equal(countSeps(), 0, "unchanged render should paint no rows");

  // A full-line erase also clears the sidebar columns on that row, so the
  // sidebar has to be repainted in the same frame.
  erase = true;
  terminal.writes.length = 0;
  tui.doRender();
  assert.equal(countSeps(), 15, "a full-line erase should force a full sidebar repaint");

  comp.dispose();
});

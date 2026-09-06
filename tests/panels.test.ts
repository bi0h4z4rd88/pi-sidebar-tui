import test from "node:test";
import assert from "node:assert/strict";
import { visibleWidth } from "@earendil-works/pi-tui";
import type { SidebarContext, TodoItem, SubagentEntry, WorkspaceFile } from "../types.ts";
import { renderSessionPanel, estimateCtxLeft } from "../panels/session.ts";
import { renderTodosPanel } from "../panels/todos.ts";
import { renderSubagentsPanel } from "../panels/subagents.ts";
import { renderWorkspacePanel } from "../panels/workspace.ts";

function strip(s: string): string {
  return s.replace(/\x1b\[[0-9;]*m/g, "");
}

function makeCtx(overrides: Partial<SidebarContext> = {}): SidebarContext {
  return {
    sessionTitle: null,
    sessionId: null,
    todos: [],
    subagents: [],
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

// ─── Session panel ────────────────────────────────────────────────────────────

test("session panel: no title shows placeholder", () => {
  const ctx = makeCtx({ sessionTitle: null });
  const lines = renderSessionPanel(ctx, 40);
  const text = lines.map(strip).join("\n");
  assert.ok(text.includes("waiting for first message"), `missing placeholder, got: ${text}`);
});

test("session panel: title appears in output", () => {
  const ctx = makeCtx({ sessionTitle: "Fix the auth bug" });
  const lines = renderSessionPanel(ctx, 40);
  const text = lines.map(strip).join("\n");
  assert.ok(text.includes("Fix the auth bug"), `title missing, got: ${text}`);
});

test("session panel: title truncated when wider than width-2", () => {
  const ctx = makeCtx({ sessionTitle: "a".repeat(100) });
  const lines = renderSessionPanel(ctx, 20);
  for (const line of lines) {
    assert.ok(visibleWidth(strip(line)) <= 20, `line too wide: "${strip(line)}"`);
  }
  const titleLine = lines
    .map(strip)
    .find(l => l.trim().length > 0 && !l.includes("Session") && !l.includes("─"));
  assert.ok(titleLine !== undefined, "no title line found");
  assert.ok(titleLine.includes("…"), `title not truncated: "${titleLine}"`);
});

test("session panel: header line contains 'Session'", () => {
  const ctx = makeCtx({});
  const lines = renderSessionPanel(ctx, 40);
  assert.ok(lines.map(strip).some(l => l.includes("Session")));
});

// ─── Session panel: context bar ───────────────────────────────────────────────

test("session panel: context renders as fill bar with rounded pct label", () => {
  const ctx = makeCtx({ contextPercent: 40, contextTokens: 80000, contextWindow: 200000 });
  const text = renderSessionPanel(ctx, 40).map(strip).join("\n");
  assert.ok(text.includes("█"), `missing fill bar, got: ${text}`);
  assert.ok(text.includes("40%"), `missing rounded pct label, got: ${text}`);
});

test("session panel: context detail line shows token counts + unit", () => {
  const ctx = makeCtx({ contextPercent: 40, contextTokens: 80000, contextWindow: 200000 });
  const text = renderSessionPanel(ctx, 40).map(strip).join("\n");
  assert.ok(text.includes("80k / 200k"), `missing token counts, got: ${text}`);
  assert.ok(text.includes("tokens"), `missing 'tokens' unit, got: ${text}`);
});

test("session panel: context detail line includes auto-compact status", () => {
  const ctx = makeCtx({ contextPercent: 40, contextTokens: 80000, contextWindow: 200000, autoCompactEnabled: true });
  const text = renderSessionPanel(ctx, 40).map(strip).join("\n");
  assert.ok(text.includes("auto-compact on"), `missing auto-compact status, got: ${text}`);
});

test("session panel: context bar fits within width at high usage", () => {
  const ctx = makeCtx({ contextPercent: 95, contextTokens: 190000, contextWindow: 200000 });
  const lines = renderSessionPanel(ctx, 30);
  for (const line of lines) {
    assert.ok(visibleWidth(strip(line)) <= 30, `line too wide: "${strip(line)}"`);
  }
});

test("session panel: context bar leaves 2 cols clear on the right", () => {
  const ctx = makeCtx({ contextPercent: 95, contextTokens: 190000, contextWindow: 200000 });
  const barLine = renderSessionPanel(ctx, 40).map(strip).find(l => l.includes("█"));
  assert.ok(barLine !== undefined, "no bar line found");
  assert.equal(visibleWidth(barLine), 38, `bar line should leave 2 cols clear, got width ${visibleWidth(barLine)}`);
});

test("session panel: no bar when context data absent", () => {
  const text = renderSessionPanel(makeCtx({}), 40).map(strip).join("\n");
  assert.ok(!text.includes("█"), `bar should not render without context, got: ${text}`);
});

// ─── Session panel: context estimate ──────────────────────────────────────────

const S = (tokens: number, turns: number) => ({ tokens, turns });

test("estimateCtxLeft: unknown with fewer than 2 samples", () => {
  assert.deepEqual(estimateCtxLeft([], 100000, 200000), { kind: "unknown" });
  assert.deepEqual(estimateCtxLeft([S(100, 1)], 100000, 200000), { kind: "unknown" });
});

test("estimateCtxLeft: unknown when turn count does not advance", () => {
  assert.deepEqual(estimateCtxLeft([S(100, 5), S(200, 5)], 100000, 200000), { kind: "unknown" });
});

test("estimateCtxLeft: unknown without context data", () => {
  assert.deepEqual(estimateCtxLeft([S(100, 1), S(200, 2)], null, 200000), { kind: "unknown" });
  assert.deepEqual(estimateCtxLeft([S(100, 1), S(200, 2)], 100000, null), { kind: "unknown" });
});

test("estimateCtxLeft: stable when context not growing", () => {
  assert.deepEqual(estimateCtxLeft([S(100, 1), S(100, 5)], 100000, 200000), { kind: "stable" });
  assert.deepEqual(estimateCtxLeft([S(200, 1), S(100, 5)], 100000, 200000), { kind: "stable" });
});

test("estimateCtxLeft: computes turns remaining from recent pace", () => {
  // pace: (400-200)/(4-2) = 100 tokens/turn; remaining 50000 → 500 turns
  assert.deepEqual(estimateCtxLeft([S(200, 2), S(400, 4)], 150000, 200000), { kind: "left", turns: 500 });
});

test("estimateCtxLeft: pace from first/last of buffer, middle noise ignored", () => {
  // pace: (300-100)/(3-0) = 66.7/turn; remaining 100000 → 1500
  const r = estimateCtxLeft([S(100, 0), S(5000, 1), S(150, 2), S(300, 3)], 100000, 200000);
  assert.deepEqual(r, { kind: "left", turns: 1500 });
});

test("estimateCtxLeft: full window yields 0 turns left", () => {
  assert.deepEqual(estimateCtxLeft([S(100, 1), S(300, 2)], 200000, 200000), { kind: "left", turns: 0 });
});

// ─── Session panel: left / cost rows ─────────────────────────────────────────

// Fallback hex codes (no pi theme in tests): muted=#6c6c6c accent=#febc38 warning=#ff9500
const HEX_MUTED = "38;2;108;108;108";
const HEX_ACCENT = "38;2;254;188;56";
const HEX_WARNING = "38;2;255;149;0";

function leftRow(ctx: SidebarContext, width = 40): { raw: string; text: string } | undefined {
  const lines = renderSessionPanel(ctx, width);
  const i = lines.findIndex(l => strip(l).includes("left"));
  return i === -1 ? undefined : { raw: lines[i], text: strip(lines[i]) };
}

function makeCtxEst(overrides: Partial<SidebarContext> = {}): SidebarContext {
  return makeCtx({
    contextTokens: 190000,
    contextWindow: 200000,
    contextPercent: 95,
    turnCount: 2,
    tokensIn: 1000,
    cacheRead: 870,
    sessionCost: 1.234,
    ctxSamples: [S(187500, 1), S(190000, 2)], // pace 2500/turn, remaining 10000 → 4 turns
    ...overrides,
  });
}

test("session panel: left row shows estimated turns with ≈Nt value", () => {
  const row = leftRow(makeCtxEst());
  assert.ok(row, "no left row found");
  assert.ok(row!.text.includes("≈4t"), `expected ≈4t, got: "${row!.text}"`);
});

test("session panel: left row value is warning red when < 5 turns", () => {
  const row = leftRow(makeCtxEst());
  assert.ok(row, "no left row found");
  assert.ok(row!.raw.includes(HEX_WARNING), `expected warning color, got: "${row!.raw}"`);
});

test("session panel: left row value is accent when 5-19 turns", () => {
  // pace 625/turn → remaining 10000 → 16 turns
  const row = leftRow(makeCtxEst({ ctxSamples: [S(100000, 0), S(100625, 1)] }));
  assert.ok(row, "no left row found");
  assert.ok(row!.text.includes("≈16t"), `expected ≈16t, got: "${row!.text}"`);
  assert.ok(row!.raw.includes(HEX_ACCENT), `expected accent color, got: "${row!.raw}"`);
});

test("session panel: left row value is muted when >= 20 turns", () => {
  // pace 250/turn → remaining 10000 → 40 turns
  const row = leftRow(makeCtxEst({ ctxSamples: [S(100000, 0), S(100250, 1)] }));
  assert.ok(row, "no left row found");
  assert.ok(row!.text.includes("≈40t"), `expected ≈40t, got: "${row!.text}"`);
  assert.ok(row!.raw.includes(HEX_MUTED), `expected muted color, got: "${row!.raw}"`);
});

test("session panel: left row shows NA when no samples", () => {
  const row = leftRow(makeCtxEst({ ctxSamples: [] }));
  assert.ok(row, "no left row found");
  assert.ok(row!.text.includes("—"), `expected NA, got: "${row!.text}"`);
});

test("session panel: left row shows infinity when pace flat", () => {
  const row = leftRow(makeCtxEst({ ctxSamples: [S(100000, 1), S(100000, 5)] }));
  assert.ok(row, "no left row found");
  assert.ok(row!.text.includes("∞"), `expected ∞, got: "${row!.text}"`);
});

test("session panel: cost row sits under cache row (col2 order)", () => {
  const lines = renderSessionPanel(makeCtxEst(), 40).map(strip);
  const cacheIdx = lines.findIndex(l => l.includes("cache"));
  const costIdx = lines.findIndex(l => l.includes("cost"));
  assert.ok(cacheIdx !== -1 && costIdx !== -1, "cache/cost rows missing");
  assert.ok(costIdx > cacheIdx, `expected cost under cache (cache=${cacheIdx}, cost=${costIdx})`);
  const costLine = lines[costIdx];
  assert.ok(costLine.includes("$1.234"), `cost value missing, got: "${costLine}"`);
});

test("session panel: left row sits under turns row (col1 order)", () => {
  const lines = renderSessionPanel(makeCtxEst(), 40).map(strip);
  const turnsIdx = lines.findIndex(l => l.includes("turns"));
  const leftIdx = lines.findIndex(l => l.includes("left"));
  assert.ok(turnsIdx !== -1 && leftIdx !== -1, "turns/left rows missing");
  assert.ok(leftIdx > turnsIdx, `expected left under turns (turns=${turnsIdx}, left=${leftIdx})`);
});

// ─── Session panel: pace-aware context bar ───────────────────────────────────

function barLine(ctx: SidebarContext, width = 40): string | undefined {
  return renderSessionPanel(ctx, width).find(l => strip(l).includes("█"));
}

const HEX_SUCCESS = "38;2;95;175;95";

test("ctx bar: escalates to warning when estimate < 5 turns despite low pct", () => {
  // pct 40 (would be success) but pace 2500/turn, remaining 10000 → 4 turns
  const ctx = makeCtxEst({ contextTokens: 190000, contextPercent: 40, ctxSamples: [S(187500, 1), S(190000, 2)] });
  const bar = barLine(ctx);
  assert.ok(bar, "no bar line");
  assert.ok(bar!.includes(HEX_WARNING), `expected warning bar, got: "${bar}"`);
});

test("ctx bar: escalates to accent when estimate 5-19 turns", () => {
  const ctx = makeCtxEst({ contextPercent: 40, ctxSamples: [S(100000, 0), S(100625, 1)] }); // 16 turns
  const bar = barLine(ctx);
  assert.ok(bar, "no bar line");
  assert.ok(bar!.includes(HEX_ACCENT), `expected accent bar, got: "${bar}"`);
});

test("ctx bar: stays success when estimate >= 20 turns and pct low", () => {
  const ctx = makeCtxEst({ contextPercent: 40, ctxSamples: [S(100000, 0), S(100250, 1)] }); // 40 turns
  const bar = barLine(ctx);
  assert.ok(bar, "no bar line");
  assert.ok(bar!.includes(HEX_SUCCESS), `expected success bar, got: "${bar}"`);
});

test("ctx bar: pct-based warning still applies without samples", () => {
  const ctx = makeCtxEst({ contextPercent: 95, ctxSamples: [] });
  const bar = barLine(ctx);
  assert.ok(bar, "no bar line");
  assert.ok(bar!.includes(HEX_WARNING), `expected warning bar, got: "${bar}"`);
});

test("session panel: left row fits width at narrow sidebar", () => {
  const ctx = makeCtxEst();
  const lines = renderSessionPanel(ctx, 30);
  for (const line of lines) {
    assert.ok(visibleWidth(strip(line)) <= 30, `line too wide: "${strip(line)}"`);
  }
});

// ─── Todos panel ─────────────────────────────────────────────────────────────

test("todos panel: empty shows (no todos)", () => {
  const lines = renderTodosPanel(makeCtx({ todos: [] }), 40);
  assert.ok(lines.map(strip).join("\n").includes("no todos"));
});

test("todos panel: header count is done/total", () => {
  const ctx = makeCtx({
    todos: [
      { id: "1", content: "done", status: "completed" },
      { id: "2", content: "active", status: "in_progress" },
      { id: "3", content: "pending", status: "pending" },
    ],
  });
  const header = strip(renderTodosPanel(ctx, 40)[0]);
  assert.ok(header.includes("1/3"), `expected "1/3" in header, got: "${header}"`);
});

test("todos panel: all pending count is 0/N", () => {
  const ctx = makeCtx({
    todos: [
      { id: "1", content: "a", status: "pending" },
      { id: "2", content: "b", status: "pending" },
    ],
  });
  const header = strip(renderTodosPanel(ctx, 40)[0]);
  assert.ok(header.includes("0/2"), `expected "0/2", got: "${header}"`);
});

test("todos panel: correct glyphs for each status", () => {
  const ctx = makeCtx({
    todos: [
      { id: "1", content: "done", status: "completed" },
      { id: "2", content: "active", status: "in_progress" },
      { id: "3", content: "pending", status: "pending" },
    ],
  });
  const text = renderTodosPanel(ctx, 60).map(strip).join("\n");
  assert.ok(text.includes("✓"), "missing ✓ for completed");
  assert.ok(text.includes("●"), "missing ● for in_progress");
  assert.ok(text.includes("○"), "missing ○ for pending");
});

test("todos panel: in-progress shows sub-action parenthetical", () => {
  const ctx = makeCtx({
    todos: [
      { id: "1", content: "my task", status: "in_progress", subAction: "running subtask" },
    ],
  });
  const text = renderTodosPanel(ctx, 60).map(strip).join("\n");
  assert.ok(text.includes("running subtask"), `sub-action missing, got: ${text}`);
});

test("todos panel: no line exceeds width", () => {
  const ctx = makeCtx({
    todos: [{ id: "1", content: "a".repeat(100), status: "pending" }],
  });
  const lines = renderTodosPanel(ctx, 20);
  for (const line of lines) {
    assert.ok(visibleWidth(strip(line)) <= 20, `line too wide: "${strip(line)}"`);
  }
});

test("todos panel: todo lines indented 1 space from side border", () => {
  const ctx = makeCtx({ todos: [{ id: "1", content: "Task A", status: "pending" }] });
  const s = strip(renderTodosPanel(ctx, 40).find((l) => strip(l).includes("Task A"))!);
  assert.ok(s.startsWith(" ") && !s.startsWith("  "), `todo line indent != 1: "${s}"`);
});

// ─── Subagents panel ──────────────────────────────────────────────────────────

function makeAgent(overrides: Partial<SubagentEntry> = {}): SubagentEntry {
  return {
    id: "a1",
    name: "test-agent",
    status: "running",
    startedAt: Date.now() - 3000,
    turns: 1,
    toolCount: 2,
    tokens: 8000,
    toolLog: [],
    ...overrides,
  };
}

test("subagents panel: empty shows (no subagents)", () => {
  const lines = renderSubagentsPanel(makeCtx({ subagents: [] }), 60);
  assert.ok(lines.map(strip).join("\n").includes("no subagents"));
});

test("subagents panel: running agent has no checkmark", () => {
  const ctx = makeCtx({ subagents: [makeAgent({ status: "running" })] });
  const text = renderSubagentsPanel(ctx, 60).map(strip).join("\n");
  assert.ok(!text.includes("✓"), `unexpected ✓ in running agent output`);
  assert.ok(text.includes("running"), `missing "running" status`);
});

test("subagents panel: completed agent shows checkmark", () => {
  const ctx = makeCtx({
    subagents: [makeAgent({
      status: "completed",
      startedAt: Date.now() - 8000,
      completedAt: Date.now(),
      turns: 3, toolCount: 12, tokens: 45000,
    })],
  });
  const text = renderSubagentsPanel(ctx, 60).map(strip).join("\n");
  assert.ok(text.includes("✓"), "missing ✓ for completed agent");
  assert.ok(text.includes("complete"), `missing "complete" status`);
});

test("subagents panel: completed meta line includes duration", () => {
  const ctx = makeCtx({
    subagents: [makeAgent({
      status: "completed",
      startedAt: Date.now() - 8000,
      completedAt: Date.now(),
      turns: 3, toolCount: 12, tokens: 45000,
    })],
  });
  const text = renderSubagentsPanel(ctx, 60).map(strip).join("\n");
  assert.ok(text.includes("3 turns"), `missing turns in meta`);
  assert.ok(text.includes("12 tools"), `missing tools in meta`);
});

test("subagents panel: running meta line has no duration suffix", () => {
  const ctx = makeCtx({
    subagents: [makeAgent({
      status: "running",
      startedAt: Date.now() - 3000,
      turns: 1, toolCount: 2, tokens: 8000,
    })],
  });
  const lines = renderSubagentsPanel(ctx, 60);
  const metaLine = lines.map(strip).find(l => l.includes("turns") && l.includes("tools"));
  assert.ok(metaLine !== undefined, "no meta line found");
  // Duration suffix (e.g. "· 3s") should NOT appear in meta for running agents
  // The status line shows "running (3s)" instead
  assert.ok(!metaLine.match(/·\s+\d+s$/), `unexpected duration suffix in running meta: "${metaLine}"`);
});

test("subagents panel: parallel label only with 2+ running", () => {
  const running1 = makeAgent({ id: "a1", name: "agent-1", status: "running" });
  const running2 = makeAgent({ id: "a2", name: "agent-2", status: "running" });
  const done = makeAgent({ id: "a3", name: "agent-3", status: "completed", completedAt: Date.now() });

  const oneRunning = makeCtx({ subagents: [running1, done] });
  assert.ok(
    !renderSubagentsPanel(oneRunning, 60).map(strip).join("\n").includes("parallel"),
    "parallel shown with only 1 running"
  );

  const twoRunning = makeCtx({ subagents: [running1, running2] });
  assert.ok(
    renderSubagentsPanel(twoRunning, 60).map(strip).join("\n").includes("parallel"),
    "parallel not shown with 2 running"
  );
});

test("subagents panel: tool log shows at most 3 lines", () => {
  const ctx = makeCtx({
    subagents: [makeAgent({
      status: "running",
      toolLog: ["read: a.ts", "bash: ls", "write: b.ts", "bash: git status"],
    })],
  });
  const lines = renderSubagentsPanel(ctx, 60);
  const toolLines = lines.filter(l => {
    const t = strip(l).trim();
    return t.includes(":") && (
      t.startsWith("read") || t.startsWith("bash") ||
      t.startsWith("write") || t.startsWith("edit")
    );
  });
  assert.equal(toolLines.length, 3, `expected 3 tool lines, got ${toolLines.length}`);
});

test("subagents panel: no line exceeds width", () => {
  const ctx = makeCtx({
    subagents: [makeAgent({
      name: "a".repeat(80),
      toolLog: ["read: " + "b".repeat(80)],
    })],
  });
  const lines = renderSubagentsPanel(ctx, 30);
  for (const line of lines) {
    assert.ok(visibleWidth(strip(line)) <= 30, `line too wide: "${strip(line)}"`);
  }
});

// ─── Workspace panel ──────────────────────────────────────────────────────────

test("workspace panel: no git repo shows message", () => {
  const ctx = makeCtx({ branch: null, workspaceFiles: [] });
  const text = renderWorkspacePanel(ctx, 40).map(strip).join("\n");
  assert.ok(text.includes("not a git repo"), `got: ${text}`);
});

test("workspace panel: clean repo shows (clean)", () => {
  const ctx = makeCtx({ branch: "main", workspaceFiles: [] });
  const text = renderWorkspacePanel(ctx, 40).map(strip).join("\n");
  assert.ok(text.includes("clean"), `got: ${text}`);
});

test("workspace panel: additions-only shows +N not -0", () => {
  const ctx = makeCtx({
    branch: "main",
    workspaceFiles: [{ path: "src/foo.ts", added: 29, removed: 0 }],
  });
  const text = renderWorkspacePanel(ctx, 40).map(strip).join("\n");
  assert.ok(text.includes("+29"), `missing +29, got: ${text}`);
  assert.ok(!text.includes("-0"), `unexpected -0, got: ${text}`);
});

test("workspace panel: additions and deletions shows +N -M", () => {
  const ctx = makeCtx({
    branch: "main",
    workspaceFiles: [{ path: "src/bar.ts", added: 12, removed: 3 }],
  });
  const text = renderWorkspacePanel(ctx, 40).map(strip).join("\n");
  assert.ok(text.includes("+12"), `missing +12, got: ${text}`);
  assert.ok(text.includes("-3"), `missing -3, got: ${text}`);
});

test("workspace panel: 16 files capped to 15", () => {
  const files: WorkspaceFile[] = Array.from({ length: 16 }, (_, i) => ({
    path: `src/file${i}.ts`,
    added: 1,
    removed: 0,
  }));
  const ctx = makeCtx({ branch: "main", workspaceFiles: files });
  const lines = renderWorkspacePanel(ctx, 50);
  const fileLines = lines.filter(l => strip(l).includes("src/file"));
  assert.equal(fileLines.length, 15, `expected 15 file lines, got ${fileLines.length}`);
});

test("workspace panel: header contains branch name", () => {
  const ctx = makeCtx({ branch: "feature/my-branch", workspaceFiles: [] });
  const header = strip(renderWorkspacePanel(ctx, 60)[0]);
  assert.ok(header.includes("feature/my-branch"), `branch missing from header: "${header}"`);
});

test("workspace panel: no line exceeds width", () => {
  const ctx = makeCtx({
    branch: "very-long-branch-name-that-is-quite-wordy",
    aheadCount: 99,
    untrackedCount: 99,
    workspaceFiles: [{ path: "src/" + "a".repeat(80) + ".ts", added: 999, removed: 999 }],
  });
  const lines = renderWorkspacePanel(ctx, 30);
  for (const line of lines) {
    assert.ok(visibleWidth(strip(line)) <= 30, `line too wide: "${strip(line)}"`);
  }
});

test("workspace panel: file lines indented 1 space from side border", () => {
  const ctx = makeCtx({ branch: "main", workspaceFiles: [{ path: "src/foo.ts", added: 5, removed: 0 }] });
  const s = strip(renderWorkspacePanel(ctx, 40).find((l) => strip(l).includes("src/foo.ts"))!);
  assert.ok(s.startsWith(" ") && !s.startsWith("  "), `file line indent != 1: "${s}"`);
});

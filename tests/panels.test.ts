import test from "node:test";
import assert from "node:assert/strict";
import { visibleWidth } from "@earendil-works/pi-tui";
import type { SidebarContext, TodoItem, SubagentEntry, WorkspaceFile } from "../types.ts";
import { renderSessionPanel } from "../panels/session.ts";
import { renderTodosPanel } from "../panels/todos.ts";
import { renderSubagentsPanel } from "../panels/subagents.ts";
import { renderWorkspacePanel } from "../panels/workspace.ts";

function strip(s: string): string {
  return s.replace(/\x1b\[[0-9;]*m/g, "");
}

function makeCtx(overrides: Partial<SidebarContext> = {}): SidebarContext {
  return {
    sessionTitle: null,
    todos: [],
    subagents: [],
    branch: "main",
    aheadCount: 0,
    untrackedCount: 0,
    workspaceFiles: [],
    cwd: "/tmp/test",
    model: null,
    contextPercent: null,
    contextWindow: null,
    mcpServers: null,
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

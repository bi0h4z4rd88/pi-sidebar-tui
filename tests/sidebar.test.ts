import test from "node:test";
import assert from "node:assert/strict";
import { visibleWidth } from "@earendil-works/pi-tui";
import type { SidebarContext } from "../types.ts";
import { renderSidebar } from "../sidebar.ts";

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
    thinkingLevel: null,
    contextTokens: null,
    contextPercent: null,
    contextWindow: null,
    tokensIn: 0,
    tokensOut: 0,
    cacheRead: 0,
    sessionCost: 0,
    turnCount: 0,
    activeTool: null,
    autoCompactEnabled: null,
    sessionStartMs: Date.now(),
    mcpServers: [],
    ...overrides,
  };
}

test("sidebar stacks all 4 panels", () => {
  const ctx = makeCtx({});
  const lines = renderSidebar(ctx, 40);
  const text = lines.map(strip).join("\n");
  assert.ok(text.includes("Session"), "missing Session panel");
  assert.ok(text.includes("Todos"), "missing Todos panel");
  assert.ok(text.includes("Async Subagents"), "missing Subagents panel");
  assert.ok(text.includes("Workspace"), "missing Workspace panel");
});

test("sidebar has blank separator lines between panels", () => {
  const ctx = makeCtx({});
  const lines = renderSidebar(ctx, 40);
  assert.ok(lines.some(l => strip(l).trim() === ""), "no blank separator line found");
});

test("sidebar all lines at most configured width", () => {
  const ctx = makeCtx({
    sessionTitle: "a".repeat(200),
    todos: [{ id: "1", content: "b".repeat(200), status: "in_progress" }],
  });
  const lines = renderSidebar(ctx, 30);
  for (const line of lines) {
    const w = visibleWidth(strip(line));
    assert.ok(w <= 30, `line too wide (${w}): "${strip(line)}"`);
  }
});

test("sidebar width=1 does not throw", () => {
  const ctx = makeCtx({});
  assert.doesNotThrow(() => renderSidebar(ctx, 1));
});

test("sidebar empty states for all panels render without error", () => {
  const ctx = makeCtx({
    sessionTitle: null,
    todos: [],
    subagents: [],
    branch: null,
    workspaceFiles: [],
  });
  const lines = renderSidebar(ctx, 36);
  assert.ok(lines.length > 0);
  const text = lines.map(strip).join("\n");
  assert.ok(text.includes("waiting for first message"));
  assert.ok(text.includes("no todos"));
  assert.ok(text.includes("no subagents"));
  assert.ok(text.includes("not a git repo"));
});

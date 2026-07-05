import test from "node:test";
import assert from "node:assert/strict";
import { visibleWidth } from "@earendil-works/pi-tui";
import type { SidebarContext, TodoItem, SubagentEntry, WorkspaceFile } from "../types.ts";
import { renderSessionPanel } from "../panels/session.ts";

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

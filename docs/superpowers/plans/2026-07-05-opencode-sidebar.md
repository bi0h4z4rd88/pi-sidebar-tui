# OpenCode Sidebar TUI Extension Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a standalone pi extension package that renders a fixed-width right-column sidebar with four live-updating panels: Session, Todos, Async Subagents, and Workspace.

**Architecture:** Each panel is a pure function `(ctx: SidebarContext, width: number) => string[]`. `sidebar.ts` stacks them with blank-line separators. `index.ts` wires pi events into module-level state and registers a widget that calls `renderSidebar()` on each render tick.

**Tech Stack:** TypeScript (ESM, `--experimental-strip-types`), `@earendil-works/pi-tui` (`truncateToWidth`, `visibleWidth`), `node:child_process` (workspace git queries), `node:test` + `node:assert/strict` (tests).

## Global Constraints

- No runtime dependency on `pi-sidebar`; peer-depend on `@earendil-works/pi-tui` and `@earendil-works/pi-coding-agent`
- All files are `.ts` (ESM); imports use `.ts` extensions
- Sidebar default width: 36 columns
- Test runner: `node --experimental-strip-types --test tests/**/*.test.ts`
- ANSI stripped in test assertions via `s.replace(/\x1b\[[0-9;]*m/g, "")`
- `truncateToWidth` and `visibleWidth` imported from `@earendil-works/pi-tui`
- All lines returned from any panel/sidebar function must satisfy `visibleWidth(line) <= width`
- No `console.log` in non-test code; suppress errors silently or use `console.debug`

---

### Task 1: Package scaffold and types

**Files:**
- Create: `package.json`
- Create: `types.ts`

**Interfaces:**
- Produces: `TodoStatus`, `TodoItem`, `SubagentStatus`, `SubagentEntry`, `WorkspaceFile`, `SidebarContext` (used by every subsequent task)

- [ ] **Step 1: Create `package.json`**

```json
{
  "name": "pi-sidebar-tui",
  "version": "0.1.0",
  "description": "OpenCode-style sidebar TUI extension for pi coding agent",
  "type": "module",
  "files": [
    "*.ts",
    "panels/**/*.ts"
  ],
  "keywords": ["pi-package", "pi", "coding-agent", "sidebar", "tui"],
  "license": "MIT",
  "scripts": {
    "test": "node --experimental-strip-types --test 'tests/**/*.test.ts'"
  },
  "peerDependencies": {
    "@earendil-works/pi-coding-agent": ">=0.74.0",
    "@earendil-works/pi-tui": ">=0.74.0"
  },
  "devDependencies": {
    "@earendil-works/pi-coding-agent": ">=0.74.0",
    "@earendil-works/pi-tui": ">=0.74.0"
  },
  "pi": {
    "extensions": [
      "./index.ts"
    ]
  }
}
```

- [ ] **Step 2: Create `types.ts`**

```typescript
export type TodoStatus = "pending" | "in_progress" | "completed";

export interface TodoItem {
  id: string;
  content: string;
  status: TodoStatus;
  subAction?: string;
}

export type SubagentStatus = "running" | "completed" | "failed";

export interface SubagentEntry {
  id: string;
  name: string;
  status: SubagentStatus;
  startedAt: number;
  completedAt?: number;
  turns: number;
  toolCount: number;
  tokens: number;
  toolLog: string[];
}

export interface WorkspaceFile {
  path: string;
  added: number;
  removed: number;
}

export interface SidebarContext {
  sessionTitle: string | null;
  todos: TodoItem[];
  subagents: SubagentEntry[];
  branch: string | null;
  aheadCount: number;
  untrackedCount: number;
  workspaceFiles: WorkspaceFile[];
  cwd: string | undefined;
}
```

- [ ] **Step 3: Install dev dependencies**

```bash
cd /Users/pdallaire/Projects/Coding/pi-sidebar-tui
npm install --save-dev @earendil-works/pi-tui @earendil-works/pi-coding-agent
```

Note: These packages are installed in `pi-sidebar`'s `node_modules`. If `npm install` cannot resolve them from npm registry, symlink them:
```bash
mkdir -p node_modules/@earendil-works
ln -s /Users/pdallaire/Projects/Coding/pi-sidebar/node_modules/@earendil-works/pi-tui node_modules/@earendil-works/pi-tui
ln -s /Users/pdallaire/Projects/Coding/pi-sidebar/node_modules/@earendil-works/pi-coding-agent node_modules/@earendil-works/pi-coding-agent
```

- [ ] **Step 4: Verify structure**

```bash
ls -la && cat types.ts
```

Expected: both files exist, `node_modules/@earendil-works/pi-tui/dist/index.d.ts` is resolvable.

- [ ] **Step 5: Commit**

```bash
git add package.json types.ts
git commit -m "feat: add package scaffold and types"
```

---

### Task 2: ANSI color helpers and formatting utilities

**Files:**
- Create: `colors.ts`

**Interfaces:**
- Produces:
  - `bold(text: string): string`
  - `dim(text: string): string`
  - `fg(hexColor: string, text: string): string`
  - `COLORS: { accent: string; success: string; warning: string; header: string; muted: string }`
  - `formatDuration(ms: number): string` — e.g. `"8s"` or `"1m24s"`
  - `formatRelativeTime(ms: number): string` — e.g. `"1m24s ago"`
  - `formatTokens(n: number): string` — e.g. `"45k"` or `"1.2M"`
  - `spinnerFrame(): string` — current braille spinner char
  - `formatDiffStat(added: number, removed: number): string` — `"+29"` or `"+29 -5"`
  - `panelHeader(title: string, width: number): string[]` — `[boldTitle, dimSeparator]`

- [ ] **Step 1: Create `colors.ts`**

```typescript
import { visibleWidth } from "@earendil-works/pi-tui";

const RESET = "\x1b[0m";
const BOLD = "\x1b[1m";
const DIM_CODE = "\x1b[2m";

function hexToAnsi(color: string): string {
  const h = color.replace("#", "");
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `\x1b[38;2;${r};${g};${b}m`;
}

export const COLORS = {
  accent:  "#febc38",
  success: "#5faf5f",
  warning: "#ff9500",
  header:  "#00afaf",
  muted:   "#6c6c6c",
};

export function bold(text: string): string {
  return `${BOLD}${text}${RESET}`;
}

export function dim(text: string): string {
  return `${DIM_CODE}${text}${RESET}`;
}

export function fg(hexColor: string, text: string): string {
  return `${hexToAnsi(hexColor)}${text}${RESET}`;
}

export function formatDuration(ms: number): string {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  if (m > 0) return `${m}m${s % 60}s`;
  return `${s}s`;
}

export function formatRelativeTime(ms: number): string {
  return `${formatDuration(ms)} ago`;
}

export function formatTokens(n: number): string {
  if (n < 1000) return n.toString();
  if (n < 1_000_000) return `${Math.round(n / 1000)}k`;
  return `${(n / 1_000_000).toFixed(1)}M`;
}

const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

export function spinnerFrame(): string {
  return SPINNER_FRAMES[Math.floor(Date.now() / 80) % SPINNER_FRAMES.length];
}

export function formatDiffStat(added: number, removed: number): string {
  if (removed > 0) return `+${added} -${removed}`;
  return `+${added}`;
}

export function panelHeader(title: string, width: number): string[] {
  const separatorLen = Math.max(0, width);
  return [
    bold(title),
    dim("─".repeat(separatorLen)),
  ];
}
```

- [ ] **Step 2: Verify it compiles (no test file yet — just syntax check)**

```bash
node --experimental-strip-types --input-type=module <<'EOF'
import { bold, dim, fg, COLORS, formatDuration, formatTokens, spinnerFrame, panelHeader } from "./colors.ts";
console.log(bold("Session"));
console.log(dim("─".repeat(20)));
console.log(fg(COLORS.accent, "● active"));
console.log(formatDuration(84000));   // "1m24s"
console.log(formatTokens(45000));     // "45k"
console.log(spinnerFrame());
console.log(panelHeader("Test", 20));
EOF
```

Expected: no errors, colored output visible.

- [ ] **Step 3: Commit**

```bash
git add colors.ts
git commit -m "feat: add ANSI color helpers and formatting utilities"
```

---

### Task 3: Session panel

**Files:**
- Create: `panels/session.ts`
- Create: `tests/panels.test.ts` (session section only — subsequent tasks append to this file)

**Interfaces:**
- Consumes: `SidebarContext` from `../types.ts`; `bold`, `dim`, `panelHeader` from `../colors.ts`; `truncateToWidth` from `@earendil-works/pi-tui`
- Produces: `renderSessionPanel(ctx: SidebarContext, width: number): string[]`

- [ ] **Step 1: Write the failing tests**

Create `tests/panels.test.ts`:

```typescript
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
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
node --experimental-strip-types --test 'tests/panels.test.ts' 2>&1 | head -20
```

Expected: `SyntaxError` or `Cannot find module` — `panels/session.ts` does not exist yet.

- [ ] **Step 3: Create `panels/session.ts`**

```typescript
import { truncateToWidth } from "@earendil-works/pi-tui";
import type { SidebarContext } from "../types.ts";
import { dim, panelHeader } from "../colors.ts";

export function renderSessionPanel(ctx: SidebarContext, width: number): string[] {
  const lines: string[] = [...panelHeader("Session", width)];

  const title = ctx.sessionTitle;
  if (!title) {
    lines.push(dim("  (waiting for first message…)"));
  } else {
    const truncated = truncateToWidth(title, Math.max(0, width - 2), "…");
    lines.push(dim(`  ${truncated}`));
  }

  return lines;
}
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
node --experimental-strip-types --test 'tests/panels.test.ts' 2>&1
```

Expected: `▶ session panel: no title shows placeholder … ok`, all 4 session tests pass.

- [ ] **Step 5: Commit**

```bash
git add panels/session.ts tests/panels.test.ts
git commit -m "feat: add Session panel with tests"
```

---

### Task 4: Todos panel

**Files:**
- Modify: `tests/panels.test.ts` (append Todos section)
- Create: `panels/todos.ts`

**Interfaces:**
- Consumes: `SidebarContext`, `TodoItem`, `TodoStatus` from `../types.ts`; `bold`, `dim`, `fg`, `COLORS`, `panelHeader`, `truncateToWidth` from deps
- Produces: `renderTodosPanel(ctx: SidebarContext, width: number): string[]`

- [ ] **Step 1: Append failing Todos tests to `tests/panels.test.ts`**

Add these imports at top of file (after existing imports):
```typescript
import { renderTodosPanel } from "../panels/todos.ts";
```

Append after the session tests:
```typescript
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
```

- [ ] **Step 2: Run tests to confirm new tests fail**

```bash
node --experimental-strip-types --test 'tests/panels.test.ts' 2>&1 | grep -E "fail|error|ok" | head -20
```

Expected: session tests still pass; todos tests fail with `Cannot find module`.

- [ ] **Step 3: Create `panels/todos.ts`**

```typescript
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import type { SidebarContext, TodoItem, TodoStatus } from "../types.ts";
import { dim, fg, COLORS, panelHeader } from "../colors.ts";

const GLYPHS: Record<TodoStatus, string> = {
  completed: "✓",
  in_progress: "●",
  pending: "○",
};

const GLYPH_COLORS: Record<TodoStatus, string> = {
  completed: COLORS.success,
  in_progress: COLORS.accent,
  pending: COLORS.muted,
};

function renderTodoLine(todo: TodoItem, width: number): string {
  const glyph = fg(GLYPH_COLORS[todo.status], GLYPHS[todo.status]);
  const glyphWidth = 1; // all glyphs are 1 visible char
  const spaceAfterGlyph = 1;
  const indent = glyphWidth + spaceAfterGlyph;

  if (todo.status === "in_progress" && todo.subAction) {
    const subText = ` (${todo.subAction})`;
    const contentMax = Math.max(0, width - indent);
    const fullText = todo.content + subText;
    if (visibleWidth(fullText) <= contentMax) {
      return `${glyph} ${todo.content}${dim(subText)}`;
    }
    const contentTruncated = truncateToWidth(todo.content, Math.max(0, contentMax - 4), "…");
    return `${glyph} ${contentTruncated}`;
  }

  const contentMax = Math.max(0, width - indent);
  const content = truncateToWidth(todo.content, contentMax, "…");
  return `${glyph} ${content}`;
}

export function renderTodosPanel(ctx: SidebarContext, width: number): string[] {
  const { todos } = ctx;
  const done = todos.filter(t => t.status === "completed").length;
  const title = `Todos (${done}/${todos.length})`;
  const lines: string[] = [...panelHeader(title, width)];

  if (todos.length === 0) {
    lines.push(dim("  (no todos)"));
    return lines;
  }

  for (const todo of todos) {
    lines.push(renderTodoLine(todo, width));
  }

  return lines;
}
```

- [ ] **Step 4: Run tests**

```bash
node --experimental-strip-types --test 'tests/panels.test.ts' 2>&1
```

Expected: all session + todos tests pass.

- [ ] **Step 5: Commit**

```bash
git add panels/todos.ts tests/panels.test.ts
git commit -m "feat: add Todos panel with tests"
```

---

### Task 5: Async Subagents panel

**Files:**
- Modify: `tests/panels.test.ts` (append Subagents section)
- Create: `panels/subagents.ts`

**Interfaces:**
- Consumes: `SidebarContext`, `SubagentEntry`, `SubagentStatus` from `../types.ts`; `dim`, `fg`, `COLORS`, `panelHeader`, `formatDuration`, `formatRelativeTime`, `formatTokens`, `spinnerFrame` from `../colors.ts`; `truncateToWidth` from `@earendil-works/pi-tui`
- Produces: `renderSubagentsPanel(ctx: SidebarContext, width: number): string[]`

- [ ] **Step 1: Append failing Subagents tests to `tests/panels.test.ts`**

Add to imports at top:
```typescript
import { renderSubagentsPanel } from "../panels/subagents.ts";
```

Append after todos tests:
```typescript
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
```

- [ ] **Step 2: Run tests to confirm new tests fail**

```bash
node --experimental-strip-types --test 'tests/panels.test.ts' 2>&1 | grep -c "fail"
```

Expected: 8 new tests fail; prior tests still pass.

- [ ] **Step 3: Create `panels/subagents.ts`**

```typescript
import { truncateToWidth } from "@earendil-works/pi-tui";
import type { SidebarContext, SubagentEntry } from "../types.ts";
import {
  dim, fg, COLORS, panelHeader,
  formatDuration, formatRelativeTime, formatTokens, spinnerFrame,
} from "../colors.ts";

function renderSubagentBlock(agent: SubagentEntry, width: number): string[] {
  const lines: string[] = [];

  const now = Date.now();
  const elapsed = now - agent.startedAt;

  let statusGlyph: string;
  let agentNameColor: string;
  if (agent.status === "completed") {
    statusGlyph = fg(COLORS.success, "✓");
    agentNameColor = COLORS.success;
  } else if (agent.status === "failed") {
    statusGlyph = fg(COLORS.warning, "✗");
    agentNameColor = COLORS.warning;
  } else {
    statusGlyph = fg(COLORS.accent, spinnerFrame());
    agentNameColor = COLORS.accent;
  }

  const nameMax = Math.max(0, width - 2);
  const truncName = truncateToWidth(agent.name, nameMax, "…");
  lines.push(`${statusGlyph} ${fg(agentNameColor, truncName)}`);

  if (agent.status === "completed" && agent.completedAt !== undefined) {
    const duration = agent.completedAt - agent.startedAt;
    const ago = now - agent.completedAt;
    lines.push(dim(`  complete (${formatRelativeTime(ago)})`));
    const meta = `${agent.turns} turns · ${agent.toolCount} tools · ${formatTokens(agent.tokens)} tokens · ${formatDuration(duration)}`;
    lines.push(dim(`  ${truncateToWidth(meta, Math.max(0, width - 2), "…")}`));
  } else if (agent.status === "failed") {
    lines.push(dim(`  failed (${formatRelativeTime(elapsed)})`));
    const meta = `${agent.turns} turns · ${agent.toolCount} tools · ${formatTokens(agent.tokens)} tokens`;
    lines.push(dim(`  ${truncateToWidth(meta, Math.max(0, width - 2), "…")}`));
  } else {
    lines.push(dim(`  running (${formatDuration(elapsed)})`));
    const meta = `${agent.turns} turns · ${agent.toolCount} tools · ${formatTokens(agent.tokens)} tokens`;
    lines.push(dim(`  ${truncateToWidth(meta, Math.max(0, width - 2), "…")}`));
  }

  const recentLog = agent.toolLog.slice(-3);
  for (const entry of recentLog) {
    lines.push(dim(`  ${truncateToWidth(entry, Math.max(0, width - 2), "…")}`));
  }

  return lines;
}

export function renderSubagentsPanel(ctx: SidebarContext, width: number): string[] {
  const { subagents } = ctx;
  const running = subagents.filter(a => a.status === "running").length;
  const completed = subagents.filter(a => a.status === "completed").length;

  const parallelSuffix = running > 1 ? " · parallel" : "";
  const title = `Async Subagents (${completed}/${subagents.length})${parallelSuffix}`;
  const lines: string[] = [...panelHeader(title, width)];

  if (subagents.length === 0) {
    lines.push(dim("  (no subagents)"));
    return lines;
  }

  for (let i = 0; i < subagents.length; i++) {
    if (i > 0) lines.push("");
    lines.push(...renderSubagentBlock(subagents[i], width));
  }

  return lines;
}
```

- [ ] **Step 4: Run tests**

```bash
node --experimental-strip-types --test 'tests/panels.test.ts' 2>&1
```

Expected: all session + todos + subagents tests pass.

- [ ] **Step 5: Commit**

```bash
git add panels/subagents.ts tests/panels.test.ts
git commit -m "feat: add Async Subagents panel with tests"
```

---

### Task 6: Workspace panel and git data module

**Files:**
- Create: `workspace.ts` (git queries, caching)
- Create: `panels/workspace.ts`
- Modify: `tests/panels.test.ts` (append Workspace section)

**Interfaces:**
- Produces (from `workspace.ts`):
  - `interface WorkspaceData { branch: string | null; aheadCount: number; untrackedCount: number; files: WorkspaceFile[] }`
  - `getWorkspaceData(cwd: string | undefined): WorkspaceData`
  - `invalidateWorkspaceCache(): void`
- Produces (from `panels/workspace.ts`):
  - `renderWorkspacePanel(ctx: SidebarContext, width: number): string[]`

- [ ] **Step 1: Create `workspace.ts`**

```typescript
import { execSync } from "node:child_process";
import type { WorkspaceFile } from "./types.ts";

export interface WorkspaceData {
  branch: string | null;
  aheadCount: number;
  untrackedCount: number;
  files: WorkspaceFile[];
}

const CACHE_TTL_MS = 2000;
let cache: { data: WorkspaceData; timestamp: number } | null = null;

function run(cmd: string, cwd: string): string {
  try {
    return execSync(cmd, { cwd, encoding: "utf-8", timeout: 2000 }).trim();
  } catch {
    return "";
  }
}

function parseBranch(cwd: string): string | null {
  const out = run("git branch --show-current", cwd);
  return out || null;
}

function parseAhead(cwd: string): number {
  const out = run("git rev-list @{u}..HEAD --count", cwd);
  const n = parseInt(out, 10);
  return isNaN(n) ? 0 : n;
}

function parseUntracked(cwd: string): number {
  const out = run("git status --porcelain", cwd);
  if (!out) return 0;
  return out.split("\n").filter(l => l.startsWith("??")).length;
}

function parseNumstat(cwd: string): WorkspaceFile[] {
  const out = run("git diff --numstat HEAD", cwd);
  if (!out) return [];

  return out
    .split("\n")
    .map(line => {
      const parts = line.split("\t");
      if (parts.length < 3) return null;
      const added = parseInt(parts[0], 10);
      const removed = parseInt(parts[1], 10);
      const path = parts[2].trim();
      if (isNaN(added) || isNaN(removed) || !path) return null;
      return { path, added, removed };
    })
    .filter((f): f is WorkspaceFile => f !== null)
    .sort((a, b) => (b.added + b.removed) - (a.added + a.removed))
    .slice(0, 15);
}

export function getWorkspaceData(cwd: string | undefined): WorkspaceData {
  const empty: WorkspaceData = { branch: null, aheadCount: 0, untrackedCount: 0, files: [] };
  if (!cwd) return empty;

  const now = Date.now();
  if (cache && now - cache.timestamp < CACHE_TTL_MS) return cache.data;

  const branch = parseBranch(cwd);
  if (!branch) {
    cache = { data: empty, timestamp: now };
    return empty;
  }

  const data: WorkspaceData = {
    branch,
    aheadCount: parseAhead(cwd),
    untrackedCount: parseUntracked(cwd),
    files: parseNumstat(cwd),
  };
  cache = { data, timestamp: now };
  return data;
}

export function invalidateWorkspaceCache(): void {
  cache = null;
}
```

- [ ] **Step 2: Create `panels/workspace.ts`**

```typescript
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import type { SidebarContext, WorkspaceFile } from "../types.ts";
import { bold, dim, fg, COLORS, formatDiffStat } from "../colors.ts";

function buildGitStatus(branch: string, ahead: number, untracked: number): string {
  let status = `⎇ ${branch}`;
  if (ahead > 0) status += ` +${ahead}`;
  if (untracked > 0) status += ` ?${untracked}`;
  return status;
}

function renderWorkspaceHeader(ctx: SidebarContext, width: number): string[] {
  const left = bold("Workspace");
  const leftPlain = "Workspace";

  if (!ctx.branch) {
    return [left, dim("─".repeat(Math.max(0, width)))];
  }

  const gitStatus = buildGitStatus(ctx.branch, ctx.aheadCount, ctx.untrackedCount);
  const leftLen = visibleWidth(leftPlain);
  const rightLen = visibleWidth(gitStatus);
  const padding = Math.max(1, width - leftLen - rightLen);
  const headerLine = `${left}${" ".repeat(padding)}${dim(gitStatus)}`;

  return [headerLine, dim("─".repeat(Math.max(0, width)))];
}

function renderFileLine(file: WorkspaceFile, width: number): string {
  const stat = formatDiffStat(file.added, file.removed);
  const statLen = visibleWidth(stat);
  const pathMax = Math.max(0, width - statLen - 1);
  const path = truncateToWidth(file.path, pathMax, "…");
  const pathLen = visibleWidth(path);
  const padding = Math.max(1, width - pathLen - statLen);
  return `${path}${" ".repeat(padding)}${fg(COLORS.success, stat)}`;
}

export function renderWorkspacePanel(ctx: SidebarContext, width: number): string[] {
  const lines: string[] = [...renderWorkspaceHeader(ctx, width)];

  if (!ctx.branch) {
    lines.push(dim("  (not a git repo)"));
    return lines;
  }

  const files = ctx.workspaceFiles.slice(0, 15);
  if (files.length === 0) {
    lines.push(dim("  (clean)"));
    return lines;
  }

  for (const file of files) {
    lines.push(renderFileLine(file, width));
  }

  return lines;
}
```

- [ ] **Step 3: Append Workspace tests to `tests/panels.test.ts`**

Add to imports:
```typescript
import { renderWorkspacePanel } from "../panels/workspace.ts";
```

Append after subagents tests:
```typescript
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
```

- [ ] **Step 4: Run all tests**

```bash
node --experimental-strip-types --test 'tests/panels.test.ts' 2>&1
```

Expected: all tests pass (session, todos, subagents, workspace).

- [ ] **Step 5: Commit**

```bash
git add workspace.ts panels/workspace.ts tests/panels.test.ts
git commit -m "feat: add Workspace panel, git data module, and tests"
```

---

### Task 7: Sidebar stacking and integration tests

**Files:**
- Create: `sidebar.ts`
- Create: `tests/sidebar.test.ts`

**Interfaces:**
- Consumes: all four `render*Panel` functions; `SidebarContext` from `./types.ts`; `visibleWidth`, `truncateToWidth` from `@earendil-works/pi-tui`
- Produces: `renderSidebar(ctx: SidebarContext, width: number): string[]`

- [ ] **Step 1: Write failing integration tests**

Create `tests/sidebar.test.ts`:

```typescript
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
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
node --experimental-strip-types --test 'tests/sidebar.test.ts' 2>&1 | head -10
```

Expected: `Cannot find module '../sidebar.ts'`.

- [ ] **Step 3: Create `sidebar.ts`**

```typescript
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import type { SidebarContext } from "./types.ts";
import { renderSessionPanel } from "./panels/session.ts";
import { renderTodosPanel } from "./panels/todos.ts";
import { renderSubagentsPanel } from "./panels/subagents.ts";
import { renderWorkspacePanel } from "./panels/workspace.ts";

export function renderSidebar(ctx: SidebarContext, width: number): string[] {
  const safeWidth = Math.max(1, width);

  const panels = [
    renderSessionPanel(ctx, safeWidth),
    renderTodosPanel(ctx, safeWidth),
    renderSubagentsPanel(ctx, safeWidth),
    renderWorkspacePanel(ctx, safeWidth),
  ];

  const result: string[] = [];
  for (let i = 0; i < panels.length; i++) {
    if (i > 0) result.push("");
    for (const line of panels[i]) {
      result.push(truncateToWidth(line, safeWidth, "", true));
    }
  }

  return result;
}
```

- [ ] **Step 4: Run all tests**

```bash
node --experimental-strip-types --test 'tests/**/*.test.ts' 2>&1
```

Expected: all tests in both files pass.

- [ ] **Step 5: Commit**

```bash
git add sidebar.ts tests/sidebar.test.ts
git commit -m "feat: add sidebar stacking and integration tests"
```

---

### Task 8: Extension entry point — state, events, commands, widget

**Files:**
- Create: `index.ts`

**Interfaces:**
- Consumes: `renderSidebar` from `./sidebar.ts`; `getWorkspaceData`, `invalidateWorkspaceCache` from `./workspace.ts`; `SidebarContext`, `TodoItem`, `SubagentEntry` from `./types.ts`; `ExtensionAPI` from `@earendil-works/pi-coding-agent`

No new tests for this task — extension wiring is tested by running pi live. The spec notes a known risk: pi's widget API may not support right-column layout for standalone extensions; fallback is `placement: "belowEditor"`.

- [ ] **Step 1: Create `index.ts`**

```typescript
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { TodoItem, SubagentEntry, SidebarContext } from "./types.ts";
import { renderSidebar } from "./sidebar.ts";
import { getWorkspaceData, invalidateWorkspaceCache } from "./workspace.ts";

const SIDEBAR_WIDTH = 36;
const TOOL_LOG_MAX = 10;
const SUBAGENT_TOOL_PATTERN = /^(task|dispatch|agent)/i;
const TODO_TOOL_PATTERN = /todo/i;
const WRITE_TOOLS = new Set(["write", "edit", "bash", "computer"]);

let sidebarEnabled = true;
let sidebarWidth = SIDEBAR_WIDTH;
let sessionTitle: string | null = null;
let todos: TodoItem[] = [];
const subagentsMap = new Map<string, SubagentEntry>();
let activeSubagentId: string | null = null;

function buildSidebarContext(cwd: string | undefined): SidebarContext {
  const ws = getWorkspaceData(cwd);
  return {
    sessionTitle,
    todos,
    subagents: Array.from(subagentsMap.values()),
    branch: ws.branch,
    aheadCount: ws.aheadCount,
    untrackedCount: ws.untrackedCount,
    workspaceFiles: ws.files,
    cwd,
  };
}

function parseTodos(input: unknown): TodoItem[] | null {
  if (!input || typeof input !== "object") return null;

  const obj = input as Record<string, unknown>;
  const raw = obj["todos"] ?? obj["items"] ?? obj["list"] ?? input;
  if (!Array.isArray(raw)) return null;

  const result: TodoItem[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const i = item as Record<string, unknown>;
    const content = typeof i["content"] === "string" ? i["content"] :
                    typeof i["text"] === "string" ? i["text"] : null;
    const status = typeof i["status"] === "string" ? i["status"] : "pending";
    const id = typeof i["id"] === "string" ? i["id"] : String(result.length);
    const subAction = typeof i["subAction"] === "string" ? i["subAction"] : undefined;
    if (!content) continue;

    const normalizedStatus =
      status === "in_progress" || status === "active" ? "in_progress" :
      status === "completed" || status === "done" ? "completed" : "pending";

    result.push({ id, content, status: normalizedStatus, subAction });
  }
  return result;
}

function extractSubagentName(input: unknown): string {
  if (!input || typeof input !== "object") return "subagent";
  const obj = input as Record<string, unknown>;
  const name = obj["name"] ?? obj["title"] ?? obj["description"] ?? obj["task"];
  if (typeof name !== "string") return "subagent";
  return name.split("\n")[0].slice(0, 60);
}

export default function opencodesSidebar(pi: ExtensionAPI) {
  let currentCwd: string | undefined;
  let requestRender: (() => void) | null = null;

  pi.on("session_start", async (_event, ctx) => {
    sessionTitle = null;
    todos = [];
    subagentsMap.clear();
    activeSubagentId = null;
    invalidateWorkspaceCache();
    currentCwd = (ctx as any).cwd;

    const hasUI = (ctx as any).hasUI;
    if (!hasUI) return;

    const ui = (ctx as any).ui;
    let renderTick = 0;
    const scheduleRender = () => {
      const tick = ++renderTick;
      setTimeout(() => {
        if (tick === renderTick) ui.requestRender?.();
      }, 16);
    };
    requestRender = scheduleRender;

    ui.setWidget("opencode-sidebar", (_tui: any, _theme: any) => ({
      dispose() { requestRender = null; },
      invalidate() {},
      render(_width: number): string[] {
        if (!sidebarEnabled) return [];
        return renderSidebar(buildSidebarContext(currentCwd), sidebarWidth);
      },
    }), { placement: "belowEditor" });
  });

  pi.on("session_shutdown", async () => {
    sessionTitle = null;
    todos = [];
    subagentsMap.clear();
    activeSubagentId = null;
  });

  pi.on("before_agent_start", async (event, ctx) => {
    currentCwd = (ctx as any).cwd;
    if (sessionTitle === null && typeof (event as any).prompt === "string") {
      sessionTitle = (event as any).prompt.slice(0, 60);
    }
    requestRender?.();
  });

  pi.on("tool_call", async (event, ctx) => {
    currentCwd = (ctx as any).cwd;
    const toolName = (event as any).toolName ?? "";
    const input = (event as any).input;
    const toolCallId = (event as any).toolCallId ?? toolName;

    if (TODO_TOOL_PATTERN.test(toolName)) {
      const parsed = parseTodos(input);
      if (parsed !== null) {
        todos = parsed;
        requestRender?.();
      }
    } else if (SUBAGENT_TOOL_PATTERN.test(toolName)) {
      const entry: SubagentEntry = {
        id: toolCallId,
        name: extractSubagentName(input),
        status: "running",
        startedAt: Date.now(),
        turns: 0,
        toolCount: 0,
        tokens: 0,
        toolLog: [],
      };
      subagentsMap.set(toolCallId, entry);
      activeSubagentId = toolCallId;
      requestRender?.();
    } else if (activeSubagentId) {
      const active = subagentsMap.get(activeSubagentId);
      if (active) {
        const inputPreview = typeof input === "string"
          ? input.slice(0, 40)
          : typeof input === "object" && input !== null
            ? JSON.stringify(input).slice(0, 40)
            : "";
        active.toolLog.push(`${toolName}: ${inputPreview}`);
        if (active.toolLog.length > TOOL_LOG_MAX) {
          active.toolLog.shift();
        }
        active.toolCount++;
        requestRender?.();
      }
    }
  });

  pi.on("tool_result", async (event) => {
    const toolName = (event as any).toolName ?? "";
    const toolCallId = (event as any).toolCallId ?? toolName;

    if (WRITE_TOOLS.has(toolName.toLowerCase())) {
      invalidateWorkspaceCache();
    }

    if (subagentsMap.has(toolCallId)) {
      const entry = subagentsMap.get(toolCallId)!;
      entry.status = (event as any).error ? "failed" : "completed";
      entry.completedAt = Date.now();
      if (activeSubagentId === toolCallId) {
        activeSubagentId = null;
      }
      requestRender?.();
    }
  });

  pi.on("message_end", async (event, ctx) => {
    currentCwd = (ctx as any).cwd;
    if (activeSubagentId) {
      const active = subagentsMap.get(activeSubagentId);
      if (active) {
        active.turns++;
        const usage = (event as any).message?.usage;
        if (usage && typeof usage.output === "number") {
          active.tokens += (usage.input ?? 0) + (usage.output ?? 0);
        }
      }
    }
    requestRender?.();
  });

  pi.on("turn_end", async (_event, ctx) => {
    currentCwd = (ctx as any).cwd;
    invalidateWorkspaceCache();
    requestRender?.();
  });

  pi.on("agent_end", async (_event, ctx) => {
    currentCwd = (ctx as any).cwd;
    invalidateWorkspaceCache();
    requestRender?.();
  });

  pi.registerCommand("sidebar-tui", {
    description: "Toggle OpenCode sidebar (on, off, toggle, width <N>)",
    handler: async (args, ctx) => {
      currentCwd = (ctx as any).cwd;
      const trimmed = args?.trim() ?? "";

      if (trimmed === "on") {
        sidebarEnabled = true;
      } else if (trimmed === "off") {
        sidebarEnabled = false;
      } else if (trimmed.startsWith("width ")) {
        const n = parseInt(trimmed.slice(6), 10);
        if (!isNaN(n) && n >= 10 && n <= 120) {
          sidebarWidth = n;
        } else {
          (ctx as any).ui?.notify?.("Usage: /sidebar-tui width <10-120>", "warning");
          return;
        }
      } else {
        sidebarEnabled = !sidebarEnabled;
      }

      (ctx as any).ui?.notify?.(
        `OpenCode sidebar ${sidebarEnabled ? "enabled" : "disabled"}`,
        "info"
      );
    },
  });

  pi.registerCommand("session-title", {
    description: "Set session title shown in sidebar",
    handler: async (args, ctx) => {
      const title = args?.trim() ?? "";
      if (!title) {
        (ctx as any).ui?.notify?.("Usage: /session-title <text>", "warning");
        return;
      }
      sessionTitle = title;
      requestRender?.();
      (ctx as any).ui?.notify?.(`Session title set: ${title}`, "info");
    },
  });
}
```

- [ ] **Step 2: Verify the file compiles**

```bash
node --experimental-strip-types --input-type=module <<'EOF'
import f from "./index.ts";
console.log(typeof f);
EOF
```

Expected: `function`

- [ ] **Step 3: Run all tests to confirm nothing is broken**

```bash
node --experimental-strip-types --test 'tests/**/*.test.ts' 2>&1
```

Expected: all tests pass.

- [ ] **Step 4: Commit**

```bash
git add index.ts
git commit -m "feat: add extension entry point with event wiring and commands"
```

---

### Task 9: Final self-review and smoke test

**Files:** None modified.

- [ ] **Step 1: Run full test suite**

```bash
node --experimental-strip-types --test 'tests/**/*.test.ts' 2>&1
```

Expected output: all tests `ok`, zero failures.

- [ ] **Step 2: Verify file structure matches spec**

```bash
find . -name "*.ts" | grep -v node_modules | sort
```

Expected:
```
./colors.ts
./index.ts
./panels/session.ts
./panels/subagents.ts
./panels/todos.ts
./panels/workspace.ts
./sidebar.ts
./tests/panels.test.ts
./tests/sidebar.test.ts
./types.ts
./workspace.ts
```

- [ ] **Step 3: Verify package.json pi extension manifest**

```bash
node -e "const p = JSON.parse(require('fs').readFileSync('package.json','utf8')); console.log(JSON.stringify(p.pi, null, 2))"
```

Expected:
```json
{
  "extensions": [
    "./index.ts"
  ]
}
```

- [ ] **Step 4: Quick render sanity check**

```bash
node --experimental-strip-types --input-type=module <<'EOF'
import { renderSidebar } from "./sidebar.ts";
const ctx = {
  sessionTitle: "Fix the auth bug in middleware",
  todos: [
    { id: "1", content: "Inspect tests", status: "in_progress", subAction: "inspecting test files" },
    { id: "2", content: "Write failing test", status: "pending" },
    { id: "3", content: "Setup repo", status: "completed" },
  ],
  subagents: [
    { id: "a1", name: "test-runner", status: "completed", startedAt: Date.now()-84000, completedAt: Date.now()-76000, turns: 3, toolCount: 12, tokens: 45000, toolLog: [] },
    { id: "a2", name: "file-scanner", status: "running", startedAt: Date.now()-3000, turns: 1, toolCount: 2, tokens: 8000, toolLog: ["read: /src/auth.ts", "bash: git status"] },
  ],
  branch: "feature/fix-auth",
  aheadCount: 2,
  untrackedCount: 1,
  workspaceFiles: [
    { path: "src/auth.ts", added: 29, removed: 0 },
    { path: "src/middleware.ts", added: 12, removed: 3 },
  ],
  cwd: "/tmp/test",
};
const lines = renderSidebar(ctx, 36);
for (const line of lines) process.stdout.write(line + "\n");
EOF
```

Expected: colored sidebar output with all 4 panels visible.

- [ ] **Step 5: Final commit**

```bash
git add -A
git commit -m "feat: complete pi-sidebar-tui extension with 4-panel OpenCode sidebar"
```

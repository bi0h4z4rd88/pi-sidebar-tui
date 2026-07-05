# OpenCode-Style Sidebar TUI Extension for pi

**Date:** 2026-07-05  
**Status:** Approved  
**Package:** `pi-sidebar-tui` (standalone, no runtime dependency on `pi-sidebar`)

---

## Overview

A new pi extension that renders a fixed-width right-column sidebar with four stacked panels modeled after opencode-ai's TUI sidebar: Session, Todos, Async Subagents, and Workspace. The sidebar is wired into pi's existing `FixedEditorCluster` two-column layout mechanism via `sidebarLines`.

---

## Architecture

### Package structure

```
pi-sidebar-tui/
  package.json          ← pi extension manifest; peer deps: pi-tui, pi-coding-agent
  index.ts              ← extension entry; event wiring; module-level state
  sidebar.ts            ← stacks panel outputs → string[]; handles width/truncation
  types.ts              ← TodoItem, SubagentEntry, SidebarContext
  colors.ts             ← ANSI helpers: fg, dim, bold, reset (~30 lines)
  panels/
    session.ts          ← Session panel renderer
    todos.ts            ← Todos panel renderer
    subagents.ts        ← Async Subagents panel renderer
    workspace.ts        ← Workspace panel renderer
  tests/
    panels.test.ts      ← unit tests per panel
    sidebar.test.ts     ← integration: full stack, width, separators
```

### Rendering model

- Each panel: `(ctx: SidebarContext, width: number) => string[]`
- `sidebar.ts` stacks panels with one blank-line separator between each, truncates all lines to `width`
- `index.ts` registers sidebar content via `ctx.ui.setWidget("opencode-sidebar", callback)` — pi's core widget API handles the column layout natively. If runtime testing reveals pi's widget API does not support sidebar columns for standalone extensions, fallback: render the sidebar as a freestanding `setFooter` block (stacked below chat, not right-column). This is a known risk to verify at implementation start.
- Sidebar default width: 36 columns (configurable via `/sidebar-tui width <N>`)

### Rendering library

`@earendil-works/pi-tui` (already pi's TUI framework). Used for:
- `truncateToWidth(text, width, "…")` — ANSI-aware truncation
- `visibleWidth(text)` — ANSI-aware length

No additional dependencies introduced.

---

## Data types

```typescript
// types.ts

export type TodoStatus = "pending" | "in_progress" | "completed";

export interface TodoItem {
  id: string;
  content: string;
  status: TodoStatus;
  subAction?: string;  // current sub-action text for in_progress items
}

export type SubagentStatus = "running" | "completed" | "failed";

export interface SubagentEntry {
  id: string;           // tool_call_id
  name: string;         // from tool input (task name or first line of task)
  status: SubagentStatus;
  startedAt: number;    // Date.now() at tool_call
  completedAt?: number;
  turns: number;
  toolCount: number;
  tokens: number;
  toolLog: string[];    // recent tool calls, capped at 10 entries
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

---

## State tracking (index.ts)

Module-level state updated by pi event handlers:

```
sessionTitle: string | null
todos: TodoItem[]
subagents: Map<string, SubagentEntry>   // keyed by tool_call_id
activeSubagentId: string | null         // currently running subagent
```

### Session title

- On `before_agent_start`: if `sessionTitle` is null, set to first 60 chars of `event.prompt`
- `/session-title <text>` command: sets `sessionTitle` to provided text
- Resets to null on `session_shutdown`

### Todos

- On `tool_call` where `event.toolName` matches `/todo/i`:
  - Parse `event.input` for array of `{ content, status, subAction? }` items
  - Replace `todos` wholesale (TodoWrite always sends full list)
  - Request sidebar re-render
- Status mapping: `"pending"` → `○`, `"in_progress"` → `●`, `"completed"` → `✓`

### Subagents

- On `tool_call` where `event.toolName` matches `/task|dispatch|agent/i`:
  - Create `SubagentEntry`: name from input payload, `startedAt: Date.now()`, `status: "running"`
  - Store in `subagents` map keyed by tool_call_id
  - Set `activeSubagentId`
- On `tool_result` for same tool_call_id:
  - Mark entry `completed` (or `failed` on error), set `completedAt`
  - Clear `activeSubagentId`
- On `tool_call` (any tool) while `activeSubagentId` set:
  - Append `"toolName: truncated-input"` to active subagent's `toolLog` (cap at 10)
- On `message_end` while `activeSubagentId` set:
  - Increment `turns`, add token counts

### Workspace

- `getWorkspaceFiles(cwd)`: runs `git diff --numstat HEAD`, parses into `WorkspaceFile[]`
- Cached with 2s TTL, invalidated on `tool_result` for write/edit/bash tools
- Sorted by `added + removed` descending, capped at 15 files
- Git branch via `git branch --show-current`, ahead count via `git rev-list @{u}..HEAD --count`, untracked via `git status --porcelain` — all run as child processes, cached with 2s TTL alongside workspace files. No dependency on `footerData`.

---

## Panel rendering

### Session panel

```
Session
───────────────────────────────────
  My first session task title...
```

- Header: `"Session"` bold + underline separator
- Title line: dim-colored, truncated to `width - 2`
- No title yet: `"(waiting for first message…)"` in dim

### Todos panel

```
Todos (2/5)
───────────────────────────────────
● Active todo (running subtask...)
○ Pending todo
✓ Done todo
```

- Header count: `done/total` where done = completed count
- Empty state: `"  (no todos)"` dim
- Glyph colors: `●` accent, `○` dim, `✓` dim/success
- Sub-action: dim parenthetical on same line as in-progress item, truncated to fit remaining width
- Each item line truncated to `width`

### Async Subagents panel

```
Async Subagents (1/2) · parallel
─────────────────────────────────
✓ agent-name
  complete (1m24s ago)
  3 turns · 12 tools · 45k tokens · 8s
⠸ other-agent
  running (3s)
  1 turns · 2 tools · 8k tokens
  read: /path/to/file.ts
  bash: git status
```

- `· parallel` suffix: only shown when >1 subagent `status === "running"`
- Spinner: `⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏` — frame advanced by wall-clock ms / 80 mod 10
- Completed: `✓` success color; running: spinner accent color; failed: `✗` warning color
- Status line: `"complete (Xm Ys ago)"` or `"running (Xs)"` dim
- Meta line: `"N turns · N tools · Nk tokens"` + `"· Xs"` duration only when completed
- Tool log: up to 3 lines shown (most recent), each `"  toolName: input-preview"` dim, truncated
- Empty state: `"  (no subagents)"` dim

### Workspace panel

```
Workspace               ⎇ main +2 ?1
────────────────────────────────────
src/foo.ts                      +29
src/bar.ts                   +12 -3
```

- Header: `"Workspace"` left + git status right-aligned on same line, padded with spaces
- Git status: `"⎇ branch"` + `" +N"` if ahead > 0 + `" ?N"` if untracked > 0
- File lines: path left, diff stat right, space-padded between
- Diff stat: `"+N"` if no deletions; `"+N -M"` if deletions > 0
- Clean repo: `"  (clean)"` dim
- No git repo: `"  (not a git repo)"` dim

---

## Commands

| Command | Effect |
|---|---|
| `/sidebar-tui` | Toggle sidebar on/off |
| `/sidebar-tui on\|off` | Explicit toggle |
| `/sidebar-tui width <N>` | Set sidebar column width |
| `/session-title <text>` | Override session title |

---

## Testing

### `tests/panels.test.ts` — unit tests

**Session panel:**
- No title → shows placeholder
- Title truncated at `width - 2`

**Todos panel:**
- Empty → shows `(no todos)`
- All pending → all `○`, count `0/N`
- Mixed → correct glyphs, count `done/total`
- In-progress with sub-action → parenthetical shown, truncated to fit
- Long item → line truncated to width

**Subagents panel:**
- Empty → shows `(no subagents)`
- Single running → spinner glyph, no duration in meta
- Single completed → `✓`, duration shown, relative time shown
- Two running → `· parallel` in header
- One running, one complete → `· parallel` absent
- Tool log: 4 entries → only 3 shown

**Workspace panel:**
- Clean repo → `(clean)` shown
- Files with additions only → `+N` format
- Files with additions and deletions → `+N -M` format
- 16 files → capped at 15
- Diff stat right-aligned within width

### `tests/sidebar.test.ts` — integration

- All 4 panels stack with blank-line separators
- All lines ≤ configured width (no overflow)
- Width=1 edge case does not throw
- Empty states for all panels render without error

### Test runner

```
node --experimental-strip-types --test tests/**/*.test.ts
```

---

## Non-goals

- No blessed/ink/bubbletea — raw ANSI only
- No runtime dependency on `pi-sidebar`
- No persistence of session title across restarts
- No scrolling within panels (static render)
- No mouse interaction

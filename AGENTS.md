# PROJECT KNOWLEDGE BASE

**Generated:** 2026-09-16

## OVERVIEW
Project: **pi-sidebar-tui**
A **pi coding-agent extension** that renders a live right-column sidebar TUI inside the pi terminal: session metrics (model, thinking level, context usage bar, token/cost stats, `turns left` estimate), todo tracking, git workspace status, and MCP server status.
Stack: **TypeScript (ESM, `"type":"module"`)** run via **Node native type-stripping** (`--experimental-strip-types`) — **no build step, no tsconfig, no bundler**. Deps: `@earendil-works/pi-coding-agent` + `@earendil-works/pi-tui` (both `>=0.74.0`). Tests: `node:test` + `node:assert/strict`. Node v26.

> This is an **extension, not a standalone app**. There is no "run" command — it loads into pi and reacts to pi's event system.

## STRUCTURE
```
├── index.ts              # Extension entry: `export default function piSidebar(pi)`. All `pi.on(...)` event handlers, state, command/shortcut registration
├── sidebar.ts            # Composes all panels into the final sidebar line list
├── panels/
│   ├── session.ts        # Session metrics panel (model, ctx bar, stats grid)
│   ├── todos.ts          # Todo tracking panel
│   ├── workspace.ts      # Git workspace status panel
│   └── mcp.ts            # MCP server status panel
├── compositor.ts         # `SidebarCompositor` — paints right column, synchronized output, flicker-free repaint
├── colors.ts             # Theme color tokens + ANSI/format helpers (fg/dim/bold, trunc, panelHeader, padToMin, spinner…)
├── config.ts             # Sidebar settings persistence + auto-compact read (versioned cache)
├── mcp.ts                # MCP server discovery/status (reads mcp.json + mcp-cache.json)
├── workspace.ts          # Git workspace state (branch, ahead/untracked, file diff stats)
├── parse-todos.ts        # Parse pi-todo tool results → TodoItem[]
├── caveman.ts            # pi-caveman level indicator (reads pi-caveman shared state)
├── types.ts              # `SidebarContext` + supporting types (single shared UI state object)
├── tests/                # node:test suites (one file per concern)
├── README.md             # User-facing docs (install, usage, architecture)
└── CHANGELOG.md          # Per-version changelog (keep updated on release)
```

## COMMANDS
| Action | Command |
|--------|---------|
| Install | `npm install` |
| Test    | `npm test`  (→ `node --experimental-strip-types --test 'tests/**/*.test.ts'`) |
| Build   | *none* (types stripped at runtime; no compile step) |
| Run     | *N/A* — load into pi: `pi install npm:pi-sidebar-tui` |
| Publish | `npm login` → `npm publish` (see release workflow below) |

**In-pi controls** (once loaded): `/sidebar-tui on|off`, `/sidebar-tui width <10-120>`, `/sidebar-tui todos <N>`, `/session-title "..."`, shortcut **`Ctrl+Shift+T`** (toggle; rebind in `~/.pi/agent/keybindings.json`).

## CODING STANDARDS
* **Language**: TypeScript, ESM. **Imports must include the `.ts` extension** (required by type-stripping, e.g. `import { x } from "./colors.ts"`).
* **Style**: 2-space indent, double quotes, semicolons. Panels are pure functions: `renderXPanel(ctx: SidebarContext, width: number): string[]`.
* **Single state object**: all UI data flows through one `SidebarContext` (see `types.ts`). `index.ts` builds it; `sidebar.ts` + `panels/*` consume it. Keep panels pure — no I/O, no global state.
* **Colors**: always render via `fg(COLORS.x, text)` / `dim()` / `bold()` from `colors.ts` so they delegate to pi's **live theme**. `FALLBACK_HEX` covers tests/cold-start. Do **not** hardcode ANSI codes in panels. Tokens: `accent`, `success`, `warning`, `error` (red), `header` (text), `muted`.
* **Width discipline**: every panel must fit the given `width` (tests assert `visibleWidth(line) <= width`). Use `trunc()` / `padToMin()` / `truncateToWidth`.
* **Rules**: *no linter/formatter configured* (no eslint/prettier/tsconfig). Style is enforced by convention + tests.

## WHERE TO LOOK
* **Source / entry**: `index.ts` (event handlers + state), `panels/` (UI)
* **Tests**: `tests/` (`panels.test.ts`, `sidebar.test.ts`, `config.test.ts`, `mcp.test.ts`, `parse-todos.test.ts`, `shortcut.test.ts`, `caveman.test.ts`)
* **Docs**: `README.md`, `CHANGELOG.md`

## NOTES
* **No type-checking in CI**: `--experimental-strip-types` *strips* types but does **not** type-check. Type errors only surface in the editor — run tests for behavior, but also keep types clean manually.
* **`SidebarCompositor` (compositor.ts) monkey-patches** `terminal.columns` and `terminal.write`, and wraps `tui.doRender` in a synchronized-output block. Edits here are high-risk (flicker/regressions); it repaints only changed rows to stay flicker-free.
* **Context bar color** is by window-usage %: green `<50`, yellow (accent) `50–80`, red (error) `>80`. The separate `left ≈Nt` row uses pace-based color (muted/accent/warning).
* **Reserved panel rows** (stable layout): MCP = header + 2 content, Todos = header + 7 content (`padToMin`). Panels grow past reserved only when content exceeds it; Todos caps at `todosMax` with a ` … +N more` footer.
* **Defaults**: sidebar width `45`, `todosMax` `10`. Persisted to `~/.pi/agent/sidebar-tui.json` (corrupt/out-of-range → defaults).
* **Release workflow**: bump `version` in `package.json` → add a `## [version] - YYYY-MM-DD` section to `CHANGELOG.md` (move `[Unreleased]` content in) → `git commit` + `git push origin main` → `npm publish`. The **lockfile root `version` is intentionally left stale** (repo convention; don't "fix" it).
* **Publish `files`**: only `*.ts` + `panels/**/*.ts` are shipped (tests excluded).
* **Shortcut mismatch**: code registers `ctrl+shift+t`; README's "Ctrl+Shift+S" note is stale.

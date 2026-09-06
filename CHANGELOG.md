# Changelog

All notable changes to this project will be documented in this file.

## [1.7.0] - 2026-09-06

### Added

- **MCP servers panel**: New "MCP Servers" panel listing each configured server's status (connected / partial / disabled), direct vs. total tool counts, and an estimate of the token cost of exposing direct tools. Reads `~/.pi/agent/mcp.json` + `mcp-cache.json` (1.5s cache, invalidated on MCP status events); disabled servers are surfaced with no tool counts.
- **Todos live capture + resume**: The Todos panel now reads the list from the `todo` tool's result `details` (so pi-todo / built-in todos actually appear) and reconstructs it from session history on `session_start` — the panel is correct immediately after quitting and resuming, and stays branch-aware.

### Changed

- **Shortcut changed**: Toggle sidebar shortcut moved from `Ctrl+Shift+S` to `Ctrl+Shift+T` to avoid conflict with the pi-web-access extension which also uses `Ctrl+Shift+S`.
- **1-space side-border indentation**: All panel content (session rows, MCP servers, todos, subagents, workspace files, and empty-state labels) is indented 1 space from the `│` left border for a consistent, less-crowded look.

## [1.6.2] - 2026-09-04

### Added

- **Context "turns left" estimate**: The session stats grid now shows a `left` row (under `turns`) estimating how many turns remain before the context window fills, based on recent context growth (first/last of a 10-turn sample buffer). Shows `≈Nt` colored by urgency (muted ≥20t, accent 5–19t, warning red <5t), `∞` when context is flat, or `—` until enough data. The context fill bar is now pace-aware too: it escalates to accent/warning when the estimate is <20t/<5t even if raw percentage is low.

### Changed

- **Session stats grid rebalanced**: `cost` moved to the Tokens column (under `cache`) so the context estimate pairs with `turns` in the Stats column; both columns are now 5 rows.

### Changed

- **Sidebar toggle shortcut moved to `Ctrl+Shift+S`**: `Ctrl+I` shares its terminal byte with Tab, so pressing Tab also toggled the sidebar. `Ctrl+Shift+S` is unambiguous on terminals with Kitty keyboard-protocol or modifyOtherKeys support (pi negotiates the Kitty protocol at startup).

### Fixed

- **Sidebar flicker/lag while processing data**: The compositor now repaints only the sidebar rows that actually changed (skipping the write entirely when nothing changed) and paints the sidebar inside pi's own render cycle as a single synchronized-output frame. pi's full-line erase (`\x1b[2K`) is bounded to the main-area width so its renders no longer wipe the sidebar columns — the primary cause of the flicker while tokens/tools stream.

## [1.6.0] - 2026-09-03

### Added

- **Context usage progress bar**: The Session panel's context line is now a fill bar driven by live context-window usage — green below 70%, yellow 70-90%, red above 90% — with the token count and auto-compact status on a second line. Replaces the plain `tokens / window (pct%)` text.

## [1.5.2] - 2026-08-24

### Changed

- **Sidebar toggle shortcut moved to `Ctrl+I`**: `Ctrl+2` did not reach the TUI in some terminals. Note: `ctrl+i` shares its terminal byte with Tab.

## [1.5.1] - 2026-08-24

### Changed

- **Sidebar toggle shortcut is `Ctrl+S`**: `Option+S` collides with terminal character input (e.g. `ß`) and other Option/Super combos did not reach the TUI reliably. Note: `ctrl+s` is also pi's default `app.session.toggleSort` binding — if both fire, rebind one in `~/.pi/agent/keybindings.json`.

## [1.5.0] - 2026-08-24

### Added

- **Keyboard shortcut**: `Option+S` (`alt+s`) toggles the sidebar on/off, shared with the `/sidebar-tui on|off` command. Rebind via `~/.pi/agent/keybindings.json`.
- Config file path can be overridden with the `PI_SIDEBAR_CONFIG` environment variable (defaults to `~/.pi/agent/sidebar-tui.json`).

## [1.4.0] - 2026-08-24

### Added

- **Persistent sidebar settings**: `/sidebar-tui on|off` and `/sidebar-tui width <N>` now persist across pi restarts. Settings are stored in `~/.pi/agent/sidebar-tui.json` (corrupt or out-of-range values fall back to defaults: enabled, width 40).

## [1.3.2] - 2026-08-22

### Changed

- **No opaque sidebar background by default**: The compositor no longer paints a solid background behind the sidebar, so terminal transparency shows through. Set `PI_SIDEBAR_BG="#rrggbb"` to opt back into an opaque panel (e.g. to hide scroll flash on opaque terminals).

## [1.2.0] - 2026-07-06

### Added

- **Theme-aware colors**: Delegates to pi Theme API when available, falls back to hardcoded ANSI colors
- **Session ID display**: Shows session ID in session panel
- **Thinking level indicator**: Inline after model name (e.g. ` - minimal`, ` - high`); shows ` - think off` when disabled

### Changed

- Separator and cwd line use theme `dim()` instead of hardcoded ANSI codes
- Thinking level dimmed to match interface label styling

## [1.1.0] - 2026-07-06

### Added

- **Live tok/s display**: Real-time tokens-per-second via 2-second sliding window, tracked per-model and reset on model change
- **Session title auto-inference**: Auto-generated from first user prompt with regex-based summarization (strips filler/method wrappers) and async LLM fallback
- **Static stat labels**: All session labels always visible with `—` fallback when data absent (time, last turn, speed, turns, cost, in, out, total, cache)
- **Stats/token column headers**: Two-column layout with separator line and headers

### Changed

- Sidebar toggle (`/sidebar-tui off/on`) properly disposes/reinstalls the compositor at runtime
- tok/s measured against LLM generation time only (message_start → message_end), excludes tool execution
- Session title regex strips method wrapper patterns ("use", "create", "build", etc.) and filler prefixes
- Removed model provider display from session panel
- Removed OpenCode references — neutral "sidebar" naming throughout

### Fixed

- Terminal column detection via prototype getter to bypass instance-level overrides
- tok/s clocked from first output token, not request send
- Removed stale variable references
- Separator line trimmed one character short for visual consistency
- Stats/token headers capitalized for consistency

## [1.0.0] - 2026-07-05

### Added

- **SidebarCompositor**: Right-column terminal layout via `terminal.columns` narrowing with synchronized output and cursor save/restore
- **Session Panel**: Session title, elapsed time, active tool indicator, model/thinking level, context usage, token in/out, session cost, cache hit%, turn count, auto-compact indicator
- **MCP Servers Panel**: Connected server status, tool counts, token estimates from `mcp.json`/`mcp-cache.json`
- **Todos Panel**: Todo parsing from tool calls with status glyphs (`○` `●` `✓`), progress counter, sub-action annotations
- **Async Subagents Panel**: Subagent tracking (running/completed/failed), per-agent turns/tools/tokens/time, last 3 tool log entries, parallel indicator
- **Workspace Panel**: Git branch with ahead/untracked counts, dirty file listing with diff stats, auto-refresh on write operations
- **Current path display**: Bottom-of-sidebar cwd with home-dir tilde substitution
- **Extension commands**: `/sidebar-tui` (on/off/toggle/width) and `/session-title` for runtime control
- **Session history seeding**: Tokens, turns, thinking level, and session title seeded from session history on resume
- **Unit tests**: Panel rendering and sidebar integration tests

### Changed

- Sidebar width increased to 45 columns (configurable 10-120)
- Sidebar background set to black to match terminal and hide scroll flash
- Panel header titles include leading space for visual consistency

### Fixed

- Reverted DECLRMM/DECSLRM column constraint — broke pi main area rendering
- Hooked `terminal.write` to repaint sidebar after streaming output
- Selective ANSI reset in cwd line preserves background fill for padding
- Session title inferred from first user message when no explicit name
- Session history prioritized over live API for thinking level on resume
- MCP panel format matches `directCount/totalCount` and exact tool count display
- Cursor save/restore (`DECSC`/`DECRC`) around sidebar paint
- Footer line stacking from `terminal.columns` override
- Git stderr suppression in workspace module
- Dispose guards to avoid clearing new session's render reference

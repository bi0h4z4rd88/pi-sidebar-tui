# Changelog

All notable changes to this project will be documented in this file.

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

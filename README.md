# pi-sidebar-tui

OpenCode-style sidebar TUI extension for [pi coding agent](https://github.com/earendil-works/pi).

Displays a real-time sidebar panel inside the pi terminal UI showing session metrics, todo tracking, workspace status, and connected MCP servers — inspired by [OpenCode](https://github.com/atanunny/opencode) sidebar.

## Features

### Session Panel
- Session title (auto-inferred from first user message with LLM fallback, or manually set)
- Session elapsed time (updated every 30 seconds)
- Active tool indicator with live elapsed timer
- Current model name with thinking level (`think:high`, `think:medium`, etc.)
- Context window usage: `tokens / max_window (pct%)` — fill bar colored by usage: green <50%, yellow 50–80%, red >80%
- Context estimate: `left ≈Nt` — turns remaining until the window fills at recent growth rate (`∞` when flat, `—` until enough data); colored muted ≥20t / accent 5–19t / warning red <5t
- Auto-compact status indicator
- Token input/output totals + session cost
- Cache hit percentage + turn count
- Live tokens-per-second (tok/s) via 2-second sliding window
- Session ID display
- Theme-aware colors (delegates to pi Theme API when available)

### MCP Servers Panel
- Connected MCP server status with connection indicators
- Tool count per server (direct/total)
- Token estimate per server

### Todos Panel
- Parses todo items from tool calls (`todo` tool)
- Status glyphs: `○` pending, `◐` in progress, `✓` completed
- Progress counter: `Todos (2/5)`
- Sub-action annotations for in-progress items

### Workspace Panel
- Git branch with ahead/untracked counts
- Dirty file listing with diff stats (+N/-N)
- Current working directory at bottom of sidebar
- Auto-refreshes on write operations (write/edit/bash/computer tools)

## Installation

```bash
pi install npm:pi-sidebar-tui
```

The extension auto-registers via the `"pi"` field in `package.json`.

## Usage

The sidebar activates automatically when a session starts. Toggle visibility with:

```
/sidebar-tui on        # Enable sidebar
/sidebar-tui off       # Disable sidebar
/sidebar-tui width 45  # Set sidebar width (10-120)
/sidebar-tui todos 7   # Set the todos panel viewport height (1-100, default 7)
/sidebar-tui scroll 3  # Set keyboard scroll nudge size in lines (1-20, default 3)
/sidebar-tui min-main 40  # Hide the sidebar when pi's area would be narrower than 40 columns (default 0 = never hide)

/sidebar-scroll up      # Scroll the focused panel up one nudge
/sidebar-scroll down    # Scroll the focused panel down one nudge
/sidebar-scroll top     # Scroll the focused panel to the top
/sidebar-scroll bottom  # Scroll the focused panel to the bottom
/sidebar-scroll 10      # Scroll the focused panel by N lines

Ctrl+Shift+T            # Toggle sidebar on/off (rebind in ~/.pi/agent/keybindings.json)
Alt+Shift+Up / Down     # Scroll the focused panel up / down one nudge (Ctrl+Alt+Up / Down too)
Alt+PageUp / PageDown   # Scroll the focused panel a page (3x the nudge size)
```

The **Session** panel stays pinned at the top. The **Todos**, **MCP**, and **Workspace** panels each scroll **independently** when their content is taller than their own window (small terminal, or many todos / MCP servers / workspace files). Each scrolling panel shows `▲ N lines above` / `▼ N lines below` indicators; panels that fit render in full with no indicators. The scrollable panels share the available rows and fill down to the cwd row, so there's no dead blank band above it when the content is long enough (on a very short terminal the panels are squeezed down to fit, or clip, rather than pushing the whole sidebar off-screen).

**Scrolling:** the mouse wheel over a panel scrolls that panel (fullscreen mode only) and focuses it. The keyboard (`/sidebar-scroll`, `Alt+Shift+Up/Down`, `Alt+PageUp/Down`) scrolls the *focused* panel — the last one you scrolled with the mouse, or the first scrollable panel if you haven't yet.

Set custom session title:

```
/session-title "My feature implementation"
```

## Configuration

### Narrow terminals

The sidebar can step aside on a terminal too narrow to fit both, giving pi the full width, and come back when the terminal widens again (a phone rotated to landscape, a split pane resized). It's off by default (`minMainWidth` `0`, the sidebar shows at any width). Set `/sidebar-tui min-main <N>` to hide it whenever pi's area would be narrower than N columns: with the default sidebar width of 45, `min-main 40` shows it from 86 columns up.

Settings are saved in `~/.pi/agent/sidebar-tui.json` (`enabled`, `width`, `todosMax`, `scrollSpeed`, `minMainWidth`).

### Environment

| Env var | Default | Description |
| --- | --- | --- |
| `PI_SIDEBAR_BG` | *(unset)* | Paint the sidebar with an opaque `#rrggbb` background. Unset (default) leaves the terminal background untouched so terminal transparency shows through. Set e.g. `PI_SIDEBAR_BG="#000000"` to hide scroll flash on opaque terminals. |
| `PI_SIDEBAR_SCROLL_SPEED` | `3` | Lines per keyboard scroll nudge (1-20). Overrides the persisted `scrollSpeed`; a page is 3x this. The mouse wheel uses the terminal's native scroll amount. |

## Requirements

- [pi coding agent](https://github.com/earendil-works/pi) >= 0.74.0
- [pi-tui](https://github.com/earendil-works/pi) >= 0.74.0

## Architecture

```
pi-sidebar-tui/
├── index.ts              # Extension entry point, event handlers, state management
├── sidebar.ts            # Main sidebar renderer (composes all panels)
├── compositor.ts         # Terminal compositor for right-column layout
├── colors.ts             # ANSI color helpers, formatting utilities
├── types.ts              # TypeScript type definitions
├── mcp.ts                # MCP server discovery and status
├── workspace.ts          # Git workspace state tracking
├── panels/
│   ├── session.ts        # Session metrics panel
│   ├── todos.ts          # Todo tracking panel
│   ├── workspace.ts      # Git workspace status panel
│   └── mcp.ts            # MCP server status panel
├── tests/
│   ├── panels.test.ts    # Panel rendering tests
│   └── sidebar.test.ts   # Sidebar rendering tests
└── package.json
```

## How It Works

The extension hooks into pi's event system (`session_start`, `tool_call`, `message_end`, `turn_end`, etc.) to track state and renders a right-column sidebar using a custom `SidebarCompositor` that:

1. Narrows `terminal.columns` so pi renders main content in the left portion
2. Paints the sidebar in the rightmost columns after each pi render cycle
3. Uses synchronized output (`\x1b[?2026h`) to prevent rendering artifacts
4. Saves/restores cursor position (`DECSC`/`DECRC`) around paint

## Development

```bash
npm install
npm test
```

## Publish on npm

```bash
npm login
npm publish
```

## License

MIT

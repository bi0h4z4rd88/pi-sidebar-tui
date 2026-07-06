# pi-sidebar-tui

OpenCode-style sidebar TUI extension for [pi coding agent](https://github.com/earendil-works/pi).

Displays a real-time sidebar panel inside the pi terminal UI showing session metrics, todo tracking, subagent monitoring, workspace status, and connected MCP servers — inspired by [OpenCode](https://github.com/atanunny/opencode) sidebar.

## Features

### Session Panel
- Session title (auto-inferred from first user message with LLM fallback, or manually set)
- Session elapsed time (updated every 30 seconds)
- Active tool indicator with live elapsed timer
- Current model name with thinking level (`think:high`, `think:medium`, etc.)
- Context window usage: `tokens / max_window (pct%)`
- Auto-compact status indicator
- Token input/output totals + session cost
- Cache hit percentage + turn count
- Live tokens-per-second (tok/s) via 2-second sliding window

### MCP Servers Panel
- Connected MCP server status with connection indicators
- Tool count per server (direct/total)
- Token estimate per server

### Todos Panel
- Parses todo items from tool calls (`todo` tool)
- Status glyphs: `○` pending, `●` in progress, `✓` completed
- Progress counter: `Todos (2/5)`
- Sub-action annotations for in-progress items

### Async Subagents Panel
- Tracks dispatched subagents (task/dispatch/agent tools)
- Status: running (animated spinner), completed, or failed
- Per-agent: turns, tool count, token usage, elapsed time
- Last 3 tool calls logged per agent
- Parallel subagent indicator

### Workspace Panel
- Git branch with ahead/untracked counts
- Dirty file listing with diff stats (+N/-N)
- Current working directory at bottom of sidebar
- Auto-refreshes on write operations (write/edit/bash/computer tools)

## Installation

```bash
# Install as a pi package
pi install bi0h4z4rd88/pi-sidebar-tui

# Or clone manually into your extensions directory
git clone https://github.com/bi0h4z4rd88/pi-sidebar-tui.git
```

Add to your pi extensions config. The extension auto-registers via the `"pi"` field in `package.json`.

## Usage

The sidebar activates automatically when a session starts. Toggle visibility with:

```
/sidebar-tui on       # Enable sidebar
/sidebar-tui off      # Disable sidebar
/sidebar-tui toggle   # Toggle on/off
/sidebar-tui width 45 # Set sidebar width (10-120)
```

Set custom session title:

```
/session-title "My feature implementation"
```

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
│   ├── subagents.ts      # Async subagent monitoring panel
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

## License

MIT

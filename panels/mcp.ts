import type { SidebarContext } from "../types.ts";
import { dim, fg, COLORS, panelHeader } from "../colors.ts";

export function renderMcpPanel(ctx: SidebarContext, width: number): string[] {
  const servers = ctx.mcpServers;
  if (!servers || servers.length === 0) return [];

  const lines: string[] = [...panelHeader("MCP Servers", width)];

  for (const srv of servers) {
    const dot = srv.connected ? fg(COLORS.success, "●") : fg(COLORS.warning, "○");
    const tokens = formatTokens(srv.tokenEstimate);
    const count = String(srv.toolCount);
    // right-align: name · count · ~tokens
    const suffix = `  ${count}  ~${tokens}`;
    const nameMax = Math.max(0, width - 4 - suffix.length);
    const name = srv.name.length > nameMax ? srv.name.slice(0, nameMax - 1) + "…" : srv.name;
    lines.push(dim("  ") + dot + " " + fg(COLORS.accent, name) + dim(suffix));
  }

  return lines;
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + "M";
  if (n >= 1000) return (n / 1000).toFixed(1) + "k";
  return String(n);
}

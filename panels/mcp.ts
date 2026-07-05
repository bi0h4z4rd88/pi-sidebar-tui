import type { SidebarContext } from "../types.ts";
import { dim, fg, COLORS, panelHeader } from "../colors.ts";

export function renderMcpPanel(ctx: SidebarContext, width: number): string[] {
  const servers = ctx.mcpServers;
  if (!servers || servers.length === 0) return [];

  const lines: string[] = [...panelHeader("MCP Servers", width)];

  for (const srv of servers) {
    const dot = srv.connected
      ? (srv.directCount === srv.totalCount && srv.totalCount > 0
          ? fg(COLORS.success, "●")
          : fg(COLORS.warning, "◐"))
      : dim("○");

    const countStr = srv.totalCount > 0 ? `${srv.directCount}/${srv.totalCount}` : "";
    const tokenStr = srv.directCount > 0 ? `  ~${srv.tokenEstimate.toLocaleString()}` : "";
    const suffix = dim(`  ${countStr}${tokenStr}`);
    const suffixVisibleLen = 2 + countStr.length + (srv.directCount > 0 ? 2 + String(srv.tokenEstimate.toLocaleString()).length + 1 : 0);

    const nameMax = Math.max(0, width - 4 - suffixVisibleLen);
    const name = srv.name.length > nameMax
      ? srv.name.slice(0, nameMax - 1) + "…"
      : srv.name;

    lines.push(dim("  ") + dot + " " + fg(COLORS.accent, name) + suffix);
  }

  return lines;
}

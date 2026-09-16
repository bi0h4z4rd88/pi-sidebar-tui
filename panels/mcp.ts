import type { SidebarContext } from "../types.ts";
import { dim, fg, COLORS, panelHeader, padToMin } from "../colors.ts";

// Reserved content rows so the panel footprint is stable (header + this many).
const MIN_MCP_ROWS = 2;

export function renderMcpPanel(ctx: SidebarContext, width: number): string[] {
  const servers = ctx.mcpServers ?? [];

  const header = panelHeader("MCP Servers", width);
  const content: string[] = [];

  for (const srv of servers) {
    const dot = srv.disabled
      ? dim("⊘")
      : srv.connected
        ? (srv.directCount === srv.totalCount && srv.totalCount > 0
            ? fg(COLORS.success, "●")
            : fg(COLORS.warning, "◐"))
        : dim("○");

    const countStr = srv.totalCount > 0 ? `${srv.directCount}/${srv.totalCount}` : "";
    const tokenStr = srv.directCount > 0 ? `  ~${srv.tokenEstimate.toLocaleString()}` : "";
    const suffix = dim(`  ${countStr}${tokenStr}`);
    const suffixVisibleLen = 2 + countStr.length + (srv.directCount > 0 ? 2 + String(srv.tokenEstimate.toLocaleString()).length + 1 : 0);

    const nameMax = Math.max(0, width - 3 - suffixVisibleLen);
    const name = srv.name.length > nameMax
      ? srv.name.slice(0, nameMax - 1) + "…"
      : srv.name;

    content.push(dim(" ") + dot + " " + fg(COLORS.accent, name) + suffix);
  }

  return [...header, ...padToMin(content, MIN_MCP_ROWS)];
}

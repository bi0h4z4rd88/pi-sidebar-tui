import { truncateToWidth } from "@earendil-works/pi-tui";
import type { SidebarContext } from "../types.ts";
import { dim, fg, COLORS, panelHeader } from "../colors.ts";

export function renderSessionPanel(ctx: SidebarContext, width: number): string[] {
  const lines: string[] = [...panelHeader("Session", width)];

  const title = ctx.sessionTitle;
  if (!title) {
    lines.push(dim("  (waiting for first message…)"));
  } else {
    const truncated = truncateToWidth(title, Math.max(0, width - 2), "…");
    lines.push(dim(`  ${truncated}`));
  }

  lines.push("");

  // Model
  if (ctx.model) {
    const modelStr = truncateToWidth(ctx.model, Math.max(0, width - 8), "…");
    lines.push(dim("  ◈ ") + fg(COLORS.accent, modelStr));
  }

  // Context usage: nb_ctx / max_ctx (pct%)
  if (ctx.contextPercent !== null) {
    const pct = ctx.contextPercent.toFixed(1) + "%";
    const tokens = ctx.contextTokens !== null ? formatK(ctx.contextTokens) : "?";
    const win = ctx.contextWindow !== null ? formatK(ctx.contextWindow) : "?";
    lines.push(dim(`  ctx `) + fg(COLORS.header, `${tokens} / ${win}`) + dim(` (${pct})`));
  }

  return lines;
}

function formatK(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + "M";
  if (n >= 1000) return Math.round(n / 1000) + "k";
  return String(n);
}

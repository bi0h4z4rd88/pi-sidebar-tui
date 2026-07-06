import { truncateToWidth } from "@earendil-works/pi-tui";
import type { SidebarContext } from "../types.ts";
import { dim, fg, COLORS, panelHeader } from "../colors.ts";

const NA = "—";

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

  // Active tool (live only)
  if (ctx.activeTool) {
    const toolElapsed = Date.now() - ctx.activeTool.startedAt;
    const toolName = truncateToWidth(ctx.activeTool.name, Math.max(0, width - 14), "…");
    lines.push(dim("  tool  ") + fg(COLORS.accent, toolName) + dim(` (${formatDuration(toolElapsed)})`));
    lines.push("");
  }

  // Model
  const modelStr = ctx.model
    ? truncateToWidth(ctx.model, Math.max(0, width - 10), "…")
    : NA;
  lines.push(dim("  model ") + fg(ctx.model ? COLORS.accent : COLORS.muted, modelStr));

  if (ctx.model && ctx.thinkingLevel && ctx.thinkingLevel !== "off") {
    lines.push(dim(`  think ${ctx.thinkingLevel}`));
  }

  // Context
  if (ctx.contextPercent !== null) {
    const pct = ctx.contextPercent;
    const tokens = ctx.contextTokens !== null ? formatK(ctx.contextTokens) : "?";
    const win = ctx.contextWindow !== null ? formatK(ctx.contextWindow) : "?";
    const ctxColor = pct > 90 ? COLORS.warning : pct > 70 ? COLORS.accent : COLORS.header;
    lines.push(dim("  ctx   ") + fg(ctxColor, `${tokens} / ${win}`) + dim(` (${pct.toFixed(1)}%)`));
    if (ctx.autoCompactEnabled !== null) {
      const compactColor = pct > 70 ? COLORS.warning : COLORS.muted;
      lines.push(dim("  ") + fg(compactColor, ctx.autoCompactEnabled ? "auto-compact on" : "auto-compact off"));
    }
  } else {
    lines.push(dim("  ctx   ") + fg(COLORS.muted, NA));
  }

  lines.push("");

  // Timing
  const elapsed = Date.now() - ctx.sessionStartMs;
  lines.push(dim("  time  ") + fg(COLORS.muted, elapsed >= 1000 ? formatDuration(elapsed) : NA));
  lines.push(dim("  last  ") + fg(COLORS.muted, ctx.lastTurnMs !== null ? formatDuration(ctx.lastTurnMs) : NA));

  const avgTps = ctx.modelGenerationMs > 0
    ? Math.round(ctx.modelTokensOut / (ctx.modelGenerationMs / 1000))
    : null;
  lines.push(dim("  speed ") + fg(COLORS.muted, avgTps !== null ? `${avgTps} tok/s` : NA));

  lines.push("");

  // Tokens
  lines.push(dim("  in    ") + fg(COLORS.muted, ctx.tokensIn > 0 ? formatK(ctx.tokensIn) : NA));
  lines.push(dim("  out   ") + fg(COLORS.muted, ctx.tokensOut > 0 ? formatK(ctx.tokensOut) : NA));

  const tokenTotal = ctx.tokensIn + ctx.tokensOut + ctx.cacheRead + ctx.cacheWrite;
  lines.push(dim("  total ") + fg(COLORS.muted, tokenTotal > 0 ? formatK(tokenTotal) : NA));

  const totalIn = ctx.tokensIn + ctx.cacheRead;
  const cacheHitPct = totalIn > 0 ? Math.round((ctx.cacheRead / totalIn) * 100) : null;
  lines.push(dim("  cache ") + fg(COLORS.muted, cacheHitPct !== null && cacheHitPct > 0 ? `${cacheHitPct}%` : NA));

  lines.push(dim("  cost  ") + fg(COLORS.muted, ctx.sessionCost > 0 ? `$${ctx.sessionCost.toFixed(3)}` : NA));
  lines.push(dim("  turns ") + fg(COLORS.muted, ctx.turnCount > 0 ? String(ctx.turnCount) : NA));

  return lines;
}

function formatK(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + "M";
  if (n >= 1000) return Math.round(n / 1000) + "k";
  return String(n);
}

function formatDuration(ms: number): string {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const h = Math.floor(m / 60);
  if (h > 0) return `${h}h${m % 60}m`;
  if (m > 0) return `${m}m${s % 60}s`;
  return `${s}s`;
}

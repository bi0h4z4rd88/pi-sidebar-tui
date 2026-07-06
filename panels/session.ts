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

  // Session elapsed time
  const elapsed = Date.now() - ctx.sessionStartMs;
  if (elapsed >= 1000) {
    lines.push(dim("  time  ") + fg(COLORS.muted, formatDuration(elapsed)));
  }

  lines.push("");

  // Active tool (live, shown when agent is running)
  if (ctx.activeTool) {
    const toolElapsed = Date.now() - ctx.activeTool.startedAt;
    const toolName = truncateToWidth(ctx.activeTool.name, Math.max(0, width - 14), "…");
    lines.push(dim("  tool  ") + fg(COLORS.accent, toolName) + dim(` (${formatDuration(toolElapsed)})`));
    lines.push("");
  }

  // Model + thinking level
  if (ctx.model) {
    const thinkSuffix = ctx.thinkingLevel && ctx.thinkingLevel !== "off"
      ? dim(` · think:${ctx.thinkingLevel}`)
      : "";
    const suffixLen = ctx.thinkingLevel && ctx.thinkingLevel !== "off"
      ? ` · think:${ctx.thinkingLevel}`.length
      : 0;
    const modelStr = truncateToWidth(ctx.model, Math.max(0, width - 10 - suffixLen), "…");
    lines.push(dim("  model ") + fg(COLORS.accent, modelStr) + thinkSuffix);
  }

  // Context usage
  if (ctx.contextPercent !== null) {
    const pct = ctx.contextPercent;
    const pctStr = pct.toFixed(1) + "%";
    const tokens = ctx.contextTokens !== null ? formatK(ctx.contextTokens) : "?";
    const win = ctx.contextWindow !== null ? formatK(ctx.contextWindow) : "?";
    const ctxColor = pct > 90 ? COLORS.warning : pct > 70 ? COLORS.accent : COLORS.header;
    lines.push(dim("  ctx   ") + fg(ctxColor, `${tokens} / ${win}`) + dim(` (${pctStr})`));

    if (ctx.autoCompactEnabled !== null) {
      const compactColor = pct > 70 ? COLORS.warning : COLORS.muted;
      const label = ctx.autoCompactEnabled ? "auto-compact on" : "auto-compact off";
      lines.push(dim("  ") + fg(compactColor, label));
    }
  }

  // Speed + last turn latency
  const avgTps = ctx.modelGenerationMs > 0
    ? Math.round(ctx.modelTokensOut / (ctx.modelGenerationMs / 1000))
    : null;
  if (avgTps !== null) {
    lines.push(dim("  speed ") + fg(COLORS.muted, `${avgTps} tok/s`));
  }
  if (ctx.lastTurnMs !== null) {
    lines.push(dim("  last  ") + fg(COLORS.muted, formatDuration(ctx.lastTurnMs)));
  }

  // Tokens in / out + cost
  if (ctx.tokensIn > 0 || ctx.tokensOut > 0) {
    lines.push(dim("  in    ") + fg(COLORS.muted, formatK(ctx.tokensIn)));
    lines.push(dim("  out   ") + fg(COLORS.muted, formatK(ctx.tokensOut)));
    if (ctx.sessionCost > 0) {
      lines.push(dim("  cost  ") + fg(COLORS.muted, `$${ctx.sessionCost.toFixed(3)}`));
    }
  }

  // Session token total
  const tokenTotal = ctx.tokensIn + ctx.tokensOut + ctx.cacheRead + ctx.cacheWrite;
  if (tokenTotal > 0) {
    lines.push(dim("  total ") + fg(COLORS.muted, formatK(tokenTotal)));
  }

  // Cache efficiency + turn count
  const totalIn = ctx.tokensIn + ctx.cacheRead;
  const cacheHitPct = totalIn > 0 ? Math.round((ctx.cacheRead / totalIn) * 100) : null;
  if (cacheHitPct !== null && cacheHitPct > 0) {
    lines.push(dim("  cache ") + fg(COLORS.muted, `${cacheHitPct}%`));
  }
  if (ctx.turnCount > 0) {
    lines.push(dim("  turns ") + fg(COLORS.muted, String(ctx.turnCount)));
  }

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

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
    lines.push(dim("  ⏱ " + formatDuration(elapsed)));
  }

  lines.push("");

  // Active tool (live, shown when agent is running)
  if (ctx.activeTool) {
    const toolElapsed = Date.now() - ctx.activeTool.startedAt;
    const toolName = truncateToWidth(ctx.activeTool.name, Math.max(0, width - 10), "…");
    lines.push(fg(COLORS.warning, "  ⚙ ") + fg(COLORS.accent, toolName) + dim(` (${formatDuration(toolElapsed)})`));
    lines.push("");
  }

  // Model + thinking level + provider
  if (ctx.model) {
    const thinkSuffix = ctx.thinkingLevel && ctx.thinkingLevel !== "off"
      ? dim(` · think:${ctx.thinkingLevel}`)
      : "";
    const suffixLen = ctx.thinkingLevel && ctx.thinkingLevel !== "off"
      ? ` · think:${ctx.thinkingLevel}`.length
      : 0;
    const modelStr = truncateToWidth(ctx.model, Math.max(0, width - 6 - suffixLen), "…");
    lines.push(dim("  ◈ ") + fg(COLORS.accent, modelStr) + thinkSuffix);
    if (ctx.modelProvider) {
      lines.push(dim(`  via ${ctx.modelProvider}`));
    }
  }

  // Context usage: nb_ctx / max_ctx (pct%)
  if (ctx.contextPercent !== null) {
    const pct = ctx.contextPercent;
    const pctStr = pct.toFixed(1) + "%";
    const tokens = ctx.contextTokens !== null ? formatK(ctx.contextTokens) : "?";
    const win = ctx.contextWindow !== null ? formatK(ctx.contextWindow) : "?";
    const ctxColor = pct > 90 ? COLORS.warning : pct > 70 ? COLORS.accent : COLORS.header;
    lines.push(dim(`  ctx `) + fg(ctxColor, `${tokens} / ${win}`) + dim(` (${pctStr})`));

    // Compaction indicator
    if (ctx.autoCompactEnabled !== null) {
      const compactColor = pct > 70 ? COLORS.warning : COLORS.muted;
      const label = ctx.autoCompactEnabled ? "⚡ auto-compact on" : "⚡ auto-compact off";
      lines.push(dim("  ") + fg(compactColor, label));
    }
  }

  // Live TPS during streaming
  if (ctx.agentStartMs !== null && ctx.streamingOut > 0) {
    const elapsedSec = (Date.now() - ctx.agentStartMs) / 1000;
    const tps = elapsedSec > 0 ? Math.round(ctx.streamingOut / elapsedSec) : 0;
    if (tps > 0) {
      lines.push(fg(COLORS.success, `  ~${tps} tok/s`));
    }
  }

  // Last turn latency
  if (ctx.lastTurnMs !== null && ctx.agentStartMs === null) {
    lines.push(dim("  last ") + fg(COLORS.muted, formatDuration(ctx.lastTurnMs)));
  }

  // Token in / out + cost
  if (ctx.tokensIn > 0 || ctx.tokensOut > 0) {
    const costStr = ctx.sessionCost > 0 ? dim(`  $${ctx.sessionCost.toFixed(3)}`) : "";
    lines.push(
      dim("  ↑") + fg(COLORS.muted, formatK(ctx.tokensIn)) +
      dim("  ↓") + fg(COLORS.muted, formatK(ctx.tokensOut)) +
      costStr
    );
  }

  // Session token total
  const tokenTotal = ctx.tokensIn + ctx.tokensOut + ctx.cacheRead + ctx.cacheWrite;
  if (tokenTotal > 0) {
    lines.push(dim("  Σ ") + fg(COLORS.muted, formatK(tokenTotal)));
  }

  // Cache efficiency + turn count
  const totalIn = ctx.tokensIn + ctx.cacheRead;
  const cacheHitPct = totalIn > 0 ? Math.round((ctx.cacheRead / totalIn) * 100) : null;
  const hasCacheInfo = cacheHitPct !== null && cacheHitPct > 0;
  const hasTurns = ctx.turnCount > 0;

  if (hasCacheInfo || hasTurns) {
    const parts: string[] = [];
    if (hasCacheInfo) parts.push(dim("  ↩") + fg(COLORS.muted, `${cacheHitPct}%`));
    if (hasTurns) parts.push(dim(`  ${ctx.turnCount} turn${ctx.turnCount === 1 ? "" : "s"}`));
    lines.push(parts.join(""));
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

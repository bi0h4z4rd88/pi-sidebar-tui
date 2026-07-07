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
  if (ctx.sessionId) {
    lines.push(dim(`  ${ctx.sessionId}`));
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
  const hasThink = !!(ctx.model && ctx.thinkingLevel && ctx.thinkingLevel !== "off");
  const modelDisplay = ctx.model
    ? truncateToWidth(ctx.model, Math.max(0, width - 10 - (hasThink ? 2 + ctx.thinkingLevel!.length : 0)), "…")
    : NA;
  lines.push(
    dim("  model ") +
    fg(ctx.model ? COLORS.accent : COLORS.muted, modelDisplay) +
    (hasThink ? dim(` - ${ctx.thinkingLevel}`) : "")
  );

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

  // Two-column stats
  // Col1: time, last, speed, cost, turns
  // Col2: in, out, total, cache
  const elapsed = Date.now() - ctx.sessionStartMs;
  const avgTps = ctx.liveTps ?? ctx.lastTps;
  const tokenTotal = ctx.tokensIn + ctx.tokensOut + ctx.cacheRead + ctx.cacheWrite;
  const totalIn = ctx.tokensIn + ctx.cacheRead;
  const cacheHitPct = totalIn > 0 ? Math.round((ctx.cacheRead / totalIn) * 100) : null;

  const col1: [string, string][] = [
    ["time", elapsed >= 1000 ? formatDuration(elapsed) : NA],
    ["last", ctx.lastTurnMs !== null ? formatDuration(ctx.lastTurnMs) : NA],
    ["speed", avgTps !== null ? `${avgTps} tok/s` : NA],
    ["turns", ctx.turnCount > 0 ? String(ctx.turnCount) : NA],
    ["cost", ctx.sessionCost > 0 ? `$${ctx.sessionCost.toFixed(3)}` : NA],
  ];

  const col2: [string, string][] = [
    ["in", ctx.tokensIn > 0 ? formatK(ctx.tokensIn) : NA],
    ["out", ctx.tokensOut > 0 ? formatK(ctx.tokensOut) : NA],
    ["total", tokenTotal > 0 ? formatK(tokenTotal) : NA],
    ["cache", cacheHitPct !== null && cacheHitPct > 0 ? `${cacheHitPct}%` : NA],
  ];

  const usable = Math.max(0, width - 2);
  const c1W = Math.floor(usable / 2);
  const c2W = usable - c1W;
  const v1W = Math.max(0, c1W - 6); // 5 label + 1 space
  const v2W = Math.max(0, c2W - 6);

  // Column sub-headers with separator
  const h1 = "Stats".padEnd(c1W);
  const h2 = "Tokens";
  lines.push(dim("  " + h1 + h2));
  lines.push(dim("  " + "─".repeat(Math.max(0, usable - 1))));

  const rowCount = Math.max(col1.length, col2.length);
  for (let i = 0; i < rowCount; i++) {
    const [l1, v1] = col1[i] ?? ["", ""];
    const [l2, v2] = col2[i] ?? ["", ""];
    const v1s = v1.slice(0, v1W).padEnd(v1W);
    const v2s = v2.slice(0, v2W);
    lines.push(
      dim("  " + l1.padEnd(5) + " ") + fg(COLORS.muted, v1s) +
      dim(l2.padEnd(5) + " ") + fg(COLORS.muted, v2s)
    );
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

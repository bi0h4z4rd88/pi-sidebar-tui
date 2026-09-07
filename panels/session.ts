import type { SidebarContext, CtxSample, CtxLeft } from "../types.ts";
import { dim, fg, COLORS, panelHeader, trunc, thinkingColorName } from "../colors.ts";
import { cavemanFireFrame, cavemanLabel } from "../caveman.ts";

const NA = "—";

// Left label column: leading space + label left-padded to 7 + trailing space.
// 9 cols total so the longest label ("caveman") fits with a gap; every value
// in the Session panel then aligns at the same column.
const label = (name: string): string => " " + name.padEnd(7) + " ";

export function estimateCtxLeft(
  samples: CtxSample[],
  contextTokens: number | null,
  contextWindow: number | null,
): CtxLeft {
  if (samples.length < 2 || contextTokens === null || contextWindow === null) {
    return { kind: "unknown" };
  }
  const first = samples[0];
  const last = samples[samples.length - 1];
  const dTurns = last.turns - first.turns;
  if (dTurns <= 0) return { kind: "unknown" };
  const rate = (last.tokens - first.tokens) / dTurns;
  if (rate <= 0) return { kind: "stable" };
  const remaining = Math.max(0, contextWindow - contextTokens);
  return { kind: "left", turns: Math.floor(remaining / rate) };
}

export function renderSessionPanel(ctx: SidebarContext, width: number): string[] {
  const lines: string[] = [...panelHeader("Session", width)];

  const title = ctx.sessionTitle;
  if (!title) {
    lines.push(dim(" (waiting for first message…)"));
  } else {
    const truncated = trunc(title, Math.max(0, width - 2));
    lines.push(dim(` ${truncated}`));
  }
  if (ctx.sessionId) {
    lines.push(dim(` ${ctx.sessionId}`));
  }

  lines.push("");

  // Model
  const thinkText = ctx.model
    ? (ctx.thinkingLevel && ctx.thinkingLevel !== "off" ? ` - ${ctx.thinkingLevel}` : " - think off")
    : "";
  const modelDisplay = ctx.model
    ? trunc(ctx.model, Math.max(0, width - 12 - thinkText.length))
    : NA;
  // Color the thinking level with pi's own per-level theme color (delegates to
  // the live pi theme via fg(); falls back to the dark-theme hex otherwise).
  const thinkPart = ctx.model
    ? (ctx.thinkingLevel && ctx.thinkingLevel !== "off"
        ? dim(" - ") + fg(thinkingColorName(ctx.thinkingLevel), ctx.thinkingLevel)
        : dim(" - think off"))
    : "";
  lines.push(
    dim(label("model")) +
    fg(ctx.model ? COLORS.accent : COLORS.muted, modelDisplay) +
    thinkPart
  );

  // Caveman mode (from the pi-caveman extension). Omitted when off/uninstalled.
  if (ctx.cavemanLevel && ctx.cavemanLevel !== "off") {
    lines.push(
      dim(label("caveman")) +
      cavemanFireFrame(ctx.cavemanFrame) +
      fg(COLORS.accent, ` ${cavemanLabel(ctx.cavemanLevel)}`)
    );
  }

  const ctxEst = estimateCtxLeft(ctx.ctxSamples, ctx.contextTokens, ctx.contextWindow);

  // Context — window usage as a fill bar
  if (ctx.contextPercent !== null) {
    const pct = ctx.contextPercent;
    const tokens = ctx.contextTokens !== null ? formatK(ctx.contextTokens) : "?";
    const win = ctx.contextWindow !== null ? formatK(ctx.contextWindow) : "?";
    // Pace-aware severity: estimate drives escalation (e.g. 40% but 3 turns to full)
    const estSeverity = ctxEst.kind === "left"
      ? (ctxEst.turns < 5 ? 2 : ctxEst.turns < 20 ? 1 : 0)
      : 0;
    const pctSeverity = pct > 90 ? 2 : pct > 70 ? 1 : 0;
    const sev = Math.max(estSeverity, pctSeverity);
    const ctxColor = sev === 2 ? COLORS.warning : sev === 1 ? COLORS.accent : COLORS.success;

    const prefix = label("ctx");
    const pctLabel = `${Math.round(pct)}%`;
    const gap = 1;
    const rightPad = 2; // keep 2 cols clear on the right edge
    const barWidth = Math.max(4, width - rightPad - prefix.length - gap - pctLabel.length);
    const clamped = Math.max(0, Math.min(100, pct));
    const filled = Math.round((clamped / 100) * barWidth);
    const empty = Math.max(0, barWidth - filled);

    lines.push(
      dim(prefix) +
      fg(ctxColor, "█".repeat(filled)) +
      dim("░".repeat(empty)) +
      " " +
      fg(ctxColor, pctLabel)
    );

    const compact = ctx.autoCompactEnabled === null ? ""
      : ctx.autoCompactEnabled ? " · auto-compact on" : " · auto-compact off";
    lines.push(dim(`${" ".repeat(prefix.length)}${tokens} / ${win} tkns${compact}`));
  } else {
    lines.push(dim(label("ctx")) + fg(COLORS.muted, NA));
  }

  // Active tool (live only) — rendered right after the ctx / tokens line
  if (ctx.activeTool) {
    const toolElapsed = Date.now() - ctx.activeTool.startedAt;
    const toolName = trunc(ctx.activeTool.name, Math.max(0, width - 16));
    lines.push(dim(label("tool")) + fg(COLORS.accent, toolName) + dim(` (${formatDuration(toolElapsed)})`));
  }

  lines.push("");

  // Two-column stats
  // Col1: time, last, speed, turns, left
  // Col2: in, out, total, cache, cost
  const elapsed = Date.now() - ctx.sessionStartMs;
  const avgTps = ctx.liveTps ?? ctx.lastTps;
  const tokenTotal = ctx.tokensIn + ctx.tokensOut + ctx.cacheRead + ctx.cacheWrite;
  const totalIn = ctx.tokensIn + ctx.cacheRead;
  const cacheHitPct = totalIn > 0 ? Math.round((ctx.cacheRead / totalIn) * 100) : null;

  const leftValue = ctxEst.kind === "left" ? `≈${ctxEst.turns}t` : ctxEst.kind === "stable" ? "∞" : NA;
  const leftColor = ctxEst.kind !== "left" ? COLORS.muted
    : ctxEst.turns < 5 ? COLORS.warning
    : ctxEst.turns < 20 ? COLORS.accent
    : COLORS.muted;

  const col1: [string, string, string][] = [
    ["time", elapsed >= 1000 ? formatDuration(elapsed) : NA, COLORS.muted],
    ["last", ctx.lastTurnMs !== null ? formatDuration(ctx.lastTurnMs) : NA, COLORS.muted],
    ["speed", avgTps !== null ? `${avgTps} tok/s` : NA, COLORS.muted],
    ["turns", ctx.turnCount > 0 ? String(ctx.turnCount) : NA, COLORS.muted],
    ["left", leftValue, leftColor],
  ];

  const col2: [string, string][] = [
    ["in", ctx.tokensIn > 0 ? formatK(ctx.tokensIn) : NA],
    ["out", ctx.tokensOut > 0 ? formatK(ctx.tokensOut) : NA],
    ["total", tokenTotal > 0 ? formatK(tokenTotal) : NA],
    ["cache", cacheHitPct !== null && cacheHitPct > 0 ? `${cacheHitPct}%` : NA],
    ["cost", ctx.sessionCost > 0 ? `$${ctx.sessionCost.toFixed(3)}` : NA],
  ];

  const usable = Math.max(0, width - 2);
  const c1W = Math.floor(usable / 2);
  const c2W = usable - c1W;
  const v1W = Math.max(0, c1W - 6); // 5 label + 1 space
  const v2W = Math.max(0, c2W - 6);

  // Column sub-headers with separator
  const h1 = "Stats".padEnd(c1W);
  const h2 = "Tokens";
  lines.push(dim(" " + h1 + h2));
  lines.push(dim(" " + "─".repeat(Math.max(0, usable - 1))));

  const rowCount = Math.max(col1.length, col2.length);
  for (let i = 0; i < rowCount; i++) {
    const [l1, v1, c1] = col1[i] ?? ["", "", COLORS.muted];
    const [l2, v2] = col2[i] ?? ["", ""];
    const v1s = v1.slice(0, v1W).padEnd(v1W);
    const v2s = v2.slice(0, v2W);
    lines.push(
      dim(" " + l1.padEnd(5) + " ") + fg(c1, v1s) +
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

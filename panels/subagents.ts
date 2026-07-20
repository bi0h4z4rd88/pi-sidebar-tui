import type { SidebarContext, SubagentEntry } from "../types.ts";
import {
  dim, fg, COLORS, panelHeader, trunc,
  formatDuration, formatRelativeTime, formatTokens, spinnerFrame,
} from "../colors.ts";

function renderSubagentBlock(agent: SubagentEntry, width: number): string[] {
  const lines: string[] = [];

  const now = Date.now();
  const elapsed = now - agent.startedAt;

  let statusGlyph: string;
  let agentNameColor: string;
  if (agent.status === "completed") {
    statusGlyph = fg(COLORS.success, "✓");
    agentNameColor = COLORS.success;
  } else if (agent.status === "failed") {
    statusGlyph = fg(COLORS.warning, "✗");
    agentNameColor = COLORS.warning;
  } else {
    statusGlyph = fg(COLORS.accent, spinnerFrame());
    agentNameColor = COLORS.accent;
  }

  const nameMax = Math.max(0, width - 2);
  const truncName = trunc(agent.name, nameMax);
  lines.push(`${statusGlyph} ${fg(agentNameColor, truncName)}`);

  if (agent.status === "completed" && agent.completedAt !== undefined) {
    const duration = agent.completedAt - agent.startedAt;
    const ago = now - agent.completedAt;
    lines.push(dim(`  complete (${formatRelativeTime(ago)})`));
    const meta = `${agent.turns} turns · ${agent.toolCount} tools · ${formatTokens(agent.tokens)} tokens · ${formatDuration(duration)}`;
    lines.push(dim(`  ${trunc(meta, Math.max(0, width - 2))}`));
  } else if (agent.status === "failed") {
    lines.push(dim(`  failed (${formatRelativeTime(elapsed)})`));
    const meta = `${agent.turns} turns · ${agent.toolCount} tools · ${formatTokens(agent.tokens)} tokens`;
    lines.push(dim(`  ${trunc(meta, Math.max(0, width - 2))}`));
  } else {
    lines.push(dim(`  running (${formatDuration(elapsed)})`));
    const meta = `${agent.turns} turns · ${agent.toolCount} tools · ${formatTokens(agent.tokens)} tokens`;
    lines.push(dim(`  ${trunc(meta, Math.max(0, width - 2))}`));
  }

  const recentLog = agent.toolLog.slice(-3);
  for (const entry of recentLog) {
    lines.push(dim(`  ${trunc(entry, Math.max(0, width - 2))}`));
  }

  return lines;
}

export function renderSubagentsPanel(ctx: SidebarContext, width: number): string[] {
  const { subagents } = ctx;
  const running = subagents.filter(a => a.status === "running").length;
  const completed = subagents.filter(a => a.status === "completed").length;

  const parallelSuffix = running > 1 ? " · parallel" : "";
  const title = `Async Subagents (${completed}/${subagents.length})${parallelSuffix}`;
  const lines: string[] = [...panelHeader(title, width)];

  if (subagents.length === 0) {
    lines.push(dim("  (no subagents)"));
    return lines;
  }

  for (let i = 0; i < subagents.length; i++) {
    if (i > 0) lines.push("");
    lines.push(...renderSubagentBlock(subagents[i], width));
  }

  return lines;
}

import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import type { SidebarContext } from "../types.ts";
import { bold, dim, fg, COLORS, formatDiffStat } from "../colors.ts";
import type { WorkspaceFile } from "../types.ts";

function buildGitStatus(branch: string, ahead: number, untracked: number): string {
  let status = `⎇ ${branch}`;
  if (ahead > 0) status += ` +${ahead}`;
  if (untracked > 0) status += ` ?${untracked}`;
  return status;
}

function renderWorkspaceHeader(ctx: SidebarContext, width: number): string[] {
  const left = bold(" Workspace");
  const leftPlain = " Workspace";

  if (!ctx.branch) {
    return [left, dim("─".repeat(Math.max(0, width)))];
  }

  const gitStatus = buildGitStatus(ctx.branch, ctx.aheadCount, ctx.untrackedCount);
  const leftLen = visibleWidth(leftPlain);
  let rightLen = visibleWidth(gitStatus);
  const minPadding = 1;

  // If the right side is too long, truncate it
  let displayStatus = gitStatus;
  if (leftLen + minPadding + rightLen > width) {
    const maxStatusLen = Math.max(0, width - leftLen - minPadding);
    displayStatus = truncateToWidth(gitStatus, maxStatusLen, "…");
  }

  rightLen = visibleWidth(displayStatus);
  const padding = Math.max(1, width - leftLen - rightLen);
  const headerLine = `${left}${" ".repeat(padding)}${dim(displayStatus)}`;

  return [headerLine, dim("─".repeat(Math.max(0, width)))];
}

function renderFileLine(file: WorkspaceFile, width: number): string {
  const stat = formatDiffStat(file.added, file.removed);
  const statLen = visibleWidth(stat);
  const pathMax = Math.max(0, width - statLen - 1);
  const path = truncateToWidth(file.path, pathMax, "…");
  const pathLen = visibleWidth(path);
  const padding = Math.max(1, width - pathLen - statLen);
  return `${path}${" ".repeat(padding)}${fg(COLORS.success, stat)}`;
}

export function renderWorkspacePanel(ctx: SidebarContext, width: number): string[] {
  const lines: string[] = [...renderWorkspaceHeader(ctx, width)];

  if (!ctx.branch) {
    lines.push(dim("  (not a git repo)"));
    return lines;
  }

  const files = ctx.workspaceFiles.slice(0, 15);
  if (files.length === 0) {
    lines.push(dim("  (clean)"));
    return lines;
  }

  for (const file of files) {
    lines.push(renderFileLine(file, width));
  }

  return lines;
}

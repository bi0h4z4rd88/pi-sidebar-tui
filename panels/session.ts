import { truncateToWidth } from "@earendil-works/pi-tui";
import type { SidebarContext } from "../types.ts";
import { dim, panelHeader } from "../colors.ts";

export function renderSessionPanel(ctx: SidebarContext, width: number): string[] {
  const lines: string[] = [...panelHeader("Session", width)];

  const title = ctx.sessionTitle;
  if (!title) {
    lines.push(dim("  (waiting for first message…)"));
  } else {
    const truncated = truncateToWidth(title, Math.max(0, width - 2), "…");
    lines.push(dim(`  ${truncated}`));
  }

  return lines;
}

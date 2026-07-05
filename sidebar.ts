import { truncateToWidth } from "@earendil-works/pi-tui";
import type { SidebarContext } from "./types.ts";
import { renderSessionPanel } from "./panels/session.ts";
import { renderTodosPanel } from "./panels/todos.ts";
import { renderSubagentsPanel } from "./panels/subagents.ts";
import { renderWorkspacePanel } from "./panels/workspace.ts";

export function renderSidebar(ctx: SidebarContext, width: number): string[] {
  const safeWidth = Math.max(1, width);

  const panels = [
    renderSessionPanel(ctx, safeWidth),
    renderTodosPanel(ctx, safeWidth),
    renderSubagentsPanel(ctx, safeWidth),
    renderWorkspacePanel(ctx, safeWidth),
  ];

  const result: string[] = [];
  for (let i = 0; i < panels.length; i++) {
    if (i > 0) result.push("");
    for (const line of panels[i]) {
      result.push(truncateToWidth(line, safeWidth, "", true));
    }
  }

  return result;
}

import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import type { SidebarContext, TodoItem, TodoStatus } from "../types.ts";
import { dim, fg, COLORS, panelHeader } from "../colors.ts";

const GLYPHS: Record<TodoStatus, string> = {
  completed: "✓",
  in_progress: "●",
  pending: "○",
};

const GLYPH_COLORS: Record<TodoStatus, string> = {
  completed: COLORS.success,
  in_progress: COLORS.accent,
  pending: COLORS.muted,
};

function renderTodoLine(todo: TodoItem, width: number): string {
  const glyph = fg(GLYPH_COLORS[todo.status], GLYPHS[todo.status]);
  const glyphWidth = 1; // all glyphs are 1 visible char
  const spaceAfterGlyph = 1;
  const indent = glyphWidth + spaceAfterGlyph;

  if (todo.status === "in_progress" && todo.subAction) {
    const subText = ` (${todo.subAction})`;
    const contentMax = Math.max(0, width - indent);
    const fullText = todo.content + subText;
    if (visibleWidth(fullText) <= contentMax) {
      return `${glyph} ${todo.content}${dim(subText)}`;
    }
    const contentTruncated = truncateToWidth(todo.content, Math.max(0, contentMax - 4), "…");
    return `${glyph} ${contentTruncated}`;
  }

  const contentMax = Math.max(0, width - indent);
  const content = truncateToWidth(todo.content, contentMax, "…");
  return `${glyph} ${content}`;
}

export function renderTodosPanel(ctx: SidebarContext, width: number): string[] {
  const { todos } = ctx;
  const done = todos.filter(t => t.status === "completed").length;
  const title = `Todos (${done}/${todos.length})`;
  const lines: string[] = [...panelHeader(title, width)];

  if (todos.length === 0) {
    lines.push(dim("  (no todos)"));
    return lines;
  }

  for (const todo of todos) {
    lines.push(renderTodoLine(todo, width));
  }

  return lines;
}

import { visibleWidth } from "@earendil-works/pi-tui";
import type { SidebarContext, TodoItem, TodoStatus } from "../types.ts";
import { dim, fg, COLORS, panelHeader, trunc } from "../colors.ts";

const GLYPHS: Record<TodoStatus, string> = {
  completed: "✓",
  in_progress: "◐",
  pending: "○",
};

const GLYPH_COLORS: Record<TodoStatus, string> = {
  completed: COLORS.success,
  in_progress: COLORS.accent,
  pending: COLORS.muted,
};

const LEFT_PAD = 1; // gap between the sidebar's side border and the content

function renderTodoLine(todo: TodoItem, width: number): string {
  const leftPad = " ".repeat(LEFT_PAD);
  const glyph = fg(GLYPH_COLORS[todo.status], GLYPHS[todo.status]);
  const glyphWidth = 1; // all glyphs are 1 visible char
  const spaceAfterGlyph = 1;
  const indent = LEFT_PAD + glyphWidth + spaceAfterGlyph;

  if (todo.status === "in_progress" && todo.subAction) {
    const subText = ` (${todo.subAction})`;
    const contentMax = Math.max(0, width - indent);
    const fullText = todo.content + subText;
    if (visibleWidth(fullText) <= contentMax) {
      return `${leftPad}${glyph} ${todo.content}${dim(subText)}`;
    }
    const contentTruncated = trunc(todo.content, Math.max(0, contentMax - 4));
    return `${leftPad}${glyph} ${contentTruncated}`;
  }

  const contentMax = Math.max(0, width - indent);
  const content = trunc(todo.content, contentMax);
  return `${leftPad}${glyph} ${content}`;
}

/**
 * Pick the most useful todos to show within a cap: in-progress first (original
 * order), then the most recent (highest list position). Returns the list
 * unchanged when it fits or `max` is invalid.
 */
export function selectTodosToShow(todos: TodoItem[], max: number): TodoItem[] {
  if (!Number.isFinite(max) || max <= 0 || todos.length <= max) return todos;
  const inProgress = todos.filter(t => t.status === "in_progress");
  const chosen: TodoItem[] = inProgress.slice(0, max);
  if (chosen.length < max) {
    const chosenSet = new Set(chosen);
    const recent = todos
      .filter(t => t.status !== "in_progress" && !chosenSet.has(t))
      .slice(-(max - chosen.length));
    chosen.push(...recent);
  }
  return chosen;
}

export function renderTodosPanel(ctx: SidebarContext, width: number): string[] {
  const { todos, todosMax } = ctx;
  const done = todos.filter(t => t.status === "completed").length;
  const title = `Todos (${done}/${todos.length})`;
  const lines: string[] = [...panelHeader(title, width)];

  if (todos.length === 0) {
    lines.push(dim(" (no todos)"));
    return lines;
  }

  const max = typeof todosMax === "number" && todosMax > 0 ? todosMax : todos.length;
  const shown = selectTodosToShow(todos, max);
  const hidden = todos.length - shown.length;

  for (const todo of shown) {
    lines.push(renderTodoLine(todo, width));
  }

  if (hidden > 0) {
    lines.push(dim(` … +${hidden} more`));
  }

  return lines;
}

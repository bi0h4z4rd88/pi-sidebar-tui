import type { TodoItem, TodoStatus } from "./types.ts";

/**
 * Parse a todo list from a todo tool's payload.
 *
 * Handles two shapes:
 *  - The full list passed in the tool INPUT (list-in-args style): a bare
 *    array, or an object with a `todos` / `items` / `list` key.
 *  - The list returned in the tool RESULT details (pi-todo style):
 *    `details = { todos: [{ id, text, done }], ... }`.
 *
 * Returns `null` when no todo array is present (e.g. an action-only input
 * like `{ action, text, id }`), so callers can distinguish "no list" from an
 * empty list (which returns `[]`).
 */
export function parseTodos(input: unknown): TodoItem[] | null {
  if (!input || typeof input !== "object") return null;

  const obj = input as Record<string, unknown>;
  const raw = obj["todos"] ?? obj["items"] ?? obj["list"] ?? input;
  if (!Array.isArray(raw)) return null;

  const result: TodoItem[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const i = item as Record<string, unknown>;

    const content =
      typeof i["content"] === "string" ? i["content"] :
      typeof i["text"] === "string" ? i["text"] : null;
    if (!content) continue;

    result.push({
      id: normalizeId(i["id"], result.length),
      content,
      status: normalizeStatus(i),
      subAction: typeof i["subAction"] === "string" ? i["subAction"] : undefined,
    });
  }
  return result;
}

/**
 * Reconstruct the todo list from a session branch (resume support).
 *
 * A todo tool (pi-todo, built-in) stores a FULL snapshot in each tool result's
 * `details.todos`, so the state at a given point in history is simply the LAST
 * `todo` tool result in the branch. This mirrors how the pi-todo plugin
 * restores state on `session_start`.
 *
 * `branch` is the array from `sessionManager.getBranch()`. Each entry of the
 * form `{ type: "message", message: { role: "toolResult", toolName: "todo",
 * details: {...} } }` is a candidate. Returns `[]` when nothing is found.
 */
export function reconstructTodosFromBranch(branch: unknown): TodoItem[] {
  if (!Array.isArray(branch)) return [];

  let last: TodoItem[] | null = null;
  for (const entry of branch) {
    if (!entry || (entry as Record<string, unknown>)["type"] !== "message") continue;
    const msg = (entry as Record<string, any>)["message"];
    if (msg?.role !== "toolResult" || msg.toolName !== "todo") continue;
    const parsed = parseTodos(msg?.details);
    if (parsed !== null) last = parsed;
  }
  return last ?? [];
}

function normalizeId(id: unknown, fallbackIndex: number): string {
  if (typeof id === "string" && id.length > 0) return id;
  if (typeof id === "number" && Number.isFinite(id)) return String(id);
  return String(fallbackIndex);
}

function normalizeStatus(i: Record<string, unknown>): TodoStatus {
  if (typeof i["status"] === "string") {
    switch (i["status"]) {
      case "in_progress":
      case "active":
        return "in_progress";
      case "completed":
      case "done":
        return "completed";
      default:
        return "pending";
    }
  }
  // Boolean-based shapes (e.g. pi-todo uses `done`).
  if (i["done"] === true || i["completed"] === true) return "completed";
  if (i["in_progress"] === true || i["active"] === true) return "in_progress";
  return "pending";
}

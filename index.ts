import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { TodoItem, SubagentEntry, SidebarContext } from "./types.ts";
import { renderSidebar } from "./sidebar.ts";
import { getWorkspaceData, invalidateWorkspaceCache } from "./workspace.ts";

const SIDEBAR_WIDTH = 36;
const TOOL_LOG_MAX = 10;
const SUBAGENT_TOOL_PATTERN = /^(task|dispatch|agent)/i;
const TODO_TOOL_PATTERN = /todo/i;
const WRITE_TOOLS = new Set(["write", "edit", "bash", "computer"]);

let sidebarEnabled = true;
let sidebarWidth = SIDEBAR_WIDTH;
let sessionTitle: string | null = null;
let todos: TodoItem[] = [];
const subagentsMap = new Map<string, SubagentEntry>();
let activeSubagentId: string | null = null;

function buildSidebarContext(cwd: string | undefined): SidebarContext {
  const ws = getWorkspaceData(cwd);
  return {
    sessionTitle,
    todos,
    subagents: Array.from(subagentsMap.values()),
    branch: ws.branch,
    aheadCount: ws.aheadCount,
    untrackedCount: ws.untrackedCount,
    workspaceFiles: ws.files,
    cwd,
  };
}

function parseTodos(input: unknown): TodoItem[] | null {
  if (!input || typeof input !== "object") return null;

  const obj = input as Record<string, unknown>;
  const raw = obj["todos"] ?? obj["items"] ?? obj["list"] ?? input;
  if (!Array.isArray(raw)) return null;

  const result: TodoItem[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const i = item as Record<string, unknown>;
    const content = typeof i["content"] === "string" ? i["content"] :
                    typeof i["text"] === "string" ? i["text"] : null;
    const status = typeof i["status"] === "string" ? i["status"] : "pending";
    const id = typeof i["id"] === "string" ? i["id"] : String(result.length);
    const subAction = typeof i["subAction"] === "string" ? i["subAction"] : undefined;
    if (!content) continue;

    const normalizedStatus =
      status === "in_progress" || status === "active" ? "in_progress" :
      status === "completed" || status === "done" ? "completed" : "pending";

    result.push({ id, content, status: normalizedStatus, subAction });
  }
  return result;
}

function extractSubagentName(input: unknown): string {
  if (!input || typeof input !== "object") return "subagent";
  const obj = input as Record<string, unknown>;
  const name = obj["name"] ?? obj["title"] ?? obj["description"] ?? obj["task"];
  if (typeof name !== "string") return "subagent";
  return name.split("\n")[0].slice(0, 60);
}

export default function opencodesSidebar(pi: ExtensionAPI) {
  let currentCwd: string | undefined;
  let requestRender: (() => void) | null = null;

  pi.on("session_start", async (_event, ctx) => {
    sessionTitle = null;
    todos = [];
    subagentsMap.clear();
    activeSubagentId = null;
    invalidateWorkspaceCache();
    currentCwd = (ctx as any).cwd;

    const hasUI = (ctx as any).hasUI;
    if (!hasUI) return;

    const ui = (ctx as any).ui;
    let renderTick = 0;
    let tuiRef: any = null;
    const scheduleRender = () => {
      const tick = ++renderTick;
      setTimeout(() => {
        if (tick === renderTick) tuiRef?.requestRender();
      }, 16);
    };
    const myRender = scheduleRender;
    requestRender = myRender;

    ui.setWidget("powerline-sidebar", (tui: any, _theme: any) => {
      tuiRef = tui;
      return {
        dispose() { if (requestRender === myRender) { requestRender = null; tuiRef = null; } },
        invalidate() {},
        render(_width: number): string[] {
          if (!sidebarEnabled) return [];
          return renderSidebar(buildSidebarContext(currentCwd), sidebarWidth);
        },
      };
    });
  });

  pi.on("session_shutdown", async () => {
    sessionTitle = null;
    todos = [];
    subagentsMap.clear();
    activeSubagentId = null;
  });

  pi.on("before_agent_start", async (event, ctx) => {
    currentCwd = (ctx as any).cwd;
    if (sessionTitle === null && typeof (event as any).prompt === "string") {
      sessionTitle = (event as any).prompt.slice(0, 60);
    }
    requestRender?.();
  });

  pi.on("tool_call", async (event, ctx) => {
    currentCwd = (ctx as any).cwd;
    const toolName = (event as any).toolName ?? "";
    const input = (event as any).input;
    const toolCallId = (event as any).toolCallId ?? toolName;

    if (TODO_TOOL_PATTERN.test(toolName)) {
      const parsed = parseTodos(input);
      if (parsed !== null) {
        todos = parsed;
        requestRender?.();
      }
    } else if (SUBAGENT_TOOL_PATTERN.test(toolName)) {
      const entry: SubagentEntry = {
        id: toolCallId,
        name: extractSubagentName(input),
        status: "running",
        startedAt: Date.now(),
        turns: 0,
        toolCount: 0,
        tokens: 0,
        toolLog: [],
      };
      subagentsMap.set(toolCallId, entry);
      activeSubagentId = toolCallId;
      requestRender?.();
    } else if (activeSubagentId) {
      const active = subagentsMap.get(activeSubagentId);
      if (active) {
        const inputPreview = typeof input === "string"
          ? input.slice(0, 40)
          : typeof input === "object" && input !== null
            ? JSON.stringify(input).slice(0, 40)
            : "";
        active.toolLog.push(`${toolName}: ${inputPreview}`);
        if (active.toolLog.length > TOOL_LOG_MAX) {
          active.toolLog.shift();
        }
        active.toolCount++;
        requestRender?.();
      }
    }
  });

  pi.on("tool_result", async (event) => {
    const toolName = (event as any).toolName ?? "";
    const toolCallId = (event as any).toolCallId ?? toolName;

    if (WRITE_TOOLS.has(toolName.toLowerCase())) {
      invalidateWorkspaceCache();
    }

    if (subagentsMap.has(toolCallId)) {
      const entry = subagentsMap.get(toolCallId)!;
      entry.status = (event as any).isError ? "failed" : "completed";
      entry.completedAt = Date.now();
      if (activeSubagentId === toolCallId) {
        activeSubagentId = null;
      }
      requestRender?.();
    }
  });

  pi.on("message_end", async (event, ctx) => {
    currentCwd = (ctx as any).cwd;
    if (activeSubagentId) {
      const active = subagentsMap.get(activeSubagentId);
      if (active) {
        active.turns++;
        const usage = (event as any).message?.usage;
        if (usage && typeof usage.output === "number") {
          active.tokens += (usage.input ?? 0) + (usage.output ?? 0);
        }
      }
    }
    requestRender?.();
  });

  pi.on("turn_end", async (_event, ctx) => {
    currentCwd = (ctx as any).cwd;
    invalidateWorkspaceCache();
    requestRender?.();
  });

  pi.on("agent_end", async (_event, ctx) => {
    currentCwd = (ctx as any).cwd;
    invalidateWorkspaceCache();
    requestRender?.();
  });

  pi.registerCommand("sidebar-tui", {
    description: "Toggle OpenCode sidebar (on, off, toggle, width <N>)",
    handler: async (args, ctx) => {
      currentCwd = (ctx as any).cwd;
      const trimmed = args?.trim() ?? "";

      if (trimmed === "on") {
        sidebarEnabled = true;
      } else if (trimmed === "off") {
        sidebarEnabled = false;
      } else if (trimmed.startsWith("width ")) {
        const n = parseInt(trimmed.slice(6), 10);
        if (!isNaN(n) && n >= 10 && n <= 120) {
          sidebarWidth = n;
        } else {
          (ctx as any).ui?.notify?.("Usage: /sidebar-tui width <10-120>", "warning");
          return;
        }
      } else {
        sidebarEnabled = !sidebarEnabled;
      }

      (ctx as any).ui?.notify?.(
        `OpenCode sidebar ${sidebarEnabled ? "enabled" : "disabled"}`,
        "info"
      );
    },
  });

  pi.registerCommand("session-title", {
    description: "Set session title shown in sidebar",
    handler: async (args, ctx) => {
      const title = args?.trim() ?? "";
      if (!title) {
        (ctx as any).ui?.notify?.("Usage: /session-title <text>", "warning");
        return;
      }
      sessionTitle = title;
      requestRender?.();
      (ctx as any).ui?.notify?.(`Session title set: ${title}`, "info");
    },
  });
}

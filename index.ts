import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { TodoItem, SubagentEntry, SidebarContext, McpServerInfo } from "./types.ts";
import { renderSidebar } from "./sidebar.ts";
import { getWorkspaceData, invalidateWorkspaceCache } from "./workspace.ts";
import { SidebarCompositor } from "./compositor.ts";
import { getMcpServers } from "./mcp.ts";

const TOOL_LOG_MAX = 10;
const SUBAGENT_TOOL_PATTERN = /^(task|dispatch|agent)/i;
const TODO_TOOL_PATTERN = /todo/i;
const WRITE_TOOLS = new Set(["write", "edit", "bash", "computer"]);

let sidebarEnabled = true;
let sessionTitle: string | null = null;
let todos: TodoItem[] = [];
const subagentsMap = new Map<string, SubagentEntry>();
let activeSubagentId: string | null = null;
let currentModel: string | null = null;
let thinkingLevel: string | null = null;
let contextTokens: number | null = null;
let contextPercent: number | null = null;
let contextWindow: number | null = null;
let tokensIn = 0;
let tokensOut = 0;
let cacheRead = 0;
let cacheWrite = 0;
let sessionCost = 0;
let turnCount = 0;
let activeTool: { name: string; startedAt: number } | null = null;
let autoCompactEnabled: boolean | null = null;
let sessionStartMs = Date.now();
let mcpServers: McpServerInfo[] = [];
let modelProvider: string | null = null;
let agentStartMs: number | null = null;
let modelTokensOut = 0;
let modelAgentMs = 0;
let lastTurnMs: number | null = null;
let sessionTimerHandle: ReturnType<typeof setInterval> | null = null;

function inferThinkingLevel(sm: any): string | null {
  try {
    const entries: any[] = sm.getBranch?.() ?? [];
    for (let i = entries.length - 1; i >= 0; i--) {
      const e = entries[i];
      if (e?.type === "thinking_level_change" && typeof e.thinkingLevel === "string") {
        return e.thinkingLevel;
      }
    }
  } catch {
    // ignore
  }
  return null;
}

function inferSessionTitle(sm: any): string | null {
  try {
    const entries: any[] = sm.getBranch?.() ?? [];
    for (const e of entries) {
      if (e?.type !== "message") continue;
      const msg = e.message;
      if (msg?.role !== "user") continue;
      const content = msg.content;
      const text = typeof content === "string"
        ? content
        : Array.isArray(content)
          ? content.find((c: any) => c?.type === "text")?.text ?? ""
          : "";
      const trimmed = text.trim().replace(/\s+/g, " ");
      if (trimmed) return trimmed.slice(0, 60);
    }
  } catch {
    // ignore
  }
  return null;
}

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
    model: currentModel,
    thinkingLevel,
    contextTokens,
    contextPercent,
    contextWindow,
    tokensIn,
    tokensOut,
    cacheRead,
    cacheWrite,
    sessionCost,
    turnCount,
    activeTool,
    autoCompactEnabled,
    sessionStartMs,
    mcpServers,
    modelProvider,
    modelTokensOut,
    modelAgentMs,
    lastTurnMs,
  };
}

function updateContextUsage(ctx: any): void {
  try {
    const usage = ctx.getContextUsage?.();
    if (usage) {
      contextTokens = typeof usage.tokens === "number" ? usage.tokens : null;
      contextPercent = typeof usage.percent === "number" ? usage.percent : null;
      contextWindow = typeof usage.contextWindow === "number" ? usage.contextWindow : null;
    }
    const model = ctx.model;
    if (model?.name) currentModel = model.name;
    else if (model?.id) currentModel = model.id;
    modelProvider = (model as any)?.provider ?? (model as any)?.backend ?? null;
  } catch {
    // ignore
  }
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
  let currentCwd: string | undefined = process.cwd();
  let requestRender: (() => void) | null = null;

  pi.on("session_start", async (_event, ctx) => {
    sessionTitle = ctx.sessionManager.getSessionName() ?? inferSessionTitle(ctx.sessionManager) ?? null;
    todos = [];
    subagentsMap.clear();
    activeSubagentId = null;
    currentModel = null;
    thinkingLevel = null;
    contextTokens = null;
    contextPercent = null;
    contextWindow = null;
    mcpServers = getMcpServers();
    sessionStartMs = Date.now();
    if (sessionTimerHandle) { clearInterval(sessionTimerHandle); sessionTimerHandle = null; }
    sessionTimerHandle = setInterval(() => requestRender?.(), 30_000);
    activeTool = null;
    turnCount = 0;
    autoCompactEnabled = (ctx as any).settingsManager?.getCompactionSettings?.()?.enabled ?? null;
    // Seed usage totals from existing session entries (handles resume)
    { let inSum = 0, outSum = 0, cacheSum = 0, costSum = 0, turns = 0;
      for (const e of (ctx.sessionManager.getBranch?.() ?? [])) {
        const m = (e as any).message;
        if ((e as any).type !== "message") continue;
        if (m?.role === "user") { turns++; continue; }
        if (m?.role !== "assistant") continue;
        if (m?.stopReason === "error" || m?.stopReason === "aborted") continue;
        inSum += m.usage?.input ?? 0;
        outSum += m.usage?.output ?? 0;
        cacheSum += m.usage?.cacheRead ?? 0;
        cacheWrite += m.usage?.cacheWrite ?? 0;
        costSum += m.usage?.cost?.total ?? 0;
      }
      tokensIn = inSum; tokensOut = outSum; cacheRead = cacheSum; sessionCost = costSum;
      turnCount = turns;
    }
    invalidateWorkspaceCache();
    currentCwd = (ctx as any).cwd;
    updateContextUsage(ctx);
    // Prefer live API; fall back to last thinking_level_change entry in history
    // Session history is authoritative for resumed sessions; fall back to live API
    thinkingLevel = inferThinkingLevel(ctx.sessionManager) ?? pi.getThinkingLevel?.() ?? null;

    const hasUI = (ctx as any).hasUI;
    if (!hasUI) return;

    const ui = (ctx as any).ui;
    let renderTick = 0;
    let tuiRef: any = null;
    let compositorRef: SidebarCompositor | null = null;

    const scheduleRender = () => {
      const tick = ++renderTick;
      setTimeout(() => {
        if (tick === renderTick) {
          if (compositorRef) {
            compositorRef.paint();
          } else {
            tuiRef?.requestRender();
          }
        }
      }, 16);
    };
    const myRender = scheduleRender;
    requestRender = myRender;

    ui.setWidget("opencode-sidebar", (tui: any, _theme: any) => {
      tuiRef = tui;

      if (sidebarEnabled) {
        const comp = new SidebarCompositor(
          tui,
          () => buildSidebarContext(currentCwd),
        );
        comp.install();
        compositorRef = comp;
      }

      return {
        dispose() {
          if (requestRender === myRender) { requestRender = null; tuiRef = null; }
          compositorRef?.dispose();
          compositorRef = null;
        },
        invalidate() {},
        render(_width: number): string[] { return []; },
      };
    }, { placement: "belowEditor" });
  });

  pi.on("session_info_changed", async (event, _ctx) => {
    const name = (event as any).name;
    sessionTitle = typeof name === "string" ? name : null;
    requestRender?.();
  });

  pi.on("session_shutdown", async () => {
    if (sessionTimerHandle) { clearInterval(sessionTimerHandle); sessionTimerHandle = null; }
    tokensIn = 0;
    tokensOut = 0;
    cacheRead = 0;
    cacheWrite = 0;
    sessionCost = 0;
    turnCount = 0;
    activeTool = null;
    agentStartMs = null;
    modelTokensOut = 0;
    modelAgentMs = 0;
    lastTurnMs = null;
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
    updateContextUsage(ctx);
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
    const usage = (event as any).message?.usage;
    if (usage && (event as any).message?.role === "assistant") {
      const stopReason = (event as any).message?.stopReason;
      if (stopReason !== "error" && stopReason !== "aborted") {
        tokensIn += usage.input ?? 0;
        tokensOut += usage.output ?? 0;
        cacheRead += usage.cacheRead ?? 0;
        cacheWrite += usage.cacheWrite ?? 0;
        sessionCost += usage.cost?.total ?? 0;
        modelTokensOut += usage.output ?? 0;
      }
    }
    if (activeSubagentId) {
      const active = subagentsMap.get(activeSubagentId);
      if (active) {
        active.turns++;
        if (usage && typeof usage.output === "number") {
          active.tokens += (usage.input ?? 0) + (usage.output ?? 0);
        }
      }
    }
    requestRender?.();
  });

  pi.on("turn_end", async (_event, ctx) => {
    currentCwd = (ctx as any).cwd;
    updateContextUsage(ctx);
    invalidateWorkspaceCache();
    turnCount++;
    activeTool = null;
    if (agentStartMs !== null) {
      lastTurnMs = Date.now() - agentStartMs;
      modelAgentMs += lastTurnMs;
      agentStartMs = null;
    }
    requestRender?.();
  });

  pi.on("agent_end", async (_event, ctx) => {
    currentCwd = (ctx as any).cwd;
    updateContextUsage(ctx);
    invalidateWorkspaceCache();
    requestRender?.();
  });

  pi.on("model_select", async (event, ctx) => {
    const m = (event as any).model;
    if (m?.name) currentModel = m.name;
    else if (m?.id) currentModel = m.id;
    modelTokensOut = 0;
    modelAgentMs = 0;
    lastTurnMs = null;
    updateContextUsage(ctx);
    requestRender?.();
  });

  pi.on("agent_start", async (_event, ctx) => {
    currentCwd = (ctx as any).cwd;
    agentStartMs = Date.now();
    streamingOut = 0;
    updateContextUsage(ctx);
    requestRender?.();
  });

  pi.on("tool_execution_start", async (event) => {
    const name = (event as any).toolName ?? "";
    activeTool = { name, startedAt: Date.now() };
    requestRender?.();
  });

  pi.on("tool_execution_end", async () => {
    activeTool = null;
    requestRender?.();
  });

  pi.on("thinking_level_select", async (event) => {
    thinkingLevel = (event as any).level ?? null;
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

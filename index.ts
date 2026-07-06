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
let sidebarWidth = 40;
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
let messageStartMs: number | null = null;
let modelTokensOut = 0;
let modelGenerationMs = 0;
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

const FILLER_PREFIX = /^(can you |could you |please |i want you to |i'd like you to |i need you to |help me |i need to |let's |let us )+/i;
const METHOD_WRAPPER = /^(use|create|run|make|build|write|add|generate|implement|spawn|start)\s+(?:(?:a|an|the|some|my|one)\s+)?(?:\w+\s+){0,3}(?:to|that|which|for)\s+/i;

function summarizePrompt(raw: string): string {
  const firstLine = raw.split("\n").map(l => l.trim()).find(l => l.length > 0) ?? raw.trim();
  const noFiller = firstLine.replace(FILLER_PREFIX, "").trim();
  const noWrapper = noFiller.replace(METHOD_WRAPPER, "").trim();
  const title = noWrapper.charAt(0).toUpperCase() + noWrapper.slice(1);
  return title.slice(0, 60);
}

async function generateTitleWithModel(prompt: string, ctx: any, onTitle: (t: string) => void): Promise<void> {
  try {
    const registry = ctx.modelRegistry;
    if (!registry?.streamSimple) return;
    const modelDesc = ctx.model;
    if (!modelDesc) return;
    const fullModel = (registry.getAll() as any[]).find((m: any) => m.id === modelDesc.id);
    if (!fullModel) return;
    const context = {
      messages: [{
        role: "user" as const,
        content: `Write a 5-7 word task title for this request. Start with an action verb. No punctuation. Output only the title.\n\n${prompt.slice(0, 500)}`,
      }],
    };
    const stream = registry.streamSimple(fullModel, context, { maxTokens: 20, reasoning: "off" });
    const message = await (stream as any).result();
    const text = (message.content as any[]).find((c: any) => c.type === "text")?.text?.trim() ?? "";
    if (text.length > 0 && text.length <= 80) onTitle(text.slice(0, 60));
  } catch {
    // fallback already set
  }
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
      if (text.trim()) return summarizePrompt(text);
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
    modelGenerationMs,
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

export default function piSidebar(pi: ExtensionAPI) {
  let currentCwd: string | undefined = process.cwd();
  let requestRender: (() => void) | null = null;
  let tuiRef: any = null;
  let compositorRef: SidebarCompositor | null = null;

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

    ui.setWidget("pi-sidebar", (tui: any, _theme: any) => {
      tuiRef = tui;

      if (sidebarEnabled) {
        const comp = new SidebarCompositor(
          tui,
          () => buildSidebarContext(currentCwd),
          sidebarWidth,
        );
        comp.install();
        compositorRef = comp;
      }

      return {
        dispose() {
          if (requestRender === myRender) { requestRender = null; }
          compositorRef?.dispose();
          compositorRef = null;
          tuiRef = null;
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
    modelGenerationMs = 0;
    lastTurnMs = null;
    sessionTitle = null;
    todos = [];
    subagentsMap.clear();
    activeSubagentId = null;
  });

  pi.on("before_agent_start", async (event, ctx) => {
    currentCwd = (ctx as any).cwd;
    if (sessionTitle === null && typeof (event as any).prompt === "string") {
      const raw = (event as any).prompt as string;
      sessionTitle = summarizePrompt(raw);
      generateTitleWithModel(raw, ctx, (title) => {
        sessionTitle = title;
        requestRender?.();
      });
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

  pi.on("message_start", async (event) => {
    if ((event as any).message?.role === "assistant") {
      messageStartMs = Date.now();
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
        if (messageStartMs !== null) {
          modelGenerationMs += Date.now() - messageStartMs;
          messageStartMs = null;
        }
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
    modelGenerationMs = 0;
    lastTurnMs = null;
    updateContextUsage(ctx);
    requestRender?.();
  });

  pi.on("agent_start", async (_event, ctx) => {
    currentCwd = (ctx as any).cwd;
    agentStartMs = Date.now();
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
    description: "Control sidebar: /sidebar-tui on | off | width <N>",
    handler: async (args, ctx) => {
      currentCwd = (ctx as any).cwd;
      const parts = (args?.trim() ?? "").split(/\s+/);
      const cmd = parts[0];

      if (cmd === "width") {
        const n = parseInt(parts[1] ?? "", 10);
        if (isNaN(n) || n < 10 || n > 120) {
          (ctx as any).ui?.notify?.("Usage: /sidebar-tui width <10-120>", "warning");
          return;
        }
        sidebarWidth = n;
        if (compositorRef && tuiRef) {
          compositorRef.dispose();
          compositorRef = null;
          const comp = new SidebarCompositor(tuiRef, () => buildSidebarContext(currentCwd), sidebarWidth);
          comp.install();
          compositorRef = comp;
          requestRender?.();
        }
        (ctx as any).ui?.notify?.(`Sidebar width set to ${n}`, "info");
        return;
      }

      if (cmd !== "on" && cmd !== "off") {
        (ctx as any).ui?.notify?.("Usage: /sidebar-tui on | off | width <N>", "warning");
        return;
      }

      sidebarEnabled = cmd === "on";

      if (!sidebarEnabled) {
        compositorRef?.dispose();
        compositorRef = null;
      } else if (tuiRef && !compositorRef) {
        const comp = new SidebarCompositor(tuiRef, () => buildSidebarContext(currentCwd), sidebarWidth);
        comp.install();
        compositorRef = comp;
        requestRender?.();
      }

      (ctx as any).ui?.notify?.(
        `Sidebar ${sidebarEnabled ? "enabled" : "disabled"}`,
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

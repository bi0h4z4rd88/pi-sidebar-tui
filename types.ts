export type TodoStatus = "pending" | "in_progress" | "completed";

export interface TodoItem {
  id: string;
  content: string;
  status: TodoStatus;
  subAction?: string;
}

export interface WorkspaceFile {
  path: string;
  added: number;
  removed: number;
}

export interface McpServerInfo {
  name: string;
  directCount: number;
  totalCount: number;
  tokenEstimate: number;
  connected: boolean;
  disabled: boolean;
}

export interface CtxSample {
  tokens: number;
  turns: number;
}

export type CtxLeft =
  | { kind: "unknown" }
  | { kind: "stable" }
  | { kind: "left"; turns: number };

export interface SidebarContext {
  sessionTitle: string | null;
  sessionId: string | null;
  todos: TodoItem[];
  branch: string | null;
  aheadCount: number;
  untrackedCount: number;
  workspaceFiles: WorkspaceFile[];
  cwd: string | undefined;
  model: string | null;
  thinkingLevel: string | null;
  contextTokens: number | null;
  contextPercent: number | null;
  contextWindow: number | null;
  tokensIn: number;
  tokensOut: number;
  cacheRead: number;
  cacheWrite: number;
  sessionCost: number;
  turnCount: number;
  activeTool: { name: string; startedAt: number } | null;
  autoCompactEnabled: boolean | null;
  sessionStartMs: number;
  mcpServers: McpServerInfo[];
  modelProvider: string | null;
  cavemanLevel: string | null;
  cavemanFrame: number;
  liveTps: number | null;
  lastTps: number | null;
  lastTurnMs: number | null;
  ctxSamples: CtxSample[];
}

export type TodoStatus = "pending" | "in_progress" | "completed";

export interface TodoItem {
  id: string;
  content: string;
  status: TodoStatus;
  subAction?: string;
}

export type SubagentStatus = "running" | "completed" | "failed";

export interface SubagentEntry {
  id: string;
  name: string;
  status: SubagentStatus;
  startedAt: number;
  completedAt?: number;
  turns: number;
  toolCount: number;
  tokens: number;
  toolLog: string[];
}

export interface WorkspaceFile {
  path: string;
  added: number;
  removed: number;
}

export interface SidebarContext {
  sessionTitle: string | null;
  todos: TodoItem[];
  subagents: SubagentEntry[];
  branch: string | null;
  aheadCount: number;
  untrackedCount: number;
  workspaceFiles: WorkspaceFile[];
  cwd: string | undefined;
  model: string | null;
  contextPercent: number | null;
  contextWindow: number | null;
  mcpServers: { connected: number; total: number } | null;
}

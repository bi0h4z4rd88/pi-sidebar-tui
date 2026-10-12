import { readFileSync, writeFileSync, mkdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

// Mirrors pi-coding-agent's getAgentDir() ($PI_CODING_AGENT_DIR or ~/.pi/agent).
// Inlined instead of importing the package so tests never load the full
// pi-coding-agent module graph (it pulls in @earendil-works/pi-server, which
// is only present inside a real pi runtime).
function agentDir(): string {
  const envDir = process.env["PI_CODING_AGENT_DIR"];
  if (envDir) {
    return envDir.startsWith("~/") ? join(homedir(), envDir.slice(2)) : envDir;
  }
  return join(homedir(), ".pi", "agent");
}

export interface SidebarSettings {
  enabled: boolean;
  width: number;
  /** Max todos shown in the Todos panel before it caps to the last N (+ a "+N more" footer). */
  todosMax: number;
  /** Number of lines to scroll per up/down nudge (default: 3). A page is 3x this. */
  scrollSpeed: number;
  /** Fewest columns pi's main area may keep; on a narrower terminal the sidebar hides. 0 never hides it. */
  minMainWidth: number;
}

// minMainWidth defaults to 0 (never hide) so hiding on narrow terminals is
// opt-in: any non-zero default would hide the sidebar on terminals where it
// shows today (40 hides it below 86 columns, a plain 80-column one included).
export const DEFAULT_SIDEBAR_SETTINGS: SidebarSettings = { enabled: true, width: 45, todosMax: 7, scrollSpeed: 3, minMainWidth: 0 };
export const MIN_SIDEBAR_WIDTH = 10;
export const MAX_SIDEBAR_WIDTH = 120;
export const MIN_TODOS_MAX = 1;
export const MAX_TODOS_MAX = 100;
export const MIN_SCROLL_SPEED = 1;
export const MAX_SCROLL_SPEED = 20;
export const MIN_MAIN_WIDTH = 0;
export const MAX_MAIN_WIDTH = 500;

export function sidebarConfigPath(): string {
  return process.env["PI_SIDEBAR_CONFIG"] || join(agentDir(), "sidebar-tui.json");
}

export interface AutoCompactReadOptions {
  agentDir?: string;
  cwd?: string;
}

function readCompactionEnabled(settingsPath: string): boolean | null {
  let raw: string;
  try {
    raw = readFileSync(settingsPath, "utf8");
  } catch {
    return null;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;

  const compaction = (parsed as Record<string, unknown>)["compaction"];
  if (typeof compaction !== "object" || compaction === null) return null;
  const enabled = (compaction as Record<string, unknown>)["enabled"];
  return typeof enabled === "boolean" ? enabled : null;
}

export function readAutoCompactEnabled(options: AutoCompactReadOptions = {}): boolean {
  const globalPath = join(options.agentDir ?? agentDir(), "settings.json");
  const projectPath = options.cwd ? join(options.cwd, ".pi", "settings.json") : null;

  const project = projectPath ? readCompactionEnabled(projectPath) : null;
  if (project !== null) return project;

  const global = readCompactionEnabled(globalPath);
  if (global !== null) return global;

  return true;
}

function statRevision(path: string | null): string {
  if (!path) return "missing";
  try {
    const stats = statSync(path);
    return `${stats.size}:${stats.mtimeNs}`;
  } catch {
    return "missing";
  }
}

const autoCompactCache = new Map<string, { revision: string; value: boolean }>();

export function getAutoCompactEnabled(options: AutoCompactReadOptions = {}): boolean {
  const resolvedAgentDir = options.agentDir ?? agentDir();
  const cwd = options.cwd ?? "";
  const globalPath = join(resolvedAgentDir, "settings.json");
  const projectPath = cwd ? join(cwd, ".pi", "settings.json") : null;

  const cacheKey = `${resolvedAgentDir}\u0000${cwd}`;
  const revision = `${statRevision(globalPath)}|${statRevision(projectPath)}`;
  const cached = autoCompactCache.get(cacheKey);
  if (cached && cached.revision === revision) return cached.value;

  const value = readAutoCompactEnabled({ agentDir: resolvedAgentDir, cwd: cwd || undefined });
  autoCompactCache.set(cacheKey, { revision, value });
  return value;
}

function parseSettingsFile(path: string): Record<string, unknown> | null {
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch {
    return null;
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed === "object" && parsed !== null) return parsed as Record<string, unknown>;
    return null;
  } catch {
    return null;
  }
}

export function loadSidebarSettings(path: string = sidebarConfigPath()): SidebarSettings {
  const obj = parseSettingsFile(path);
  const settings: SidebarSettings = { ...DEFAULT_SIDEBAR_SETTINGS };
  if (obj) {
    if (typeof obj["enabled"] === "boolean") {
      settings.enabled = obj["enabled"];
    }
    const w = obj["width"];
    if (typeof w === "number" && Number.isInteger(w) && w >= MIN_SIDEBAR_WIDTH && w <= MAX_SIDEBAR_WIDTH) {
      settings.width = w;
    }
    const tm = obj["todosMax"];
    if (typeof tm === "number" && Number.isInteger(tm) && tm >= MIN_TODOS_MAX && tm <= MAX_TODOS_MAX) {
      settings.todosMax = tm;
    }
    const ss = obj["scrollSpeed"];
    if (typeof ss === "number" && Number.isInteger(ss) && ss >= MIN_SCROLL_SPEED && ss <= MAX_SCROLL_SPEED) {
      settings.scrollSpeed = ss;
    }
    const mm = obj["minMainWidth"];
    if (typeof mm === "number" && Number.isInteger(mm) && mm >= MIN_MAIN_WIDTH && mm <= MAX_MAIN_WIDTH) {
      settings.minMainWidth = mm;
    }
  }
  // Env override wins over both the file value and the default.
  const envSpeed = process.env["PI_SIDEBAR_SCROLL_SPEED"] ? parseInt(process.env["PI_SIDEBAR_SCROLL_SPEED"], 10) : NaN;
  if (!isNaN(envSpeed) && envSpeed >= MIN_SCROLL_SPEED && envSpeed <= MAX_SCROLL_SPEED) {
    settings.scrollSpeed = envSpeed;
  }
  return settings;
}

export function saveSidebarSettings(settings: SidebarSettings, path: string = sidebarConfigPath()): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(settings, null, 2) + "\n", "utf8");
}

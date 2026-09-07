import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

// Read-only view of the pi-caveman extension's state. The sidebar is a separate
// pi extension and cannot import pi-caveman (that would couple the two and pull
// in its module graph). Instead we read the same shared state the plugin writes:
//   1. A per-session `caveman-level` custom entry (authoritative for the run).
//   2. The config file ~/.pi/agent/caveman.json (defaultLevel + showStatus).
// If neither is present the plugin is effectively uninstalled -> show nothing.

export const CAVEMAN_LEVELS = [
  "off",
  "lite",
  "full",
  "ultra",
  "wenyan-lite",
  "wenyan",
  "wenyan-ultra",
  "micro",
] as const;

export interface CavemanConfig {
  /** Level applied to new sessions ("off" = don't auto-enable). */
  defaultLevel: string;
  /** Whether the plugin shows its own animated footer. (Not used to gate the sidebar.) */
  showStatus: boolean;
  /** True when the config file existed and was readable. */
  present: boolean;
}

const DEFAULT_CAVEMAN_CONFIG: Omit<CavemanConfig, "present"> = {
  defaultLevel: "full",
  showStatus: true,
};

/**
 * Resolve the caveman config path. Mirrors pi-caveman's getConfigDir so we read
 * the exact file the plugin writes:
 *   1. PI_CAVEMAN_CONFIG (test/override)
 *   2. PI_CODING_AGENT_DIR (env override pi itself honors)
 *   3. $XDG_CONFIG_HOME/pi/agent
 *   4. ~/.pi/agent
 */
function cavemanConfigPath(explicit?: string): string {
  if (explicit) return explicit;
  if (process.env.PI_CAVEMAN_CONFIG) return process.env.PI_CAVEMAN_CONFIG;
  const envDir = process.env.PI_CODING_AGENT_DIR;
  if (envDir) {
    return join(envDir.startsWith("~/") ? join(homedir(), envDir.slice(2)) : envDir, "caveman.json");
  }
  if (process.env.XDG_CONFIG_HOME) {
    return join(process.env.XDG_CONFIG_HOME, "pi", "agent", "caveman.json");
  }
  return join(homedir(), ".pi", "agent", "caveman.json");
}

function isValidLevel(v: unknown): v is string {
  return typeof v === "string" && (CAVEMAN_LEVELS as readonly string[]).includes(v);
}

/**
 * Load the caveman config. Never throws.
 * - missing file -> present:false, defaults
 * - unreadable/invalid JSON -> present:true, defaults (file exists => configured)
 * - invalid defaultLevel -> falls back to default ("full")
 */
export function loadCavemanConfig(explicitPath?: string): CavemanConfig {
  const path = cavemanConfigPath(explicitPath);
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch {
    return { ...DEFAULT_CAVEMAN_CONFIG, present: false };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ...DEFAULT_CAVEMAN_CONFIG, present: true };
  }
  if (typeof parsed !== "object" || parsed === null) {
    return { ...DEFAULT_CAVEMAN_CONFIG, present: true };
  }

  const obj = parsed as Record<string, unknown>;
  const config: CavemanConfig = { ...DEFAULT_CAVEMAN_CONFIG, present: true };
  if (isValidLevel(obj.defaultLevel)) config.defaultLevel = obj.defaultLevel;
  if (typeof obj.showStatus === "boolean") config.showStatus = obj.showStatus;
  return config;
}

/**
 * Resolve the effective caveman level for the current session.
 * Priority: latest valid `caveman-level` session entry > config default (if the
 * config file is present) > null (plugin uninstalled -> hide).
 * `entries` is the session branch (e.g. `sessionManager.getBranch()`).
 */
export function resolveCavemanLevel(entries: any[], cfg: CavemanConfig): string | null {
  for (let i = entries.length - 1; i >= 0; i--) {
    const e = entries[i];
    if (e?.type !== "custom" || e.customType !== "caveman-level") continue;
    const level = (e.data as { level?: unknown } | undefined)?.level;
    if (isValidLevel(level)) return level;
  }
  if (cfg.present) return cfg.defaultLevel;
  return null;
}

// --- Animated campfire (copied from pi-caveman; self-contained, no import) --

const R = "\x1b[38;5;196m"; // red
const O = "\x1b[38;5;208m"; // orange
const Y = "\x1b[38;5;220m"; // yellow
const W = "\x1b[38;5;230m"; // white-hot
const E = "\x1b[38;5;52m"; // ember (dark red)
const X = "\x1b[0m"; // reset

const FIRE_FRAMES = [
  `${R}⠠${O}⠄${X}`,
  `${O}⠔${Y}⠂${X}`,
  `${Y}⠊${W}⠑${X}`,
  `${W}⠑${Y}⠊${X}`,
  `${Y}⠂${O}⠔${X}`,
  `${O}⠄${R}⠠${X}`,
  `${R}⠠${E}⠄${X}`,
  `${E}⠔${R}⠂${X}`,
];

const LABELS: Record<string, string> = {
  lite: "LITE",
  full: "FULL",
  ultra: "ULTRA",
  "wenyan-lite": "文言",
  wenyan: "文言文",
  "wenyan-ultra": "文言文極",
  micro: "MICRO",
};

const INTERVALS: Record<string, number> = {
  lite: 300,
  full: 200,
  ultra: 100,
  "wenyan-lite": 300,
  wenyan: 200,
  "wenyan-ultra": 100,
  micro: 120,
};

/** Fire glyph for a given frame index (wraps). */
export function cavemanFireFrame(i: number): string {
  return FIRE_FRAMES[((i % FIRE_FRAMES.length) + FIRE_FRAMES.length) % FIRE_FRAMES.length] ?? FIRE_FRAMES[0]!;
}

/** Human-readable level label ("off" -> ""). */
export function cavemanLabel(level: string): string {
  return LABELS[level] ?? "";
}

/** Animation interval in ms for a level. */
export function cavemanInterval(level: string): number {
  return INTERVALS[level] ?? 200;
}

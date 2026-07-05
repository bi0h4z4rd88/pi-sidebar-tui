import { execSync } from "node:child_process";
import type { WorkspaceFile } from "./types.ts";

export interface WorkspaceData {
  branch: string | null;
  aheadCount: number;
  untrackedCount: number;
  files: WorkspaceFile[];
}

const CACHE_TTL_MS = 2000;
let cache: { data: WorkspaceData; timestamp: number } | null = null;

function run(cmd: string, cwd: string): string {
  try {
    return execSync(cmd, { cwd, encoding: "utf-8", timeout: 2000 }).trim();
  } catch {
    return "";
  }
}

function parseBranch(cwd: string): string | null {
  const out = run("git branch --show-current", cwd);
  return out || null;
}

function parseAhead(cwd: string): number {
  const out = run("git rev-list @{u}..HEAD --count", cwd);
  const n = parseInt(out, 10);
  return isNaN(n) ? 0 : n;
}

function parseUntracked(cwd: string): number {
  const out = run("git status --porcelain", cwd);
  if (!out) return 0;
  return out.split("\n").filter(l => l.startsWith("??")).length;
}

function parseNumstat(cwd: string): WorkspaceFile[] {
  const out = run("git diff --numstat HEAD", cwd);
  if (!out) return [];

  return out
    .split("\n")
    .map(line => {
      const parts = line.split("\t");
      if (parts.length < 3) return null;
      const added = parseInt(parts[0], 10);
      const removed = parseInt(parts[1], 10);
      const path = parts[2].trim();
      if (isNaN(added) || isNaN(removed) || !path) return null;
      return { path, added, removed };
    })
    .filter((f): f is WorkspaceFile => f !== null)
    .sort((a, b) => (b.added + b.removed) - (a.added + a.removed))
    .slice(0, 15);
}

export function getWorkspaceData(cwd: string | undefined): WorkspaceData {
  const empty: WorkspaceData = { branch: null, aheadCount: 0, untrackedCount: 0, files: [] };
  if (!cwd) return empty;

  const now = Date.now();
  if (cache && now - cache.timestamp < CACHE_TTL_MS) return cache.data;

  const branch = parseBranch(cwd);
  if (!branch) {
    cache = { data: empty, timestamp: now };
    return empty;
  }

  const data: WorkspaceData = {
    branch,
    aheadCount: parseAhead(cwd),
    untrackedCount: parseUntracked(cwd),
    files: parseNumstat(cwd),
  };
  cache = { data, timestamp: now };
  return data;
}

export function invalidateWorkspaceCache(): void {
  cache = null;
}

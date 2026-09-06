import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export interface McpServerInfo {
  name: string;
  directCount: number;
  totalCount: number;
  tokenEstimate: number;
  connected: boolean;
  disabled: boolean;
}

const MCP_CACHE_TTL_MS = 1500;
let mcpCache: { data: McpServerInfo[]; timestamp: number } | null = null;

function getAgentDir(): string {
  return process.env["PI_AGENT_DIR"] ?? join(homedir(), ".pi", "agent");
}

function readJson(path: string): unknown {
  try {
    return JSON.parse(readFileSync(path, "utf-8"));
  } catch {
    return null;
  }
}

function estimateTokens(tool: { name: string; description?: string; inputSchema?: unknown }): number {
  const schemaLen = JSON.stringify(tool.inputSchema ?? {}).length;
  const descLen = tool.description?.length ?? 0;
  return Math.ceil((tool.name.length + descLen + schemaLen) / 4) + 10;
}

function computeMcpServers(): McpServerInfo[] {
  const agentDir = getAgentDir();
  const config = readJson(join(agentDir, "mcp.json")) as any;
  const cache = readJson(join(agentDir, "mcp-cache.json")) as any;

  const configuredServers: Record<string, any> = config?.mcpServers ?? {};
  const cachedServers: Record<string, any> = cache?.servers ?? {};
  const globalDirect = config?.settings?.directTools;

  const names = Object.keys(configuredServers).length > 0
    ? Object.keys(configuredServers)
    : Object.keys(cachedServers);

  if (names.length === 0) return [];

  return names.map((name) => {
    const definition = configuredServers[name] ?? {};
    const srv = cachedServers[name];
    const tools: any[] = srv?.tools ?? [];

    // A disabled server is surfaced with no tool counts regardless of any cached tools.
    if (definition.disabled === true) {
      return { name, directCount: 0, totalCount: 0, tokenEstimate: 0, connected: false, disabled: true };
    }

    const connected = tools.length > 0;

    // Determine directTools filter same way mcp-panel does
    let toolFilter: true | string[] | false = false;
    if (definition.directTools !== undefined) {
      toolFilter = definition.directTools;
    } else if (globalDirect) {
      toolFilter = globalDirect;
    }

    const excludeTools: string[] = definition.excludeTools ?? [];

    let directCount = 0;
    let tokenEstimate = 0;
    let totalCount = 0;

    for (const tool of tools) {
      // Simple exclude check
      if (excludeTools.includes(tool.name)) continue;
      totalCount++;

      const isDirect = toolFilter === true || (Array.isArray(toolFilter) && toolFilter.includes(tool.name));
      if (isDirect) {
        directCount++;
        tokenEstimate += estimateTokens(tool);
      }
    }

    return { name, directCount, totalCount, tokenEstimate, connected, disabled: false };
  });
}

export function getMcpServers(): McpServerInfo[] {
  const now = Date.now();
  if (mcpCache && now - mcpCache.timestamp < MCP_CACHE_TTL_MS) return mcpCache.data;

  const data = computeMcpServers();
  mcpCache = { data, timestamp: now };
  return data;
}

export function invalidateMcpCache(): void {
  mcpCache = null;
}

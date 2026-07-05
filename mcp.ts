import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export interface McpServerInfo {
  name: string;
  toolCount: number;
  tokenEstimate: number;
  connected: boolean;
}

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

export function getMcpServers(): McpServerInfo[] {
  const agentDir = getAgentDir();
  const config = readJson(join(agentDir, "mcp.json")) as any;
  const cache = readJson(join(agentDir, "mcp-cache.json")) as any;

  const configured: string[] = config?.mcpServers ? Object.keys(config.mcpServers) : [];
  const cachedServers: Record<string, any> = cache?.servers ?? {};

  if (configured.length === 0 && Object.keys(cachedServers).length === 0) return [];

  const names = configured.length > 0 ? configured : Object.keys(cachedServers);

  return names.map((name) => {
    const srv = cachedServers[name];
    const tools: any[] = srv?.tools ?? [];
    const tokenEstimate = Math.round(
      tools.reduce((sum: number, t: any) => sum + JSON.stringify(t).length, 0) / 4
    );
    return {
      name,
      toolCount: tools.length,
      tokenEstimate,
      connected: tools.length > 0,
    };
  });
}

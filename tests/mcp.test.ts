import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getMcpServers, invalidateMcpCache } from "../mcp.ts";
import { renderMcpPanel } from "../panels/mcp.ts";
import type { McpServerInfo, SidebarContext } from "../types.ts";

function strip(s: string): string {
  return s.replace(/\x1b\[[0-9;]*m/g, "");
}

/** Run fn with PI_AGENT_DIR pointed at a fresh temp dir; restore env afterward. */
function withAgentDir<T>(setup: (dir: string) => void, fn: (dir: string) => T): T {
  const dir = mkdtempSync(join(tmpdir(), "sidebar-mcp-"));
  const prev = process.env["PI_AGENT_DIR"];
  process.env["PI_AGENT_DIR"] = dir;
  invalidateMcpCache();
  try {
    setup(dir);
    return fn(dir);
  } finally {
    if (prev === undefined) delete process.env["PI_AGENT_DIR"];
    else process.env["PI_AGENT_DIR"] = prev;
    invalidateMcpCache();
  }
}

function writeConfig(dir: string, config: unknown, cache?: unknown): void {
  writeFileSync(join(dir, "mcp.json"), JSON.stringify(config), "utf8");
  if (cache !== undefined) writeFileSync(join(dir, "mcp-cache.json"), JSON.stringify(cache), "utf8");
}

function makeMcpCtx(servers: McpServerInfo[]): SidebarContext {
  return {
    sessionTitle: null,
    sessionId: null,
    todos: [],
    branch: "main",
    aheadCount: 0,
    untrackedCount: 0,
    workspaceFiles: [],
    cwd: "/tmp/test",
    model: null,
    thinkingLevel: null,
    contextTokens: null,
    contextPercent: null,
    contextWindow: null,
    tokensIn: 0,
    tokensOut: 0,
    cacheRead: 0,
    cacheWrite: 0,
    sessionCost: 0,
    turnCount: 0,
    activeTool: null,
    autoCompactEnabled: null,
    sessionStartMs: Date.now(),
    mcpServers: servers,
    modelProvider: null,
    liveTps: null,
    lastTps: null,
    lastTurnMs: null,
    ctxSamples: [],
  };
}

// ─── getMcpServers ────────────────────────────────────────────────────────────

test("getMcpServers: disabled server is not connected and reports zero counts", () => {
  withAgentDir(
    (dir) =>
      writeConfig(
        dir,
        { mcpServers: { srv: { command: "x", disabled: true, directTools: true } } },
        { version: 1, servers: { srv: { tools: [{ name: "t1", description: "d", inputSchema: { type: "object" } }] } } },
      ),
    () => {
      const servers = getMcpServers();
      assert.equal(servers.length, 1);
      const s = servers[0];
      assert.equal(s.name, "srv");
      assert.equal(s.disabled, true);
      assert.equal(s.connected, false, "disabled server must not be reported connected");
      assert.equal(s.directCount, 0);
      assert.equal(s.totalCount, 0);
      assert.equal(s.tokenEstimate, 0);
    },
  );
});

test("getMcpServers: enabled server with direct tools reports connected with counts", () => {
  withAgentDir(
    (dir) =>
      writeConfig(
        dir,
        { mcpServers: { srv: { command: "x", directTools: true } } },
        {
          version: 1,
          servers: {
            srv: {
              tools: [
                { name: "a", description: "one", inputSchema: { type: "object" } },
                { name: "b", description: "two", inputSchema: { type: "object" } },
              ],
            },
          },
        },
      ),
    () => {
      const s = getMcpServers()[0];
      assert.equal(s.disabled, false);
      assert.equal(s.connected, true);
      assert.equal(s.totalCount, 2);
      assert.equal(s.directCount, 2);
      assert.ok(s.tokenEstimate > 0, "token estimate should be positive");
    },
  );
});

test("getMcpServers: no config and no cache yields empty list", () => {
  withAgentDir(() => writeConfig("", null), () => {
    assert.deepEqual(getMcpServers(), []);
  });
});

test("getMcpServers: invalidateMcpCache forces a fresh read", () => {
  const prev = process.env["PI_AGENT_DIR"];
  const dir = mkdtempSync(join(tmpdir(), "sidebar-mcp-"));
  process.env["PI_AGENT_DIR"] = dir;
  try {
    writeConfig(dir, { mcpServers: { alpha: { command: "x", directTools: true } } }, {
      version: 1,
      servers: { alpha: { tools: [{ name: "t", description: "d" }] } },
    });
    assert.equal(getMcpServers()[0].name, "alpha");

    // Reconfigure to a different server. Without invalidation the cache hides it.
    writeConfig(dir, { mcpServers: { beta: { command: "y", directTools: true } } }, {
      version: 1,
      servers: { beta: { tools: [{ name: "t", description: "d" }] } },
    });
    assert.equal(getMcpServers()[0].name, "alpha", "expected cached (stale) value before invalidation");

    invalidateMcpCache();
    assert.equal(getMcpServers()[0].name, "beta", "expected fresh value after invalidation");
  } finally {
    if (prev === undefined) delete process.env["PI_AGENT_DIR"];
    else process.env["PI_AGENT_DIR"] = prev;
    invalidateMcpCache();
  }
});

// ─── MCP panel ────────────────────────────────────────────────────────────────

test("mcp panel: disabled server shows a distinct glyph and no tool counts", () => {
  const ctx = makeMcpCtx([
    { name: "srv", directCount: 0, totalCount: 0, tokenEstimate: 0, connected: false, disabled: true },
  ]);
  const text = renderMcpPanel(ctx, 40).map(strip).join("\n");
  assert.ok(text.includes("srv"), `server name missing, got: ${text}`);
  assert.ok(text.includes("⊘"), `expected disabled glyph, got: ${text}`);
  assert.ok(!text.includes("0/0"), `unexpected 0/0 count for disabled server: ${text}`);
});

test("mcp panel: connected-all server keeps success dot and counts", () => {
  const ctx = makeMcpCtx([
    { name: "srv", directCount: 3, totalCount: 3, tokenEstimate: 120, connected: true, disabled: false },
  ]);
  const text = renderMcpPanel(ctx, 40).map(strip).join("\n");
  assert.ok(text.includes("3/3"), `expected 3/3 count, got: ${text}`);
  assert.ok(text.includes("●"), `expected success dot, got: ${text}`);
  assert.ok(!text.includes("⊘"), `unexpected disabled glyph: ${text}`);
});

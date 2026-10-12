import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Point the extension at a private agent dir and config before it is imported
// (it reads its settings once at import time), so the developer's own pi
// settings, MCP and caveman config never take part in the run.
const agentDir = mkdtempSync(join(tmpdir(), "sidebar-min-main-"));
const configPath = join(agentDir, "sidebar-tui.json");
process.env.PI_CODING_AGENT_DIR = agentDir;
process.env.PI_AGENT_DIR = agentDir;
process.env.PI_CAVEMAN_CONFIG = join(agentDir, "caveman.json");
process.env.PI_SIDEBAR_CONFIG = configPath;
writeFileSync(configPath, JSON.stringify({ enabled: true, width: 45, todosMax: 10, minMainWidth: 40 }));
const { default: piSidebar } = await import("../index.ts");

// A pi with one session started in a 62-column terminal (a phone in portrait).
function startSession() {
  const handlers = new Map<string, (event: any, ctx: any) => Promise<void>>();
  const commands = new Map<string, any>();
  const pi = {
    on: (name: string, handler: any) => { handlers.set(name, handler); },
    registerCommand: (name: string, opts: any) => { commands.set(name, opts); },
    registerShortcut: () => {},
  } as any;
  piSidebar(pi);

  const terminal = { columns: 62, rows: 24, write(_data: string) {} };
  const renderedWidths: number[] = [];
  const tui = {
    terminal,
    doRender() { renderedWidths.push(terminal.columns); },
    requestRender() {},
  };
  const messages: string[] = [];
  const sessionManager = { getSessionName: () => null, getBranch: () => [], getSessionId: () => "s1" };
  const ctx = {
    cwd: process.cwd(),
    hasUI: true,
    sessionManager,
    getContextUsage: () => null,
    model: null,
    ui: {
      notify: (message: string) => { messages.push(message); },
      setWidget: (_name: string, factory: any) => { factory(tui, undefined); },
    },
  } as any;
  return { handlers, commands, ctx, tui, renderedWidths, messages };
}

// session_start starts a repaint timer; shutting the session down stops it so the test process can exit.
test.afterEach(async () => {
  const s = startSession();
  await s.handlers.get("session_shutdown")!({}, s.ctx);
});

const savedMinMain = () => JSON.parse(readFileSync(configPath, "utf8")).minMainWidth;

test("on a terminal too narrow for the configured minimum, pi gets the whole width", async () => {
  const s = startSession();
  await s.handlers.get("session_start")!({}, s.ctx);
  s.tui.doRender();
  assert.equal(s.renderedWidths.at(-1), 62);
});

test("/sidebar-tui min-main changes the minimum live and persists it", async () => {
  const s = startSession();
  await s.handlers.get("session_start")!({}, s.ctx);
  const command = s.commands.get("sidebar-tui")!;

  await command.handler("min-main 10", s.ctx);
  s.tui.doRender();
  assert.equal(s.renderedWidths.at(-1), 62 - 45 - 1, "sidebar not shown after lowering the minimum");
  assert.equal(savedMinMain(), 10);
  assert.match(s.messages.at(-1)!, /10 columns/);

  await command.handler("min-main 0", s.ctx);
  assert.equal(savedMinMain(), 0);
  assert.match(s.messages.at(-1)!, /never hides/);

  await command.handler("min-main 40", s.ctx);
  s.tui.doRender();
  assert.equal(s.renderedWidths.at(-1), 62, "sidebar still shown after raising the minimum");
});

for (const arg of ["min-main", "min-main -1", "min-main wide", "min-main 501"]) {
  test(`/sidebar-tui ${arg} explains the usage and changes nothing`, async () => {
    const s = startSession();
    const before = readFileSync(configPath, "utf8");
    await s.commands.get("sidebar-tui")!.handler(arg, s.ctx);
    assert.match(s.messages.at(-1)!, /Usage: \/sidebar-tui min-main <0-500>/);
    assert.equal(readFileSync(configPath, "utf8"), before);
  });
}

test("toggling the sidebar keeps the configured minimum", async () => {
  const s = startSession();
  await s.commands.get("sidebar-tui")!.handler("min-main 55", s.ctx);
  await s.commands.get("sidebar-tui")!.handler("off", s.ctx);
  await s.commands.get("sidebar-tui")!.handler("on", s.ctx);
  assert.equal(savedMinMain(), 55);
});

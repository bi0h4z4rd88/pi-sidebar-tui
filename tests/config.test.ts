import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  DEFAULT_SIDEBAR_SETTINGS,
  getAutoCompactEnabled,
  loadSidebarSettings,
  readAutoCompactEnabled,
  saveSidebarSettings,
} from "../config.ts";

function tmpFile(): string {
  return join(mkdtempSync(join(tmpdir(), "sidebar-cfg-")), "sidebar-tui.json");
}

test("loadSidebarSettings returns defaults when file is missing", () => {
  const s = loadSidebarSettings(tmpFile());
  assert.deepEqual(s, DEFAULT_SIDEBAR_SETTINGS);
});

test("saveSidebarSettings then loadSidebarSettings round-trips", () => {
  const p = tmpFile();
  saveSidebarSettings({ enabled: false, width: 64 }, p);
  assert.deepEqual(loadSidebarSettings(p), { enabled: false, width: 64, todosMax: 5 });
});

test("saveSidebarSettings creates parent directory if missing", () => {
  const p = join(mkdtempSync(join(tmpdir(), "sidebar-cfg-")), "nested", "dir", "sidebar-tui.json");
  saveSidebarSettings({ enabled: true, width: 50 }, p);
  assert.deepEqual(loadSidebarSettings(p), { enabled: true, width: 50, todosMax: 5 });
});

test("loadSidebarSettings returns defaults for corrupt JSON", () => {
  const p = tmpFile();
  writeFileSync(p, "{not json");
  assert.deepEqual(loadSidebarSettings(p), DEFAULT_SIDEBAR_SETTINGS);
});

test("loadSidebarSettings falls back to defaults for out-of-range width", () => {
  const p = tmpFile();
  writeFileSync(p, JSON.stringify({ enabled: false, width: 999 }));
  const s = loadSidebarSettings(p);
  assert.equal(s.enabled, false);
  assert.equal(s.width, DEFAULT_SIDEBAR_SETTINGS.width);
});

test("loadSidebarSettings falls back to default width for non-integer width", () => {
  const p = tmpFile();
  writeFileSync(p, JSON.stringify({ enabled: true, width: "wide" }));
  const s = loadSidebarSettings(p);
  assert.equal(s.width, DEFAULT_SIDEBAR_SETTINGS.width);
});

test("loadSidebarSettings defaults todosMax to 5 when missing", () => {
  assert.equal(loadSidebarSettings(tmpFile()).todosMax, 5);
});

test("saveSidebarSettings round-trips a non-default todosMax", () => {
  const p = tmpFile();
  saveSidebarSettings({ enabled: true, width: 50, todosMax: 8 }, p);
  assert.equal(loadSidebarSettings(p).todosMax, 8);
});

test("loadSidebarSettings ignores out-of-range todosMax", () => {
  const p = tmpFile();
  writeFileSync(p, JSON.stringify({ todosMax: 999 }));
  assert.equal(loadSidebarSettings(p).todosMax, 5);
});

function tmpDirs() {
  const agent = mkdtempSync(join(tmpdir(), "sidebar-agent-"));
  const cwd = mkdtempSync(join(tmpdir(), "sidebar-cwd-"));
  return { agent, cwd };
}

test("readAutoCompactEnabled defaults to true when settings are missing", () => {
  const { agent, cwd } = tmpDirs();
  assert.equal(readAutoCompactEnabled({ agentDir: agent, cwd }), true);
});

test("readAutoCompactEnabled reads global setting", () => {
  const { agent, cwd } = tmpDirs();
  writeFileSync(join(agent, "settings.json"), JSON.stringify({ compaction: { enabled: false } }));
  assert.equal(readAutoCompactEnabled({ agentDir: agent, cwd }), false);
});

test("readAutoCompactEnabled project setting overrides global", () => {
  const { agent, cwd } = tmpDirs();
  writeFileSync(join(agent, "settings.json"), JSON.stringify({ compaction: { enabled: false } }));
  mkdirSync(join(cwd, ".pi"), { recursive: true });
  writeFileSync(join(cwd, ".pi", "settings.json"), JSON.stringify({ compaction: { enabled: true } }));
  assert.equal(readAutoCompactEnabled({ agentDir: agent, cwd }), true);
});

test("readAutoCompactEnabled ignores invalid JSON", () => {
  const { agent, cwd } = tmpDirs();
  writeFileSync(join(agent, "settings.json"), "{not json");
  assert.equal(readAutoCompactEnabled({ agentDir: agent, cwd }), true);
});

test("getAutoCompactEnabled updates when global setting changes", () => {
  const { agent, cwd } = tmpDirs();
  const options = { agentDir: agent, cwd };
  writeFileSync(join(agent, "settings.json"), JSON.stringify({ compaction: { enabled: false } }));
  assert.equal(getAutoCompactEnabled(options), false);
  assert.equal(getAutoCompactEnabled(options), false);

  writeFileSync(join(agent, "settings.json"), JSON.stringify({ compaction: { enabled: true } }));
  assert.equal(getAutoCompactEnabled(options), true);
});

test("getAutoCompactEnabled updates when project setting changes", () => {
  const { agent, cwd } = tmpDirs();
  const options = { agentDir: agent, cwd };
  writeFileSync(join(agent, "settings.json"), JSON.stringify({ compaction: { enabled: false } }));
  mkdirSync(join(cwd, ".pi"), { recursive: true });

  writeFileSync(join(cwd, ".pi", "settings.json"), JSON.stringify({ compaction: { enabled: true } }));
  assert.equal(getAutoCompactEnabled(options), true);

  writeFileSync(join(cwd, ".pi", "settings.json"), JSON.stringify({ compaction: { enabled: false } }));
  assert.equal(getAutoCompactEnabled(options), false);
});

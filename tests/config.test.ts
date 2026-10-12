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
  assert.deepEqual(loadSidebarSettings(p), { enabled: false, width: 64, todosMax: 7, scrollSpeed: 3, minMainWidth: 0 });
});

test("saveSidebarSettings creates parent directory if missing", () => {
  const p = join(mkdtempSync(join(tmpdir(), "sidebar-cfg-")), "nested", "dir", "sidebar-tui.json");
  saveSidebarSettings({ enabled: true, width: 50 }, p);
  assert.deepEqual(loadSidebarSettings(p), { enabled: true, width: 50, todosMax: 7, scrollSpeed: 3, minMainWidth: 0 });
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

test("loadSidebarSettings defaults todosMax to 7 when missing", () => {
  assert.equal(loadSidebarSettings(tmpFile()).todosMax, 7);
});

test("saveSidebarSettings round-trips a non-default todosMax", () => {
  const p = tmpFile();
  saveSidebarSettings({ enabled: true, width: 50, todosMax: 8 }, p);
  assert.equal(loadSidebarSettings(p).todosMax, 8);
});

test("loadSidebarSettings ignores out-of-range todosMax", () => {
  const p = tmpFile();
  writeFileSync(p, JSON.stringify({ todosMax: 999 }));
  assert.equal(loadSidebarSettings(p).todosMax, 7);
});

test("loadSidebarSettings defaults scrollSpeed to 3 when missing", () => {
  assert.equal(loadSidebarSettings(tmpFile()).scrollSpeed, 3);
});

test("saveSidebarSettings round-trips a non-default scrollSpeed", () => {
  const p = tmpFile();
  saveSidebarSettings({ enabled: true, width: 50, todosMax: 10, scrollSpeed: 6 }, p);
  assert.equal(loadSidebarSettings(p).scrollSpeed, 6);
});

test("loadSidebarSettings ignores out-of-range scrollSpeed", () => {
  const p = tmpFile();
  writeFileSync(p, JSON.stringify({ scrollSpeed: 999 }));
  assert.equal(loadSidebarSettings(p).scrollSpeed, 3);
});

test("loadSidebarSettings respects PI_SIDEBAR_SCROLL_SPEED env override", () => {
  const p = tmpFile();
  const prev = process.env.PI_SIDEBAR_SCROLL_SPEED;
  process.env.PI_SIDEBAR_SCROLL_SPEED = "7";
  try {
    assert.equal(loadSidebarSettings(p).scrollSpeed, 7);
  } finally {
    if (prev === undefined) delete process.env.PI_SIDEBAR_SCROLL_SPEED;
    else process.env.PI_SIDEBAR_SCROLL_SPEED = prev;
  }
});

test("loadSidebarSettings defaults minMainWidth to 0 (never hide) when missing, so hiding is opt-in", () => {
  assert.equal(loadSidebarSettings(tmpFile()).minMainWidth, 0);
});

test("saveSidebarSettings round-trips minMainWidth, including 0 (never hide)", () => {
  for (const minMainWidth of [0, 60]) {
    const p = tmpFile();
    saveSidebarSettings({ enabled: true, width: 50, todosMax: 10, minMainWidth }, p);
    assert.equal(loadSidebarSettings(p).minMainWidth, minMainWidth);
  }
});

for (const [name, value] of [
  ["negative", -1],
  ["above the maximum", 501],
  ["not an integer", 40.5],
  ["not a number", "wide"],
] as const) {
  test(`loadSidebarSettings ignores a minMainWidth that is ${name}`, () => {
    const p = tmpFile();
    writeFileSync(p, JSON.stringify({ minMainWidth: value }));
    assert.equal(loadSidebarSettings(p).minMainWidth, 0);
  });
}

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

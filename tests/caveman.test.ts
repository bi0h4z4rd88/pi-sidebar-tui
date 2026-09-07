import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  CAVEMAN_LEVELS,
  loadCavemanConfig,
  resolveCavemanLevel,
  cavemanFireFrame,
  cavemanLabel,
  cavemanInterval,
} from "../caveman.ts";

function tmpFile(): string {
  return join(mkdtempSync(join(tmpdir(), "sidebar-caveman-")), "caveman.json");
}

function cavemanEntry(level: string): any {
  return { type: "custom", customType: "caveman-level", data: { level } };
}

test("CAVEMAN_LEVELS includes the documented levels", () => {
  for (const l of ["off", "lite", "full", "ultra", "micro", "wenyan"]) {
    assert.ok((CAVEMAN_LEVELS as readonly string[]).includes(l), `missing ${l}`);
  }
});

// --- resolveCavemanLevel ---------------------------------------------------

test("resolveCavemanLevel: no entry + no config -> null (uninstalled)", () => {
  assert.equal(resolveCavemanLevel([], { defaultLevel: "full", showStatus: true, present: false }), null);
});

test("resolveCavemanLevel: no entry + config present -> defaultLevel", () => {
  assert.equal(resolveCavemanLevel([], { defaultLevel: "ultra", showStatus: true, present: true }), "ultra");
});

test("resolveCavemanLevel: no entry + config present + default off -> off", () => {
  assert.equal(resolveCavemanLevel([], { defaultLevel: "off", showStatus: true, present: true }), "off");
});

test("resolveCavemanLevel: latest session entry wins over config", () => {
  const entries = [
    { type: "message", message: { role: "user" } },
    cavemanEntry("full"),
    cavemanEntry("ultra"),
  ];
  assert.equal(
    resolveCavemanLevel(entries, { defaultLevel: "lite", showStatus: true, present: true }),
    "ultra",
  );
});

test("resolveCavemanLevel: session entry wins even when config absent", () => {
  const entries = [cavemanEntry("wenyan")];
  assert.equal(resolveCavemanLevel(entries, { defaultLevel: "full", showStatus: true, present: false }), "wenyan");
});

test("resolveCavemanLevel: entry with level off is honored", () => {
  const entries = [cavemanEntry("full"), cavemanEntry("off")];
  assert.equal(
    resolveCavemanLevel(entries, { defaultLevel: "full", showStatus: true, present: true }),
    "off",
  );
});

test("resolveCavemanLevel: invalid entry level ignored, falls to config", () => {
  const entries = [cavemanEntry("nonsense")];
  assert.equal(
    resolveCavemanLevel(entries, { defaultLevel: "full", showStatus: true, present: true }),
    "full",
  );
});

test("resolveCavemanLevel: non-caveman custom entries ignored", () => {
  const entries = [{ type: "custom", customType: "other", data: { level: "ultra" } }];
  assert.equal(
    resolveCavemanLevel(entries, { defaultLevel: "full", showStatus: true, present: false }),
    null,
  );
});

test("resolveCavemanLevel: entry missing data.level ignored", () => {
  const entries = [{ type: "custom", customType: "caveman-level", data: {} }];
  assert.equal(
    resolveCavemanLevel(entries, { defaultLevel: "full", showStatus: true, present: true }),
    "full",
  );
});

// --- loadCavemanConfig -----------------------------------------------------

test("loadCavemanConfig: missing file -> defaults, present false", () => {
  const cfg = loadCavemanConfig(tmpFile());
  assert.deepEqual(cfg, { defaultLevel: "full", showStatus: true, present: false });
});

test("loadCavemanConfig: valid file parsed", () => {
  const p = tmpFile();
  writeFileSync(p, JSON.stringify({ defaultLevel: "wenyan", showStatus: false }));
  assert.deepEqual(loadCavemanConfig(p), { defaultLevel: "wenyan", showStatus: false, present: true });
});

test("loadCavemanConfig: invalid JSON -> defaults, present true", () => {
  const p = tmpFile();
  writeFileSync(p, "{ not json");
  const cfg = loadCavemanConfig(p);
  assert.equal(cfg.present, true);
  assert.equal(cfg.defaultLevel, "full");
  assert.equal(cfg.showStatus, true);
});

test("loadCavemanConfig: invalid level -> default full", () => {
  const p = tmpFile();
  writeFileSync(p, JSON.stringify({ defaultLevel: "bogus" }));
  const cfg = loadCavemanConfig(p);
  assert.equal(cfg.present, true);
  assert.equal(cfg.defaultLevel, "full");
});

test("loadCavemanConfig: partial file keeps other defaults", () => {
  const p = tmpFile();
  writeFileSync(p, JSON.stringify({ showStatus: false }));
  const cfg = loadCavemanConfig(p);
  assert.equal(cfg.present, true);
  assert.equal(cfg.showStatus, false);
  assert.equal(cfg.defaultLevel, "full");
});

// --- cavemanFireFrame ------------------------------------------------------

test("cavemanFireFrame: wraps modulo 8", () => {
  assert.equal(cavemanFireFrame(0), cavemanFireFrame(8));
  assert.notEqual(cavemanFireFrame(0), cavemanFireFrame(1));
});

test("cavemanFireFrame: emits ANSI color codes", () => {
  assert.ok(cavemanFireFrame(0).includes("\x1b["));
});

// --- cavemanLabel ----------------------------------------------------------

test("cavemanLabel: known levels", () => {
  assert.equal(cavemanLabel("full"), "FULL");
  assert.equal(cavemanLabel("lite"), "LITE");
  assert.equal(cavemanLabel("ultra"), "ULTRA");
  assert.equal(cavemanLabel("micro"), "MICRO");
  assert.equal(cavemanLabel("wenyan"), "文言文");
  assert.equal(cavemanLabel("off"), "");
});

// --- cavemanInterval -------------------------------------------------------

test("cavemanInterval: per-level timing", () => {
  assert.equal(cavemanInterval("full"), 200);
  assert.equal(cavemanInterval("lite"), 300);
  assert.equal(cavemanInterval("ultra"), 100);
  assert.equal(cavemanInterval("micro"), 120);
});

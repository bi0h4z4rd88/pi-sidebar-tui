import { test } from "node:test";
import assert from "node:assert/strict";
import { api, createWarner, piVersion, VERIFIED_PI_LINES, versionNotice } from "../pi-guard.ts";

test("versionNotice: a verified release line runs silently, including its patch releases", () => {
  for (const version of ["1.2.0", "1.3.0", "1.5.0", "1.5.3"]) {
    assert.equal(versionNotice(version), null, version);
  }
});

test("versionNotice: any other release line warns once, naming the pi and the verified lines", () => {
  const notice = versionNotice("1.6.0");
  assert.ok(notice, "an unverified line must warn");
  assert.match(notice, /pi 1\.6\.0/);
  for (const line of VERIFIED_PI_LINES) assert.ok(notice.includes(line), `names ${line}`);
});

test("versionNotice: a version it cannot read warns too, because not knowing is not knowing it is fine", () => {
  assert.ok(versionNotice("unknown"));
  assert.ok(versionNotice(""));
});

test("piVersion: answers a string with at least a major.minor, never empty", () => {
  const version = piVersion();
  assert.equal(typeof version, "string");
  assert.ok(version.length > 0);
});

test("createWarner: says each thing once, and a notify that throws cannot take the run down", () => {
  const said: string[] = [];
  const warner = createWarner((message) => {
    said.push(message);
    throw new Error("notify is broken");
  });
  warner.warn("k", "first");
  warner.warn("k", "first again");
  warner.warn("other", "second");
  assert.deepEqual(said, ["first", "second"]);
  assert.deepEqual(warner.warned(), ["k", "other"]);
});

test("createWarner: with no notify channel at all, warnings are recorded and dropped", () => {
  const warner = createWarner(undefined);
  warner.warn("k", "message");
  assert.deepEqual(warner.warned(), ["k"]);
});

test("api: a present internal is returned untouched, and nothing is said", () => {
  const said: string[] = [];
  const warner = createWarner((message) => said.push(message));
  const fn = () => 42;
  assert.equal(api(warner, "ctx.sessionManager.getBranch", fn, undefined), fn);
  assert.deepEqual(said, []);
});

test("api: a missing internal warns once, naming it, and hands back the fallback", () => {
  const said: string[] = [];
  const warner = createWarner((message) => said.push(message));
  assert.equal(api(warner, "ctx.sessionManager.getBranch", undefined, "fallback"), "fallback");
  assert.equal(api(warner, "ctx.sessionManager.getBranch", undefined, "fallback"), "fallback");
  assert.equal(said.length, 1, "once per internal");
  assert.match(said[0], /getBranch/);
  assert.match(said[0], /pi-sidebar-tui/);
});

/**
 * pi moves; this package should not break when it does.
 *
 * Two halves, because either alone is not enough. A version check gives the reader a heads-up: a pi on a release
 * line this package was verified against runs silently, and any other pi warns once per session and keeps running.
 * That notice cannot save the run on its own, though — an internal that moved crashes at the call, long after the
 * warning was printed. So every pi internal is also read through `api()`, which feature-detects it, warns once
 * naming what is missing, and hands back a fallback: the one feature degrades instead of the session failing.
 *
 * The pi package is imported as a namespace and its `VERSION` read defensively: a named import of an export a
 * future pi stops providing fails at link time, before any of this code can warn about it.
 */
import * as piPackage from "@earendil-works/pi-coding-agent";

/** `major.minor` lines this package has been verified against. A patch release on one of them runs silently. */
export const VERIFIED_PI_LINES: readonly string[] = ["1.2", "1.3", "1.4", "1.5"];

const PACKAGE = "pi-sidebar-tui";

/** The running pi's version, or `"unknown"` when pi does not say: a package that cannot tell must never assume. */
export function piVersion(): string {
  const version = (piPackage as { VERSION?: unknown }).VERSION;
  return typeof version === "string" && version.length > 0 ? version : "unknown";
}

const lineOf = (version: string): string | undefined => /^(\d+)\.(\d+)\./.exec(version)?.slice(1, 3).join(".");

/**
 * The one-line warning for a pi this package was not verified against, or `null` when it was. An unparseable
 * version warns too: not knowing is not the same as knowing it is fine.
 */
export function versionNotice(version: string, lines: readonly string[] = VERIFIED_PI_LINES, packageName = PACKAGE): string | null {
  const line = lineOf(version);
  if (line !== undefined && lines.includes(line)) return null;
  const verified = lines.length > 0 ? lines.join(", ") : "(none)";
  return (
    `${packageName}: pi ${version} has not been verified against this release of ${packageName} (verified release lines: ` +
    `${verified}). It keeps working, and anything pi moved degrades with a warning of its own rather than failing the session.`
  );
}

/** A function that says something to the user, once per key: `ctx.ui.notify` when pi provides one. */
export type Notify = (message: string, level?: "info" | "warning" | "error") => void;

/**
 * A once-per-key warner over `notify`. Repeats are dropped so a degraded feature cannot flood a session with the
 * same sentence on every prompt, and a notify that throws never propagates: a warning is not worth a failed run.
 */
export function createWarner(notify: Notify | undefined): { warn: (key: string, message: string) => void; warned: () => string[] } {
  const said = new Set<string>();
  return {
    warn(key, message) {
      if (said.has(key)) return;
      said.add(key);
      try {
        notify?.(message, "warning");
      } catch {
        // A broken notify channel costs the warning, never the run.
      }
    },
    warned: () => [...said],
  };
}

/**
 * A pi internal, or `fallback` when it is not there. `value` is checked for being callable-or-present by `present`,
 * so `api(warner, "ctx.sessionManager.getBranch", ctx.sessionManager?.getBranch, undefined)` warns once, naming the
 * internal, instead of throwing at the call site the way a bare access would.
 */
export function api<T>(warner: { warn: (key: string, message: string) => void }, name: string, value: T | undefined | null, fallback: T, packageName = PACKAGE): T {
  if (value !== undefined && value !== null) return value;
  warner.warn(
    `missing:${name}`,
    `${packageName}: pi no longer provides \`${name}\`; that one feature is off for this session. An update to ${packageName} is likely to fix it.`,
  );
  return fallback;
}

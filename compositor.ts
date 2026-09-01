import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import type { SidebarContext } from "./types.ts";
import { renderSidebar } from "./sidebar.ts";
import { dim } from "./colors.ts";

// No background by default so terminal transparency shows through.
// Set PI_SIDEBAR_BG="#rrggbb" to paint an opaque panel (hides scroll flash).
const SIDEBAR_BG = (() => {
  const hex = process.env["PI_SIDEBAR_BG"]?.replace("#", "");
  if (!/^[0-9a-fA-F]{6}$/.test(hex ?? "")) return "";
  const r = parseInt(hex.slice(0, 2), 16);
  const g = parseInt(hex.slice(2, 4), 16);
  const b = parseInt(hex.slice(4, 6), 16);
  return `\x1b[48;2;${r};${g};${b}m`;
})();
const BG_RESET = "\x1b[49m";

const BEGIN_SYNC = "\x1b[?2026h"; // begin synchronized output
const END_SYNC = "\x1b[?2026l";   // end synchronized output

/**
 * Versioned, renderer-local state slot for the permanent doRender dispatcher.
 *
 * The state object is stored on the RAW renderer (via the ui proxy, which
 * passes non-function values through unchanged). Because the renderer is a
 * stable raw object across /reload, the state survives extension module
 * reloads while never being captured by any compositor instance.
 */
const COMPOSITOR_STATE = Symbol.for("pi-sidebar-tui:compositor-state:v1");

type RenderFn = (...args: unknown[]) => unknown;

interface CompositorState {
  originalDoRender: RenderFn;
  activeOwner: object | null;
  activeRender: ((original: RenderFn, args: unknown[]) => unknown) | null;
}

function moveCursor(row: number, col: number): string {
  return `\x1b[${row};${col}H`;
}

function descriptorFor(obj: object, key: string): PropertyDescriptor | undefined {
  let target: object | null = obj;
  while (target) {
    const d = Object.getOwnPropertyDescriptor(target, key);
    if (d) return d;
    target = Object.getPrototypeOf(target);
  }
  return undefined;
}

export class SidebarCompositor {
  private tui: any;
  private terminal: any;
  private getCtx: () => SidebarContext;

  // Original values captured at install() time, used for exact restore.
  private originalColumnsDesc: PropertyDescriptor | undefined;
  private originalWrite: (data: string) => void;
  private hadOwnColumns = false;
  private originalOwnColumnsDesc: PropertyDescriptor | undefined;
  private disposed = false;

  private readonly sidebarWidth: number;

  // The renderer-local state this compositor attached to (captured at install
  // time; dispose uses this exact reference, not a re-read of this.tui[STATE],
  // so a renderer switch cannot make an old compositor clear the new
  // renderer's state).
  private compositorState: CompositorState | null = null;

  // Transient state, active only while a render is executing.
  private capturing = false;
  private writeWasOwn = false;
  private originalOwnWrite: ((data: string) => void) | undefined;
  private tail = "";
  private sawEndSync = false;
  private capturedBody: string | null = null;

  constructor(tui: any, getCtx: () => SidebarContext, sidebarWidth = 40) {
    this.tui = tui;
    this.terminal = tui.terminal;
    this.getCtx = getCtx;
    this.originalWrite = this.terminal.write.bind(this.terminal);
    this.sidebarWidth = sidebarWidth;
  }

  install(): void {
    // Narrow terminal.columns so pi renders in the left portion only.
    this.hadOwnColumns = Object.hasOwn(this.terminal, "columns");
    if (this.hadOwnColumns) {
      this.originalOwnColumnsDesc = Object.getOwnPropertyDescriptor(this.terminal, "columns");
    }
    this.originalColumnsDesc = descriptorFor(this.terminal, "columns");
    const origDesc = this.originalColumnsDesc;
    const terminal = this.terminal;

    Object.defineProperty(terminal, "columns", {
      configurable: true,
      enumerable: true,
      get() {
        const d = origDesc;
        const raw = d?.get ? (d.get.call(terminal) ?? 80) : (typeof d?.value === "number" ? d.value : 80);
        return Math.max(1, raw - 40 - 1);
      },
    });

    // Renderer-local permanent dispatcher. The ui proxy passes non-function
    // values through unchanged, so reading/writing the state hits the RAW
    // renderer and survives extension module reloads.
    let state = this.tui[COMPOSITOR_STATE] as CompositorState | undefined;

    if (!state) {
      const originalDoRender = this.tui.doRender as RenderFn;
      state = { originalDoRender, activeOwner: null, activeRender: null };
      this.tui[COMPOSITOR_STATE] = state;

      // Permanent wrapper: installed exactly once per renderer. It captures
      // ONLY `state` — never `this`, never the compositor instance, never
      // getCtx, never module state. That is what keeps GC correct across
      // reloads.
      const permanentWrapper = (...args: unknown[]): unknown => {
        const active = state.activeRender;
        if (active) {
          return active(state.originalDoRender, args);
        }
        return state.originalDoRender(...args);
      };
      this.tui.doRender = permanentWrapper;
    }

    // Attach this compositor as the active owner. If state already existed we
    // MUST NOT reassign tui.doRender — an external extension may have wrapped
    // the permanent dispatcher since; only attach the current compositor.
    state.activeOwner = this;
    state.activeRender = (original, args) => this.executeCapturedRender(original, args);
    this.compositorState = state;
  }

  /**
   * Run a render with the synchronized-output capture lifecycle: intercept
   * terminal.write, let the original render run, then flush and restore.
   * Returns whatever the original render returns.
   */
  private executeCapturedRender(
    originalDoRender: RenderFn,
    args: unknown[],
  ): unknown {
    const startedCapture = this.beginCapture();
    try {
      return originalDoRender(...args);
    } finally {
      // Only close the capture we actually started. A re-entrant nested
      // render sees capturing=true, does not start a new capture, and
      // therefore must not end the outer one.
      if (startedCapture) this.endCapture();
    }
  }

  /**
   * Build only the ANSI body needed to paint the sidebar: cursor save, autowrap
   * off, absolute moves, separator + content per row, autowrap on, cursor
   * restore. No synchronized-output markers and no write — callers decide how
   * to frame it.
   */
  private buildPaintBody(): string {
    const rawRows = this.terminal.rows;
    const d = this.originalColumnsDesc;
    const rawCols = d?.get ? (d.get.call(this.terminal) ?? 80) : (typeof d?.value === "number" ? d.value : 80);
    const sw = this.sidebarWidth;
    const sepCol = rawCols - sw;
    const sidebarCol = sepCol + 1;
    const ctx = this.getCtx();
    const lines = renderSidebar(ctx, sw);

    let buf = "\x1b7";     // save cursor (DECSC)
    buf += "\x1b[?7l";     // disable auto-wrap

    // Format cwd for bottom row: collapse home dir, truncate from left if needed
    const cwd = ctx.cwd ?? "";
    const home = process.env["HOME"] ?? "";
    const cwdDisplay = home && cwd.startsWith(home) ? "~" + cwd.slice(home.length) : cwd;
    const cwdTruncated = visibleWidth(cwdDisplay) > sw - 1
      ? "…" + cwdDisplay.slice(-(sw - 2))
      : cwdDisplay;
    const cwdLine = dim(" " + cwdTruncated);

    for (let row = 1; row <= rawRows; row++) {
      buf += moveCursor(row, sepCol);
      buf += dim("│");
      buf += moveCursor(row, sidebarCol);
      buf += SIDEBAR_BG;
      if (row === rawRows && cwd) {
        buf += truncateToWidth(cwdLine, sw, "", true);
      } else {
        const line = lines[row - 1];
        buf += line !== undefined
          ? truncateToWidth(line, sw, "", true)
          : " ".repeat(sw);
      }
      buf += BG_RESET;
    }

    buf += "\x1b[?7h";     // enable auto-wrap
    buf += "\x1b8";        // restore cursor (DECRC)
    return buf;
  }

  /**
   * Standalone repaint used when the sidebar's own data changed: a complete
   * synchronized frame in a single write.
   */
  paint(): void {
    if (this.disposed) return;
    const body = this.buildPaintBody();
    if (!body) return;
    this.originalWrite(BEGIN_SYNC + body + END_SYNC);
  }

  /**
   * Start intercepting terminal.write. Each chunk is scanned for end-of-sync
   * markers and forwarded immediately; only a tiny tail (at most
   * END_SYNC.length - 1 chars) is held back to detect markers split across
   * BoundedTerminalWriter chunks.
   *
   * @returns true if this call actually started a capture, false if it was a
   * no-op (disposed or already capturing). The caller must only call
   * endCapture() when this returns true, so a re-entrant doRender cannot
   * terminate an outer capture.
   */
  private beginCapture(): boolean {
    if (this.disposed || this.capturing) return false;
    this.capturing = true;
    this.tail = "";
    this.sawEndSync = false;
    this.capturedBody = null;
    this.writeWasOwn = Object.hasOwn(this.terminal, "write");
    if (this.writeWasOwn) {
      this.originalOwnWrite = this.terminal.write;
    }
    const self = this;
    this.terminal.write = (data: string) => self.handleWrite(data);
    return true;
  }

  /**
   * Forward a chunk immediately, inserting the sidebar body before every
   * complete end-of-sync marker, and keeping only the longest raw suffix that
   * could be a prefix of END_SYNC (for cross-chunk markers).
   */
  private handleWrite(data: string): void {
    if (this.disposed) { this.originalWrite(data); return; }
    const scan = this.tail + data;
    this.tail = "";

    let out = "";
    let pos = 0;
    let idx = scan.indexOf(END_SYNC, pos);
    while (idx !== -1) {
      // Raw text before the marker, then the sidebar body, then the marker
      // itself (never swallowed).
      out += scan.slice(pos, idx);
      if (this.capturedBody === null) {
        this.capturedBody = this.buildPaintBody();
      }
      out += this.capturedBody;
      out += END_SYNC;
      pos = idx + END_SYNC.length;
      idx = scan.indexOf(END_SYNC, pos);
      this.sawEndSync = true;
    }
    // Raw remainder after the last complete marker.
    const remainder = scan.slice(pos);

    // Find the longest suffix of remainder that equals a prefix of END_SYNC.
    // Only that suffix may be held back; the rest is forwarded immediately.
    let keep = 0;
    for (let k = Math.min(END_SYNC.length - 1, remainder.length); k >= 1; k--) {
      if (END_SYNC.startsWith(remainder.slice(remainder.length - k))) {
        keep = k;
        break;
      }
    }
    this.tail = remainder.slice(remainder.length - keep);
    const flush = out + remainder.slice(0, remainder.length - keep);
    if (flush) this.originalWrite(flush);
  }

  /**
   * Stop intercepting, flush the tail, restore terminal.write exactly, and if
   * pi produced no synchronized frame at all, repaint the sidebar standalone.
   */
  private endCapture(): void {
    if (!this.capturing) return;
    this.capturing = false;
    if (this.tail) { this.originalWrite(this.tail); this.tail = ""; }

    // Exact restore: own property -> restore original value; otherwise delete
    // to fall back to the prototype method.
    if (this.writeWasOwn) {
      this.terminal.write = this.originalOwnWrite!;
    } else {
      delete this.terminal.write;
    }
    this.writeWasOwn = false;
    this.originalOwnWrite = undefined;

    const sawFrame = this.sawEndSync;
    this.sawEndSync = false;
    this.capturedBody = null;
    if (!sawFrame) this.paint();
  }

  dispose(): void {
    if (this.disposed) return;
    // Mark disposed FIRST so endCapture()'s standalone-frame fallback does not
    // repaint a sidebar that is being removed.
    this.disposed = true;
    if (this.capturing) this.endCapture();

    // Detach from the state this compositor attached to at install time.
    // Owner-equality matters: if a newer compositor already re-attached, a
    // late dispose from an old compositor must not clear the new owner.
    if (this.compositorState?.activeOwner === this) {
      this.compositorState.activeOwner = null;
      this.compositorState.activeRender = null;
    }
    this.compositorState = null;

    // Exact restore for columns.
    if (this.hadOwnColumns) {
      Object.defineProperty(this.terminal, "columns", this.originalOwnColumnsDesc!);
    } else {
      delete this.terminal.columns;
    }
    this.hadOwnColumns = false;
    this.originalOwnColumnsDesc = undefined;

    // NOTE: doRender is intentionally NOT touched here. The permanent
    // dispatcher stays on the raw renderer (inactive passthrough when no
    // compositor is attached). Deleting or reassigning it would either be a
    // no-op on the proxy (delete) or clobber external wrappers (set).
  }
}

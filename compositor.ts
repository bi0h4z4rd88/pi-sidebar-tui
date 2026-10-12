import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import type { SidebarContext } from "./types.ts";
import { renderSidebar, type PanelSlot } from "./sidebar.ts";
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
  private originalColumnsDesc: PropertyDescriptor | undefined;
  private originalColumnsOwnDesc: PropertyDescriptor | undefined;
  private originalDoRender: ((...args: any[]) => any) | null = null;
  private originalWrite: (data: string) => void;
  private disposed = false;

  private readonly sidebarWidth: number;
  // Fewest columns pi's main area may keep. Below it the sidebar steps aside
  // and pi gets the whole terminal; 0 never hides it.
  private readonly minMainWidth: number;

  // Last painted sidebar content, used to repaint only rows that actually
  // changed. Prevents full-panel rewrites every frame (the flicker source).
  private cachedLines: string[] | null = null;
  private cachedColumns = 0;
  private cachedRows = 0;
  private cachedWidth = 0;
  private cacheValid = false;

  // Per-panel scroll offset (content rows hidden above the window) and the
  // last rendered panel layout (row ranges + each panel's maxOffset).
  private panelOffsets = new Map<string, number>();
  private layout: PanelSlot[] = [];

  // Focused panel for keyboard scrolling (set by the mouse, defaults to the
  // first scrollable panel present). Plus the original routeWheel we wrap.
  private focusedPanel: string | null = null;
  private originalRouteWheel: ((event: any, delta: number) => void) | null = null;

  constructor(tui: any, getCtx: () => SidebarContext, sidebarWidth = 40, minMainWidth = 0) {
    this.tui = tui;
    this.terminal = tui.terminal;
    this.getCtx = getCtx;
    this.originalWrite = this.terminal.write.bind(this.terminal);
    this.sidebarWidth = sidebarWidth;
    this.minMainWidth = minMainWidth;
  }

  install(): void {
    // Narrow terminal.columns so pi renders in the left portion only.
    this.originalColumnsDesc = descriptorFor(this.terminal, "columns");
    this.originalColumnsOwnDesc = Object.getOwnPropertyDescriptor(this.terminal, "columns");
    const origDesc = this.originalColumnsDesc;
    const terminal = this.terminal;
    const self = this; // `this` inside the getter below is the terminal, not the compositor

    Object.defineProperty(terminal, "columns", {
      configurable: true,
      enumerable: true,
      get() {
        const d = origDesc;
        const raw = d?.get ? (d.get.call(terminal) ?? 80) : (typeof d?.value === "number" ? d.value : 80);
        return self.shown() ? Math.max(1, raw - self.sidebarWidth - 1) : raw;
      },
    });

    // Paint sidebar after every pi render cycle.
    //
    // To stop flicker we merge the sidebar into pi's own render frame instead
    // of writing a separate frame afterwards:
    //   - wrap the whole doRender in a single synchronized-output block
    //     (?2026h ... ?2026l), stripping pi's own markers, so the main area and
    //     the sidebar update atomically (no gap where the sidebar is gone);
    //   - rewrite pi's full-line erase (\x1b[2K) into a width-limited erase
    //     (\x1b[<mainWidth>X) so pi's renders never wipe the sidebar columns.
    if (typeof this.tui.doRender === "function") {
      const originalDoRender = this.tui.doRender;
      this.originalDoRender = originalDoRender;
      const self = this;
      this.tui.doRender = function (...args: any[]) {
        if (self.disposed) return originalDoRender.apply(this, args);
        if (!self.shown()) {
          // Nothing on screen to keep: the next shown frame must paint every row.
          self.cacheValid = false;
          return originalDoRender.apply(this, args);
        }

        const writeOwnDesc = Object.getOwnPropertyDescriptor(terminal, "write");
        const originalWrite = terminal.write;
        const mainWidth = self.mainWidth();
        let forceFullPaint = false;
        let result: any;
        let didThrow = false;
        let thrown: unknown;

        self.originalWrite("\x1b[?2026h"); // begin synchronized output (single frame)
        try {
          Object.defineProperty(terminal, "write", {
            configurable: true,
            enumerable: true,
            writable: true,
            value(this: any, data: string) {
              if (typeof data !== "string") return originalWrite.call(this, data);
              if (/\x1b\[(?:2J|3J)|\n|\r\n|\x1b\[\d*[ST]|\x1bM/.test(data)) forceFullPaint = true;
              const sanitized = data
                .replace(/\x1b\[\?2026[hl]/g, "")
                .replace(/\x1b\[2K/g, `\x1b[${mainWidth}X`);
              return originalWrite.call(this, sanitized);
            },
          });

          try {
            result = originalDoRender.apply(this, args);
          } catch (error) {
            didThrow = true;
            thrown = error;
          }

          if (!didThrow) {
            try {
              self.paintInternal(forceFullPaint, false);
            } catch {
              // Sidebar painting must never break pi's render cycle.
            }
          }
        } finally {
          if (writeOwnDesc) {
            Object.defineProperty(terminal, "write", writeOwnDesc);
          } else {
            Reflect.deleteProperty(terminal, "write");
          }
          self.originalWrite("\x1b[?2026l"); // end synchronized output
        }

        if (didThrow) throw thrown;
        return result;
      };
    }

    this.installMouseWheel();
  }

  // Wrap the TUI's wheel routing so a wheel over the sidebar columns scrolls
  // the panel under the cursor instead of the main viewport. Fullscreen mode
  // only (routeWheel is the alt-screen's fallback wheel handler).
  private installMouseWheel(): void {
    if (typeof this.tui.routeWheel !== "function") return;
    const original = this.tui.routeWheel;
    this.originalRouteWheel = original;
    const self = this;
    this.tui.routeWheel = function (event: any, delta: number) {
      // A hidden sidebar has no columns of its own: the wheel is pi's.
      if (self.disposed || !self.shown()) return original.call(self.tui, event, delta);
      const sepCol = self.getSeparatorColumn(); // 1-based
      const x = typeof event?.x === "number" ? event.x : -1; // 0-based
      const y = typeof event?.y === "number" ? event.y : -1; // 0-based
      if (x >= sepCol - 1) {
        // Over the sidebar: scroll the panel under the cursor (0-based y -> 1-based row).
        const row = y + 1;
        if (self.scrollPanelAtRow(row, delta)) {
          const id = self.panelAtRow(row);
          if (id) self.setFocusedPanel(id);
          return; // consumed: don't scroll the main viewport
        }
        self.scrollFocused(delta);
        return;
      }
      return original.call(self.tui, event, delta);
    };
  }

  paint(): void {
    // Standalone paint (e.g. from a state-update request): its own sync frame.
    this.paintInternal(false, true);
  }

  getPanelOffset(id: string): number {
    return this.panelOffsets.get(id) ?? 0;
  }

  getPanelMax(id: string): number {
    const slot = this.layout.find((s) => s.id === id);
    return slot?.maxOffset ?? 0;
  }

  scrollPanelBy(id: string, delta: number): void {
    const max = this.getPanelMax(id);
    const next = Math.max(0, Math.min(max, this.getPanelOffset(id) + delta));
    if (next !== this.getPanelOffset(id) || !this.cacheValid) {
      this.panelOffsets.set(id, next);
      this.cacheValid = false;
      this.paint();
    }
  }

  // Scrollable panel id whose row range contains `row` (1-based), or null.
  panelAtRow(row: number): string | null {
    const r = Math.floor(row);
    for (const slot of this.layout) {
      if (slot.scrollable && r > slot.startRow && r <= slot.endRow) return slot.id;
    }
    return null;
  }

  // Scroll the panel under the cursor. Returns true when a panel was hit.
  scrollPanelAtRow(row: number, delta: number): boolean {
    const id = this.panelAtRow(row);
    if (!id) return false;
    this.scrollPanelBy(id, delta);
    return true;
  }

  // Column where the sidebar's left border sits (1-based). Input routing uses
  // it to decide whether the mouse is over the sidebar.
  getSeparatorColumn(): number {
    return this.rawColumns() - this.sidebarWidth;
  }

  getFocusedPanel(): string | null {
    if (this.focusedPanel && this.layout.some((s) => s.id === this.focusedPanel && s.scrollable)) {
      return this.focusedPanel;
    }
    return this.layout.find((s) => s.scrollable)?.id ?? null;
  }

  setFocusedPanel(id: string): void {
    this.focusedPanel = id;
  }

  // Scroll the focused panel (keyboard path). Returns false when no panel.
  scrollFocused(delta: number): boolean {
    const id = this.getFocusedPanel();
    if (!id) return false;
    this.scrollPanelBy(id, delta);
    return true;
  }

  private rawColumns(): number {
    const d = this.originalColumnsDesc;
    const raw = d?.get
      ? d.get.call(this.terminal)
      : (typeof d?.value === "number" ? d.value : undefined);
    return typeof raw === "number" && Number.isFinite(raw) ? Math.max(1, Math.floor(raw)) : 80;
  }

  // Whether the sidebar is on screen at the terminal's current width. pi-tui
  // redraws in full whenever the width it reads changes, so flipping this on a
  // resize repaints both the main area and the sidebar.
  private shown(): boolean {
    return this.minMainWidth <= 0 || this.rawColumns() - this.sidebarWidth - 1 >= this.minMainWidth;
  }

  // Width of pi's main area (columns left of the separator). Used to bound the
  // erase so the sidebar columns are never cleared.
  private mainWidth(): number {
    const rawCols = this.rawColumns();
    return Math.max(1, rawCols - this.sidebarWidth - 1);
  }

  private formatLine(line: string | undefined, width: number): string {
    const content = line === undefined ? "" : truncateToWidth(line, width, "", true);
    const padding = Math.max(0, width - visibleWidth(content));
    return `${SIDEBAR_BG}${content}${" ".repeat(padding)}${BG_RESET}`;
  }

  private paintInternal(forceFull: boolean, standalone: boolean): void {
    if (this.disposed || !this.shown()) return;

    const rawRows = this.terminal.rows;
    const rawCols = this.rawColumns();
    const sw = this.sidebarWidth;
    const sepCol = rawCols - sw;
    const sidebarCol = sepCol + 1;

    const ctx = this.getCtx();

    // Build the cwd bottom row (pinned to the last terminal row when present).
    const home = process.env["HOME"] ?? "";
    const cwd = ctx.cwd ?? "";
    const hasCwd = Boolean(cwd);
    const cwdDisplay = home && cwd.startsWith(home) ? "~" + cwd.slice(home.length) : cwd;
    const cwdTruncated = visibleWidth(cwdDisplay) > sw - 1
      ? "…" + cwdDisplay.slice(-(sw - 2))
      : cwdDisplay;
    const cwdLine = dim(" " + cwdTruncated);

    // Visible panel rows = all rows minus the pinned cwd row (when present).
    const visiblePanelRows = hasCwd ? Math.max(1, rawRows - 1) : rawRows;

    // Adaptive render: the water-filler fits the panels into visiblePanelRows,
    // and each panel scrolls internally when its content exceeds its window.
    // The result always fits, so we paint top-aligned with no whole-sidebar
    // offset. The cwd row is pinned to the final terminal row.
    const offsetRecord: Record<string, number> = {};
    for (const [id, off] of this.panelOffsets) offsetRecord[id] = off;
    const { lines, layout } = renderSidebar(ctx, sw, visiblePanelRows, offsetRecord);
    this.layout = layout;

    const panelLinesToRender: string[] = [];
    for (let i = 0; i < visiblePanelRows; i++) {
      panelLinesToRender.push(lines[i] ?? "");
    }

    const formattedLines: string[] = [];
    for (let i = 0; i < visiblePanelRows; i++) {
      formattedLines.push(this.formatLine(panelLinesToRender[i], sw));
    }
    if (hasCwd) {
      formattedLines.push(this.formatLine(cwdLine, sw));
    }

    // Repaint only rows that changed since the last paint. Skip the write
    // entirely when nothing changed — the core flicker fix.
    const dimensionsChanged = this.cachedColumns !== rawCols
      || this.cachedRows !== rawRows
      || this.cachedWidth !== sw;
    const shouldPaintAll = forceFull || !this.cacheValid || dimensionsChanged;
    const rows = shouldPaintAll
      ? formattedLines.map((_, index) => index)
      : formattedLines.reduce<number[]>((changed, line, index) => {
          if (this.cachedLines?.[index] !== line) changed.push(index);
          return changed;
        }, []);

    if (rows.length === 0) return;

    let buf = standalone ? "\x1b[?2026h" : "";
    buf += "\x1b7";          // save cursor (DECSC)
    buf += "\x1b[?7l";       // disable auto-wrap

    for (const index of rows) {
      const row = index + 1;
      buf += moveCursor(row, sepCol);
      buf += dim("│");
      buf += moveCursor(row, sidebarCol);
      buf += formattedLines[index];
    }

    buf += "\x1b[?7h";       // enable auto-wrap
    buf += "\x1b8";          // restore cursor (DECRC)
    if (standalone) buf += "\x1b[?2026l"; // end synchronized output

    try {
      this.originalWrite(buf);
    } catch {
      this.cacheValid = false;
      return;
    }

    this.cachedLines = formattedLines;
    this.cachedColumns = rawCols;
    this.cachedRows = rawRows;
    this.cachedWidth = sw;
    this.cacheValid = true;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;

    if (this.originalColumnsOwnDesc) {
      Object.defineProperty(this.terminal, "columns", this.originalColumnsOwnDesc);
    } else {
      Reflect.deleteProperty(this.terminal, "columns");
    }

    if (this.originalDoRender !== null) {
      this.tui.doRender = this.originalDoRender;
    }

    if (this.originalRouteWheel !== null) {
      this.tui.routeWheel = this.originalRouteWheel;
      this.originalRouteWheel = null;
    }
  }
}

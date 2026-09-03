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

  // Last painted sidebar content, used to repaint only rows that actually
  // changed. Prevents full-panel rewrites every frame (the flicker source).
  private cachedLines: string[] | null = null;
  private cachedColumns = 0;
  private cachedRows = 0;
  private cachedWidth = 0;
  private cacheValid = false;

  constructor(tui: any, getCtx: () => SidebarContext, sidebarWidth = 40) {
    this.tui = tui;
    this.terminal = tui.terminal;
    this.getCtx = getCtx;
    this.originalWrite = this.terminal.write.bind(this.terminal);
    this.sidebarWidth = sidebarWidth;
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
        return Math.max(1, raw - self.sidebarWidth - 1);
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
              if (/\x1b\[(?:2J|3J)/.test(data)) forceFullPaint = true;
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
  }

  paint(): void {
    // Standalone paint (e.g. from a state-update request): its own sync frame.
    this.paintInternal(false, true);
  }

  private rawColumns(): number {
    const d = this.originalColumnsDesc;
    const raw = d?.get
      ? d.get.call(this.terminal)
      : (typeof d?.value === "number" ? d.value : undefined);
    return typeof raw === "number" && Number.isFinite(raw) ? Math.max(1, Math.floor(raw)) : 80;
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
    if (this.disposed) return;

    const rawRows = this.terminal.rows;
    const rawCols = this.rawColumns();
    const sw = this.sidebarWidth;
    const sepCol = rawCols - sw;
    const sidebarCol = sepCol + 1;

    const ctx = this.getCtx();
    const lines = renderSidebar(ctx, sw);

    // Build the full set of formatted lines (panel rows + bottom cwd row).
    const home = process.env["HOME"] ?? "";
    const cwd = ctx.cwd ?? "";
    const cwdDisplay = home && cwd.startsWith(home) ? "~" + cwd.slice(home.length) : cwd;
    const cwdTruncated = visibleWidth(cwdDisplay) > sw - 1
      ? "…" + cwdDisplay.slice(-(sw - 2))
      : cwdDisplay;
    const cwdLine = dim(" " + cwdTruncated);

    const formattedLines: string[] = [];
    for (let row = 1; row <= rawRows; row++) {
      if (row === rawRows && cwd) {
        formattedLines.push(this.formatLine(cwdLine, sw));
      } else {
        formattedLines.push(this.formatLine(lines[row - 1], sw));
      }
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
  }
}

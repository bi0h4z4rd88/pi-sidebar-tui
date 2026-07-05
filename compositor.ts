import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import type { SidebarContext } from "./types.ts";
import { renderSidebar } from "./sidebar.ts";

// Dark navy-indigo: subtle, distinct from pure-black terminal bg, complements cyan/amber/green text
const SIDEBAR_BG = "\x1b[48;2;16;18;30m";
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
  private sidebarWidth: number;
  private getCtx: () => SidebarContext;
  private originalColumnsDesc: PropertyDescriptor | undefined;
  private originalDoRender: (() => void) | null = null;
  private originalWrite: (data: string) => void;
  private disposed = false;

  constructor(tui: any, sidebarWidth: number, getCtx: () => SidebarContext) {
    this.tui = tui;
    this.terminal = tui.terminal;
    this.sidebarWidth = sidebarWidth;
    this.getCtx = getCtx;
    this.originalWrite = this.terminal.write.bind(this.terminal);
  }

  install(): void {
    // Narrow terminal.columns so pi renders content in the left portion only.
    // The separator + sidebar occupy the right (sidebarWidth + 1) columns.
    this.originalColumnsDesc = descriptorFor(this.terminal, "columns");
    const origDesc = this.originalColumnsDesc;
    const terminal = this.terminal;
    const sw = this.sidebarWidth;

    Object.defineProperty(terminal, "columns", {
      configurable: true,
      enumerable: true,
      get() {
        const raw = origDesc?.get
          ? origDesc.get.call(terminal)
          : (typeof origDesc?.value === "number" ? origDesc.value : 80);
        return Math.max(1, raw - sw - 1);
      },
    });

    // Paint sidebar after every pi render cycle
    if (typeof this.tui.doRender === "function") {
      this.originalDoRender = this.tui.doRender.bind(this.tui);
      const self = this;
      this.tui.doRender = function () {
        if (self.disposed) { self.originalDoRender?.(); return; }
        self.originalDoRender!();
        self.paint();
      };
    }
  }

  private getRawColumns(): number {
    const d = this.originalColumnsDesc;
    if (d?.get) return d.get.call(this.terminal);
    if (typeof d?.value === "number") return d.value;
    return 80;
  }

  paint(): void {
    if (this.disposed) return;
    const rawRows = this.terminal.rows;
    const rawCols = this.getRawColumns();
    const sepCol = rawCols - this.sidebarWidth;
    const sidebarCol = sepCol + 1;
    const ctx = this.getCtx();
    const lines = renderSidebar(ctx, this.sidebarWidth);

    let buf = "\x1b[?2026h"; // begin synchronized output
    buf += "\x1b7";          // save cursor (DECSC)
    buf += "\x1b[?7l";       // disable auto-wrap

    // Format cwd for bottom row: collapse home dir, truncate from left if needed
    const cwd = ctx.cwd ?? "";
    const home = process.env["HOME"] ?? "";
    const cwdDisplay = home && cwd.startsWith(home) ? "~" + cwd.slice(home.length) : cwd;
    const cwdLine = "\x1b[2m" + (visibleWidth(cwdDisplay) > this.sidebarWidth
      ? "…" + cwdDisplay.slice(-(this.sidebarWidth - 1))
      : cwdDisplay) + BG_RESET;

    for (let row = 1; row <= rawRows; row++) {
      buf += moveCursor(row, sepCol);
      buf += "\x1b[2m│\x1b[0m";
      buf += moveCursor(row, sidebarCol);
      buf += SIDEBAR_BG;
      if (row === rawRows && cwd) {
        buf += truncateToWidth(cwdLine, this.sidebarWidth, "", true);
      } else {
        const line = lines[row - 1];
        buf += line !== undefined
          ? truncateToWidth(line, this.sidebarWidth, "", true)
          : " ".repeat(this.sidebarWidth);
      }
      buf += BG_RESET;
    }

    buf += "\x1b[?7h";       // enable auto-wrap
    buf += "\x1b8";          // restore cursor (DECRC)
    buf += "\x1b[?2026l";    // end synchronized output

    this.originalWrite(buf);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;

    if (this.originalColumnsDesc) {
      Object.defineProperty(this.terminal, "columns", this.originalColumnsDesc);
    } else {
      Reflect.deleteProperty(this.terminal, "columns");
    }

    if (this.originalDoRender !== null) {
      this.tui.doRender = this.originalDoRender;
    }
  }
}

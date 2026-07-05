import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import type { SidebarContext } from "./types.ts";
import { renderSidebar } from "./sidebar.ts";

const SIDEBAR_BG = "\x1b[48;2;0;0;0m"; // black — matches terminal bg, hides scroll flash
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
  private originalDoRender: (() => void) | null = null;
  private originalWrite: (data: string) => void;
  private disposed = false;

  constructor(tui: any, getCtx: () => SidebarContext) {
    this.tui = tui;
    this.terminal = tui.terminal;
    this.getCtx = getCtx;
    this.originalWrite = this.terminal.write.bind(this.terminal);
  }

  private getRawColumns(): number {
    const d = this.originalColumnsDesc;
    if (d?.get) return d.get.call(this.terminal);
    if (typeof d?.value === "number") return d.value;
    return 80;
  }

  private get sidebarWidth(): number {
    return Math.floor(this.getRawColumns() / 3);
  }

  install(): void {
    // Narrow terminal.columns so pi renders in the left 2/3 only.
    this.originalColumnsDesc = descriptorFor(this.terminal, "columns");
    const origDesc = this.originalColumnsDesc;
    const terminal = this.terminal;

    Object.defineProperty(terminal, "columns", {
      configurable: true,
      enumerable: true,
      get() {
        const raw = origDesc?.get
          ? origDesc.get.call(terminal)
          : (typeof origDesc?.value === "number" ? origDesc.value : 80);
        const sw = Math.min(5, Math.floor(raw / 3));
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

  paint(): void {
    if (this.disposed) return;
    const rawRows = this.terminal.rows;
    const rawCols = this.getRawColumns();
    const sw = this.sidebarWidth;
    const sepCol = rawCols - sw;
    const sidebarCol = sepCol + 1;
    const ctx = this.getCtx();
    const lines = renderSidebar(ctx, sw);

    let buf = "\x1b[?2026h"; // begin synchronized output
    buf += "\x1b7";          // save cursor (DECSC)
    buf += "\x1b[?7l";       // disable auto-wrap

    // Format cwd for bottom row: collapse home dir, truncate from left if needed
    const cwd = ctx.cwd ?? "";
    const home = process.env["HOME"] ?? "";
    const cwdDisplay = home && cwd.startsWith(home) ? "~" + cwd.slice(home.length) : cwd;
    const cwdLine = "\x1b[2m " + (visibleWidth(cwdDisplay) > sw - 1
      ? "…" + cwdDisplay.slice(-(sw - 2))
      : cwdDisplay) + "\x1b[22;23;24;39m"; // selective reset, preserves bg for padding spaces

    for (let row = 1; row <= rawRows; row++) {
      buf += moveCursor(row, sepCol);
      buf += "\x1b[2m│\x1b[0m";
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

import { truncateToWidth } from "@earendil-works/pi-tui";
import type { SidebarContext } from "./types.ts";
import { renderSidebar } from "./sidebar.ts";

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
    this.originalColumnsDesc = descriptorFor(this.terminal, "columns");
    const origDesc = this.originalColumnsDesc;
    const terminal = this.terminal;
    const sw = this.sidebarWidth;

    // Make pi think the terminal is narrower so it renders in the left portion only
    Object.defineProperty(terminal, "columns", {
      configurable: true,
      enumerable: true,
      get() {
        const raw = origDesc?.get
          ? origDesc.get.call(terminal)
          : (typeof origDesc?.value === "number" ? origDesc.value : 80);
        return Math.max(1, raw - sw);
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
    const sidebarCol = rawCols - this.sidebarWidth + 1;
    const ctx = this.getCtx();
    const lines = renderSidebar(ctx, this.sidebarWidth);

    let buf = "\x1b[?2026h"; // begin synchronized output
    buf += "\x1b[?7l";       // disable auto-wrap

    for (let row = 1; row <= rawRows; row++) {
      const line = lines[row - 1];
      buf += moveCursor(row, sidebarCol);
      buf += line !== undefined
        ? truncateToWidth(line, this.sidebarWidth, "", true)
        : " ".repeat(this.sidebarWidth);
    }

    buf += "\x1b[?7h";       // enable auto-wrap
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

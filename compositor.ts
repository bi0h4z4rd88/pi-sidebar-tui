import { truncateToWidth } from "@earendil-works/pi-tui";
import type { SidebarContext } from "./types.ts";
import { renderSidebar } from "./sidebar.ts";

function moveCursor(row: number, col: number): string {
  return `\x1b[${row};${col}H`;
}

export class SidebarCompositor {
  private tui: any;
  private terminal: any;
  private sidebarWidth: number;
  private getCtx: () => SidebarContext;
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
    if (typeof this.tui.doRender !== "function") return;
    this.originalDoRender = this.tui.doRender.bind(this.tui);
    const self = this;
    this.tui.doRender = function () {
      if (self.disposed) { self.originalDoRender?.(); return; }
      self.originalDoRender!();
      self.paint();
    };
  }

  paint(): void {
    if (this.disposed) return;
    const rawRows = this.terminal.rows;
    const rawCols = this.terminal.columns;
    // separator 1 col to the left of the sidebar
    const sepCol = rawCols - this.sidebarWidth;
    const sidebarCol = sepCol + 1;
    const ctx = this.getCtx();
    const lines = renderSidebar(ctx, this.sidebarWidth);

    let buf = "\x1b[?2026h"; // begin synchronized output
    buf += "\x1b7";          // save cursor (DECSC)
    buf += "\x1b[?7l";       // disable auto-wrap

    for (let row = 1; row <= rawRows; row++) {
      buf += moveCursor(row, sepCol);
      buf += "\x1b[2m│\x1b[0m"; // dim separator
      const line = lines[row - 1];
      buf += moveCursor(row, sidebarCol);
      buf += line !== undefined
        ? truncateToWidth(line, this.sidebarWidth, "", true)
        : " ".repeat(this.sidebarWidth);
    }

    buf += "\x1b[?7h";       // enable auto-wrap
    buf += "\x1b8";          // restore cursor (DECRC)
    buf += "\x1b[?2026l";    // end synchronized output

    this.originalWrite(buf);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    if (this.originalDoRender !== null) {
      this.tui.doRender = this.originalDoRender;
    }
  }
}

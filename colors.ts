// Selective reset: clears bold/dim/italic/underline/fg but NOT background
const RESET = "\x1b[22;23;24;39m";
const BOLD = "\x1b[1m";
const DIM_CODE = "\x1b[2m";

function hexToAnsi(color: string): string {
  const h = color.replace("#", "");
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `\x1b[38;2;${r};${g};${b}m`;
}

export const COLORS = {
  accent:  "#febc38",
  success: "#5faf5f",
  warning: "#ff9500",
  header:  "#00afaf",
  muted:   "#6c6c6c",
};

export function bold(text: string): string {
  return `${BOLD}${text}${RESET}`;
}

export function dim(text: string): string {
  return `${DIM_CODE}${text}${RESET}`;
}

export function fg(hexColor: string, text: string): string {
  return `${hexToAnsi(hexColor)}${text}${RESET}`;
}

export function formatDuration(ms: number): string {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  if (m > 0) return `${m}m${s % 60}s`;
  return `${s}s`;
}

export function formatRelativeTime(ms: number): string {
  return `${formatDuration(ms)} ago`;
}

export function formatTokens(n: number): string {
  if (n < 1000) return n.toString();
  if (n < 1_000_000) return `${Math.round(n / 1000)}k`;
  return `${(n / 1_000_000).toFixed(1)}M`;
}

const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

export function spinnerFrame(): string {
  return SPINNER_FRAMES[Math.floor(Date.now() / 80) % SPINNER_FRAMES.length];
}

export function formatDiffStat(added: number, removed: number): string {
  if (removed > 0) return `+${added} -${removed}`;
  return `+${added}`;
}

export function panelHeader(title: string, width: number): string[] {
  const separatorLen = Math.max(0, width);
  return [
    bold(title),
    dim("─".repeat(separatorLen)),
  ];
}

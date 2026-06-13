const FG_RESET = "\x1b[39m";
const STYLE_RESET = "\x1b[22m";

export function detectColor(
  env = process.env,
  isTTY = process.stdout.isTTY === true,
) {
  if (env.NO_COLOR !== undefined && env.NO_COLOR !== "") return false;
  return isTTY;
}

export function createTheme(enabled = detectColor()) {
  const style = (open, close) => (text) =>
    enabled ? `${open}${text}${close}` : String(text);
  return {
    enabled,
    purple: style("\x1b[38;5;141m", FG_RESET),
    green: style("\x1b[38;5;114m", FG_RESET),
    dim: style("\x1b[2m", STYLE_RESET),
    bold: style("\x1b[1m", STYLE_RESET),
  };
}

const ANSI_PATTERN = /\x1b\[[0-9;]*m/g;
const ANSI_AT_START = /^\x1b\[[0-9;]*m/;

export function stripAnsi(text) {
  return String(text).replace(ANSI_PATTERN, "");
}

export function visibleWidth(text) {
  return stripAnsi(text).length;
}

export function padVisible(text, width) {
  const pad = Math.max(0, width - visibleWidth(text));
  return `${text}${" ".repeat(pad)}`;
}

export function truncateVisible(text, width) {
  if (width <= 0) return "";
  const str = String(text);
  if (visibleWidth(str) <= width) return str;
  let out = "";
  let visible = 0;
  let i = 0;
  while (i < str.length && visible < width - 1) {
    const code = ANSI_AT_START.exec(str.slice(i));
    if (code) {
      out += code[0];
      i += code[0].length;
      continue;
    }
    out += str[i];
    i += 1;
    visible += 1;
  }
  return out.includes("\x1b") ? `${out}\x1b[0m…` : `${out}…`;
}

export function layoutWidth(columns) {
  const cols = Number.isFinite(columns) ? columns : 80;
  return Math.max(60, Math.min(cols - 1, 100));
}

export function box(lines, { width, theme }) {
  const inner = width - 2;
  const top = theme.purple(`╭${"─".repeat(inner)}╮`);
  const bottom = theme.purple(`╰${"─".repeat(inner)}╯`);
  const body = lines.map((line) => {
    const content = padVisible(truncateVisible(`  ${line}`, inner), inner);
    return `${theme.purple("│")}${content}${theme.purple("│")}`;
  });
  return [top, ...body, bottom].join("\n");
}

export function sectionHeader(title, width, theme) {
  const ruleLength = Math.max(0, width - title.length - 2);
  const label = theme.bold(theme.purple(title));
  return ` ${label} ${theme.purple("─".repeat(ruleLength))}`;
}

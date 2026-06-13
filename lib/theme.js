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
    magenta: style("\x1b[38;5;176m", FG_RESET),
    green: style("\x1b[38;5;114m", FG_RESET),
    dim: style("\x1b[2m", STYLE_RESET),
    bold: style("\x1b[1m", STYLE_RESET),
  };
}

import { emitKeypressEvents } from "node:readline";
import { createTheme } from "./theme.js";

const theme = createTheme();

// True when a keypress should cancel the prompt: Left arrow (←) on an empty
// line. A non-empty line means the user is editing, so ← just moves the cursor.
export function isCancelKey(key, line) {
  return Boolean(key) && key.name === "left" && line === "";
}

// Move the highlighted index in response to an arrow key. Pure.
export function moveIndex(index, count, keyName) {
  if (keyName === "up") return Math.max(0, index - 1);
  if (keyName === "down") return Math.min(count - 1, index + 1);
  return index;
}

// Toggle membership of an index in a selection set, returning a new set. Pure.
export function toggleSelected(selected, index) {
  const next = new Set(selected);
  if (next.has(index)) next.delete(index);
  else next.add(index);
  return next;
}

// Render the lines for an interactive chooser. `options` is an array of
// { title, description }. Highlighted row gets a ❯ pointer; multi-select rows
// get a ◉/◯ checkbox, single-select rows a ●/○ radio. Pure (modulo color).
export function renderChoiceLines({
  label,
  options,
  index,
  multi,
  selected,
  help,
}) {
  const lines = [theme.bold(`◇ ${label}`)];
  if (help) lines.push(theme.dim(`  ${help}`));
  options.forEach((option, i) => {
    const active = i === index;
    const pointer = active ? theme.purple("❯") : " ";
    const mark = multi
      ? selected.has(i)
        ? theme.green("◉")
        : "◯"
      : active
        ? theme.green("●")
        : "○";
    const title = active ? theme.bold(option.title) : option.title;
    lines.push(` ${pointer} ${mark} ${title}`);
    if (active && option.description)
      lines.push(theme.dim(`     ${option.description}`));
  });
  return lines;
}

// Interactive single/multi chooser driven by arrow keys. ↑↓ move, Enter
// confirms, ← cancels; in multi mode Space toggles a checkbox. Resolves to
// { index } (single), { values: number[] } (multi), or { cancelled: true }.
// Renders in place over the chooser's own block, leaving prior output intact.
export async function chooseInteractive(opts) {
  const input = opts.input || process.stdin;
  const output = opts.output || process.stdout;
  const multi = Boolean(opts.multi);
  const count = opts.options.length;
  const help = multi
    ? "↑↓ move · space toggle · enter confirm · ← back"
    : "↑↓ move · enter select · ← back";
  let index = Math.min(Math.max(opts.defaultIndex || 0, 0), count - 1);
  let selected = new Set(opts.defaultSelected || []);

  emitKeypressEvents(input);
  const wasRaw = Boolean(input.isRaw);
  if (input.isTTY) input.setRawMode(true);
  const priorListeners = input.listeners("keypress");
  input.removeAllListeners("keypress");

  let printed = 0;
  const draw = () => {
    const lines = renderChoiceLines({
      label: opts.label,
      options: opts.options,
      index,
      multi,
      selected,
      help,
    });
    if (printed > 0) output.write(`\x1b[${printed}A`);
    output.write("\x1b[J");
    output.write(`${lines.join("\n")}\n`);
    printed = lines.length;
  };
  draw();

  return new Promise((resolve) => {
    const cleanup = () => {
      input.removeListener("keypress", onKey);
      if (input.isTTY) input.setRawMode(wasRaw);
      for (const listener of priorListeners) input.on("keypress", listener);
    };
    const onKey = (_str, key) => {
      if (!key) return;
      if (key.ctrl && key.name === "c") {
        cleanup();
        process.exit(130);
      }
      if (key.name === "up" || key.name === "down") {
        index = moveIndex(index, count, key.name);
        draw();
        return;
      }
      if (multi && key.name === "space") {
        selected = toggleSelected(selected, index);
        draw();
        return;
      }
      if (key.name === "left") {
        cleanup();
        resolve({ cancelled: true });
        return;
      }
      if (key.name === "return") {
        cleanup();
        if (multi) resolve({ values: [...selected].sort((a, b) => a - b) });
        else resolve({ index });
      }
    };
    input.on("keypress", onKey);
  });
}

// Wraps rl.question so the Left arrow (←) on an empty line cancels the prompt.
// Resolves to { value } with the typed answer, or { cancelled: true } when the
// user presses ← before typing anything. Left arrow still edits a non-empty line.
export async function askCancelable(rl, query, input = process.stdin) {
  emitKeypressEvents(input);
  const controller = new AbortController();
  const onKeypress = (_str, key) => {
    if (isCancelKey(key, rl.line)) controller.abort();
  };
  input.on("keypress", onKeypress);
  try {
    const value = await rl.question(query, { signal: controller.signal });
    return { value };
  } catch (error) {
    if (error && error.name === "AbortError") return { cancelled: true };
    throw error;
  } finally {
    input.off("keypress", onKeypress);
  }
}

# Dashboard Claude Code Theme Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restyle the `npx digital-brain` terminal dashboard to a Claude Code-style look — rounded purple header card, status dots, `❯` cursor, dim secondary text — with zero new dependencies and zero behavior changes.

**Architecture:** A new pure-function theme module (`lib/theme.js`) provides ANSI color helpers (factory-created so tests can force colors on/off) and layout primitives (visible-width padding/truncation that ignore ANSI codes, a rounded box, ruled section headers). `lib/ui.js` keeps all of its input handling and menu logic untouched; only the render code changes to use the theme.

**Tech Stack:** Node.js ≥20 ESM, raw ANSI 256-color escape codes, `node:test` runner (existing `npm test` runs `tests/*.test.mjs`).

**Spec:** `docs/superpowers/specs/2026-06-13-dashboard-claude-code-theme-design.md`

**Domain notes for the engineer:**
- ANSI escape codes: `\x1b[38;5;141m` sets a 256-color foreground (141 = soft violet, our "midnight purple"); `\x1b[39m` resets only the foreground; `\x1b[1m`/`\x1b[2m` are bold/dim and `\x1b[22m` resets both. We use attribute-specific resets (`39`, `22`) instead of the full reset (`0`) so nested styles like `bold(purple("x"))` don't cancel each other.
- Strings containing ANSI codes are longer in `.length` than they look on screen. Any column alignment must therefore measure "visible width" (length after stripping codes), which is why `padVisible`/`truncateVisible` exist.
- The `NO_COLOR` convention (https://no-color.org): if the `NO_COLOR` env var is set to anything, CLI tools should emit no color.
- `lib/ui.js` is an interactive raw-mode TTY app. It exits immediately when stdin/stdout are not TTYs, so automated runs can only check that it parses (`node --check`); visual checks are manual.

**File structure:**
- `lib/theme.js` (new) — colors + layout primitives, pure functions, no I/O except reading nothing; ~120 lines.
- `tests/theme.test.mjs` (new) — unit tests for the theme module.
- `lib/ui.js` (modified) — render functions only: `render()`, `sourceLine()`, `pick()`, `runCommand()`, plus a version reader and a new `headerLines()` helper.

---

### Task 1: Theme module — color helpers

**Files:**
- Create: `lib/theme.js`
- Test: `tests/theme.test.mjs`

- [ ] **Step 1: Write the failing tests**

Create `tests/theme.test.mjs`:

```js
import test from "node:test";
import assert from "node:assert/strict";
import { createTheme, detectColor } from "../lib/theme.js";

test("color helpers wrap text in ANSI codes when enabled", () => {
  const theme = createTheme(true);
  assert.equal(theme.purple("hi"), "\x1b[38;5;141mhi\x1b[39m");
  assert.equal(theme.green("hi"), "\x1b[38;5;114mhi\x1b[39m");
  assert.equal(theme.magenta("hi"), "\x1b[38;5;176mhi\x1b[39m");
  assert.equal(theme.dim("hi"), "\x1b[2mhi\x1b[22m");
  assert.equal(theme.bold("hi"), "\x1b[1mhi\x1b[22m");
});

test("color helpers pass text through unchanged when disabled", () => {
  const theme = createTheme(false);
  assert.equal(theme.purple("hi"), "hi");
  assert.equal(theme.green("hi"), "hi");
  assert.equal(theme.dim("hi"), "hi");
  assert.equal(theme.bold("hi"), "hi");
});

test("nested styles compose without cancelling each other", () => {
  const theme = createTheme(true);
  assert.equal(
    theme.bold(theme.purple("x")),
    "\x1b[1m\x1b[38;5;141mx\x1b[39m\x1b[22m",
  );
});

test("detectColor is false when NO_COLOR is set", () => {
  assert.equal(detectColor({ NO_COLOR: "1" }, true), false);
  assert.equal(detectColor({}, true), true);
  assert.equal(detectColor({}, false), false);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd "/Users/rushilshah/Desktop/Projects/Digital Brain" && node --test tests/theme.test.mjs`
Expected: FAIL — `Cannot find module '.../lib/theme.js'`

- [ ] **Step 3: Write the minimal implementation**

Create `lib/theme.js`:

```js
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd "/Users/rushilshah/Desktop/Projects/Digital Brain" && node --test tests/theme.test.mjs`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add lib/theme.js tests/theme.test.mjs
git commit -m "feat: add terminal theme color helpers"
```

---

### Task 2: Theme module — visible-width text helpers

**Files:**
- Modify: `lib/theme.js`
- Test: `tests/theme.test.mjs`

- [ ] **Step 1: Write the failing tests**

Append to `tests/theme.test.mjs` (extend the import line first):

```js
import {
  createTheme,
  detectColor,
  visibleWidth,
  padVisible,
  truncateVisible,
} from "../lib/theme.js";
```

```js
test("visibleWidth ignores ANSI escape codes", () => {
  const theme = createTheme(true);
  assert.equal(visibleWidth("hello"), 5);
  assert.equal(visibleWidth(theme.purple("hello")), 5);
  assert.equal(visibleWidth(theme.bold(theme.purple("hello"))), 5);
});

test("padVisible pads colored strings to the target visible width", () => {
  const theme = createTheme(true);
  assert.equal(visibleWidth(padVisible(theme.green("ok"), 6)), 6);
  assert.equal(padVisible("ok", 6), "ok    ");
  assert.equal(padVisible("toolong", 3), "toolong");
});

test("truncateVisible leaves short strings alone", () => {
  assert.equal(truncateVisible("short", 10), "short");
});

test("truncateVisible cuts to width and appends ellipsis", () => {
  const out = truncateVisible("a".repeat(20), 10);
  assert.equal(out, "aaaaaaaaa…");
  assert.equal(visibleWidth(out), 10);
});

test("truncateVisible preserves ANSI codes and resets styles", () => {
  const theme = createTheme(true);
  const out = truncateVisible(theme.purple("a".repeat(20)), 10);
  assert.equal(visibleWidth(out), 10);
  assert.ok(out.startsWith("\x1b[38;5;141m"));
  assert.ok(out.endsWith("\x1b[0m…"));
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd "/Users/rushilshah/Desktop/Projects/Digital Brain" && node --test tests/theme.test.mjs`
Expected: FAIL — `visibleWidth` (and others) not exported

- [ ] **Step 3: Write the minimal implementation**

Append to `lib/theme.js`:

```js
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd "/Users/rushilshah/Desktop/Projects/Digital Brain" && node --test tests/theme.test.mjs`
Expected: PASS (9 tests)

- [ ] **Step 5: Commit**

```bash
git add lib/theme.js tests/theme.test.mjs
git commit -m "feat: add ANSI-aware width helpers to theme"
```

---

### Task 3: Theme module — box, section headers, layout width

**Files:**
- Modify: `lib/theme.js`
- Test: `tests/theme.test.mjs`

- [ ] **Step 1: Write the failing tests**

Extend the import in `tests/theme.test.mjs` with `box, sectionHeader, layoutWidth`, then append:

```js
test("layoutWidth clamps to [60, 100] with one column of margin", () => {
  assert.equal(layoutWidth(40), 60);
  assert.equal(layoutWidth(81), 80);
  assert.equal(layoutWidth(500), 100);
  assert.equal(layoutWidth(undefined), 79);
});

test("box renders rounded borders with uniform visible width", () => {
  const theme = createTheme(true);
  const out = box(["short", theme.purple("colored")], { width: 40, theme });
  const lines = out.split("\n");
  assert.equal(lines.length, 4);
  for (const line of lines) assert.equal(visibleWidth(line), 40);
  assert.ok(stripAnsi(lines[0]).startsWith("╭"));
  assert.ok(stripAnsi(lines[0]).endsWith("╮"));
  assert.ok(stripAnsi(lines[3]).startsWith("╰"));
  assert.ok(stripAnsi(lines[3]).endsWith("╯"));
});

test("box truncates content wider than the box", () => {
  const theme = createTheme(false);
  const out = box(["x".repeat(100)], { width: 30, theme });
  for (const line of out.split("\n")) assert.equal(visibleWidth(line), 30);
  assert.ok(out.includes("…"));
});

test("sectionHeader rules out to the full width", () => {
  const theme = createTheme(true);
  const header = sectionHeader("Sources", 50, theme);
  assert.equal(visibleWidth(header), 50);
  assert.ok(stripAnsi(header).startsWith(" Sources ─"));
});
```

(Also add `stripAnsi` to the import line — it is already exported.)

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd "/Users/rushilshah/Desktop/Projects/Digital Brain" && node --test tests/theme.test.mjs`
Expected: FAIL — `box` not exported

- [ ] **Step 3: Write the minimal implementation**

Append to `lib/theme.js`:

```js
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd "/Users/rushilshah/Desktop/Projects/Digital Brain" && node --test tests/theme.test.mjs`
Expected: PASS (13 tests)

- [ ] **Step 5: Run the full project checks**

Run: `cd "/Users/rushilshah/Desktop/Projects/Digital Brain" && npm test && npm run check`
Expected: all existing tests still PASS; `check` exits 0

- [ ] **Step 6: Commit**

```bash
git add lib/theme.js tests/theme.test.mjs
git commit -m "feat: add box, section header, and layout width to theme"
```

---

### Task 4: Restyle the main dashboard screen in `lib/ui.js`

**Files:**
- Modify: `lib/ui.js` (imports at top; `render()` at lines ~67–92; `sourceLine()` at lines ~315–320)

No unit tests for this task — `render()` writes to a raw-mode TTY; the spec assigns it manual verification. Each step ends with `node --check`.

- [ ] **Step 1: Add theme imports, theme instance, and version reader**

In `lib/ui.js`, extend the existing import block:

```js
import {
  box,
  createTheme,
  layoutWidth,
  padVisible,
  sectionHeader,
  visibleWidth,
} from "./theme.js";
```

After the existing `const bin = …` line, add:

```js
const theme = createTheme();
const version = readVersion();
```

And add these helpers near the other small helpers at the bottom of the file (before `parseArgs`):

```js
function readVersion() {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
    return typeof pkg.version === "string" ? pkg.version : "";
  } catch {
    return "";
  }
}

function shortenPath(target) {
  const home = os.homedir();
  return target.startsWith(home) ? `~${target.slice(home.length)}` : target;
}
```

Run: `node --check lib/ui.js`
Expected: exits 0

- [ ] **Step 2: Replace `render()` and add `headerLines()`**

Replace the entire existing `render()` function with:

```js
function render() {
  const snapshot = readSnapshot();
  const items = menuItems(snapshot);
  const width = layoutWidth(process.stdout.columns);
  process.stdout.write("\x1Bc");
  console.log(box(headerLines(snapshot, width), { width, theme }));
  console.log("");
  console.log(sectionHeader("Sources", width, theme));
  console.log("");
  for (const source of sourceList) {
    console.log(`  ${sourceLine(source, snapshot)}`);
  }
  console.log("");
  console.log(sectionHeader("Actions", width, theme));
  console.log("");
  items.forEach((item, index) => {
    const selected = index === state.selected;
    const cursor = selected ? theme.purple("❯") : " ";
    const label = selected ? theme.bold(item.label) : item.label;
    console.log(` ${cursor} ${label}`);
    if (selected && item.detail) console.log(theme.dim(`     ${item.detail}`));
  });
  console.log("");
  if (state.message) console.log(` ${theme.green(state.message)}\n`);
  console.log(theme.dim(" ↑↓ move · ⏎ run · r ingest · g graph estimate · d doctor · q quit"));
}

function headerLines(snapshot, width) {
  const usable = width - 6;
  const title = theme.bold(theme.purple("✻ Digital Brain"));
  const versionLabel = version ? theme.dim(`v${version}`) : "";
  const mode = [
    snapshot.config.setupMode || "guided",
    snapshot.config.schedule || "manual",
    snapshot.config.outboundMode || "draft",
  ].join(" · ");
  const status = snapshot.initialized
    ? theme.green("● ready")
    : theme.dim("○ not initialized");
  return [
    `${padVisible(title, usable - visibleWidth(versionLabel))}${versionLabel}`,
    "",
    `${theme.dim("Vault ")}  ${shortenPath(snapshot.vault)}`,
    `${theme.dim("Status")}  ${status}`,
    `${theme.dim("Mode  ")}  ${mode}`,
  ];
}
```

Run: `node --check lib/ui.js`
Expected: exits 0

- [ ] **Step 3: Replace `sourceLine()` with the dot style**

Replace the existing `sourceLine()` function with:

```js
function sourceLine(source, snapshot) {
  const selected = isSelected(source.key, snapshot);
  const dot = selected ? theme.green("●") : theme.dim("○");
  const status = sourceStatus(source, snapshot);
  const text = `${source.label.padEnd(14)}${status.padEnd(22)}${source.description}`;
  return `${dot} ${selected ? text : theme.dim(text)}`;
}
```

Run: `node --check lib/ui.js`
Expected: exits 0

- [ ] **Step 4: Run checks and commit**

Run: `cd "/Users/rushilshah/Desktop/Projects/Digital Brain" && npm test && npm run check`
Expected: PASS / exit 0

```bash
git add lib/ui.js
git commit -m "feat: restyle main dashboard with Claude Code theme"
```

---

### Task 5: Restyle picker, command, and prompt screens in `lib/ui.js`

**Files:**
- Modify: `lib/ui.js` (`pick()` at lines ~226–253; `runCommand()` at lines ~272–287)

- [ ] **Step 1: Restyle `pick()`**

Inside the existing `pick()` while-loop, replace the rendering block (from `process.stdout.write("\x1Bc");` through the `console.log("Keys: …")` line — keep the `readKey()` handling below it untouched) with:

```js
    process.stdout.write("\x1Bc");
    console.log(sectionHeader(title, layoutWidth(process.stdout.columns), theme));
    console.log("");
    items.forEach((item, index) => {
      const active = index === selected;
      const cursor = active ? theme.purple("❯") : " ";
      const label = active ? theme.bold(item.label) : item.label;
      console.log(` ${cursor} ${label}`);
      if (active && item.detail) console.log(theme.dim(`     ${item.detail}`));
    });
    console.log("");
    console.log(theme.dim(" ↑↓ move · ⏎ choose · esc back"));
```

Run: `node --check lib/ui.js`
Expected: exits 0

- [ ] **Step 2: Restyle `runCommand()`**

In `runCommand()`, replace:

```js
  console.log(`$ digital-brain ${argv.join(" ")}`);
```

with:

```js
  console.log(theme.purple(`$ digital-brain ${argv.join(" ")}`));
```

and replace:

```js
  await rl.question("Press Enter to return to Digital Brain...");
```

with:

```js
  await rl.question(theme.dim("Press Enter to return to Digital Brain..."));
```

Run: `node --check lib/ui.js`
Expected: exits 0

- [ ] **Step 3: Run checks and commit**

Run: `cd "/Users/rushilshah/Desktop/Projects/Digital Brain" && npm test && npm run check`
Expected: PASS / exit 0

```bash
git add lib/ui.js
git commit -m "feat: restyle picker and command screens with theme"
```

---

### Task 6: Final verification

**Files:** none (verification only)

- [ ] **Step 1: Full automated check**

Run: `cd "/Users/rushilshah/Desktop/Projects/Digital Brain" && npm test && npm run check`
Expected: all tests PASS, `check` exits 0

- [ ] **Step 2: Non-TTY fallback still works**

Run: `node lib/ui.js < /dev/null | cat`
Expected output: `Digital Brain UI needs an interactive terminal. Use \`digital-brain help\` for commands.` (exit code 1 — unchanged behavior)

- [ ] **Step 3: Manual visual check (user)**

The user runs `npx digital-brain` in a real terminal and verifies:
- purple rounded header card with `✻ Digital Brain` + right-aligned version
- green `●` / dim `○` source dots, off rows dimmed
- purple `❯` cursor, bold selected action, dim detail line
- dim footer; picker sub-screens and `$ digital-brain …` command line styled
- `NO_COLOR=1 npx digital-brain` renders plain (boxes, no color)

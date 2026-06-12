# Dashboard Claude Code Theme — Design

**Date:** 2026-06-13
**Status:** Approved direction (full Claude Code chrome)
**Scope:** `lib/ui.js` rendering only — zero behavior changes, zero new dependencies.

## Goal

Restyle the `npx digital-brain` terminal dashboard from plain monochrome text to a
Claude Code-style look: rounded box-drawing header card, midnight purple accent,
status dots, `❯` cursor, dim secondary text, clearly sectioned layout.

## Approach

Raw ANSI escape codes in a new zero-dependency theme module. Rejected alternatives:

- **picocolors/chalk** — adds a dependency for ~15 lines of escape codes.
- **Ink rewrite** — pulls in React, forces a rewrite of working input handling.

## Components

### New: `lib/theme.js` (pure functions, no state)

**Color helpers** — `purple`, `magenta`, `green`, `dim`, `bold`. Each wraps a string
in ANSI codes. Midnight purple uses 256-color `38;5;141` foreground (a soft
violet that reads as midnight purple on dark terminals).

**Color gating** — colors become identity pass-throughs when:
- `process.env.NO_COLOR` is set (NO_COLOR convention), or
- stdout is not a TTY.

**Layout helpers:**
- `visibleWidth(str)` — string width ignoring ANSI escape sequences.
- `padVisible(str, width)` — right-pad based on visible width so ANSI-colored
  strings align in columns.
- `box(lines, opts)` — rounded-corner bordered card (`╭─╮ │ ╰─╯`) in purple,
  sized to terminal width. Width clamps to `process.stdout.columns` with a
  minimum of 60; content longer than the inner width is truncated with `…`.
- `sectionHeader(title, width)` — renders ` Title ─────────` ruled header in
  purple bold.

### Changed: `lib/ui.js` (render functions only)

**Main screen (`render()`):**
- Header card via `box()`: first line `✻ Digital Brain` (bold purple) with
  version right-aligned (read once from `package.json`); blank line; then
  `Vault`, `Status`, `Mode` rows with dim labels.
- `Status`: green `● ready` when initialized, dim `○ not initialized` otherwise.
- Mode row joins values with ` · `.
- Sources section: `sectionHeader("Sources")`; each row uses green `●` when
  enabled, dim `○` when off; off rows rendered fully dim. Column layout
  preserved via `padVisible`.
- Actions section: `sectionHeader("Actions")`; selected row gets purple `❯` +
  bold label, its detail line indented and dim; unselected rows plain with
  two-space indent.
- Status message (`state.message`): green.
- Footer: dim, `·` separators: `↑↓ move · ⏎ run · r ingest · g graph · d doctor · q quit`.

**Picker screens (`pick()`):** same treatment — `sectionHeader(title)`, `❯`
cursor with bold selected label and dim detail, dim footer.

**Command screen (`runCommand()`):** `$ digital-brain …` line in purple;
"Press Enter to return…" prompt dim. Subprocess output untouched.

## Error handling

- Non-TTY / `NO_COLOR`: all helpers pass through plain text; box drawing still
  renders (it is plain Unicode, not color).
- Narrow terminals: box width = `clamp(process.stdout.columns - 1, 60, 100)`
  so borders never wrap; content longer than the inner width truncated with `…`.
- `package.json` version read wrapped in try/catch; falls back to empty string.

## Testing

`tests/theme.test.mjs` (node test runner, matches existing `tests/*.test.mjs`):
- `visibleWidth`/`padVisible` correct for strings containing ANSI codes.
- `box()` output lines all have equal visible width; clamping respected.
- `NO_COLOR=1` makes color helpers identity functions.

Render functions verified manually by running `npx digital-brain` (and sub-screens)
in a real terminal.

## Out of scope

- Any behavior, key-binding, or menu-structure change.
- The Electron desktop app (`desktop/`).
- Styling output of the underlying CLI subcommands (`run`, `doctor`, …).

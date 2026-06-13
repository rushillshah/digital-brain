import test from "node:test";
import assert from "node:assert/strict";
import {
  createTheme,
  detectColor,
  visibleWidth,
  padVisible,
  truncateVisible,
  stripAnsi,
  box,
  sectionHeader,
  layoutWidth,
} from "../lib/theme.js";

test("color helpers wrap text in ANSI codes when enabled", () => {
  const theme = createTheme(true);
  assert.equal(theme.purple("hi"), "\x1b[38;5;141mhi\x1b[39m");
  assert.equal(theme.green("hi"), "\x1b[38;5;114mhi\x1b[39m");
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

test("truncateVisible returns empty string for non-positive width", () => {
  assert.equal(truncateVisible("anything", 0), "");
  assert.equal(truncateVisible("anything", -3), "");
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

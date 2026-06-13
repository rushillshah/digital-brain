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

import test from "node:test";
import assert from "node:assert/strict";
import readline from "node:readline/promises";
import { PassThrough } from "node:stream";
import {
  askCancelable,
  isCancelKey,
  moveIndex,
  toggleSelected,
  renderChoiceLines,
  chooseInteractive,
} from "../lib/prompt.js";
import { stripAnsi } from "../lib/theme.js";

function makeInterface() {
  const input = new PassThrough();
  const output = new PassThrough();
  const rl = readline.createInterface({ input, output });
  return { input, output, rl };
}

test("askCancelable cancels on left arrow with an empty buffer", async () => {
  const { input, rl } = makeInterface();
  const pending = askCancelable(rl, "Q: ", input);
  setImmediate(() => input.emit("keypress", "", { name: "left" }));
  const result = await pending;
  rl.close();
  assert.deepEqual(result, { cancelled: true });
});

test("askCancelable returns the typed value on Enter", async () => {
  const { input, rl } = makeInterface();
  const pending = askCancelable(rl, "Q: ", input);
  input.write("hello\n");
  const result = await pending;
  rl.close();
  assert.deepEqual(result, { value: "hello" });
});

test("isCancelKey only fires for left arrow on an empty line", () => {
  assert.equal(isCancelKey({ name: "left" }, ""), true);
  assert.equal(isCancelKey({ name: "left" }, "hi"), false);
  assert.equal(isCancelKey({ name: "right" }, ""), false);
  assert.equal(isCancelKey({ name: "return" }, ""), false);
  assert.equal(isCancelKey(undefined, ""), false);
});

test("moveIndex clamps at both ends", () => {
  assert.equal(moveIndex(0, 3, "up"), 0);
  assert.equal(moveIndex(0, 3, "down"), 1);
  assert.equal(moveIndex(2, 3, "down"), 2);
  assert.equal(moveIndex(1, 3, "up"), 0);
  assert.equal(moveIndex(1, 3, "space"), 1);
});

test("toggleSelected adds and removes without mutating the input", () => {
  const base = new Set([0]);
  const added = toggleSelected(base, 2);
  assert.deepEqual([...added].sort(), [0, 2]);
  assert.deepEqual([...base], [0]);
  const removed = toggleSelected(added, 0);
  assert.deepEqual([...removed], [2]);
});

test("chooseInteractive returns the highlighted index on Enter", async () => {
  const input = new PassThrough();
  const output = new PassThrough();
  const pending = chooseInteractive({
    label: "Pick",
    options: [{ title: "a" }, { title: "b" }, { title: "c" }],
    input,
    output,
  });
  setImmediate(() => {
    input.emit("keypress", "", { name: "down" });
    input.emit("keypress", "", { name: "down" });
    input.emit("keypress", "", { name: "return" });
  });
  assert.deepEqual(await pending, { index: 2 });
});

test("chooseInteractive multi toggles checkboxes and confirms", async () => {
  const input = new PassThrough();
  const output = new PassThrough();
  const pending = chooseInteractive({
    label: "Sources",
    multi: true,
    options: [{ title: "a" }, { title: "b" }, { title: "c" }],
    input,
    output,
  });
  setImmediate(() => {
    input.emit("keypress", "", { name: "space" });
    input.emit("keypress", "", { name: "down" });
    input.emit("keypress", "", { name: "down" });
    input.emit("keypress", "", { name: "space" });
    input.emit("keypress", "", { name: "return" });
  });
  assert.deepEqual(await pending, { values: [0, 2] });
});

test("chooseInteractive detaches prior keypress listeners and restores them", async () => {
  const input = new PassThrough();
  const output = new PassThrough();
  input.isTTY = true;
  input.isRaw = true;
  const rawCalls = [];
  input.setRawMode = (value) => {
    rawCalls.push(value);
    input.isRaw = value;
    return input;
  };
  let priorFired = 0;
  const prior = () => {
    priorFired += 1;
  };
  input.on("keypress", prior);

  const pending = chooseInteractive({
    label: "Pick",
    options: [{ title: "a" }, { title: "b" }],
    input,
    output,
  });
  setImmediate(() => {
    input.emit("keypress", "", { name: "down" });
    input.emit("keypress", "", { name: "return" });
  });

  assert.deepEqual(await pending, { index: 1 });
  assert.equal(priorFired, 0, "prior listener must be detached while the chooser runs");
  assert.ok(
    input.listeners("keypress").includes(prior),
    "prior listener must be restored afterward",
  );
  assert.deepEqual(rawCalls, [true, true], "raw mode set on, then restored to wasRaw");
});

test("chooseInteractive cancels on left arrow", async () => {
  const input = new PassThrough();
  const output = new PassThrough();
  const pending = chooseInteractive({
    label: "Pick",
    options: [{ title: "a" }, { title: "b" }],
    input,
    output,
  });
  setImmediate(() => input.emit("keypress", "", { name: "left" }));
  assert.deepEqual(await pending, { cancelled: true });
});

test("renderChoiceLines marks the active row and multi checkboxes", () => {
  const options = [
    { title: "Guided", description: "pick each setting" },
    { title: "Auto", description: "recommended" },
  ];
  const lines = renderChoiceLines({
    label: "Setup mode",
    options,
    index: 0,
    multi: true,
    selected: new Set([1]),
    help: "space toggles",
  }).map(stripAnsi);
  assert.equal(lines[0], "◇ Setup mode");
  assert.equal(lines[1], "  space toggles");
  assert.equal(lines[2], " ❯ ◯ Guided");
  assert.equal(lines[3], "     pick each setting");
  assert.equal(lines[4], "   ◉ Auto");
});

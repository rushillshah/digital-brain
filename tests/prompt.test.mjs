import test from "node:test";
import assert from "node:assert/strict";
import readline from "node:readline/promises";
import { PassThrough } from "node:stream";
import { askCancelable, isCancelKey } from "../lib/prompt.js";

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

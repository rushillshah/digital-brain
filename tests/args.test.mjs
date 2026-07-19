import assert from "node:assert/strict";
import test from "node:test";
import { parseArgs } from "../lib/args.js";

test("parseArgs supports flags, values, equals syntax, and repeated options", () => {
  assert.deepEqual(
    parseArgs(["--yes", "--vault", "/tmp/brain", "--model=gpt=custom", "--input", "one", "--input=two"]),
    {
      yes: true,
      vault: "/tmp/brain",
      model: "gpt=custom",
      input: ["one", "two"],
    },
  );
});

test("parseArgs ignores positional values", () => {
  assert.deepEqual(parseArgs(["run", "--days", "30"]), { days: "30" });
});

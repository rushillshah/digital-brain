import { emitKeypressEvents } from "node:readline";

// True when a keypress should cancel the prompt: Left arrow (←) on an empty
// line. A non-empty line means the user is editing, so ← just moves the cursor.
export function isCancelKey(key, line) {
  return Boolean(key) && key.name === "left" && line === "";
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

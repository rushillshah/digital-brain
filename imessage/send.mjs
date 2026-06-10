import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const args = parseArgs(process.argv.slice(2));
if (!args.vault || !args.to || !args.message) usage();

const vault = path.resolve(args.vault);
const sendEnabled = Boolean(args.yes);
const service = args.service || "iMessage";
const logMode = args["log-mode"] || "metadata";
const outboundDir = path.join(vault, "08 Sources", "iMessage", "Outbound");
fs.mkdirSync(outboundDir, { recursive: true });

if (!sendEnabled) {
  logSend({ sent: false, to: args.to, message: args.message, logMode });
  console.log(`Draft iMessage to ${args.to}: ${args.message}`);
  console.log("Add --yes to send.");
  process.exit(0);
}

if (process.platform !== "darwin") {
  throw new Error("iMessage sending requires macOS Messages.");
}

const script = `
tell application "Messages"
  set targetService to 1st service whose service type = ${service === "SMS" ? "SMS" : "iMessage"}
  set targetBuddy to buddy ${quoteAppleScript(args.to)} of targetService
  send ${quoteAppleScript(args.message)} to targetBuddy
end tell
`;
const result = spawnSync("osascript", ["-e", script], { encoding: "utf8" });
if ((result.status ?? 1) !== 0) {
  throw new Error(`iMessage send failed: ${result.stderr || result.stdout || "unknown osascript error"}`);
}
logSend({ sent: true, to: args.to, message: args.message, logMode });
console.log(`Sent iMessage to ${args.to}.`);

function logSend({ sent, to, message, logMode }) {
  const file = path.join(outboundDir, "Sent.md");
  if (!fs.existsSync(file)) fs.writeFileSync(file, "# iMessage Outbound\n\n", "utf8");
  const timestamp = new Date().toISOString();
  const content = logMode === "full" ? message : `[metadata only, ${message.length} chars, ${hash(message)}]`;
  fs.appendFileSync(file, `- ${timestamp} | ${sent ? "sent" : "draft"} | ${to}: ${content}\n`);
}

function quoteAppleScript(value) {
  return `"${String(value).replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

function hash(value) {
  let out = 0;
  for (let i = 0; i < value.length; i += 1) out = ((out << 5) - out + value.charCodeAt(i)) | 0;
  return Math.abs(out).toString(16).slice(0, 10);
}

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith("--")) continue;
    const key = arg.slice(2);
    if (key.includes("=")) {
      const [k, ...rest] = key.split("=");
      out[k] = rest.join("=");
    } else {
      const next = argv[i + 1];
      out[key] = !next || next.startsWith("--") ? true : argv[++i];
    }
  }
  return out;
}

function usage() {
  console.error('Usage: digital-brain send-imessage --to "+15551234567" --message "text" [--yes]');
  process.exit(1);
}

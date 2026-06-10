import fs from "node:fs";
import path from "node:path";

const args = parseArgs(process.argv.slice(2));
if (!args.vault || !args.channel || !args.message) usage();

const vault = path.resolve(args.vault);
const token = args.token || process.env.SLACK_BOT_TOKEN || "";
const sendEnabled = Boolean(args.yes);
const logMode = args["log-mode"] || "metadata";
const outboundDir = path.join(vault, "08 Sources", "Slack", "Outbound");
fs.mkdirSync(outboundDir, { recursive: true });

if (!sendEnabled) {
  logSend({ sent: false, channel: args.channel, message: args.message, logMode });
  console.log(`Draft Slack message for ${args.channel}: ${args.message}`);
  console.log("Add --yes to send.");
  process.exit(0);
}

if (!token) {
  throw new Error("SLACK_BOT_TOKEN is required to send. Create a Slack app/bot token with chat:write and set SLACK_BOT_TOKEN.");
}

const response = await fetch("https://slack.com/api/chat.postMessage", {
  method: "POST",
  headers: {
    authorization: `Bearer ${token}`,
    "content-type": "application/json; charset=utf-8",
  },
  body: JSON.stringify({
    channel: args.channel,
    text: args.message,
  }),
});
const body = await response.json();
if (!body.ok) {
  throw new Error(`Slack send failed: ${body.error || response.statusText}`);
}
logSend({ sent: true, channel: args.channel, message: args.message, ts: body.ts, logMode });
console.log(`Sent Slack message to ${args.channel}.`);

function logSend({ sent, channel, message, ts = "", logMode }) {
  const file = path.join(outboundDir, "Sent.md");
  if (!fs.existsSync(file)) fs.writeFileSync(file, "# Slack Outbound\n\n", "utf8");
  const timestamp = new Date().toISOString();
  const content = logMode === "full" ? message : `[metadata only, ${message.length} chars, ${hash(message)}]`;
  fs.appendFileSync(file, `- ${timestamp} | ${sent ? "sent" : "draft"} | ${channel}${ts ? ` | ${ts}` : ""}: ${content}\n`);
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
  console.error('Usage: digital-brain send-slack --channel C123 --message "text" [--yes]');
  process.exit(1);
}

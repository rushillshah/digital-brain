import fs from "node:fs";
import path from "node:path";

const args = parseArgs(process.argv.slice(2));
if (!args.vault || !args.message || (!args.chat && !(args.team && args.channel))) usage();

const vault = path.resolve(args.vault);
const token = args.token || process.env.MICROSOFT_GRAPH_TOKEN || process.env.MS_GRAPH_TOKEN || "";
const sendEnabled = Boolean(args.yes);
const logMode = args["log-mode"] || "metadata";
const outboundDir = path.join(vault, "08 Sources", "Microsoft Teams", "Outbound");
fs.mkdirSync(outboundDir, { recursive: true });

const target = args.chat ? `chat ${args.chat}` : `team ${args.team} / channel ${args.channel}`;

if (!sendEnabled) {
  logSend({ sent: false, target, message: args.message, logMode });
  console.log(`Draft Microsoft Teams message for ${target}: ${args.message}`);
  console.log("Add --yes to send.");
  process.exit(0);
}

if (!token) {
  throw new Error("MICROSOFT_GRAPH_TOKEN is required to send. Use a delegated Microsoft Graph token with Teams message send permissions.");
}

const endpoint = args.chat
  ? `https://graph.microsoft.com/v1.0/chats/${encodeURIComponent(args.chat)}/messages`
  : `https://graph.microsoft.com/v1.0/teams/${encodeURIComponent(args.team)}/channels/${encodeURIComponent(args.channel)}/messages`;

const response = await fetch(endpoint, {
  method: "POST",
  headers: {
    authorization: `Bearer ${token}`,
    "content-type": "application/json",
  },
  body: JSON.stringify({
    body: {
      contentType: "text",
      content: args.message,
    },
  }),
});
const body = await response.json().catch(() => ({}));
if (!response.ok) {
  throw new Error(`Microsoft Teams send failed: ${body.error?.message || response.statusText}`);
}
logSend({ sent: true, target, message: args.message, messageId: body.id || "", logMode });
console.log(`Sent Microsoft Teams message to ${target}.`);

function logSend({ sent, target, message, messageId = "", logMode }) {
  const file = path.join(outboundDir, "Sent.md");
  if (!fs.existsSync(file)) fs.writeFileSync(file, "# Microsoft Teams Outbound\n\n", "utf8");
  const timestamp = new Date().toISOString();
  const content = logMode === "full" ? message : `[metadata only, ${message.length} chars, ${hash(message)}]`;
  fs.appendFileSync(file, `- ${timestamp} | ${sent ? "sent" : "draft"} | ${target}${messageId ? ` | ${messageId}` : ""}: ${content}\n`);
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
  console.error('Usage: digital-brain send-teams --chat <chat-id> --message "text" [--yes]');
  console.error('   or: digital-brain send-teams --team <team-id> --channel <channel-id> --message "text" [--yes]');
  process.exit(1);
}

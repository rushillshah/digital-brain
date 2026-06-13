import fs from "node:fs";
import crypto from "node:crypto";
import path from "node:path";
import qrcode from "qrcode-terminal";
import pkg from "whatsapp-web.js";

const { Client, LocalAuth } = pkg;
const args = parseArgs(process.argv.slice(2));

if (!args.vault || !args.to || !args.message) usage();

const vault = path.resolve(args.vault);
const whatsAppDir = path.join(vault, "08 Sources", "WhatsApp");
const outboundDir = path.join(whatsAppDir, "Outbound");
const sessionDir = path.join(whatsAppDir, ".session");
const config = readConfig(vault);
const outboundLogMode = args["log-mode"] || config.outboundLogMode || "metadata";
fs.mkdirSync(outboundDir, { recursive: true });

if (!args.yes) {
  console.log("Draft only. Nothing sent.");
  console.log(`To: ${args.to}`);
  console.log(`Message: ${args.message}`);
  console.log("Re-run with --yes to send.");
  process.exit(2);
}

const client = new Client({
  authStrategy: new LocalAuth({ clientId: "digital-brain", dataPath: sessionDir }),
  puppeteer: { headless: false, args: browserArgs() },
});

client.on("qr", (qr) => {
  console.log("Scan this QR in WhatsApp > Linked devices:");
  qrcode.generate(qr, { small: true });
});

client.on("ready", async () => {
  try {
    const chat = await resolveChat(args.to);
    const disclosure = disclosureStatus(chat);
    const bypassDisclosure = args["skip-disclosure-check"] && process.env.DIGITAL_BRAIN_ALLOW_DISCLOSURE_BYPASS === "1";
    if (args["skip-disclosure-check"] && !bypassDisclosure) {
      throw new Error("Disclosure bypass requires DIGITAL_BRAIN_ALLOW_DISCLOSURE_BYPASS=1.");
    }
    if (disclosure.required && !containsDisclosure(args.message) && !bypassDisclosure) {
      throw new Error(
        'AI disclosure required before sending. Add a clear disclosure like: "Just flagging this is my AI assistant helping draft/send this."',
      );
    }
    const sent = await chat.sendMessage(args.message);
    const record = {
      timestamp: new Date().toISOString(),
      to: args.to,
      resolvedChatName: chatName(chat),
      message: outboundLogMode === "full" ? args.message : undefined,
      messageHash: hash(args.message),
      messageCharCount: args.message.length,
      messageId: sent.id?._serialized || null,
      aiAssisted: !args.human,
      disclosureIncluded: containsDisclosure(args.message),
      disclosureBypassed: bypassDisclosure,
    };
    if (outboundLogMode !== "off") {
      fs.appendFileSync(path.join(outboundDir, "sent.jsonl"), `${JSON.stringify(record)}\n`);
      const visible = outboundLogMode === "full" ? args.message : `[metadata only, ${record.messageCharCount} chars, ${record.messageHash.slice(0, 12)}]`;
      fs.appendFileSync(path.join(outboundDir, "Sent.md"), `- ${record.timestamp} | ${record.resolvedChatName}: ${visible}\n`);
    }
    console.log(`Sent to ${record.resolvedChatName}`);
    await client.destroy();
    process.exit(0);
  } catch (error) {
    console.error(`Send failed: ${error.message}`);
    await client.destroy();
    process.exit(1);
  }
});

client.initialize();

async function resolveChat(target) {
  const number = normalizePhone(target);
  if (number) {
    const id = await client.getNumberId(number);
    if (!id) throw new Error(`No WhatsApp account found for phone ${target}`);
    return await client.getChatById(id._serialized);
  }
  const chats = await client.getChats();
  const matches = chats.filter((chat) => chatName(chat).toLowerCase().includes(target.toLowerCase()));
  if (matches.length === 0) throw new Error(`No chat matched "${target}"`);
  if (matches.length > 1) throw new Error(`Multiple chats matched "${target}": ${matches.slice(0, 10).map(chatName).join(", ")}`);
  return matches[0];
}

function normalizePhone(input) {
  if (!input.startsWith("+") && !/^\d{8,}$/.test(input)) return "";
  return input.replace(/[^\d]/g, "");
}

function chatName(chat) {
  return chat.name || chat.formattedTitle || chat.id?._serialized || "Unknown Chat";
}

function parseArgs(argv) {
  const out = { yes: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--yes") out.yes = true;
    else if (arg === "--human") out.human = true;
    else if (arg === "--skip-disclosure-check") out["skip-disclosure-check"] = true;
    else if (arg.startsWith("--")) {
      const key = arg.slice(2);
      out[key] = argv[++i] || "";
    }
  }
  return out;
}

function usage() {
  console.error('Usage: digital-brain send-whatsapp --vault <path> --to "Name" --message "Text" [--yes] [--log-mode metadata|full|off]');
  process.exit(1);
}

function disclosureStatus(chat) {
  const logPath = path.join(outboundDir, "sent.jsonl");
  if (!fs.existsSync(logPath)) return { required: false, count: 0 };

  const cutoff = Date.now() - 24 * 60 * 60 * 1000;
  const name = chatName(chat);
  const records = fs
    .readFileSync(logPath, "utf8")
    .split("\n")
    .filter(Boolean)
    .map(parseJsonLine)
    .filter((record) => record)
    .filter((record) => record.resolvedChatName === name)
    .filter((record) => record.aiAssisted !== false);
  const alreadyDisclosed = records.some((record) => record.disclosureIncluded);
  if (alreadyDisclosed) return { required: false, count: 0, alreadyDisclosed: true };
  const count = records
    .filter((record) => new Date(record.timestamp).getTime() >= cutoff)
    .filter((record) => !record.disclosureIncluded).length;

  return { required: count >= 2, count, alreadyDisclosed: false };
}

function parseJsonLine(line) {
  try {
    return JSON.parse(line);
  } catch {
    return null;
  }
}

function containsDisclosure(message) {
  return /\b(ai|assistant|automated|bot)\b/i.test(message);
}

function readConfig(vaultPath) {
  const file = path.join(vaultPath, "digital-brain.config.json");
  if (!fs.existsSync(file)) return {};
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return {};
  }
}

function hash(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function browserArgs() {
  return process.env.DIGITAL_BRAIN_CHROME_NO_SANDBOX === "1"
    ? ["--no-sandbox", "--disable-setuid-sandbox"]
    : [];
}

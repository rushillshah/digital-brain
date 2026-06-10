import fs from "node:fs";
import crypto from "node:crypto";
import path from "node:path";
import qrcode from "qrcode-terminal";
import pkg from "whatsapp-web.js";

const { Client, LocalAuth } = pkg;
const args = parseArgs(process.argv.slice(2));

if (!args.vault) usage();

const vault = path.resolve(args.vault);
const whatsAppDir = path.join(vault, "08 Sources", "WhatsApp");
const rawDir = path.join(whatsAppDir, "Raw");
const chatsDir = path.join(whatsAppDir, "Chats");
const stateDir = path.join(whatsAppDir, ".sync-state");
const sessionDir = path.join(whatsAppDir, ".session");
const seenPath = path.join(stateDir, "web-seen-message-ids.json");
const days = numberArg("days", 30);
const limitPerChat = numberArg("limit-per-chat", 80);
const markdownMode = args["markdown-mode"] || "none";
const privacyMode = args["privacy-mode"] || "standard";
const selfName = args["self-name"] || "Me";
const includeGroups = !args["no-groups"];
const chatFilter = String(args.chat || "").toLowerCase();
const headless = Boolean(args.headless);

for (const directory of [rawDir, chatsDir, stateDir]) fs.mkdirSync(directory, { recursive: true });

const seen = loadSeen();
let added = 0;

const client = new Client({
  authStrategy: new LocalAuth({ clientId: "digital-brain", dataPath: sessionDir }),
  puppeteer: {
    headless,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  },
});

client.on("qr", (qr) => {
  console.log("Scan this QR in WhatsApp > Linked devices:");
  qrcode.generate(qr, { small: true });
});

client.on("ready", async () => {
  try {
    const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
    const chats = await client.getChats();
    for (const chat of chats) {
      const name = chatName(chat);
      if (!includeGroups && chat.isGroup) continue;
      if (chatFilter && !name.toLowerCase().includes(chatFilter)) continue;
      const messages = await chat.fetchMessages({ limit: limitPerChat });
      for (const message of messages) {
        if (message.isStatus) continue;
        const timestampMs = Number(message.timestamp || 0) * 1000;
        if (Number.isFinite(timestampMs) && timestampMs > 0 && timestampMs < cutoff) continue;
        const record = toRecord(chat, message, timestampMs || Date.now());
        if (!record.body && privacyMode !== "metadata-only") continue;
        if (seen.has(record.id)) continue;
        appendJsonl(record);
        appendMarkdown(record);
        seen.add(record.id);
        added += 1;
      }
    }
    saveSeen();
    console.log(`Added ${added} new WhatsApp Web/Desktop messages.`);
    await client.destroy();
    process.exit(0);
  } catch (error) {
    console.error(`WhatsApp Web/Desktop sync failed: ${error.message}`);
    await client.destroy().catch(() => undefined);
    process.exit(1);
  }
});

client.initialize();

function toRecord(chat, message, timestampMs) {
  const body = message.body || "";
  const timestamp = new Date(timestampMs).toISOString();
  const id = [
    "whatsapp-web",
    chat.id?._serialized || chatName(chat),
    message.id?._serialized || `${timestamp}-${hash(body).slice(0, 10)}`,
  ].join("::");
  return {
    id,
    source: "WhatsApp Web/Desktop linked device",
    sourceSystem: "WhatsApp",
    timestamp,
    chatPk: null,
    chatName: chatName(chat),
    chatJid: chat.id?._serialized || null,
    isGroup: Boolean(chat.isGroup),
    fromMe: Boolean(message.fromMe),
    author: message.fromMe ? selfName : message._data?.notifyName || message.author || chatName(chat) || "Unknown",
    fromJid: message.author || message.from || null,
    toJid: message.to || null,
    messageType: message.type || null,
    body: privacyMode === "metadata-only" ? "" : body,
    bodyHash: privacyMode === "metadata-only" ? hash(body) : "",
    bodyCharCount: body.length,
  };
}

function appendJsonl(record) {
  fs.appendFileSync(path.join(rawDir, `${record.timestamp.slice(0, 10)}.jsonl`), `${JSON.stringify(record)}\n`);
}

function appendMarkdown(record) {
  if (markdownMode === "none") return;
  const directory = markdownMode === "month"
    ? path.join(whatsAppDir, "ChatsByMonth", record.timestamp.slice(0, 7))
    : chatsDir;
  fs.mkdirSync(directory, { recursive: true });
  const file = path.join(directory, `${safeFilename(record.chatName)}.md`);
  if (!fs.existsSync(file)) {
    writeFileAtomic(file, `# ${escapeMarkdown(record.chatName)}\n\nSynced from WhatsApp Web/Desktop linked device.\n\n`);
  }
  const speaker = escapeMarkdown(record.author);
  const body = escapeMarkdown(record.body.replace(/\s+/g, " ").trim());
  fs.appendFileSync(file, `- ${record.timestamp} | ${speaker}: ${body}\n`);
}

function loadSeen() {
  if (!fs.existsSync(seenPath)) return new Set();
  try {
    return new Set(JSON.parse(fs.readFileSync(seenPath, "utf8")));
  } catch {
    return new Set();
  }
}

function saveSeen() {
  writeFileAtomic(seenPath, `${JSON.stringify([...seen].sort(), null, 2)}\n`);
}

function writeFileAtomic(file, value) {
  const temp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temp, value);
  fs.renameSync(temp, file);
}

function chatName(chat) {
  return chat.name || chat.formattedTitle || chat.id?._serialized || "Unknown Chat";
}

function safeFilename(value) {
  return (String(value || "Unknown Chat").replace(/[/:\\?%*"<>|]/g, "-").replace(/\s+/g, " ").trim() || "Unknown Chat").slice(0, 120);
}

function escapeMarkdown(value) {
  return String(value || "").replace(/\n/g, " ").replace(/\r/g, " ").replace(/\\/g, "\\\\").replace(/\[/g, "\\[").replace(/\]/g, "\\]").replace(/\|/g, "\\|");
}

function hash(value) {
  return crypto.createHash("sha256").update(String(value || "")).digest("hex");
}

function numberArg(name, fallback) {
  const parsed = Number(args[name] || fallback);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--no-groups") out["no-groups"] = true;
    else if (arg === "--headless") out.headless = true;
    else if (arg.startsWith("--")) out[arg.slice(2)] = argv[++i] || "";
  }
  return out;
}

function usage() {
  console.error("Usage: digital-brain sync-whatsapp-web --vault <path> [--days 30] [--limit-per-chat 80] [--chat \"Name\"] [--no-groups] [--markdown-mode none|chat|month] [--privacy-mode standard|metadata-only]");
  process.exit(1);
}

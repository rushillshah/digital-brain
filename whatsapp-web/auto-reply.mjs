import fs from "node:fs";
import crypto from "node:crypto";
import path from "node:path";
import qrcode from "qrcode-terminal";
import pkg from "whatsapp-web.js";

const { Client, LocalAuth } = pkg;
const BUSINESS_NAME_RE = /\b(amazon|flipkart|myntra|nykaa|swiggy|zomato|blinkit|zepto|uber|ola|rapido|delivery|courier|dunzo|paytm|phonepe|gpay|google pay|hdfc|icici|sbi|axis|kotak|amex|bank|airtel|jio|vodafone|vi|support|helpdesk|customer care|official|verified|business|meta ai|whatsapp|no[\s-]?reply|noreply|otp|login|security|alerts?|notifications?|offers?|promo|marketing)\b/i;
const BUSINESS_BODY_RE = /\b(otp|one time password|verification code|login code|security code|do not share|order|delivered|delivery|shipment|tracking|invoice|payment|transaction|debited|credited|refund|ticket|support|unsubscribe|offer|coupon|sale|valid till|automated message)\b/i;
const args = parseArgs(process.argv.slice(2));

if (!args.vault) usage();

const vault = path.resolve(args.vault);
const whatsAppDir = path.join(vault, "08 Sources", "WhatsApp");
const outboundDir = path.join(whatsAppDir, "Outbound");
const sessionDir = path.join(whatsAppDir, ".session");
const statePath = path.join(outboundDir, "auto-reply-state.json");
const config = readConfig(vault);
const model = args.model || config.autoReplyModel || "llama3.1";
const allow = parseList(args.allow || "");
const deny = parseList(args.deny || "");
const allowAll = Boolean(args["allow-all"]);
const includeGroups = Boolean(args["include-groups"]);
const includeBusinesses = Boolean(args["include-businesses"]);
const sendEnabled = Boolean(args.yes) || config.outboundMode === "auto-send";
const processUnreadOnStart = !Boolean(args["no-process-unread"]);
const cooldownMinutes = numberArg("cooldown-minutes", 20);
const maxRepliesPerChat = numberArg("max-replies-per-chat", 5);
const maxContextChars = numberArg("max-context-chars", 12000);
const outboundLogMode = args["log-mode"] || config.outboundLogMode || "metadata";
const state = loadState();

fs.mkdirSync(outboundDir, { recursive: true });

if (config.outboundMode === "disabled") {
  console.error("WhatsApp outbound mode is disabled in this vault. Re-run init or edit digital-brain.config.json before using auto-whatsapp.");
  process.exit(1);
}

if (!allowAll && allow.length === 0) {
  console.error('Refusing to auto-reply without an allowlist. Add --allow "Name" or pass --allow-all explicitly.');
  process.exit(1);
}

await assertOllamaModel(model);

const client = new Client({
  authStrategy: new LocalAuth({ clientId: "digital-brain", dataPath: sessionDir }),
  puppeteer: { headless: false, args: ["--no-sandbox", "--disable-setuid-sandbox"] },
});

client.on("qr", (qr) => {
  console.log("Scan this QR in WhatsApp > Linked devices:");
  qrcode.generate(qr, { small: true });
});

client.on("ready", async () => {
  console.log(`Digital Brain WhatsApp auto-reply running with Ollama model: ${model}`);
  console.log(sendEnabled ? "Auto-send is enabled." : "Draft mode. Replies will be logged but not sent. Add --yes or set outboundMode=auto-send to send.");
  console.log(allowAll ? "Allowlist: all chats." : `Allowlist: ${allow.join(", ")}`);
  if (!includeBusinesses) console.log("Likely business, notification, OTP, and service chats are skipped by default.");
  try {
    if (processUnreadOnStart) {
      await processUnreadChats();
    } else {
      console.log("Startup unread scan disabled.");
    }
  } catch (error) {
    console.error(`Startup unread scan failed: ${error.message}`);
  }
  console.log("Listening for new WhatsApp messages...");
});

client.on("message", async (message) => {
  try {
    console.log(`Received WhatsApp message event: ${summarize(message.body || "[non-text message]")}`);
    await handleMessage(message);
  } catch (error) {
    console.error(`Auto-reply error: ${error.message}`);
  }
});

client.initialize();

async function processUnreadChats() {
  const chats = await client.getChats();
  const unreadChats = chats.filter((chat) => Number(chat.unreadCount || 0) > 0);
  console.log(`Startup unread scan: ${unreadChats.length} unread chat(s).`);
  for (const chat of unreadChats) {
    const name = chatName(chat);
    if (chat.isGroup && !includeGroups) {
      console.log(`Skipping unread group chat: ${name}`);
      continue;
    }
    if (!isAllowed(name) || isDenied(name)) {
      console.log(`Skipping unread chat outside allowlist: ${name}`);
      continue;
    }
    if (isCoolingDown(name)) {
      console.log(`Skipping unread chat during cooldown: ${name}`);
      continue;
    }
    if (replyCount(name) >= maxRepliesPerChat) {
      console.log(`Skipping unread chat at reply cap: ${name}`);
      continue;
    }
    const recentMessages = await chat.fetchMessages({ limit: Math.max(12, Number(chat.unreadCount || 0) + 3) });
    const latestInbound = recentMessages.filter((message) => !message.fromMe && !message.isStatus).at(-1);
    if (!latestInbound) {
      console.log(`No inbound unread candidate found for: ${name}`);
      continue;
    }
    console.log(`Processing unread chat: ${name}`);
    await handleMessage(latestInbound, chat);
  }
}

async function handleMessage(message, knownChat = null) {
  if (message.fromMe || message.isStatus) return;
  if (state.processedMessageIds.includes(message.id?._serialized)) return;

  const chat = knownChat || await message.getChat();
  const name = chatName(chat);
  console.log(`Received from ${name}: ${summarize(message.body || "[non-text message]")}`);
  if (chat.isGroup && !includeGroups) {
    console.log(`Skipping group chat: ${name}`);
    return;
  }
  if (!isAllowed(name)) {
    console.log(`Skipping chat outside allowlist: ${name}`);
    return;
  }
  if (isDenied(name)) {
    console.log(`Skipping denied chat: ${name}`);
    return;
  }
  if (isCoolingDown(name)) {
    console.log(`Skipping chat during cooldown: ${name}`);
    return;
  }
  if (replyCount(name) >= maxRepliesPerChat) {
    console.log(`Skipping chat at reply cap: ${name}`);
    return;
  }

  console.log(`Fetching context for ${name}...`);
  const recentMessages = await chat.fetchMessages({ limit: 12 });
  if (shouldSkipNonPersonalChat(name, recentMessages)) {
    console.log(`Skipping likely business/notification chat: ${name}`);
    markProcessed(message, name, { sent: false });
    return;
  }
  const disclosure = disclosureStatus(name);
  const prompt = buildPrompt({
    chatName: name,
    incomingBody: message.body || "",
    recentMessages,
    disclosureRequired: disclosure.required,
  });
  console.log(`Generating reply for ${name} with ${model}...`);
  const startedAt = Date.now();
  const reply = await generateReply(prompt);
  console.log(`Generated reply for ${name} in ${Date.now() - startedAt}ms: ${summarize(reply || "[empty reply]")}`);
  const finalReply = disclosure.required && !containsDisclosure(reply)
    ? `Just flagging this is my AI assistant helping draft/send this. ${reply}`
    : reply;

  if (!finalReply.trim()) return;
  if (sendEnabled) {
    const sent = await chat.sendMessage(finalReply);
    logSent(name, finalReply, sent, message);
    console.log(`Auto-sent to ${name}: ${summarize(finalReply)}`);
  } else {
    logDraft(name, finalReply, message);
    console.log(`Drafted for ${name}: ${summarize(finalReply)}`);
  }

  markProcessed(message, name);
}

function buildPrompt({ chatName, incomingBody, recentMessages, disclosureRequired }) {
  const memory = readMemoryContext(chatName);
  const transcript = recentMessages
    .slice(-12)
    .map((item) => `${item.fromMe ? "Me" : chatName}: ${compact(item.body || "")}`)
    .join("\n");
  return [
    "You are helping the user reply on WhatsApp.",
    "Write exactly one message to send as the user.",
    "Be natural, concise, and relationship-appropriate.",
    "Match the user's own communication style from My Communication Style. If it says lowercase-heavy or undercapitalized, prefer lowercase casual texting.",
    "Use lexical signals from My Communication Style: recurring style words, openers, short phrase shapes, punctuation habits, and lowercase-i behavior.",
    "Do not sound like customer support, corporate email, or a generic AI assistant.",
    "Use the user's local memory context, but do not reveal private notes or say you read a vault.",
    "Do not invent facts, commitments, times, or promises.",
    disclosureRequired ? "This send requires AI disclosure. Include a short clear disclosure in the message." : "Do not mention AI unless disclosure is required.",
    "",
    `Chat: ${chatName}`,
    "",
    "Relevant local memory:",
    memory,
    "",
    "Recent chat:",
    transcript,
    "",
    `Incoming message: ${incomingBody}`,
    "",
    "Reply:",
  ].join("\n");
}

function readMemoryContext(chatName) {
  const files = [
    path.join(vault, "06 AI Memory", "My Communication Style.md"),
    path.join(vault, "06 AI Memory", "Person Reply Context.md"),
    path.join(vault, "06 AI Memory", "Person Context Index.md"),
    path.join(vault, "06 AI Memory", "Interpreted Relationship Memory.md"),
    path.join(vault, "06 AI Memory", "What AI Should Remember.md"),
  ];
  const chunks = files
    .filter((file) => fs.existsSync(file))
    .map((file) => `# ${path.basename(file)}\n${fs.readFileSync(file, "utf8")}`);
  const text = chunks.join("\n\n");
  const lower = chatName.toLowerCase();
  const lines = text.split("\n");
  const matchingWindow = [];
  for (let index = 0; index < lines.length; index += 1) {
    if (lines[index].toLowerCase().includes(lower)) {
      matchingWindow.push(lines.slice(Math.max(0, index - 8), index + 18).join("\n"));
    }
  }
  const focused = matchingWindow.join("\n\n") || text;
  return focused.slice(0, maxContextChars);
}

async function generateReply(prompt) {
  const response = await fetch("http://127.0.0.1:11434/api/generate", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      model,
      prompt,
      stream: false,
      options: { temperature: 0.35, num_predict: 160 },
    }),
  });
  if (!response.ok) throw new Error(`Ollama generate failed: ${response.status} ${await response.text()}`);
  const body = await response.json();
  return cleanReply(body.response || "");
}

async function assertOllamaModel(modelName) {
  let response;
  try {
    response = await fetch("http://127.0.0.1:11434/api/tags");
  } catch {
    throw new Error("Ollama is not running. Start it with `ollama serve` or open the Ollama app.");
  }
  if (!response.ok) throw new Error(`Ollama tags failed: ${response.status}`);
  const body = await response.json();
  const names = (body.models || []).map((item) => item.name);
  if (!names.some((name) => name === modelName || name.startsWith(`${modelName}:`))) {
    throw new Error(`Ollama model "${modelName}" is not installed. Run: ollama pull ${modelName}`);
  }
}

function cleanReply(value) {
  return String(value)
    .replace(/^["'\s]+|["'\s]+$/g, "")
    .replace(/^Reply:\s*/i, "")
    .split("\n")
    .filter((line) => !/^[-*]\s+/.test(line.trim()))
    .join(" ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 1200);
}

function isAllowed(name) {
  if (allowAll) return true;
  return allow.some((item) => name.toLowerCase().includes(item.toLowerCase()));
}

function isExplicitlyAllowed(name) {
  return allow.some((item) => name.toLowerCase().includes(item.toLowerCase()));
}

function isDenied(name) {
  return deny.some((item) => name.toLowerCase().includes(item.toLowerCase()));
}

function shouldSkipNonPersonalChat(name, recentMessages) {
  if (includeBusinesses || isExplicitlyAllowed(name)) return false;
  return isLikelyBusinessOrAutomation(name, recentMessages);
}

function isLikelyBusinessOrAutomation(name, recentMessages = []) {
  const nameText = normalizeBusinessText(name);
  const recentText = recentMessages
    .slice(-8)
    .map((message) => normalizeBusinessText(message.body || ""))
    .join(" ");
  if (isShortCodeOrServiceNumber(nameText)) return true;
  if (BUSINESS_NAME_RE.test(nameText)) return true;
  if (BUSINESS_BODY_RE.test(recentText)) return true;
  return false;
}

function isShortCodeOrServiceNumber(text) {
  const compacted = text.replace(/\D/g, "");
  return compacted.length >= 4 && compacted.length <= 8 && compacted.length / Math.max(text.length, 1) > 0.7;
}

function normalizeBusinessText(value) {
  return String(value || "").toLowerCase().replace(/\s+/g, " ").trim();
}

function isCoolingDown(name) {
  const last = state.lastSentAtByChat[name];
  if (!last) return false;
  return Date.now() - new Date(last).getTime() < cooldownMinutes * 60 * 1000;
}

function replyCount(name) {
  return state.sentCountByChat[name] || 0;
}

function markProcessed(message, name, options = { sent: true }) {
  state.processedMessageIds.push(message.id?._serialized);
  state.processedMessageIds = state.processedMessageIds.filter(Boolean).slice(-1000);
  if (options.sent !== false) {
    state.lastSentAtByChat[name] = new Date().toISOString();
    state.sentCountByChat[name] = replyCount(name) + 1;
  }
  writeJsonAtomic(statePath, state);
}

function logDraft(name, reply, trigger) {
  const record = baseRecord(name, reply, trigger);
  appendLog("auto-drafts.jsonl", record);
  fs.appendFileSync(path.join(outboundDir, "Auto Drafts.md"), `- ${record.timestamp} | ${name}: ${visibleMessage(record, reply)}\n`);
}

function logSent(name, reply, sent, trigger) {
  const record = {
    ...baseRecord(name, reply, trigger),
    messageId: sent.id?._serialized || null,
  };
  if (outboundLogMode !== "off") {
    appendLog("sent.jsonl", record);
    fs.appendFileSync(path.join(outboundDir, "Sent.md"), `- ${record.timestamp} | ${name}: ${visibleMessage(record, reply)}\n`);
  }
}

function baseRecord(name, reply, trigger) {
  return {
    timestamp: new Date().toISOString(),
    to: name,
    resolvedChatName: name,
    message: outboundLogMode === "full" ? reply : undefined,
    messageHash: hash(reply),
    messageCharCount: reply.length,
    triggerMessageId: trigger.id?._serialized || null,
    aiAssisted: true,
    autoReply: true,
    disclosureIncluded: containsDisclosure(reply),
    disclosureBypassed: false,
  };
}

function appendLog(filename, record) {
  fs.appendFileSync(path.join(outboundDir, filename), `${JSON.stringify(record)}\n`);
}

function disclosureStatus(chatNameValue) {
  const logPath = path.join(outboundDir, "sent.jsonl");
  if (!fs.existsSync(logPath)) return { required: false, count: 0 };
  const cutoff = Date.now() - 24 * 60 * 60 * 1000;
  const count = fs
    .readFileSync(logPath, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .filter((record) => record)
    .filter((record) => record.resolvedChatName === chatNameValue)
    .filter((record) => record.aiAssisted !== false)
    .filter((record) => new Date(record.timestamp).getTime() >= cutoff)
    .filter((record) => !record.disclosureIncluded).length;
  return { required: count >= 2, count };
}

function containsDisclosure(message) {
  return /\b(ai|assistant|automated|bot)\b/i.test(message);
}

function loadState() {
  if (!fs.existsSync(statePath)) return { processedMessageIds: [], lastSentAtByChat: {}, sentCountByChat: {} };
  try {
    return JSON.parse(fs.readFileSync(statePath, "utf8"));
  } catch {
    return { processedMessageIds: [], lastSentAtByChat: {}, sentCountByChat: {} };
  }
}

function writeJsonAtomic(file, value) {
  const temp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temp, `${JSON.stringify(value, null, 2)}\n`);
  fs.renameSync(temp, file);
}

function visibleMessage(record, reply) {
  return outboundLogMode === "full" ? reply : `[metadata only, ${record.messageCharCount} chars, ${record.messageHash.slice(0, 12)}]`;
}

function chatName(chat) {
  return chat.name || chat.formattedTitle || chat.id?._serialized || "Unknown Chat";
}

function compact(value) {
  return String(value).replace(/\s+/g, " ").trim().slice(0, 500);
}

function summarize(value) {
  return compact(value).slice(0, 120);
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

function parseList(value) {
  return String(value || "").split(",").map((item) => item.trim()).filter(Boolean);
}

function numberArg(name, fallback) {
  const parsed = Number(args[name] || fallback);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function parseArgs(argv) {
  const out = { yes: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--yes") out.yes = true;
    else if (arg === "--allow-all") out["allow-all"] = true;
    else if (arg === "--include-groups") out["include-groups"] = true;
    else if (arg === "--include-businesses") out["include-businesses"] = true;
    else if (arg === "--no-process-unread") out["no-process-unread"] = true;
    else if (arg.startsWith("--")) {
      const key = arg.slice(2);
      out[key] = argv[++i] || "";
    }
  }
  return out;
}

function usage() {
  console.error('Usage: digital-brain auto-whatsapp --allow "Name" --model llama3.1 [--yes] [--allow-all] [--include-groups] [--include-businesses]');
  process.exit(1);
}

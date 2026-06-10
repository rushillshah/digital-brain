import fs from "node:fs";
import crypto from "node:crypto";
import path from "node:path";
import readline from "node:readline/promises";
import { spawn } from "node:child_process";
import { stdin as input, stdout as output } from "node:process";
import qrcode from "qrcode-terminal";
import pkg from "whatsapp-web.js";

const { Client, LocalAuth } = pkg;
const DEFAULT_PROVIDER_MODELS = {
  ollama: "llama3.1",
  openai: "gpt-4.1-mini",
  anthropic: "claude-sonnet-4-6",
  xai: "grok-4.3",
};
const SUPPORTED_PROVIDERS = ["ollama", "openai", "anthropic", "xai", "codex", "codex-app"];
const BUSINESS_NAME_RE = /\b(amazon|flipkart|myntra|nykaa|swiggy|zomato|blinkit|zepto|uber|ola|rapido|delivery|courier|dunzo|paytm|phonepe|gpay|google pay|hdfc|icici|sbi|axis|kotak|amex|bank|airtel|jio|vodafone|vi|support|helpdesk|customer care|official|verified|business|meta ai|whatsapp|no[\s-]?reply|noreply|otp|login|security|alerts?|notifications?|offers?|promo|marketing)\b/i;
const BUSINESS_BODY_RE = /\b(otp|one time password|verification code|login code|security code|do not share|order|delivered|delivery|shipment|tracking|invoice|payment|transaction|debited|credited|refund|ticket|support|unsubscribe|offer|coupon|sale|valid till|automated message)\b/i;
const args = parseArgs(process.argv.slice(2));

if (!args.vault) usage();

const vault = path.resolve(args.vault);
const whatsAppDir = path.join(vault, "08 Sources", "WhatsApp");
const outboundDir = path.join(whatsAppDir, "Outbound");
const sessionDir = path.join(whatsAppDir, ".session");
const statePath = path.join(outboundDir, "auto-reply-state.json");
const whitelistPath = path.join(outboundDir, "auto-reply-whitelist.json");
const pausePath = path.join(outboundDir, "auto-reply-pause.json");
const codexAppBridgeDir = path.join(outboundDir, "Codex App Bridge");
const config = readConfig(vault);
const provider = args.provider || config.autoReplyProvider || "ollama";
const model = args.model || config.autoReplyModel || defaultModelForProvider(provider);
const replyStyleMode = args["reply-style-mode"] || config.replyStyleMode || "match-user";
const codexCommand = args["codex-command"] || process.env.DIGITAL_BRAIN_CODEX_COMMAND || config.codexCommand || "codex exec --skip-git-repo-check";
const openaiApiKey = args["openai-api-key"] || process.env.OPENAI_API_KEY || config.openaiApiKey || "";
const anthropicApiKey = args["anthropic-api-key"] || process.env.ANTHROPIC_API_KEY || config.anthropicApiKey || "";
const xaiApiKey = args["xai-api-key"] || process.env.XAI_API_KEY || config.xaiApiKey || "";
const allow = parseList(args.allow || "");
const deny = parseList(args.deny || "");
const contactNumbers = parseList([args.contact, args.phone, args["contact-number"]].filter(Boolean).join(","))
  .map(normalizePhone)
  .filter(Boolean);
const allowAll = Boolean(args["allow-all"]);
let runtimeAllowAll = allowAll;
const autoApproveNewChats = Boolean(args["auto-approve-new-chats"]);
const includeGroups = Boolean(args["include-groups"]);
const includeBusinesses = Boolean(args["include-businesses"]);
const sendEnabled = Boolean(args.yes) || config.outboundMode === "auto-send";
const processUnreadOnStart = !Boolean(args["no-process-unread"]);
const cooldownMinutes = numberArg("cooldown-minutes", 20);
const maxRepliesPerChat = numberArg("max-replies-per-chat", 0);
const maxContextChars = numberArg("max-context-chars", 12000);
const maxSharedGroupContextChars = numberArg("max-shared-group-context-chars", 3000);
const sharedGroupContextDays = numberArg("shared-group-context-days", 14);
const sharedGroupContextEnabled = !Boolean(args["no-shared-group-context"]);
const replyDebounceMs = numberArg("reply-debounce-ms", 12000);
const outboundLogMode = args["log-mode"] || config.outboundLogMode || "metadata";
const state = loadState();
const whitelist = loadWhitelist();
const hasStoredScope = Object.keys(whitelist.allowedChats || {}).length > 0;
const hasInitialScope = allowAll || allow.length > 0 || contactNumbers.length > 0 || hasStoredScope;
const interactiveTerminal = Boolean(input.isTTY && output.isTTY);
let queueTail = Promise.resolve();
const pendingLiveReplies = new Map();
const rl = interactiveTerminal ? readline.createInterface({ input, output }) : null;
let keyboardControlsStarted = false;

fs.mkdirSync(outboundDir, { recursive: true });

if (config.outboundMode === "disabled") {
  console.error("WhatsApp outbound mode is disabled in this vault. Re-run init or edit digital-brain.config.json before using auto-whatsapp.");
  process.exit(1);
}

if (!hasInitialScope && !interactiveTerminal) {
  console.error('Refusing to auto-reply without an allowlist. Add --allow "Name", --contact "+15551234567", or pass --allow-all explicitly.');
  process.exit(1);
}

if (provider === "ollama") {
  await assertOllamaModel(model);
} else if (provider === "openai") {
  assertOpenAiConfig();
} else if (provider === "anthropic") {
  assertAnthropicConfig();
} else if (provider === "xai") {
  assertXaiConfig();
} else if (!["codex", "codex-app"].includes(provider)) {
  throw new Error(`Unsupported auto-reply provider "${provider}". Use ${SUPPORTED_PROVIDERS.map((item) => `"${item}"`).join(", ")}.`);
}

const client = new Client({
  authStrategy: new LocalAuth({ clientId: "digital-brain", dataPath: sessionDir }),
  puppeteer: { headless: false, args: ["--no-sandbox", "--disable-setuid-sandbox"] },
});

client.on("qr", (qr) => {
  console.log("Scan this QR in WhatsApp > Linked devices:");
  qrcode.generate(qr, { small: true });
});

client.on("ready", async () => {
  console.log(`Digital Brain WhatsApp auto-reply running with provider: ${provider}${providerUsesModel(provider) ? ` (${model})` : ""}`);
  console.log(sendEnabled ? "Auto-send is enabled." : "Draft mode. Replies will be logged but not sent. Add --yes or set outboundMode=auto-send to send.");
  if (!hasInitialScope) await configureInteractiveScope();
  console.log(runtimeAllowAll ? "Allowlist: all chats, with first-send approval per new chat." : allowlistSummary());
  if (provider === "codex") console.log(`Codex command: ${codexCommand}`);
  if (provider === "codex-app") console.log(`Codex App bridge: ${codexAppBridgeDir}`);
  if (!includeBusinesses) console.log("Likely business, notification, OTP, and service chats are skipped by default.");
  console.log(maxRepliesPerChat > 0 ? `Reply cap: ${maxRepliesPerChat} per chat per run.` : "Reply cap: unlimited.");
  console.log(`Live reply debounce: ${replyDebounceMs}ms.`);
  startKeyboardControls();
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
    await scheduleLiveMessage(message);
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
    if (chat.isGroup && !includeGroups && !isChatWhitelisted(chat)) {
      console.log(`Skipping unread group chat: ${name}`);
      continue;
    }
    if (!isAllowed(chat) || isDenied(name)) {
      console.log(`Skipping unread chat outside allowlist: ${name}`);
      continue;
    }
    if (isCoolingDown(name)) {
      console.log(`Skipping unread chat during cooldown: ${name}`);
      continue;
    }
    if (isAtReplyCap(name)) {
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
    await enqueueMessage(latestInbound, chat);
  }
}

async function configureInteractiveScope() {
  console.log("");
  console.log("Auto-reply scope:");
  console.log("  A) all contacts, but ask once before the first AI reply to each new chat");
  console.log("  S) select contacts from your WhatsApp chat list");
  console.log("  Q) quit");
  const answer = (await rl.question("Choose A/S/Q [S]: ")).trim().toLowerCase() || "s";
  if (answer.startsWith("q")) {
    await shutdown(0);
    return;
  }
  if (answer.startsWith("a")) {
    runtimeAllowAll = true;
    console.log("Scope set to all contacts with first-send approval.");
    return;
  }
  const chats = (await client.getChats())
    .filter((chat) => includeGroups || !chat.isGroup)
    .sort((a, b) => Number(b.timestamp || 0) - Number(a.timestamp || 0))
    .slice(0, numberArg("select-limit", 60));
  if (chats.length === 0) {
    console.log("No WhatsApp chats found to select.");
    return;
  }
  console.log("");
  console.log("Select contacts:");
  chats.forEach((chat, index) => {
    console.log(`  ${index + 1}) ${chatName(chat)}`);
  });
  const selection = await rl.question("Numbers to whitelist, comma-separated: ");
  const selected = parseIndexSelection(selection, chats.length).map((index) => chats[index]);
  for (const chat of selected) {
    setWhitelistDecision(chat, "allow", "startup-select");
  }
  console.log(`Whitelisted ${selected.length} chat(s).`);
}

function enqueueMessage(message, knownChat = null) {
  queueTail = queueTail
    .catch(() => undefined)
    .then(() => handleMessage(message, knownChat))
    .catch((error) => console.error(`Auto-reply error: ${error.message}`));
  return queueTail;
}

async function scheduleLiveMessage(message) {
  if (message.fromMe || message.isStatus) return;
  const chat = await message.getChat();
  const key = chatKey(chat);
  const existing = pendingLiveReplies.get(key);
  if (existing?.timer) clearTimeout(existing.timer);
  const timer = setTimeout(() => {
    pendingLiveReplies.delete(key);
    enqueueMessage(message, chat);
  }, replyDebounceMs);
  pendingLiveReplies.set(key, { message, chat, timer });
  console.log(`Queued debounced reply for ${chatName(chat)} in ${replyDebounceMs}ms.`);
}

async function ensureChatApproved(chat, recentMessages) {
  const name = chatName(chat);
  if (isExplicitlyAllowed(chat) || isChatWhitelisted(chat)) return true;
  if (isChatDenied(chat)) {
    console.log(`Skipping stored denied chat: ${name}`);
    return false;
  }
  if (!runtimeAllowAll) return false;
  if (autoApproveNewChats) {
    setWhitelistDecision(chat, "allow", "auto-approve-new-chats");
    return true;
  }
  if (!interactiveTerminal) {
    console.log(`Skipping ${name}: first-send approval required but no interactive terminal is available.`);
    return false;
  }
  console.log("");
  console.log(`New chat needs AI approval: ${name}`);
  const inbound = recentMessages.filter((item) => !item.fromMe && !item.isStatus).slice(-3);
  for (const item of inbound) {
    console.log(`  ${name}: ${summarize(item.body || "[non-text message]")}`);
  }
  const answer = (await rl.question("Whitelist this chat for AI auto-replies? [y/N]: ")).trim().toLowerCase();
  if (answer === "y" || answer === "yes") {
    setWhitelistDecision(chat, "allow", "first-send-prompt");
    console.log(`Whitelisted ${name}.`);
    return true;
  }
  setWhitelistDecision(chat, "deny", "first-send-prompt");
  console.log(`Denied ${name}.`);
  return false;
}

async function handleMessage(message, knownChat = null) {
  if (message.fromMe || message.isStatus) return;
  if (state.processedMessageIds.includes(message.id?._serialized)) return;

  const chat = knownChat || await message.getChat();
  const name = chatName(chat);
  console.log(`Received from ${name}: ${summarize(message.body || "[non-text message]")}`);
  if (isAutoReplyPaused(chat)) {
    console.log(`Skipping paused chat: ${name}`);
    markProcessed(message, name, { sent: false });
    return;
  }
  if (chat.isGroup && !includeGroups && !isChatWhitelisted(chat)) {
    console.log(`Skipping group chat: ${name}`);
    return;
  }
  if (!isAllowed(chat)) {
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
  if (isAtReplyCap(name)) {
    console.log(`Skipping chat at reply cap: ${name}`);
    return;
  }

  console.log(`Fetching context for ${name}...`);
  const recentMessages = await chat.fetchMessages({ limit: 12 });
  if (shouldSkipNonPersonalChat(chat, recentMessages)) {
    console.log(`Skipping likely business/notification chat: ${name}`);
    markProcessed(message, name, { sent: false });
    return;
  }
  if (!(await ensureChatApproved(chat, recentMessages))) {
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
  console.log(`Generating reply for ${name} with ${provider}${provider === "ollama" ? `:${model}` : ""}...`);
  const startedAt = Date.now();
  const reply = matchPunctuationStyle(await generateReply(prompt), recentMessages, replyStyleMode);
  console.log(`Generated reply for ${name} in ${Date.now() - startedAt}ms: ${summarize(reply || "[empty reply]")}`);
  if (isNoReply(reply)) {
    console.log(`No reply needed for ${name}.`);
    markProcessed(message, name, { sent: false });
    return;
  }
  const finalReply = disclosure.required && !containsDisclosure(reply)
    ? `btw ai is helping me reply rn. ${reply}`
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
  const sharedGroupContext = readSharedGroupContext(chatName);
  const unansweredInbound = latestUnansweredInbound(recentMessages, incomingBody);
  const selfRecentMessages = recentMessages.filter((item) => item.fromMe && compact(item.body || "")).map((item) => item.body || "");
  const language = languageProfile(selfRecentMessages);
  const slang = slangProfile(selfRecentMessages);
  const selfExamples = recentMessages
    .filter((item) => item.fromMe && compact(item.body || ""))
    .slice(-6)
    .map((item) => `- ${compact(item.body || "")}`)
    .join("\n") || "- No recent self examples in this chat.";
  const transcript = recentMessages
    .slice(-12)
    .map((item) => `${item.fromMe ? "Me" : chatName}: ${compact(item.body || "")}`)
    .join("\n");
  return [
    "You are helping the user reply on WhatsApp.",
    "Write exactly one message to send as the user.",
    "Be natural, terse, and relationship-appropriate.",
    "Default to 1-12 words for casual chats unless the incoming message clearly requires detail.",
    "Your job is to answer the latest unanswered inbound chunk, not to generally comment on the conversation.",
    "First infer the concrete ask, update, or emotion in that chunk. Reply only to that.",
    "If the other person sent multiple messages in a row, answer the combined latest intent once.",
    "If there is no concrete reply needed, output exactly NO_REPLY.",
    "Do not bring in memory context unless it directly helps answer the latest unanswered chunk.",
    "Use shared group context only when it explains the latest direct message or prevents losing intent from a related group thread.",
    "Do not mention group context unless the user would naturally know it. Do not leak unrelated group details into a direct chat.",
    "Do not repeat facts, plans, suggestions, or context that were already stated in the recent chat unless confirming them briefly.",
    "If the chat includes a URL, do not pretend you opened or inspected it. React only to what the sender said, or ask if the user should check it.",
    "Do not start with hey/hi unless the recent chat itself uses that greeting pattern.",
    "Primary style source: the user's recent messages in this exact chat. Match their length, casing, bluntness, and punctuation from those examples.",
    "Secondary style source: My Communication Style. Use it only to break ties, not to add extra slang.",
    languageInstruction(language),
    slangInstruction(slang),
    replyStyleInstruction(replyStyleMode),
    "Do not perform a persona. Do not intensify the tone beyond the user's examples.",
    punctuationInstruction(replyStyleMode),
    "Do not force lol, haha, lmao, wild, rn, emojis, or question marks. Use them only if the user's recent examples in this chat use them naturally.",
    "Avoid assistant-like niceness and filler such as sounds perfect, happy to, sure thing, smooth, quick, no worries, no demon stuff, digital prep chef, digital neil, spitting facts, living in the future, or let’s unless that exact energy is already in the chat.",
    "If the recipient asks about AI, answer directly in the user's casual tone and do not overexplain.",
    "Do not sound like customer support, corporate email, or a generic AI assistant.",
    "Use the user's local memory context, but do not reveal private notes or say you read a vault.",
    "Do not invent facts, commitments, times, or promises.",
    disclosureRequired ? "This send requires AI disclosure. Use a short casual disclosure like: btw ai is helping me reply rn. Do not make it cute or apologetic." : "Do not mention AI unless the incoming message asks about it.",
    "",
    `Chat: ${chatName}`,
    "",
    "Relevant local memory:",
    memory,
    "",
    "Shared group context involving this person:",
    sharedGroupContext,
    "",
    "Recent chat:",
    transcript,
    "",
    "Latest unanswered inbound chunk to answer:",
    unansweredInbound,
    "",
    "Recent examples of the user's own messages in this chat:",
    selfExamples,
    "",
    `Incoming message: ${incomingBody}`,
    "",
    "Reply:",
  ].join("\n");
}

function latestUnansweredInbound(recentMessages, incomingBody) {
  const chunk = [];
  for (const item of recentMessages.slice().reverse()) {
    if (item.isStatus) continue;
    if (item.fromMe) break;
    const body = compact(item.body || "");
    if (body) chunk.unshift(`${item.fromMe ? "Me" : "Them"}: ${body}`);
  }
  if (chunk.length) return chunk.join("\n");
  return compact(incomingBody || "") ? `Them: ${compact(incomingBody || "")}` : "No clear unanswered inbound text.";
}

function languageProfile(recentMessages) {
  const text = recentMessages
    .slice(-16)
    .map((item) => compact(item.body || ""))
    .join(" ")
    .toLowerCase();
  const hindiTokens = text.match(/\b(acha|achha|arre|arey|haan|ha|nahi|nahin|kya|kyu|kyun|kaise|kar|karna|karo|chal|jaldi|thoda|bahut|mat|hai|hain|ho|tha|thi|badh|badh raha|theek|yaar)\b/g) || [];
  const devanagari = text.match(/[\u0900-\u097F]/g) || [];
  return {
    hasHindi: hindiTokens.length >= 3 || devanagari.length >= 3,
  };
}

function languageInstruction(profile) {
  if (profile.hasHindi) {
    return "Language guard: this exact chat shows Hindi/Hinglish usage, so light Hindi/Hinglish is allowed only if it matches the user's recent messages here.";
  }
  return "Language guard: reply in English. Never infer Hindi/Hinglish from the recipient's name, family relationship, or location. Do not use Hindi, Hinglish, romanized Hindi, or words like chal, kar, jaldi, thoda, badh raha, hai, haan, nahi unless the user's own recent messages in this exact chat use them.";
}

function slangProfile(messages) {
  const text = messages.join(" ").toLowerCase();
  return {
    usesBro: /\bbro\b/.test(text),
  };
}

function slangInstruction(profile) {
  return profile.usesBro
    ? "Slang guard: the user's recent messages in this chat use bro, so bro is allowed only if it fits the immediate reply."
    : "Slang guard: do not use bro in this chat. Do not transfer slang from other chats into this relationship.";
}

function replyStyleInstruction(mode) {
  if (mode === "casual-imperfect") {
    return "Reply style mode: casual imperfect. Allow light lowercase, shorthand, missing apostrophes, and small natural imperfections when they fit the user's learned style. Do not make the reply hard to read.";
  }
  if (mode === "clean-formal") {
    return "Reply style mode: clean formal. Use clean spelling, normal capitalization, and normal punctuation. Prefer clarity over mimicking typos or shorthand.";
  }
  return "Reply style mode: match user. Match the user's learned chat style. Do not add intentional typos unless the user's recent examples naturally show them.";
}

function punctuationInstruction(mode) {
  if (mode === "clean-formal") {
    return "Use normal clean punctuation where it improves readability. Do not overdo punctuation or make the reply sound corporate.";
  }
  return "Avoid polished punctuation. Do not add commas, apostrophes, semicolons, or final periods unless the user's recent examples use them.";
}

function isNoReply(reply) {
  return compact(reply).toUpperCase() === "NO_REPLY";
}

function readMemoryContext(chatName) {
  const files = [
    path.join(vault, "06 AI Memory", "My Communication Style.md"),
    path.join(vault, "06 AI Memory", "Person Reply Context.md"),
    path.join(vault, "06 AI Memory", "Person Context Index.md"),
    path.join(vault, "06 AI Memory", "Interpreted Relationship Memory.md"),
    path.join(vault, "06 AI Memory", "Project Context.md"),
    path.join(vault, "06 AI Memory", "Conversation Continuity.md"),
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

function readSharedGroupContext(chatNameValue) {
  if (!sharedGroupContextEnabled || maxSharedGroupContextChars <= 0) return "Disabled.";
  const rawDir = path.join(whatsAppDir, "Raw");
  if (!fs.existsSync(rawDir)) return "No WhatsApp raw source data found.";
  const target = nameFingerprint(chatNameValue);
  if (!target.normalized) return "No matching person name available.";
  const cutoff = Date.now() - sharedGroupContextDays * 24 * 60 * 60 * 1000;
  const byGroup = new Map();
  for (const file of fs.readdirSync(rawDir).filter((name) => name.endsWith(".jsonl")).sort().reverse()) {
    const fullPath = path.join(rawDir, file);
    const lines = fs.readFileSync(fullPath, "utf8").split("\n").filter(Boolean);
    for (const line of lines) {
      const record = parseJsonLine(line);
      if (!record?.isGroup || !record.chatName || !record.timestamp) continue;
      const timestamp = new Date(record.timestamp).getTime();
      if (Number.isFinite(timestamp) && timestamp < cutoff) continue;
      const body = compact(record.body || "");
      if (!body) continue;
      const group = byGroup.get(record.chatName) || [];
      group.push({
        timestamp: record.timestamp,
        author: record.fromMe ? "Me" : compact(record.author || "Unknown"),
        fromMe: Boolean(record.fromMe),
        body,
        isTarget: !record.fromMe && personNameMatches(record.author || "", target),
      });
      byGroup.set(record.chatName, group);
    }
  }
  const sections = [];
  for (const [groupName, records] of byGroup.entries()) {
    const sorted = records.sort((a, b) => String(a.timestamp).localeCompare(String(b.timestamp)));
    const targetIndexes = sorted.map((record, index) => record.isTarget ? index : -1).filter((index) => index >= 0);
    if (!targetIndexes.length) continue;
    const selected = new Map();
    for (const index of targetIndexes.slice(-4)) {
      for (let i = Math.max(0, index - 2); i <= Math.min(sorted.length - 1, index + 2); i += 1) {
        selected.set(i, sorted[i]);
      }
    }
    const lines = [...selected.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([, record]) => `- ${record.author}: ${record.body}`);
    if (lines.length) {
      sections.push(`## ${groupName}\n${lines.join("\n")}`);
    }
  }
  if (!sections.length) return "No recent shared group context found for this person.";
  return sections.join("\n\n").slice(0, maxSharedGroupContextChars);
}

function personNameMatches(value, target) {
  const candidate = nameFingerprint(value);
  if (!candidate.normalized) return false;
  if (candidate.normalized === target.normalized) return true;
  if (candidate.normalized.includes(target.normalized) || target.normalized.includes(candidate.normalized)) {
    return Math.min(candidate.normalized.length, target.normalized.length) >= 4;
  }
  if (target.tokens.length >= 2 && candidate.tokens.length >= 2) {
    const overlap = target.tokens.filter((token) => candidate.tokens.includes(token));
    return overlap.length >= 2;
  }
  return false;
}

function nameFingerprint(value) {
  const normalized = String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const tokens = normalized
    .split(" ")
    .filter((token) => token.length >= 3 && !["the", "and", "group", "chat"].includes(token));
  return { normalized, tokens };
}

async function generateReply(prompt) {
  if (provider === "codex") return generateCodexReply(prompt);
  if (provider === "codex-app") return generateCodexAppReply(prompt);
  if (provider === "openai") return generateOpenAiReply(prompt);
  if (provider === "anthropic") return generateAnthropicReply(prompt);
  if (provider === "xai") return generateXaiReply(prompt);
  return generateOllamaReply(prompt);
}

async function generateOpenAiReply(prompt) {
  return generateResponsesApiReply({
    providerName: "OpenAI",
    url: "https://api.openai.com/v1/responses",
    apiKey: openaiApiKey,
    prompt,
  });
}

async function generateXaiReply(prompt) {
  return generateResponsesApiReply({
    providerName: "xAI",
    url: "https://api.x.ai/v1/responses",
    apiKey: xaiApiKey,
    prompt,
  });
}

async function generateResponsesApiReply({ providerName, url, apiKey, prompt }) {
  const timeoutMs = numberArg("provider-timeout-ms", 45000);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let response;
  try {
    response = await fetch(url, {
      method: "POST",
      signal: controller.signal,
      headers: {
        "authorization": `Bearer ${apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model,
        input: prompt,
        max_output_tokens: 80,
        temperature: 0.25,
      }),
    });
  } catch (error) {
    if (error.name === "AbortError") throw new Error(`${providerName} reply timed out after ${timeoutMs}ms`);
    throw error;
  } finally {
    clearTimeout(timer);
  }
  const text = await response.text();
  if (!response.ok) throw new Error(`${providerName} reply failed: ${response.status} ${summarize(text)}`);
  const body = parseJsonLine(text);
  const reply = extractOpenAiText(body);
  if (!reply) throw new Error(`${providerName} returned an empty reply.`);
  return cleanReply(reply);
}

async function generateAnthropicReply(prompt) {
  const timeoutMs = numberArg("provider-timeout-ms", 45000);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let response;
  try {
    response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      signal: controller.signal,
      headers: {
        "x-api-key": anthropicApiKey,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model,
        max_tokens: 80,
        temperature: 0.25,
        messages: [{ role: "user", content: prompt }],
      }),
    });
  } catch (error) {
    if (error.name === "AbortError") throw new Error(`Anthropic reply timed out after ${timeoutMs}ms`);
    throw error;
  } finally {
    clearTimeout(timer);
  }
  const text = await response.text();
  if (!response.ok) throw new Error(`Anthropic reply failed: ${response.status} ${summarize(text)}`);
  const body = parseJsonLine(text);
  const reply = extractAnthropicText(body);
  if (!reply) throw new Error("Anthropic returned an empty reply.");
  return cleanReply(reply);
}

async function generateOllamaReply(prompt) {
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

async function generateCodexReply(prompt) {
  return runReplyCommand(codexCommand, prompt, "codex");
}

async function generateCodexAppReply(prompt) {
  const timeoutMs = numberArg("provider-timeout-ms", 300000);
  const request = createCodexAppRequest(prompt);
  console.log(`Waiting for Codex App bridge response: ${request.responsePath}`);
  return await waitForCodexAppResponse(request.responsePath, timeoutMs);
}

function createCodexAppRequest(prompt) {
  const requestId = `${Date.now()}-${crypto.randomBytes(4).toString("hex")}`;
  const requestsDir = path.join(codexAppBridgeDir, "requests");
  const responsesDir = path.join(codexAppBridgeDir, "responses");
  fs.mkdirSync(requestsDir, { recursive: true });
  fs.mkdirSync(responsesDir, { recursive: true });
  const requestPath = path.join(requestsDir, `${requestId}.json`);
  const responsePath = path.join(responsesDir, `${requestId}.json`);
  writeJsonAtomic(requestPath, {
    schemaVersion: 1,
    requestId,
    createdAt: new Date().toISOString(),
    responsePath,
    prompt,
    instructions: [
      "Write exactly one WhatsApp reply as the user.",
      "Return JSON only: {\"reply\":\"...\"}.",
      "No markdown, no explanations, no surrounding text.",
    ],
  });
  return { requestId, requestPath, responsePath };
}

async function waitForCodexAppResponse(responsePath, timeoutMs) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (fs.existsSync(responsePath)) {
      const response = parseJsonLine(fs.readFileSync(responsePath, "utf8"));
      if (!response) throw new Error(`Codex App bridge wrote invalid JSON: ${responsePath}`);
      if (response.error) throw new Error(`Codex App bridge error: ${response.error}`);
      const reply = cleanReply(response.reply || "");
      if (!reply) throw new Error(`Codex App bridge wrote an empty reply: ${responsePath}`);
      return reply;
    }
    await sleep(1000);
  }
  throw new Error(`Codex App bridge timed out after ${timeoutMs}ms. No response at ${responsePath}`);
}

async function runReplyCommand(command, prompt, label) {
  const timeoutMs = numberArg("provider-timeout-ms", 120000);
  const usesPromptFile = command.includes("{promptFile}");
  const promptFile = usesPromptFile ? path.join(outboundDir, `reply-prompt-${Date.now()}-${Math.random().toString(16).slice(2)}.txt`) : "";
  if (promptFile) fs.writeFileSync(promptFile, prompt, "utf8");
  const renderedCommand = promptFile ? command.replaceAll("{promptFile}", shellQuote(promptFile)) : command;
  return await new Promise((resolve, reject) => {
    const child = spawn(renderedCommand, { shell: true, cwd: vault, env: process.env });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      reject(new Error(`${label} reply command timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    child.stdout.on("data", (chunk) => { stdout += chunk.toString(); });
    child.stderr.on("data", (chunk) => { stderr += chunk.toString(); });
    child.on("error", (error) => {
      clearTimeout(timer);
      cleanupPromptFile(promptFile);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      cleanupPromptFile(promptFile);
      if (code !== 0) {
        reject(new Error(`${label} reply command failed with ${code}: ${summarize(stderr || stdout)}`));
        return;
      }
      resolve(cleanReply(stdout));
    });
    if (!usesPromptFile) child.stdin.end(prompt);
  });
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

function assertOpenAiConfig() {
  if (!openaiApiKey) {
    throw new Error("OpenAI provider requires an API key. Set OPENAI_API_KEY, pass --openai-api-key, or re-run init and enter the key.");
  }
}

function assertAnthropicConfig() {
  if (!anthropicApiKey) {
    throw new Error("Anthropic provider requires an API key. Set ANTHROPIC_API_KEY, pass --anthropic-api-key, or re-run init and enter the key.");
  }
}

function assertXaiConfig() {
  if (!xaiApiKey) {
    throw new Error("xAI provider requires an API key. Set XAI_API_KEY, pass --xai-api-key, or re-run init and enter the key.");
  }
}

function extractOpenAiText(body) {
  if (!body) return "";
  if (typeof body.output_text === "string") return body.output_text;
  const chunks = [];
  for (const item of body.output || []) {
    for (const content of item.content || []) {
      if (typeof content.text === "string") chunks.push(content.text);
    }
  }
  return chunks.join(" ");
}

function extractAnthropicText(body) {
  if (!body) return "";
  const chunks = [];
  for (const content of body.content || []) {
    if (content.type === "text" && typeof content.text === "string") chunks.push(content.text);
  }
  return chunks.join(" ");
}

function defaultModelForProvider(providerName) {
  return DEFAULT_PROVIDER_MODELS[providerName] || DEFAULT_PROVIDER_MODELS.ollama;
}

function providerUsesModel(providerName) {
  return ["ollama", "openai", "anthropic", "xai"].includes(providerName);
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

function matchPunctuationStyle(reply, recentMessages, mode = "match-user") {
  if (mode === "clean-formal") return reply.replace(/\s+/g, " ").trim();
  const exampleMessages = recentMessages
    .filter((item) => item.fromMe && compact(item.body || ""))
    .map((item) => item.body || "");
  const local = punctuationProfile(exampleMessages);
  const global = readSelfPunctuationStyle();
  let output = reply;
  if (!prefersPunctuation(local, global, "apostrophe")) output = output.replace(/['’]/g, "");
  if (!prefersPunctuation(local, global, "semicolon")) output = output.replace(/;/g, "");
  if (!prefersPunctuation(local, global, "period")) output = output.replace(/\.+$/g, "");
  if (!prefersPunctuation(local, global, "comma")) output = output.replace(/,/g, "");
  return output.replace(/\s+/g, " ").trim();
}

function punctuationProfile(messages) {
  const text = messages.join(" ");
  const chars = text.length;
  const count = (pattern) => (text.match(pattern) || []).length;
  return {
    hasLocalEvidence: messages.length >= 3 || chars >= 80,
    apostropheRate: chars ? count(/['’]/g) / chars : 0,
    commaRate: chars ? count(/,/g) / chars : 0,
    semicolonRate: chars ? count(/;/g) / chars : 0,
    periodRate: chars ? count(/\./g) / chars : 0,
  };
}

function prefersPunctuation(local, global, kind) {
  const field = `${kind}Rate`;
  if (local.hasLocalEvidence) return local[field] > 0.001;
  if (kind === "period" && global.noTerminalPunctuationShare >= 0.7) return false;
  return global[field] > 0.001;
}

function readSelfPunctuationStyle() {
  const profilePath = path.join(vault, "08 Sources", "Analysis", "self_profile.json");
  if (!fs.existsSync(profilePath)) return {};
  const profile = parseJsonLine(fs.readFileSync(profilePath, "utf8")) || {};
  const habits = profile.lexicalProfile?.punctuationHabits || [];
  const noTerminal = habits
    .map((habit) => String(habit).match(/no terminal punctuation \(([\d.]+)\)/))
    .find(Boolean);
  const contractions = profile.lexicalProfile?.contractions || [];
  return {
    apostropheRate: contractions.length ? 0.01 : 0,
    commaRate: 0,
    semicolonRate: 0,
    periodRate: noTerminal && Number(noTerminal[1]) >= 0.7 ? 0 : 0.01,
    noTerminalPunctuationShare: noTerminal ? Number(noTerminal[1]) : 0,
  };
}

function isAllowed(chatOrName) {
  if (isChatDenied(chatOrName)) return false;
  if (isChatWhitelisted(chatOrName)) return true;
  if (runtimeAllowAll) return true;
  const name = typeof chatOrName === "string" ? chatOrName : chatName(chatOrName);
  if (contactNumbers.some((number) => chatMatchesContact(chatOrName, number))) return true;
  return allow.some((item) => name.toLowerCase().includes(item.toLowerCase()));
}

function isExplicitlyAllowed(chatOrName) {
  const name = typeof chatOrName === "string" ? chatOrName : chatName(chatOrName);
  if (contactNumbers.some((number) => chatMatchesContact(chatOrName, number))) return true;
  return allow.some((item) => name.toLowerCase().includes(item.toLowerCase()));
}

function isDenied(name) {
  return deny.some((item) => name.toLowerCase().includes(item.toLowerCase()));
}

function shouldSkipNonPersonalChat(chatOrName, recentMessages) {
  if (includeBusinesses || isExplicitlyAllowed(chatOrName) || isChatWhitelisted(chatOrName)) return false;
  const name = typeof chatOrName === "string" ? chatOrName : chatName(chatOrName);
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

function chatMatchesContact(chatOrName, normalizedPhone) {
  if (!normalizedPhone) return false;
  if (typeof chatOrName === "string") {
    return phoneCandidateMatches(normalizePhone(chatOrName), normalizedPhone);
  }
  const candidates = [
    chatOrName.id?.user,
    chatOrName.id?._serialized,
    chatOrName.name,
    chatOrName.formattedTitle,
  ].map(normalizePhone).filter(Boolean);
  return candidates.some((candidate) => phoneCandidateMatches(candidate, normalizedPhone));
}

function phoneCandidateMatches(candidate, expected) {
  if (!candidate || !expected) return false;
  return candidate.endsWith(expected) || expected.endsWith(candidate);
}

function normalizePhone(input) {
  const digits = String(input || "").replace(/[^\d]/g, "");
  return digits.length >= 8 ? digits : "";
}

function maskPhone(value) {
  return value.length <= 4 ? "****" : `****${value.slice(-4)}`;
}

function allowlistSummary() {
  const parts = [];
  if (allow.length) parts.push(`names: ${allow.join(", ")}`);
  if (contactNumbers.length) parts.push(`contacts: ${contactNumbers.map(maskPhone).join(", ")}`);
  const storedCount = Object.keys(whitelist.allowedChats || {}).length;
  if (storedCount) parts.push(`stored: ${storedCount} chat(s)`);
  return `Allowlist: ${parts.join("; ")}`;
}

function isChatWhitelisted(chatOrName) {
  return chatKeys(chatOrName).some((key) => Boolean(whitelist.allowedChats?.[key]));
}

function isChatDenied(chatOrName) {
  return chatKeys(chatOrName).some((key) => Boolean(whitelist.deniedChats?.[key]));
}

function isAutoReplyPaused(chatOrName) {
  const pause = readPauseState();
  if (pause.paused) return true;
  return chatKeys(chatOrName).some((key) => Boolean(pause.pausedChats?.[key]));
}

function readPauseState() {
  if (!fs.existsSync(pausePath)) return { schemaVersion: 1, paused: false, pausedChats: {} };
  try {
    const pause = JSON.parse(fs.readFileSync(pausePath, "utf8"));
    return {
      schemaVersion: 1,
      paused: Boolean(pause.paused),
      pausedChats: pause.pausedChats || {},
    };
  } catch {
    return { schemaVersion: 1, paused: false, pausedChats: {} };
  }
}

function writePauseState(pause) {
  writeJsonAtomic(pausePath, {
    schemaVersion: 1,
    paused: Boolean(pause.paused),
    reason: pause.reason || "",
    updatedAt: new Date().toISOString(),
    pausedChats: pause.pausedChats || {},
  });
}

function toggleGlobalPause() {
  const pause = readPauseState();
  pause.paused = !pause.paused;
  pause.reason = pause.paused ? "keyboard-space" : "";
  writePauseState(pause);
  return pause.paused;
}

function startKeyboardControls() {
  if (keyboardControlsStarted || !interactiveTerminal || typeof input.setRawMode !== "function") return;
  keyboardControlsStarted = true;
  input.setRawMode(true);
  input.resume();
  input.on("data", async (chunk) => {
    const value = chunk.toString("utf8");
    if (value === "\u0003") await shutdown(0);
    if (value === " ") {
      const paused = toggleGlobalPause();
      console.log(paused ? "Paused WhatsApp auto-replies. Press Space to resume." : "Resumed WhatsApp auto-replies. Press Space to pause.");
    }
  });
  console.log("Keyboard controls: Space toggles pause/resume. Ctrl+C exits.");
}

function setWhitelistDecision(chat, decision, source) {
  const key = chatKey(chat);
  const record = {
    chatName: chatName(chat),
    chatId: typeof chat === "string" ? null : chat.id?._serialized || null,
    source,
    updatedAt: new Date().toISOString(),
  };
  if (decision === "allow") {
    whitelist.allowedChats[key] = record;
    delete whitelist.deniedChats[key];
  } else {
    whitelist.deniedChats[key] = record;
    delete whitelist.allowedChats[key];
  }
  writeJsonAtomic(whitelistPath, whitelist);
}

function chatKey(chatOrName) {
  return chatKeys(chatOrName)[0];
}

function chatKeys(chatOrName) {
  if (typeof chatOrName === "string") return [`name:${chatOrName.toLowerCase()}`];
  return [
    chatOrName.id?._serialized,
    `name:${chatName(chatOrName).toLowerCase()}`,
  ].filter(Boolean);
}

function loadWhitelist() {
  if (!fs.existsSync(whitelistPath)) return emptyWhitelist();
  try {
    return normalizeWhitelist(JSON.parse(fs.readFileSync(whitelistPath, "utf8")));
  } catch {
    return emptyWhitelist();
  }
}

function normalizeWhitelist(value) {
  return {
    schemaVersion: 1,
    allowedChats: value?.allowedChats || {},
    deniedChats: value?.deniedChats || {},
  };
}

function emptyWhitelist() {
  return { schemaVersion: 1, allowedChats: {}, deniedChats: {} };
}

function parseIndexSelection(value, max) {
  return [...new Set(String(value || "")
    .split(/[,\s]+/)
    .map((item) => Number(item.trim()))
    .filter((item) => Number.isInteger(item) && item >= 1 && item <= max)
    .map((item) => item - 1))];
}

function isCoolingDown(name) {
  const last = state.lastSentAtByChat[name];
  if (!last) return false;
  return Date.now() - new Date(last).getTime() < cooldownMinutes * 60 * 1000;
}

function replyCount(name) {
  return state.sentCountByChat[name] || 0;
}

function isAtReplyCap(name) {
  return maxRepliesPerChat > 0 && replyCount(name) >= maxRepliesPerChat;
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
  updateConversationContinuity(name, reply, trigger, "drafted");
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
  updateConversationContinuity(name, reply, trigger, "sent");
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

function updateConversationContinuity(name, reply, trigger, status) {
  const memoryDir = path.join(vault, "06 AI Memory");
  const sourceDir = path.join(outboundDir, "Continuity");
  fs.mkdirSync(memoryDir, { recursive: true });
  fs.mkdirSync(sourceDir, { recursive: true });
  const jsonPath = path.join(sourceDir, "conversation-continuity.json");
  const state = fs.existsSync(jsonPath) ? parseJsonLine(fs.readFileSync(jsonPath, "utf8")) || {} : {};
  state[name] = {
    chatName: name,
    updatedAt: new Date().toISOString(),
    status,
    lastInbound: compact(trigger.body || "[non-text message]"),
    lastAiReply: compact(reply),
    triggerMessageId: trigger.id?._serialized || null,
  };
  writeJsonAtomic(jsonPath, state);
  writeConversationContinuityMarkdown(path.join(memoryDir, "Conversation Continuity.md"), state);
}

function writeConversationContinuityMarkdown(file, state) {
  const rows = Object.values(state)
    .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)))
    .slice(0, 80);
  const lines = [
    "# Conversation Continuity",
    "",
    "Generated from AI-assisted WhatsApp drafts/sends. Use this to remember where conversations were left off.",
    "",
  ];
  for (const row of rows) {
    lines.push(`## ${row.chatName}`);
    lines.push("");
    lines.push(`- Updated: ${row.updatedAt}`);
    lines.push(`- Status: ${row.status}`);
    lines.push(`- Last inbound: ${row.lastInbound || "[empty]"}`);
    lines.push(`- Last AI reply: ${row.lastAiReply || "[empty]"}`);
    lines.push("");
  }
  writeFileAtomic(file, `${lines.join("\n").trim()}\n`);
}

function disclosureStatus(chatNameValue) {
  const logPath = path.join(outboundDir, "sent.jsonl");
  if (!fs.existsSync(logPath)) return { required: false, count: 0 };
  const cutoff = Date.now() - 24 * 60 * 60 * 1000;
  const records = fs
    .readFileSync(logPath, "utf8")
    .split("\n")
    .filter(Boolean)
    .map(parseJsonLine)
    .filter((record) => record)
    .filter((record) => record.resolvedChatName === chatNameValue)
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

function writeFileAtomic(file, value) {
  const temp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temp, value);
  fs.renameSync(temp, file);
}

function cleanupPromptFile(file) {
  if (file) {
    try {
      fs.unlinkSync(file);
    } catch {
      // ignore cleanup errors
    }
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function shellQuote(value) {
  return `'${String(value).replaceAll("'", "'\\''")}'`;
}

async function shutdown(code) {
  if (rl) rl.close();
  if (typeof input.setRawMode === "function") input.setRawMode(false);
  await client.destroy().catch(() => undefined);
  process.exit(code);
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
    else if (arg === "--no-shared-group-context") out["no-shared-group-context"] = true;
    else if (arg.startsWith("--")) {
      const key = arg.slice(2);
      out[key] = argv[++i] || "";
    }
  }
  return out;
}

function usage() {
  console.error('Usage: digital-brain auto-whatsapp --allow "Name" --contact "+15551234567" --provider ollama|openai|codex|codex-app --model llama3.1 [--yes] [--allow-all] [--include-groups] [--include-businesses]');
  process.exit(1);
}

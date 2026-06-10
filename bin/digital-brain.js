#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import readline from "node:readline/promises";
import { fileURLToPath } from "node:url";
import { copyDir, ensureDir, packageRoot, resolveVault, writeDefaultVault } from "../lib/fs.js";
import { emitTelemetry, readTelemetryPreference, writeTelemetryPreference } from "../lib/telemetry.js";

const root = packageRoot(import.meta.url);
const CONFIG_SCHEMA_VERSION = 1;
const PROVIDERS = {
  ollama: { label: "Ollama local model", model: "llama3.1", icon: "🦙" },
  openai: { label: "OpenAI API", model: "gpt-4.1-mini", keyEnv: "OPENAI_API_KEY", keyField: "openaiApiKey", keyArg: "openai-api-key", modelArg: "openai-model", icon: "⚡" },
  anthropic: { label: "Anthropic API", model: "claude-sonnet-4-6", keyEnv: "ANTHROPIC_API_KEY", keyField: "anthropicApiKey", keyArg: "anthropic-api-key", modelArg: "anthropic-model", icon: "🔶" },
  xai: { label: "xAI API", model: "grok-4.3", keyEnv: "XAI_API_KEY", keyField: "xaiApiKey", keyArg: "xai-api-key", modelArg: "xai-model", icon: "✕" },
  "codex-app": { label: "Codex app bridge", icon: "🧠" },
  codex: { label: "Codex CLI", icon: "⌨️" },
};

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});

async function main() {
  const [command = "help", ...argv] = process.argv.slice(2);
  const args = parseArgs(argv);

  if (command === "init") await init(argv, args);
  else if (command === "run" || command === "refresh") await runRefresh(argv, args);
  else if (command === "doctor") doctor();
  else if (command === "tutorial" || command === "setup-check") doctor({ tutorial: true });
  else if (command === "demo-proof") demoProof(argv, args);
  else if (command === "sync-whatsapp") runPython("digital_brain_whatsapp_mac_sync.py", argv);
  else if (command === "sync-imessage") runPython("digital_brain_imessage_sync.py", argv);
  else if (command === "import-slack") runPython("digital_brain_slack_export_import.py", argv);
  else if (command === "import-linkedin") runPython("digital_brain_linkedin_export_import.py", argv);
  else if (command === "import-gmail") runPython("digital_brain_gmail_takeout_import.py", argv);
  else if (command === "import-calendar") runPython("digital_brain_google_calendar_import.py", argv);
  else if (command === "import-repos") runPython("digital_brain_repo_context_import.py", argv);
  else if (command === "connect-repos") await connectRepos(argv, args);
  else if (command === "extract") runPython("digital_brain_relationship_extractor.py", argv);
  else if (command === "interpret") runPython("digital_brain_relationship_interpreter.py", argv);
  else if (command === "send-whatsapp") runNode("whatsapp-web/send.mjs", argv);
  else if (command === "send-slack") runNode("slack/send.mjs", argv);
  else if (command === "send-imessage") runNode("imessage/send.mjs", argv);
  else if (command === "auto-whatsapp") runNode("whatsapp-web/auto-reply.mjs", argv);
  else if (command === "pause-whatsapp") pauseWhatsApp(argv, args);
  else if (command === "resume-whatsapp") resumeWhatsApp(argv, args);
  else if (command === "whatsapp-status") whatsappStatus(argv);
  else help();
}

async function init(argv, args) {
  const positional = argv.filter((arg) => !arg.startsWith("--"));
  const defaultVault = path.resolve(process.cwd(), "Digital Brain Vault");
  const fullAuto = toBoolean(args["full-auto"]);
  let setupMode = fullAuto ? "full-auto" : "guided";
  let vault = positional[0] ? path.resolve(positional[0]) : args.yes ? defaultVault : "";
  let selfName = args["self-name"] || "";
  let connectAi = toBoolean(args["connect-ai"]);
  let dataWindowDays = Number(args["data-window-days"] || 30);
  let focus = args.focus || "";
  let schedule = args.schedule || (fullAuto ? "always-on" : "manual");
  let refreshIntervalMinutes = clampInterval(args["refresh-interval-minutes"] || 5);
  let activeWindow = args["active-window"] || "08:00-12:00";
  let timezone = args.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone || "local";
  let outboundMode = args["outbound-mode"] || "draft";
  let autoReplyProvider = args["auto-reply-provider"] || args.provider || "ollama";
  let openaiApiKey = args["openai-api-key"] || "";
  let anthropicApiKey = args["anthropic-api-key"] || "";
  let xaiApiKey = args["xai-api-key"] || "";
  let autoReplyModel = args.model || providerSpecificModelArg(args, autoReplyProvider) || defaultModelForProvider(autoReplyProvider);
  let replyStyleMode = args["reply-style-mode"] || "match-user";
  let repoPaths = parseList(args["repo-paths"] || args.repos || "");
  let privacyMode = args["privacy-mode"] || "standard";
  let sourceMarkdownMode = args["source-markdown-mode"] || "none";
  let selectedSources = parseList(args.sources || "whatsapp");
  let responsibilityAccepted = toBoolean(args["responsibility-accepted"]) || fullAuto || schedule === "always-on";
  let telemetryEnabled = toBoolean(args.telemetry);

  if (!args.yes) {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    printSetupHeader(defaultVault);
    vault ||= path.resolve(await ask(rl, "📁 Vault path", defaultVault, "Enter creates this folder if it does not exist."));
    selfName ||= await ask(rl, "👤 Your name", "Me");
    dataWindowDays = await askNumber(rl, "🕰️  History to import", dataWindowDays, { suffix: "days", min: 1 });
    setupMode = await select(rl, "Setup mode", [
      ["guided", "Guided", "Pick each setting yourself.", "🧭"],
      ["full-auto", "Auto mode", "Use recommended always-on local refresh settings.", "⚡"],
    ], setupMode);
    focus ||= await select(rl, "Primary focus", [
      ["relationship-memory", "Relationship memory", "Map people, tone, and recurring patterns.", "🧠"],
      ["reply-help", "Reply help", "Prioritize drafting guidance and typing-style matching.", "💬"],
      ["work-context", "Work context", "Prioritize collaborators, projects, and operational notes.", "💼"],
    ], "relationship-memory");
    if (setupMode === "full-auto") {
      schedule = "always-on";
      console.log("");
      console.log("⚡ Auto mode selected: always-on local refresh. WhatsApp outbound mode is still configurable below.");
    } else {
      schedule = await select(rl, "Refresh cadence", [
        ["manual", "Manual", "Only runs when you run a command.", "🖐️"],
        ["daily", "Daily", "Good for a low-maintenance personal vault.", "🌅"],
        ["hourly", "Hourly", "Keeps memory warm without running constantly.", "⏱️"],
        ["every-30-min", "Every 30 minutes", "Useful for morning or work-window guidance.", "🔁"],
        ["always-on", "Always-on local loop", "Runs repeatedly while your computer is awake.", "⚡"],
      ], schedule);
    }
    if (schedule === "always-on") {
      refreshIntervalMinutes = await askNumber(rl, "⏳ Always-on pull interval", refreshIntervalMinutes, {
        suffix: "minutes",
        min: 1,
      });
    }
    activeWindow = await ask(rl, "🪟 Active window for frequent refreshes", activeWindow);
    selectedSources = await multiSelect(rl, "Sources to set up", [
      ["whatsapp", "WhatsApp Mac", "Live local sync from WhatsApp for Mac database.", "💚"],
      ["imessage", "Apple iMessage", "Live local sync from macOS Messages database.", "💬"],
      ["slack", "Slack export", "Import official Slack workspace export ZIP/folder.", "🧵"],
      ["linkedin", "LinkedIn archive", "Import official LinkedIn data archive ZIP/folder.", "💼"],
      ["gmail", "Gmail Takeout", "Import official Gmail Takeout .mbox or ZIP.", "📧"],
      ["calendar", "Google Calendar", "Import official Google Calendar .ics export.", "🗓️"],
      ["repos", "Git repositories", "Index local repo READMEs, manifests, remotes, and recent commits.", "📦"],
    ], selectedSources);
    if (selectedSources.includes("repos")) repoPaths = await configureRepositoryContext(rl, args, repoPaths);
    privacyMode = await select(rl, "Privacy mode", [
      ["standard", "Standard", "Keep raw JSONL locally for analysis, but do not generate raw chat Markdown.", "🔐"],
      ["metadata-only", "Metadata only", "Store timestamps and participants, but omit message bodies.", "🧼"],
    ], privacyMode);
    outboundMode = await select(rl, "WhatsApp outbound mode", [
      ["disabled", "Disabled", "Never prepares WhatsApp sends.", "🔒"],
      ["draft", "Draft only", "Prepares text and requires you to send it.", "✍️"],
      ["send-with-confirmation", "Send with confirmation", "Can send only after explicit command confirmation.", "✅"],
      ["auto-send", "Auto-send while running", "Lets auto-whatsapp send from allowlisted chats while it is running.", "🚦"],
    ], outboundMode);
    if (outboundMode !== "disabled") {
      autoReplyProvider = await select(rl, "WhatsApp auto-reply brain", [
        ["ollama", "Ollama local model", "Runs fully local if Ollama and the model are installed.", "🦙"],
        ["openai", "OpenAI API", "Fast hosted replies using the same Digital Brain context prompt.", "⚡"],
        ["anthropic", "Anthropic API", "Hosted Claude replies using the same Digital Brain context prompt.", "🔶"],
        ["xai", "xAI API", "Hosted Grok replies using the same Digital Brain context prompt.", "✕"],
        ["codex-app", "Codex app bridge", "Uses request/response files for a Codex desktop automation or thread.", "🧠"],
        ["codex", "Codex CLI", "Uses a local codex command; only choose this if the CLI works.", "⌨️"],
      ], autoReplyProvider);
      const providerMeta = PROVIDERS[autoReplyProvider];
      if (!args.model && !providerSpecificModelArg(args, autoReplyProvider)) {
        autoReplyModel = defaultModelForProvider(autoReplyProvider);
      }
      if (providerMeta?.keyEnv) {
        autoReplyModel = await ask(rl, `🤖 ${providerMeta.label} model`, autoReplyModel || providerMeta.model);
        const apiKey = await askSecret(rl, `🔑 ${providerMeta.label} key`, {
          fallbackLabel: process.env[providerMeta.keyEnv] ? `${providerMeta.keyEnv} env found` : `use ${providerMeta.keyEnv} at runtime`,
          helpText: `Paste a key to store it locally in this vault config. Leave blank to use ${providerMeta.keyEnv} at runtime.`,
        });
        if (autoReplyProvider === "openai") openaiApiKey = apiKey;
        if (autoReplyProvider === "anthropic") anthropicApiKey = apiKey;
        if (autoReplyProvider === "xai") xaiApiKey = apiKey;
      }
      replyStyleMode = await select(rl, "AI reply style", [
        ["match-user", "Match me", "Use learned chat style; avoid fake typos unless your examples show them.", "🪞"],
        ["casual-imperfect", "Casual imperfect", "Allow light lowercase, shorthand, and small natural imperfections.", "✍️"],
        ["clean-formal", "Clean/formal", "Use cleaner spelling, capitalization, and punctuation.", "🧼"],
      ], replyStyleMode);
    }
    connectAi = await confirm(rl, "🔗 Add global AI pointers for Codex/Claude/Gemini?", true);
    telemetryEnabled = await confirm(rl, "📊 Share anonymous setup/error telemetry?", false);
    responsibilityAccepted = await responsibilityGate(rl, { schedule, outboundMode });
    if (!responsibilityAccepted && needsResponsibilityGate({ schedule, outboundMode })) {
      console.log("Full-auto/outbound confirmation was not accepted. Using manual refresh and draft-only outbound.");
      schedule = "manual";
      outboundMode = "draft";
      setupMode = "guided";
    }
    rl.close();
  }

  if (args.yes && needsResponsibilityGate({ schedule, outboundMode }) && !responsibilityAccepted) {
    throw new Error("This mode requires explicit responsibility acceptance. Re-run with --responsibility-accepted=true or use draft mode.");
  }

  ensureDir(vault);
  copyDir(path.join(root, "templates", "vault"), vault);
  const config = {
    schemaVersion: CONFIG_SCHEMA_VERSION,
    selfName: selfName || "Me",
    dataWindowDays,
    focus: focus || "relationship-memory",
    schedule,
    refreshIntervalMinutes,
    activeWindow,
    timezone,
    outboundMode,
    autoReplyProvider,
    autoReplyModel: providerUsesModel(autoReplyProvider) ? autoReplyModel : undefined,
    replyStyleMode,
    openaiApiKey: autoReplyProvider === "openai" && openaiApiKey ? openaiApiKey : undefined,
    anthropicApiKey: autoReplyProvider === "anthropic" && anthropicApiKey ? anthropicApiKey : undefined,
    xaiApiKey: autoReplyProvider === "xai" && xaiApiKey ? xaiApiKey : undefined,
    privacyMode,
    sourceMarkdownMode,
    selectedSources,
    repoPaths,
    outboundLogMode: args["outbound-log-mode"] || "metadata",
    setupMode,
    responsibilityAccepted,
    telemetryEnabled,
    defaults: {
      enterUsesDefault: true,
      defaultVault,
      skippedVaultCreates: defaultVault,
      minimumRefreshIntervalMinutes: 1,
    },
    disclosureRule: {
      enabled: true,
      discloseAfterAiAssistedSends: 2,
      windowHours: 24,
    },
  };
  writeConfig(vault, config);
  writeTelemetryPreference(telemetryEnabled);
  writeDefaultVault(vault);
  writeRefreshScript(vault, config);
  writeWatchScript(vault, config);
  writeCodexAppBridgeGuide(vault, config);

  if (connectAi) {
    addGlobalPointer(path.join(os.homedir(), ".codex", "AGENTS.md"), vault, "Codex");
    addGlobalPointer(path.join(os.homedir(), ".claude", "CLAUDE.md"), vault, "Claude");
    addGlobalPointer(path.join(os.homedir(), ".gemini", "GEMINI.md"), vault, "Gemini");
  }
  if (telemetryEnabled) {
    await emitTelemetry("init_started", { mode: setupMode, sources: selectedSources }, { enabled: telemetryEnabled });
    for (const source of selectedSources) {
      await emitTelemetry("source_selected", { source }, { enabled: telemetryEnabled });
    }
    await emitTelemetry("init_completed", {
      mode: setupMode,
      focus: config.focus,
      schedule,
      outboundMode,
      provider: autoReplyProvider,
      sources: selectedSources,
    }, { enabled: telemetryEnabled });
  }

  console.log(`Digital Brain vault created: ${vault}`);
  console.log(`Config: ${path.join(vault, "digital-brain.config.json")}`);
  console.log(`Default vault saved: ${vault}`);
  console.log(`Refresh script: ${path.join(vault, "Tools", "digital-brain-refresh.sh")}`);
  console.log(`Always-on script: ${path.join(vault, "Tools", "digital-brain-watch.sh")}`);
  if (autoReplyProvider === "codex-app") {
    console.log(`Codex app bridge guide: ${path.join(vault, "Tools", "Codex App Bridge Automation.md")}`);
    if (codexAppLooksAvailable()) {
      console.log("Codex app detected. Add the generated bridge prompt as a Codex automation/thread to answer WhatsApp reply requests.");
    } else {
      console.log("Codex app config was not detected. The bridge guide was still generated for later use.");
    }
  }
  if (autoReplyProvider === "openai" && !openaiApiKey && !process.env.OPENAI_API_KEY) {
    console.log("OpenAI provider selected. Set OPENAI_API_KEY before running auto-whatsapp, or add openaiApiKey to the vault config.");
  }
  if (autoReplyProvider === "anthropic" && !anthropicApiKey && !process.env.ANTHROPIC_API_KEY) {
    console.log("Anthropic provider selected. Set ANTHROPIC_API_KEY before running auto-whatsapp, or add anthropicApiKey to the vault config.");
  }
  if (autoReplyProvider === "xai" && !xaiApiKey && !process.env.XAI_API_KEY) {
    console.log("xAI provider selected. Set XAI_API_KEY before running auto-whatsapp, or add xaiApiKey to the vault config.");
  }
  console.log("Next:");
  console.log("  digital-brain run");
  if (schedule === "always-on") console.log(`  "${path.join(vault, "Tools", "digital-brain-watch.sh")}"`);
  printSetupCheck(vault, { tutorial: true });
}

function doctor(options = {}) {
  printSetupCheck(resolveVault(process.cwd()), options);
}

function runPython(script, argv) {
  const result = runPythonStep(script, withVault(argv));
  process.exit(result.status ?? 1);
}

async function runRefresh(argv, args) {
  const vault = getVaultFromArgs(argv);
  const config = readVaultConfig(vault);
  const telemetryEnabled = readTelemetryPreference(config);
  const days = String(args.days || args["data-window-days"] || config.dataWindowDays || 30);
  const markdownMode = args["markdown-mode"] || config.sourceMarkdownMode || "none";
  const privacyMode = args["privacy-mode"] || config.privacyMode || "standard";
  const selectedSources = parseList(args.sources || "").length ? parseList(args.sources) : config.selectedSources || ["whatsapp"];
  const repoPaths = parseList(args["repo-paths"] || args.repos || "").length ? parseList(args["repo-paths"] || args.repos) : config.repoPaths || [];
  const syncArgs = ["--vault", vault, "--days", days, "--markdown-mode", markdownMode, "--privacy-mode", privacyMode];
  const repoArgs = ["--vault", vault, ...repoPaths.flatMap((repoPath) => ["--input", repoPath])];
  const extractArgs = ["--vault", vault, "--days", days];
  const interpretArgs = ["--vault", vault, "--days", days];
  if (args["min-messages"]) extractArgs.push("--min-messages", String(args["min-messages"]));
  console.log(`Digital Brain refresh: ${vault}`);
  if (toBoolean(args["dry-run"])) {
    console.log("Dry run. Planned steps:");
    if (selectedSources.includes("whatsapp")) console.log(`  sync WhatsApp: days=${days}, markdown=${markdownMode}, privacy=${privacyMode}`);
    if (selectedSources.includes("imessage")) console.log(`  sync iMessage: days=${days}, markdown=${markdownMode}, privacy=${privacyMode}`);
    if (selectedSources.includes("slack")) console.log("  Slack: import-only; run digital-brain import-slack --input <export.zip>");
    if (selectedSources.includes("linkedin")) console.log("  LinkedIn: import-only; run digital-brain import-linkedin --input <archive.zip>");
    if (selectedSources.includes("gmail")) console.log("  Gmail: import-only; run digital-brain import-gmail --input <takeout.mbox|takeout.zip>");
    if (selectedSources.includes("calendar")) console.log("  Google Calendar: import-only; run digital-brain import-calendar --input <calendar.ics|takeout.zip>");
    if (selectedSources.includes("repos")) console.log(repoPaths.length ? `  repos: ${repoPaths.length} configured path(s)` : "  repos: no paths configured; run digital-brain import-repos --input <repo>");
    console.log(`  extract relationships: days=${days}`);
    console.log(`  interpret relationship drafts: days=${days}`);
    return;
  }
  await emitTelemetry("run_started", { sources: selectedSources, days }, { enabled: telemetryEnabled, vaultConfig: config });
  const steps = [];
  if (selectedSources.includes("whatsapp")) steps.push(["sync WhatsApp", "sync-whatsapp", "digital_brain_whatsapp_mac_sync.py", syncArgs]);
  if (selectedSources.includes("imessage")) steps.push(["sync iMessage", "sync-imessage", "digital_brain_imessage_sync.py", syncArgs]);
  if (selectedSources.includes("repos") && repoPaths.length) steps.push(["import repos", "import-repos", "digital_brain_repo_context_import.py", repoArgs]);
  if (selectedSources.includes("repos") && !repoPaths.length) console.log("\n→ import repos skipped: no repoPaths configured");
  steps.push(
    ["extract", "extract", "digital_brain_relationship_extractor.py", extractArgs],
    ["interpret", "interpret", "digital_brain_relationship_interpreter.py", interpretArgs],
  );
  for (const [label, skipKey, script, stepArgs] of steps) {
    const skipRequested = toBoolean(args[`skip-${skipKey}`]) || (skipKey.startsWith("sync-") && toBoolean(args["skip-sync"]));
    if (skipRequested) {
      console.log(`\n→ ${label} skipped`);
      continue;
    }
    console.log(`\n→ ${label}`);
    const result = runPythonStep(script, stepArgs);
    if ((result.status ?? 1) !== 0) {
      await emitTelemetry("run_failed", { step: skipKey, status: result.status ?? 1 }, { enabled: telemetryEnabled, vaultConfig: config });
      process.exit(result.status ?? 1);
    }
  }
  await emitTelemetry("run_completed", { sources: selectedSources, days }, { enabled: telemetryEnabled, vaultConfig: config });
  console.log("\nDigital Brain refresh complete.");
}

async function connectRepos(argv, args) {
  const vault = getVaultFromArgs(argv);
  const config = readVaultConfig(vault);
  let repoPaths = parseList(args["repo-paths"] || args.repos || "");
  if (!repoPaths.length && args.input) repoPaths = Array.isArray(args.input) ? args.input : [args.input];
  if (!repoPaths.length || !toBoolean(args.yes)) {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    repoPaths = await configureRepositoryContext(rl, args, repoPaths.length ? repoPaths : config.repoPaths || []);
    rl.close();
  }
  if (!repoPaths.length) {
    console.log("No repositories selected.");
    return;
  }
  config.selectedSources = Array.from(new Set([...(config.selectedSources || []), "repos"]));
  config.repoPaths = repoPaths;
  writeConfig(vault, config);
  console.log(`Saved ${repoPaths.length} repository path(s) to ${path.join(vault, "digital-brain.config.json")}.`);
  if (!toBoolean(args["skip-import"])) {
    const result = runPythonStep("digital_brain_repo_context_import.py", ["--vault", vault, ...repoPaths.flatMap((repoPath) => ["--input", repoPath])]);
    if ((result.status ?? 1) !== 0) process.exit(result.status ?? 1);
  }
}

function runPythonStep(script, argv) {
  return spawnSync("python3", [path.join(root, "scripts", script), ...argv], { stdio: "inherit" });
}

function runNode(script, argv) {
  const result = spawnSync(process.execPath, [path.join(root, script), ...withVault(argv)], { stdio: "inherit" });
  process.exit(result.status ?? 1);
}

function pauseWhatsApp(argv, args) {
  const vault = getVaultFromArgs(argv);
  const file = pauseFile(vault);
  ensureDir(path.dirname(file));
  const state = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : { schemaVersion: 1, paused: false, pausedChats: {} };
  state.schemaVersion = 1;
  state.pausedChats ||= {};
  const chat = args.chat || args.name || "";
  if (chat) {
    state.pausedChats[`name:${chat.toLowerCase()}`] = {
      chatName: chat,
      reason: args.reason || "",
      updatedAt: new Date().toISOString(),
    };
    console.log(`Paused WhatsApp auto-replies for: ${chat}`);
  } else {
    state.paused = true;
    state.reason = args.reason || "";
    state.updatedAt = new Date().toISOString();
    console.log("Paused WhatsApp auto-replies globally.");
  }
  writeFileAtomic(file, `${JSON.stringify(state, null, 2)}\n`);
}

function resumeWhatsApp(argv, args) {
  const vault = getVaultFromArgs(argv);
  const file = pauseFile(vault);
  const state = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : { schemaVersion: 1, paused: false, pausedChats: {} };
  state.schemaVersion = 1;
  state.pausedChats ||= {};
  const chat = args.chat || args.name || "";
  if (chat) {
    delete state.pausedChats[`name:${chat.toLowerCase()}`];
    console.log(`Resumed WhatsApp auto-replies for: ${chat}`);
  } else {
    state.paused = false;
    state.reason = "";
    state.updatedAt = new Date().toISOString();
    console.log("Resumed WhatsApp auto-replies globally.");
  }
  writeFileAtomic(file, `${JSON.stringify(state, null, 2)}\n`);
}

function whatsappStatus(argv) {
  const vault = getVaultFromArgs(argv);
  const file = pauseFile(vault);
  const state = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : { paused: false, pausedChats: {} };
  console.log(`WhatsApp auto-reply: ${state.paused ? "paused" : "running/not globally paused"}`);
  const pausedChats = Object.values(state.pausedChats || {});
  if (pausedChats.length) console.log(`Paused chats: ${pausedChats.map((chat) => chat.chatName).join(", ")}`);
}

function demoProof(argv, args) {
  const positional = argv.filter((arg) => !arg.startsWith("--"));
  const outDir = path.resolve(args.out || positional[0] || "demo-assets");
  const sampleVault = path.join(outDir, "sample-vault");
  ensureDir(outDir);
  if (!fs.existsSync(path.join(sampleVault, "08 Sources"))) {
    copyDir(path.join(root, "examples", "sample-vault"), sampleVault);
  }
  const extract = runPythonStep("digital_brain_relationship_extractor.py", ["--vault", sampleVault, "--days", "365", "--min-messages", "1"]);
  if ((extract.status ?? 1) !== 0) process.exit(extract.status ?? 1);
  const interpret = runPythonStep("digital_brain_relationship_interpreter.py", ["--vault", sampleVault, "--days", "365"]);
  if ((interpret.status ?? 1) !== 0) process.exit(interpret.status ?? 1);
  writeFileAtomic(path.join(outDir, "terminal-demo.txt"), demoTerminalTranscript());
  writeFileAtomic(path.join(outDir, "screenshot-cards.html"), demoScreenshotHtml());
  writeFileAtomic(path.join(outDir, "README.md"), demoReadme(outDir));
  console.log(`Demo proof assets written to: ${outDir}`);
  console.log(`Screenshot-ready HTML: ${path.join(outDir, "screenshot-cards.html")}`);
  console.log(`Sample vault: ${sampleVault}`);
}

function pauseFile(vault) {
  return path.join(vault, "08 Sources", "WhatsApp", "Outbound", "auto-reply-pause.json");
}

function withVault(argv) {
  if (argv.includes("--vault") || argv.some((arg) => arg.startsWith("--vault="))) return argv;
  return ["--vault", getVaultFromArgs(argv), ...argv];
}

function getVaultFromArgs(argv) {
  const args = parseArgs(argv);
  if (args.vault) return path.resolve(String(args.vault));
  return resolveVault(process.cwd());
}

function readVaultConfig(vault) {
  const file = path.join(vault, "digital-brain.config.json");
  if (!fs.existsSync(file)) {
    console.error(`No Digital Brain vault found. Run "digital-brain init" first, or pass --vault <path>.`);
    process.exit(1);
  }
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function printSetupCheck(vault, options = {}) {
  const config = fs.existsSync(path.join(vault, "digital-brain.config.json")) ? readVaultConfig(vault) : {};
  const selectedSources = config.selectedSources || ["whatsapp"];
  const pythonVersion = shell("python3", ["--version"], true);
  const pythonSqlite = shell("python3", ["-c", "import sqlite3; print('ok')"], true);
  const ollamaVersion = shell("ollama", ["--version"], true);
  const ghVersion = shell("gh", ["--version"], true);
  const macDb = path.join(os.homedir(), "Library/Group Containers/group.net.whatsapp.WhatsApp.shared/ChatStorage.sqlite");
  const messagesDb = path.join(os.homedir(), "Library/Messages/chat.db");
  const checks = [
    {
      label: "Node",
      ok: nodeMajor() >= 20,
      value: process.version,
      hint: "Install Node 20 or newer from https://nodejs.org.",
    },
    {
      label: "Package dependencies",
      ok: true,
      value: "installed by npm",
    },
    {
      label: "Python 3",
      ok: Boolean(pythonVersion),
      value: pythonVersion || "not found",
      hint: "Install with: brew install python",
    },
    {
      label: "Python sqlite3",
      ok: pythonSqlite === "ok",
      value: pythonSqlite === "ok" ? "available" : "not found",
      hint: "Use a Python 3 build with sqlite3 support.",
    },
    {
      label: "Ollama",
      ok: Boolean(ollamaVersion),
      value: ollamaVersion || "optional",
      hint: "Optional local LLM: brew install ollama",
      optional: true,
    },
  ];
  if (config.autoReplyProvider === "openai") {
    checks.push({
      label: "OpenAI API key",
      ok: Boolean(process.env.OPENAI_API_KEY || config.openaiApiKey),
      value: process.env.OPENAI_API_KEY ? "found in OPENAI_API_KEY" : config.openaiApiKey ? "stored in vault config" : "not found",
      hint: "Set OPENAI_API_KEY or re-run init and choose OpenAI API.",
    });
  }
  if (config.autoReplyProvider === "anthropic") {
    checks.push({
      label: "Anthropic API key",
      ok: Boolean(process.env.ANTHROPIC_API_KEY || config.anthropicApiKey),
      value: process.env.ANTHROPIC_API_KEY ? "found in ANTHROPIC_API_KEY" : config.anthropicApiKey ? "stored in vault config" : "not found",
      hint: "Set ANTHROPIC_API_KEY or re-run init and choose Anthropic API.",
    });
  }
  if (config.autoReplyProvider === "xai") {
    checks.push({
      label: "xAI API key",
      ok: Boolean(process.env.XAI_API_KEY || config.xaiApiKey),
      value: process.env.XAI_API_KEY ? "found in XAI_API_KEY" : config.xaiApiKey ? "stored in vault config" : "not found",
      hint: "Set XAI_API_KEY or re-run init and choose xAI API.",
    });
  }
  if (selectedSources.includes("whatsapp")) {
    checks.push({
      label: "WhatsApp Mac database",
      ok: fs.existsSync(macDb),
      value: fs.existsSync(macDb) ? "found" : "not found yet",
      hint: "Install/open WhatsApp for Mac, log in, then grant Terminal Full Disk Access if needed: https://faq.whatsapp.com/686469079565350",
    });
  }
  if (selectedSources.includes("imessage")) {
    checks.push({
      label: "Apple Messages database",
      ok: fs.existsSync(messagesDb),
      value: fs.existsSync(messagesDb) ? "found" : "not found yet",
      hint: "Open Messages on macOS and grant Terminal Full Disk Access if needed: https://support.apple.com/guide/messages/welcome/mac",
    });
  }
  if (selectedSources.includes("repos")) {
    checks.push({
      label: "GitHub CLI",
      ok: Boolean(ghVersion),
      value: ghVersion || "optional",
      hint: "Install with: brew install gh. Required only for GitHub repo selection during init.",
      optional: true,
    });
    checks.push({
      label: "Configured repositories",
      ok: Boolean((config.repoPaths || []).length),
      value: (config.repoPaths || []).length ? `${config.repoPaths.length} path(s)` : "none configured yet",
      hint: "Run init with repos selected or run import-repos --input /path/to/repo.",
      optional: true,
    });
  }
  if (selectedSources.includes("slack")) {
    checks.push({
      label: "Slack export",
      ok: true,
      value: "import manually",
      hint: "Export guide: https://slack.com/help/articles/201658943-Export-your-workspace-data",
    });
  }
  if (selectedSources.includes("linkedin")) {
    checks.push({
      label: "LinkedIn archive",
      ok: true,
      value: "import manually",
      hint: "Export guide: https://www.linkedin.com/help/linkedin/answer/a566336",
    });
  }
  if (selectedSources.includes("gmail")) {
    checks.push({
      label: "Gmail Takeout",
      ok: true,
      value: "import manually",
      hint: "Export guide: https://takeout.google.com/",
    });
  }
  if (selectedSources.includes("calendar")) {
    checks.push({
      label: "Google Calendar export",
      ok: true,
      value: "import manually",
      hint: "Export guide: https://takeout.google.com/",
    });
  }

  console.log("");
  console.log("Setup check");
  for (const check of checks) {
    const icon = check.ok ? "✓" : check.optional ? "○" : "!";
    console.log(`  ${icon} ${check.label}: ${check.value}`);
    if (!check.ok && check.hint) console.log(`    ${check.hint}`);
  }
  if (fs.existsSync(path.join(vault, "digital-brain.config.json"))) {
    console.log(`  ✓ Default vault: ${vault}`);
  } else {
    console.log("  ! Default vault: not set");
    console.log("    Run: digital-brain init");
  }

  if (options.tutorial) {
    console.log("");
    console.log("How to use it");
    let step = 1;
    if (selectedSources.includes("whatsapp")) {
      console.log(`  ${step++}. Open WhatsApp for Mac once and keep it logged in.`);
    }
    if (selectedSources.includes("imessage")) {
      console.log(`  ${step++}. Open Messages on macOS once and grant Terminal Full Disk Access if needed.`);
    }
    if (selectedSources.includes("slack")) {
      console.log(`  ${step++}. Download a Slack export, then run: digital-brain import-slack --input <export.zip>`);
    }
    if (selectedSources.includes("linkedin")) {
      console.log(`  ${step++}. Download a LinkedIn archive, then run: digital-brain import-linkedin --input <archive.zip>`);
    }
    if (selectedSources.includes("gmail")) {
      console.log(`  ${step++}. Download Gmail from Google Takeout, then run: digital-brain import-gmail --input <takeout.mbox|takeout.zip>`);
    }
    if (selectedSources.includes("calendar")) {
      console.log(`  ${step++}. Download Google Calendar from Google Takeout, then run: digital-brain import-calendar --input <calendar.ics|takeout.zip>`);
    }
    console.log(`  ${step++}. Run: digital-brain run`);
    console.log(`  ${step}. Ask your AI to use the generated vault notes for personal context.`);
    console.log("");
    console.log("No pip install is needed. npm installs the package dependencies.");
  }
}

function writeConfig(vault, config) {
  writeFileAtomic(path.join(vault, "digital-brain.config.json"), `${JSON.stringify(config, null, 2)}\n`);
}

function writeRefreshScript(vault, config) {
  const toolsDir = path.join(vault, "Tools");
  ensureDir(toolsDir);
  const days = Number(config.dataWindowDays || 30);
  const content = `#!/usr/bin/env bash
set -euo pipefail

VAULT="${vault.replace(/"/g, '\\"')}"
DAYS="${days}"

digital-brain run --vault "$VAULT" --days "$DAYS"

echo "Digital Brain refresh complete for $VAULT"
`;
  const scriptPath = path.join(toolsDir, "digital-brain-refresh.sh");
  writeFileAtomic(scriptPath, content);
  fs.chmodSync(scriptPath, 0o755);
}

function writeWatchScript(vault, config) {
  const toolsDir = path.join(vault, "Tools");
  ensureDir(toolsDir);
  const interval = clampInterval(config.refreshIntervalMinutes || 5);
  const content = `#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
INTERVAL_MINUTES="${interval}"

echo "Digital Brain watch loop started. Interval: $INTERVAL_MINUTES minute(s)."
echo "Press Ctrl+C to stop."

while true; do
  "$SCRIPT_DIR/digital-brain-refresh.sh"
  sleep "$((INTERVAL_MINUTES * 60))"
done
`;
  const scriptPath = path.join(toolsDir, "digital-brain-watch.sh");
  writeFileAtomic(scriptPath, content);
  fs.chmodSync(scriptPath, 0o755);
}

function writeCodexAppBridgeGuide(vault, config) {
  const toolsDir = path.join(vault, "Tools");
  ensureDir(toolsDir);
  const bridgeDir = path.join(vault, "08 Sources", "WhatsApp", "Outbound", "Codex App Bridge");
  const requestsDir = path.join(bridgeDir, "requests");
  const responsesDir = path.join(bridgeDir, "responses");
  ensureDir(requestsDir);
  ensureDir(responsesDir);
  const prompt = `# Codex App Bridge Automation

Use this prompt in a Codex desktop automation or a live Codex thread when Digital Brain is configured with:

\`\`\`bash
digital-brain auto-whatsapp --provider codex-app --yes
\`\`\`

Request folder:

\`${requestsDir}\`

Response folder:

\`${responsesDir}\`

Automation prompt:

\`\`\`text
Check for pending Digital Brain WhatsApp reply requests in ${requestsDir}. For each .json request that does not already have its response file present, read the request JSON, use its prompt field to produce exactly one WhatsApp reply as the user, and write JSON to the request's responsePath in the exact shape {"reply":"..."}. Do not send any WhatsApp message yourself. Do not write markdown or explanations in the response file. If a request cannot be answered, write {"error":"short reason"} to responsePath.
\`\`\`

Notes:

- Digital Brain sends the WhatsApp message after the response file appears.
- Keep the automation active while \`digital-brain auto-whatsapp --provider codex-app\` is running.
- The default wait timeout is 5 minutes. Override with \`--provider-timeout-ms\`.
`;
  writeFileAtomic(path.join(toolsDir, "Codex App Bridge Automation.md"), prompt);
  if (config.autoReplyProvider === "codex-app") {
    writeFileAtomic(path.join(bridgeDir, "README.md"), prompt);
  }
}

function addGlobalPointer(file, vault, label) {
  ensureDir(path.dirname(file));
  const block = `

# Digital Brain

Digital Brain vault:

\`${vault}\`

Use it as local personal context when the user asks about preferences, relationships, communication style, or recurring context. Treat generated relationship notes as provisional.
`;
  const existing = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
  if (!existing.includes(vault)) fs.appendFileSync(file, block);
  console.log(`${label} pointer: ${file}`);
}

function writeFileAtomic(file, content) {
  const temp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temp, content);
  fs.renameSync(temp, file);
}

function printSetupHeader(defaultVault) {
  console.log("");
  console.log("╭────────────────────────────────────────╮");
  console.log("│ 🧠 Digital Brain setup                 │");
  console.log("╰────────────────────────────────────────╯");
  console.log("Pick with A/B/C, 1/2/3, exact value, or press Enter for the default.");
  console.log(`Skipping the vault path creates: ${defaultVault}`);
  console.log("");
}

async function ask(rl, label, fallback, helpText = "") {
  if (helpText) console.log(`  ${helpText}`);
  const answer = await rl.question(`${label} [${fallback}]: `);
  return answer.trim() || fallback;
}

async function askSecret(rl, label, options = {}) {
  if (options.helpText) console.log(`  ${options.helpText}`);
  const suffix = options.fallbackLabel ? ` [${options.fallbackLabel}]` : "";
  const answer = await rl.question(`${label}${suffix}: `);
  return answer.trim();
}

async function askNumber(rl, label, fallback, options = {}) {
  const suffix = options.suffix ? ` ${options.suffix}` : "";
  const answer = await ask(rl, `${label}${suffix}`, String(fallback));
  const parsed = Number(answer);
  if (!Number.isFinite(parsed)) return Number(fallback);
  if (Number.isFinite(options.min) && parsed < options.min) return options.min;
  return Math.floor(parsed);
}

async function select(rl, label, options, fallback) {
  const defaultIndex = Math.max(0, options.findIndex(([value]) => value === fallback));
  console.log("");
  console.log(`◇ ${label}`);
  options.forEach(([, title, description, icon = "•"], index) => {
    const marker = index === defaultIndex ? "  ← default" : "";
    const letter = letterFor(index);
    console.log(`  ${letter}) ${icon}  ${title}${marker}`);
    console.log(`     ${description}`);
  });
  const answer = await rl.question(`Choose ${letterFor(defaultIndex)}/${defaultIndex + 1} [${letterFor(defaultIndex)}]: `);
  const trimmed = answer.trim();
  if (!trimmed) return options[defaultIndex][0];
  const letterIndex = indexFromLetter(trimmed);
  if (letterIndex >= 0 && letterIndex < options.length) return options[letterIndex][0];
  const selected = Number(trimmed);
  if (Number.isInteger(selected) && selected >= 1 && selected <= options.length) return options[selected - 1][0];
  const lower = trimmed.toLowerCase();
  const exact = options.find(([value, title]) => value.toLowerCase() === lower || title.toLowerCase() === lower);
  return exact ? exact[0] : options[defaultIndex][0];
}

async function multiSelect(rl, label, options, fallbackValues) {
  const fallback = fallbackValues.length ? fallbackValues : [options[0][0]];
  console.log("");
  console.log(`◇ ${label}`);
  options.forEach(([, title, description, icon = "•"], index) => {
    const selected = fallback.includes(options[index][0]) ? "  ← default" : "";
    const letter = letterFor(index);
    console.log(`  ${letter}) ${icon}  ${title}${selected}`);
    console.log(`     ${description}`);
  });
  const answer = await rl.question(`Choose one or more, comma-separated [${fallback.join(",")}]: `);
  if (!answer.trim()) return fallback;
  const values = [];
  for (const token of answer.split(",").map((value) => value.trim()).filter(Boolean)) {
    const letterIndex = indexFromLetter(token);
    const numericIndex = Number(token) - 1;
    const option = options[letterIndex] || options[numericIndex] || options.find(([value, title]) => value === token || title.toLowerCase() === token.toLowerCase());
    if (option && !values.includes(option[0])) values.push(option[0]);
  }
  return values.length ? values : fallback;
}

async function confirm(rl, label, fallback) {
  const hint = fallback ? "Y/n" : "y/N";
  const answer = (await rl.question(`${label} [${hint}]: `)).trim().toLowerCase();
  if (!answer) return fallback;
  return ["y", "yes", "true", "1"].includes(answer);
}

async function responsibilityGate(rl, { schedule, outboundMode }) {
  const needsGate = needsResponsibilityGate({ schedule, outboundMode });
  if (!needsGate) return true;
  console.log("");
  console.log("⚠️  Responsibility check:");
  console.log("  Digital Brain may use local databases, WhatsApp Web, and black-box third-party app behavior.");
  console.log("  You are responsible for consent, privacy, message content, and any sends triggered from this machine.");
  console.log("  Enter does not approve this mode.");
  return confirm(rl, "I understand and want this mode enabled", false);
}

async function configureRepositoryContext(rl, args, existingRepoPaths) {
  const mode = await select(rl, "Repository context setup", [
    ["github", "Connect GitHub", "Use GitHub CLI auth, pick allowed repos, then clone/pull them locally.", "🐙"],
    ["local", "Local paths", "Paste comma-separated local repo folders.", "📁"],
    ["later", "Later", "Skip now and run import-repos later.", "⏭️"],
  ], args["github-connect"] === "false" ? "local" : "github");

  if (mode === "later") return existingRepoPaths;
  if (mode === "local") {
    const answer = await ask(rl, "📦 Repository paths", existingRepoPaths.join(", "), "Comma-separated local repo folders. You can leave blank and run import-repos later.");
    return parseList(answer);
  }

  if (!commandExists("gh")) {
    console.log("GitHub CLI was not found. Install it with: brew install gh");
    const answer = await ask(rl, "📦 Repository paths", existingRepoPaths.join(", "), "Fallback: comma-separated local repo folders.");
    return parseList(answer);
  }

  if (!ghIsAuthenticated()) {
    console.log("GitHub CLI is not authenticated.");
    if (await confirm(rl, "Run `gh auth login --web` now?", true)) {
      const result = spawnSync("gh", ["auth", "login", "--web"], { stdio: "inherit" });
      if ((result.status ?? 1) !== 0 || !ghIsAuthenticated()) {
        console.log("GitHub authentication did not complete. You can run `gh auth login --web` later.");
        return existingRepoPaths;
      }
    } else {
      return existingRepoPaths;
    }
  }

  const login = ghOutput(["api", "user", "--jq", ".login"]);
  const ownersAnswer = await ask(rl, "🐙 GitHub owner/org", login || "", "Comma-separated. Example: your username, codewiser-io.");
  const owners = parseList(ownersAnswer || login);
  const repos = owners.flatMap((owner) => listGithubRepos(owner, Number(args["github-repo-limit"] || 100)));
  if (!repos.length) {
    console.log("No GitHub repositories found for the selected owner/org.");
    return existingRepoPaths;
  }

  const selected = await multiSelect(
    rl,
    "Repositories to pull into context",
    repos.map((repo) => [repo.nameWithOwner, repo.nameWithOwner, repo.description || repo.visibility || "GitHub repository", repo.isPrivate ? "🔒" : "📦"]),
    repos.slice(0, Math.min(repos.length, 5)).map((repo) => repo.nameWithOwner),
  );
  const cloneRoot = path.resolve(args["repo-clone-dir"] || path.join(os.homedir(), ".digital-brain", "github-repos"));
  ensureDir(cloneRoot);
  const paths = [];
  for (const nameWithOwner of selected) {
    const repo = repos.find((item) => item.nameWithOwner === nameWithOwner);
    if (!repo) continue;
    const localPath = cloneOrPullRepo(repo, cloneRoot);
    if (localPath) paths.push(localPath);
  }
  return paths.length ? paths : existingRepoPaths;
}

function commandExists(command) {
  const result = spawnSync(command, ["--version"], { encoding: "utf8" });
  return !result.error && (result.status ?? 1) === 0;
}

function ghIsAuthenticated() {
  const result = spawnSync("gh", ["auth", "status"], { encoding: "utf8" });
  return !result.error && (result.status ?? 1) === 0;
}

function ghOutput(args) {
  const result = spawnSync("gh", args, { encoding: "utf8" });
  if (result.error || (result.status ?? 1) !== 0) return "";
  return result.stdout.trim();
}

function listGithubRepos(owner, limit) {
  const output = ghOutput(["repo", "list", owner, "--limit", String(limit || 100), "--json", "nameWithOwner,url,description,isPrivate"]);
  if (!output) return [];
  try {
    return JSON.parse(output).map((repo) => ({
      nameWithOwner: repo.nameWithOwner,
      url: repo.url,
      description: repo.description || "",
      isPrivate: Boolean(repo.isPrivate),
      visibility: repo.isPrivate ? "private" : "public",
    }));
  } catch {
    return [];
  }
}

function cloneOrPullRepo(repo, cloneRoot) {
  const localPath = path.join(cloneRoot, repo.nameWithOwner.replace("/", "__"));
  if (fs.existsSync(path.join(localPath, ".git"))) {
    console.log(`Pulling ${repo.nameWithOwner}...`);
    const result = spawnSync("git", ["-C", localPath, "pull", "--ff-only"], { stdio: "inherit" });
    return (result.status ?? 1) === 0 ? localPath : "";
  }
  console.log(`Cloning ${repo.nameWithOwner}...`);
  const result = spawnSync("gh", ["repo", "clone", repo.nameWithOwner, localPath], { stdio: "inherit" });
  return (result.status ?? 1) === 0 ? localPath : "";
}

function needsResponsibilityGate({ schedule, outboundMode }) {
  return schedule === "always-on" || ["send-with-confirmation", "auto-send"].includes(outboundMode);
}

function codexAppLooksAvailable() {
  return fs.existsSync(path.join(os.homedir(), ".codex"));
}

function letterFor(index) {
  return String.fromCharCode(65 + index);
}

function indexFromLetter(value) {
  const normalized = value.trim().toUpperCase();
  if (!/^[A-Z]$/.test(normalized)) return -1;
  return normalized.charCodeAt(0) - 65;
}

function shell(command, args, optional = false) {
  const result = spawnSync(command, args, { encoding: "utf8" });
  if (result.error && optional) return "";
  if (result.error) return "not found";
  return (result.stdout || result.stderr).trim().split("\n")[0];
}

function nodeMajor() {
  return Number(process.version.replace(/^v/, "").split(".")[0]);
}

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith("--")) continue;
    const key = arg.slice(2);
    if (key.includes("=")) {
      const [k, ...rest] = key.split("=");
      setArg(out, k, rest.join("="));
    } else {
      const next = argv[i + 1];
      if (!next || next.startsWith("--")) setArg(out, key, true);
      else setArg(out, key, argv[++i]);
    }
  }
  return out;
}

function setArg(out, key, value) {
  if (out[key] === undefined) {
    out[key] = value;
  } else if (Array.isArray(out[key])) {
    out[key].push(value);
  } else {
    out[key] = [out[key], value];
  }
}

function parseList(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value.flatMap((item) => parseList(item));
  return String(value).split(",").map((item) => item.trim()).filter(Boolean);
}

function defaultModelForProvider(provider) {
  return PROVIDERS[provider]?.model || PROVIDERS.ollama.model;
}

function providerSpecificModelArg(args, provider) {
  const key = PROVIDERS[provider]?.modelArg;
  return key ? args[key] : "";
}

function providerUsesModel(provider) {
  return Boolean(PROVIDERS[provider]?.model);
}

function toBoolean(value) {
  if (value === undefined) return false;
  if (value === true) return true;
  return !["false", "0", "no", "off"].includes(String(value).toLowerCase());
}

function clampInterval(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 1) return 1;
  return Math.floor(parsed);
}

function demoTerminalTranscript() {
  return `$ npx digital-brain init
◇ Sources to set up
  A) WhatsApp Mac
  B) Apple iMessage
  C) Slack export
  D) LinkedIn archive
  E) Git repositories

$ digital-brain run
Digital Brain refresh: ./Digital Brain Vault

→ sync WhatsApp
Added sample messages.

→ extract
Wrote relationship profiles.
Wrote canonical person records.

→ interpret
Wrote interpreted notes.

Digital Brain refresh complete.
`;
}

function demoScreenshotHtml() {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Digital Brain Demo Cards</title>
  <style>
    :root {
      color-scheme: dark;
      font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      background: #101418;
      color: #f6f3ec;
    }
    body {
      margin: 0;
      padding: 40px;
      background: linear-gradient(135deg, #101418 0%, #17211f 55%, #151515 100%);
    }
    main {
      max-width: 1120px;
      margin: 0 auto;
      display: grid;
      gap: 24px;
    }
    h1 {
      margin: 0;
      font-size: 44px;
      line-height: 1.05;
      letter-spacing: 0;
    }
    p {
      color: #c9c3b8;
      font-size: 18px;
      line-height: 1.5;
      margin: 0;
    }
    .grid {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 16px;
    }
    .card {
      border: 1px solid rgba(255,255,255,.14);
      background: rgba(255,255,255,.06);
      border-radius: 8px;
      padding: 20px;
      min-height: 190px;
    }
    .label {
      color: #73e0a9;
      font-size: 13px;
      text-transform: uppercase;
      letter-spacing: .08em;
      margin-bottom: 12px;
    }
    .title {
      font-size: 22px;
      font-weight: 700;
      margin-bottom: 12px;
    }
    ul {
      margin: 0;
      padding-left: 18px;
      color: #d8d2c8;
      line-height: 1.55;
    }
    code {
      background: rgba(0,0,0,.34);
      border: 1px solid rgba(255,255,255,.12);
      border-radius: 6px;
      display: block;
      padding: 16px;
      color: #d9ffe9;
      font-size: 16px;
    }
  </style>
</head>
<body>
  <main>
    <h1>Digital Brain turns your digital footprint into local AI memory.</h1>
    <p>Messages, repos, notes, and exports become an editable Obsidian-compatible context vault.</p>
    <div class="grid">
      <section class="card">
        <div class="label">People</div>
        <div class="title">Relationship context</div>
        <ul>
          <li>Role evidence from conversation text</li>
          <li>Typing style and tone</li>
          <li>Open loops and continuity</li>
        </ul>
      </section>
      <section class="card">
        <div class="label">Work</div>
        <div class="title">Project memory</div>
        <ul>
          <li>GitHub/repo summaries</li>
          <li>Slack and LinkedIn imports</li>
          <li>Local notes in one vault</li>
        </ul>
      </section>
      <section class="card">
        <div class="label">Action</div>
        <div class="title">Reply assistance</div>
        <ul>
          <li>Draft or auto-reply with allowlists</li>
          <li>Provider choice: local or API</li>
          <li>Privacy-first safety defaults</li>
        </ul>
      </section>
    </div>
    <code>npx digital-brain init<br>digital-brain run</code>
  </main>
</body>
</html>
`;
}

function demoReadme(outDir) {
  return `# Digital Brain Demo Proof Assets

Generated by:

\`\`\`bash
digital-brain demo-proof --out ${outDir}
\`\`\`

## Files

- \`sample-vault/\`: fake-data vault for demos and screenshots.
- \`terminal-demo.txt\`: sanitized terminal transcript.
- \`screenshot-cards.html\`: screenshot-ready landing/demo cards.

## Suggested Caption

Your digital footprint should be queryable.

Digital Brain turns WhatsApp, iMessage, Slack, LinkedIn exports, GitHub repos, and notes into local AI memory.

## Links

- npm: https://www.npmjs.com/package/digital-brain
- GitHub: https://github.com/rushillshah/digital-brain
`;
}

function help() {
  console.log(`Digital Brain

Usage:
  digital-brain init [vault]
  digital-brain run
  digital-brain demo-proof --out ./demo-assets
  digital-brain doctor
  digital-brain tutorial
  digital-brain sync-whatsapp --days 30
  digital-brain sync-imessage --days 30
  digital-brain import-slack --input slack-export.zip
  digital-brain import-linkedin --input linkedin-archive.zip
  digital-brain import-gmail --input takeout.mbox
  digital-brain import-calendar --input calendar.ics
  digital-brain import-repos --input /path/to/repo --input /path/to/another-repo
  digital-brain connect-repos
  digital-brain extract --days 30
  digital-brain interpret --days 30
  digital-brain send-whatsapp --to "Name" --message "Text" [--yes]
  digital-brain send-slack --channel C123 --message "Text" [--yes]
  digital-brain send-imessage --to "+15551234567" --message "Text" [--yes]
  digital-brain auto-whatsapp --allow "Name" --contact "+15551234567" --provider ollama|openai|anthropic|xai|codex|codex-app --model llama3.1 [--reply-style-mode match-user|casual-imperfect|clean-formal] [--yes]
  digital-brain pause-whatsapp [--chat "Name"]
  digital-brain resume-whatsapp [--chat "Name"]
  digital-brain whatsapp-status
`);
}

#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import readline from "node:readline/promises";
import { fileURLToPath } from "node:url";
import { copyDir, ensureDir, packageRoot, resolveVault, writeDefaultVault } from "../lib/fs.js";

const root = packageRoot(import.meta.url);
const CONFIG_SCHEMA_VERSION = 1;

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});

async function main() {
  const [command = "help", ...argv] = process.argv.slice(2);
  const args = parseArgs(argv);

  if (command === "init") await init(argv, args);
  else if (command === "run" || command === "refresh") runRefresh(argv, args);
  else if (command === "doctor") doctor();
  else if (command === "tutorial" || command === "setup-check") doctor({ tutorial: true });
  else if (command === "sync-whatsapp") runPython("digital_brain_whatsapp_mac_sync.py", argv);
  else if (command === "sync-imessage") runPython("digital_brain_imessage_sync.py", argv);
  else if (command === "import-slack") runPython("digital_brain_slack_export_import.py", argv);
  else if (command === "import-linkedin") runPython("digital_brain_linkedin_export_import.py", argv);
  else if (command === "extract") runPython("digital_brain_relationship_extractor.py", argv);
  else if (command === "interpret") runPython("digital_brain_relationship_interpreter.py", argv);
  else if (command === "send-whatsapp") runNode("whatsapp-web/send.mjs", argv);
  else if (command === "auto-whatsapp") runNode("whatsapp-web/auto-reply.mjs", argv);
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
  let privacyMode = args["privacy-mode"] || "standard";
  let sourceMarkdownMode = args["source-markdown-mode"] || "none";
  let selectedSources = parseList(args.sources || "whatsapp");
  let responsibilityAccepted = toBoolean(args["responsibility-accepted"]) || fullAuto || schedule === "always-on";

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
    ], selectedSources);
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
    connectAi = await confirm(rl, "🔗 Add global AI pointers for Codex/Claude/Gemini?", true);
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
    privacyMode,
    sourceMarkdownMode,
    selectedSources,
    outboundLogMode: args["outbound-log-mode"] || "metadata",
    setupMode,
    responsibilityAccepted,
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
  writeDefaultVault(vault);
  writeRefreshScript(vault, config);
  writeWatchScript(vault, config);

  if (connectAi) {
    addGlobalPointer(path.join(os.homedir(), ".codex", "AGENTS.md"), vault, "Codex");
    addGlobalPointer(path.join(os.homedir(), ".claude", "CLAUDE.md"), vault, "Claude");
    addGlobalPointer(path.join(os.homedir(), ".gemini", "GEMINI.md"), vault, "Gemini");
  }

  console.log(`Digital Brain vault created: ${vault}`);
  console.log(`Config: ${path.join(vault, "digital-brain.config.json")}`);
  console.log(`Default vault saved: ${vault}`);
  console.log(`Refresh script: ${path.join(vault, "Tools", "digital-brain-refresh.sh")}`);
  console.log(`Always-on script: ${path.join(vault, "Tools", "digital-brain-watch.sh")}`);
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

function runRefresh(argv, args) {
  const vault = getVaultFromArgs(argv);
  const config = readVaultConfig(vault);
  const days = String(args.days || args["data-window-days"] || config.dataWindowDays || 30);
  const markdownMode = args["markdown-mode"] || config.sourceMarkdownMode || "none";
  const privacyMode = args["privacy-mode"] || config.privacyMode || "standard";
  const selectedSources = parseList(args.sources || "").length ? parseList(args.sources) : config.selectedSources || ["whatsapp"];
  const syncArgs = ["--vault", vault, "--days", days, "--markdown-mode", markdownMode, "--privacy-mode", privacyMode];
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
    console.log(`  extract relationships: days=${days}`);
    console.log(`  interpret relationship drafts: days=${days}`);
    return;
  }
  const steps = [];
  if (selectedSources.includes("whatsapp")) steps.push(["sync WhatsApp", "sync-whatsapp", "digital_brain_whatsapp_mac_sync.py", syncArgs]);
  if (selectedSources.includes("imessage")) steps.push(["sync iMessage", "sync-imessage", "digital_brain_imessage_sync.py", syncArgs]);
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
    if ((result.status ?? 1) !== 0) process.exit(result.status ?? 1);
  }
  console.log("\nDigital Brain refresh complete.");
}

function runPythonStep(script, argv) {
  return spawnSync("python3", [path.join(root, "scripts", script), ...argv], { stdio: "inherit" });
}

function runNode(script, argv) {
  const result = spawnSync(process.execPath, [path.join(root, script), ...withVault(argv)], { stdio: "inherit" });
  process.exit(result.status ?? 1);
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

function needsResponsibilityGate({ schedule, outboundMode }) {
  return schedule === "always-on" || ["send-with-confirmation", "auto-send"].includes(outboundMode);
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
      out[k] = rest.join("=");
    } else {
      const next = argv[i + 1];
      if (!next || next.startsWith("--")) out[key] = true;
      else out[key] = argv[++i];
    }
  }
  return out;
}

function parseList(value) {
  if (!value) return [];
  return String(value).split(",").map((item) => item.trim()).filter(Boolean);
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

function help() {
  console.log(`Digital Brain

Usage:
  digital-brain init [vault]
  digital-brain run
  digital-brain doctor
  digital-brain tutorial
  digital-brain sync-whatsapp --days 30
  digital-brain sync-imessage --days 30
  digital-brain import-slack --input slack-export.zip
  digital-brain import-linkedin --input linkedin-archive.zip
  digital-brain extract --days 30
  digital-brain interpret --days 30
  digital-brain send-whatsapp --to "Name" --message "Text" [--yes]
  digital-brain auto-whatsapp --allow "Name" --model llama3.1 [--yes] [--no-process-unread]
`);
}

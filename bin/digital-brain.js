#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import readline from "node:readline/promises";
import { fileURLToPath } from "node:url";
import { copyDir, ensureDir, packageRoot, resolveVault } from "../lib/fs.js";

const root = packageRoot(import.meta.url);

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});

async function main() {
  const [command = "help", ...argv] = process.argv.slice(2);
  const args = parseArgs(argv);

  if (command === "init") await init(argv, args);
  else if (command === "doctor") doctor();
  else if (command === "sync-whatsapp") runPython("digital_brain_whatsapp_mac_sync.py", argv);
  else if (command === "extract") runPython("digital_brain_relationship_extractor.py", argv);
  else if (command === "interpret") runPython("digital_brain_relationship_interpreter.py", argv);
  else if (command === "send-whatsapp") runNode("whatsapp-web/send.mjs", argv);
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
  let responsibilityAccepted = fullAuto || schedule === "always-on";

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
      console.log("⚡ Auto mode selected: always-on local refresh, draft-first outbound, AI disclosure guard enabled.");
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
    outboundMode = await select(rl, "WhatsApp outbound mode", [
      ["disabled", "Disabled", "Never prepares WhatsApp sends.", "🔒"],
      ["draft", "Draft only", "Prepares text and requires you to send it.", "✍️"],
      ["send-with-confirmation", "Send with confirmation", "Can send only after explicit command confirmation.", "✅"],
    ], outboundMode);
    connectAi = await confirm(rl, "🔗 Add global AI pointers for Codex/Claude/Gemini?", true);
    responsibilityAccepted = await responsibilityGate(rl, { schedule, outboundMode });
    if (!responsibilityAccepted && (schedule === "always-on" || outboundMode === "send-with-confirmation")) {
      console.log("Full-auto/outbound confirmation was not accepted. Using manual refresh and draft-only outbound.");
      schedule = "manual";
      outboundMode = "draft";
      setupMode = "guided";
    }
    rl.close();
  }

  ensureDir(vault);
  copyDir(path.join(root, "templates", "vault"), vault);
  const config = {
    selfName: selfName || "Me",
    dataWindowDays,
    focus: focus || "relationship-memory",
    schedule,
    refreshIntervalMinutes,
    activeWindow,
    timezone,
    outboundMode,
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
  writeRefreshScript(vault, config);
  writeWatchScript(vault, config);

  if (connectAi) {
    addGlobalPointer(path.join(os.homedir(), ".codex", "AGENTS.md"), vault, "Codex");
    addGlobalPointer(path.join(os.homedir(), ".claude", "CLAUDE.md"), vault, "Claude");
    addGlobalPointer(path.join(os.homedir(), ".gemini", "GEMINI.md"), vault, "Gemini");
  }

  console.log(`Digital Brain vault created: ${vault}`);
  console.log(`Config: ${path.join(vault, "digital-brain.config.json")}`);
  console.log(`Refresh script: ${path.join(vault, "Tools", "digital-brain-refresh.sh")}`);
  console.log(`Always-on script: ${path.join(vault, "Tools", "digital-brain-watch.sh")}`);
  console.log("Next:");
  console.log(`  digital-brain sync-whatsapp --vault "${vault}" --days ${dataWindowDays}`);
  console.log(`  digital-brain extract --vault "${vault}" --days ${dataWindowDays}`);
  console.log(`  digital-brain interpret --vault "${vault}" --days ${dataWindowDays}`);
  if (schedule === "always-on") console.log(`  "${path.join(vault, "Tools", "digital-brain-watch.sh")}"`);
}

function doctor() {
  const checks = [
    ["node", process.version],
    ["python3", shell("python3", ["--version"])],
    ["sqlite3", shell("sqlite3", ["--version"])],
    ["ollama", shell("ollama", ["--version"], true)],
  ];
  for (const [name, value] of checks) {
    console.log(`${name}: ${value || "not found"}`);
  }
  const macDb = path.join(os.homedir(), "Library/Group Containers/group.net.whatsapp.WhatsApp.shared/ChatStorage.sqlite");
  console.log(`WhatsApp Mac DB: ${fs.existsSync(macDb) ? macDb : "not found"}`);
}

function runPython(script, argv) {
  const resolved = withVault(argv);
  const result = spawnSync("python3", [path.join(root, "scripts", script), ...resolved], { stdio: "inherit" });
  process.exit(result.status ?? 1);
}

function runNode(script, argv) {
  const result = spawnSync(process.execPath, [path.join(root, script), ...argv], { stdio: "inherit" });
  process.exit(result.status ?? 1);
}

function withVault(argv) {
  if (argv.includes("--vault") || argv.some((arg) => arg.startsWith("--vault="))) return argv;
  return ["--vault", resolveVault(process.cwd()), ...argv];
}

function writeConfig(vault, config) {
  fs.writeFileSync(path.join(vault, "digital-brain.config.json"), `${JSON.stringify(config, null, 2)}\n`);
}

function writeRefreshScript(vault, config) {
  const toolsDir = path.join(vault, "Tools");
  ensureDir(toolsDir);
  const days = Number(config.dataWindowDays || 30);
  const content = `#!/usr/bin/env bash
set -euo pipefail

VAULT="${vault.replace(/"/g, '\\"')}"
DAYS="${days}"

digital-brain sync-whatsapp --vault "$VAULT" --days "$DAYS" --markdown-mode month
digital-brain extract --vault "$VAULT" --days "$DAYS"
digital-brain interpret --vault "$VAULT" --days "$DAYS"

echo "Digital Brain refresh complete for $VAULT"
`;
  const scriptPath = path.join(toolsDir, "digital-brain-refresh.sh");
  fs.writeFileSync(scriptPath, content);
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
  fs.writeFileSync(scriptPath, content);
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

async function confirm(rl, label, fallback) {
  const hint = fallback ? "Y/n" : "y/N";
  const answer = (await rl.question(`${label} [${hint}]: `)).trim().toLowerCase();
  if (!answer) return fallback;
  return ["y", "yes", "true", "1"].includes(answer);
}

async function responsibilityGate(rl, { schedule, outboundMode }) {
  const needsGate = schedule === "always-on" || outboundMode === "send-with-confirmation";
  if (!needsGate) return true;
  console.log("");
  console.log("⚠️  Responsibility check:");
  console.log("  Digital Brain may use local databases, WhatsApp Web, and black-box third-party app behavior.");
  console.log("  You are responsible for consent, privacy, message content, and any sends triggered from this machine.");
  console.log("  Enter does not approve this mode.");
  return confirm(rl, "I understand and want this mode enabled", false);
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
  digital-brain doctor
  digital-brain sync-whatsapp --vault <path> --days 30
  digital-brain extract --vault <path> --days 30
  digital-brain interpret --vault <path> --days 30
  digital-brain send-whatsapp --vault <path> --to "Name" --message "Text" [--yes]
`);
}

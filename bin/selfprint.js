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
  else if (command === "sync-whatsapp") runPython("selfprint_whatsapp_mac_sync.py", argv);
  else if (command === "extract") runPython("selfprint_relationship_extractor.py", argv);
  else if (command === "interpret") runPython("selfprint_relationship_interpreter.py", argv);
  else if (command === "send-whatsapp") runNode("whatsapp-web/send.mjs", argv);
  else help();
}

async function init(argv, args) {
  const positional = argv.filter((arg) => !arg.startsWith("--"));
  const defaultVault = path.resolve(process.cwd(), "Selfprint Vault");
  let vault = positional[0] ? path.resolve(positional[0]) : args.yes ? defaultVault : "";
  let selfName = args["self-name"] || "";
  let connectAi = toBoolean(args["connect-ai"]);

  if (!args.yes) {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    vault ||= path.resolve(await ask(rl, "Vault path", defaultVault));
    selfName ||= await ask(rl, "Your name", "Me");
    connectAi = /^y/i.test(await ask(rl, "Add global AI pointers for Codex/Claude/Gemini?", "y"));
    rl.close();
  }

  ensureDir(vault);
  copyDir(path.join(root, "templates", "vault"), vault);
  writeConfig(vault, { selfName: selfName || "Me" });

  if (connectAi) {
    addGlobalPointer(path.join(os.homedir(), ".codex", "AGENTS.md"), vault, "Codex");
    addGlobalPointer(path.join(os.homedir(), ".claude", "CLAUDE.md"), vault, "Claude");
    addGlobalPointer(path.join(os.homedir(), ".gemini", "GEMINI.md"), vault, "Gemini");
  }

  console.log(`Selfprint vault created: ${vault}`);
  console.log("Next:");
  console.log(`  selfprint sync-whatsapp --vault "${vault}" --days 30`);
  console.log(`  selfprint extract --vault "${vault}" --days 30`);
  console.log(`  selfprint interpret --vault "${vault}" --days 30`);
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
  fs.writeFileSync(path.join(vault, "selfprint.config.json"), `${JSON.stringify(config, null, 2)}\n`);
}

function addGlobalPointer(file, vault, label) {
  ensureDir(path.dirname(file));
  const block = `

# Selfprint

Selfprint vault:

\`${vault}\`

Use it as local personal context when the user asks about preferences, relationships, communication style, or recurring context. Treat generated relationship notes as provisional.
`;
  const existing = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
  if (!existing.includes(vault)) fs.appendFileSync(file, block);
  console.log(`${label} pointer: ${file}`);
}

async function ask(rl, label, fallback) {
  const answer = await rl.question(`${label} (${fallback}): `);
  return answer.trim() || fallback;
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

function help() {
  console.log(`Selfprint

Usage:
  selfprint init [vault]
  selfprint doctor
  selfprint sync-whatsapp --vault <path> --days 30
  selfprint extract --vault <path> --days 30
  selfprint interpret --vault <path> --days 30
  selfprint send-whatsapp --vault <path> --to "Name" --message "Text" [--yes]
`);
}

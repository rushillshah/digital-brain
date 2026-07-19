#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import readline from "node:readline";
import prompts from "node:readline/promises";
import { fileURLToPath } from "node:url";
import { parseArgs } from "./args.js";
import { resolveVault } from "./fs.js";
import {
  box,
  createTheme,
  layoutWidth,
  padVisible,
  sectionHeader,
  visibleWidth,
} from "./theme.js";
import { askCancelable } from "./prompt.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const bin = path.join(root, "bin", "digital-brain.js");
const theme = createTheme();
const version = readVersion();
const args = parseArgs(process.argv.slice(2));
const importSourceMeta = {
  slack: { label: "Slack", inputArg: "slack-input", hint: "Slack export ZIP/folder" },
  teams: { label: "Teams", inputArg: "teams-input", hint: "Teams export ZIP/folder" },
  linkedin: { label: "LinkedIn", inputArg: "linkedin-input", hint: "LinkedIn archive ZIP/folder" },
  gmail: { label: "Gmail", inputArg: "gmail-input", hint: "Gmail Takeout .mbox/ZIP" },
  calendar: { label: "Calendar", inputArg: "calendar-input", hint: "Calendar .ics/ZIP" },
};
const sourceList = [
  { key: "whatsapp-web", label: "WhatsApp Web", kind: "live", description: "Linked-device sync" },
  { key: "whatsapp", label: "WhatsApp Mac", kind: "live", description: "Local Mac database" },
  { key: "imessage", label: "iMessage", kind: "live", description: "macOS Messages database" },
  { key: "slack", label: "Slack", kind: "import", description: "Official export" },
  { key: "teams", label: "Teams", kind: "import", description: "Graph export" },
  { key: "gmail", label: "Gmail", kind: "import", description: "Takeout" },
  { key: "calendar", label: "Calendar", kind: "import", description: "ICS export" },
  { key: "linkedin", label: "LinkedIn", kind: "import", description: "Data archive" },
  { key: "repos", label: "GitHub/repos", kind: "repo", description: "Local or cloned repos" },
];

if (!process.stdin.isTTY || !process.stdout.isTTY) {
  console.log("Digital Brain UI needs an interactive terminal. Use `digital-brain help` for commands.");
  process.exit(1);
}

const state = {
  selected: 0,
  message: "",
  mode: "main",
};

readline.emitKeypressEvents(process.stdin);
process.stdin.setRawMode(true);
process.stdin.resume();
render();

process.stdin.on("keypress", async (_str, key) => {
  if (state.mode !== "main") return;
  if (key.ctrl && key.name === "c") return exit();
  if (key.name === "q" || key.name === "escape") return exit();
  if (key.name === "up") {
    state.selected = Math.max(0, state.selected - 1);
    return render();
  }
  if (key.name === "down") {
    state.selected = Math.min(menuItems().length - 1, state.selected + 1);
    return render();
  }
  if (key.name === "r") return runCommand(["run", "--vault", vaultPath()]);
  if (key.name === "g") return runCommand(["graph-ai", "--vault", vaultPath()]);
  if (key.name === "d") return runCommand(["doctor"]);
  if (key.name === "return" || key.name === "space") return activate(menuItems()[state.selected]);
});

function render() {
  const snapshot = readSnapshot();
  const items = menuItems(snapshot);
  const width = layoutWidth(process.stdout.columns);
  process.stdout.write("\x1Bc");
  console.log(box(headerLines(snapshot, width), { width, theme }));
  console.log("");
  console.log(sectionHeader("Sources", width, theme));
  console.log("");
  for (const source of sourceList) {
    console.log(`  ${sourceLine(source, snapshot)}`);
  }
  console.log("");
  console.log(sectionHeader("Actions", width, theme));
  console.log("");
  items.forEach((item, index) => {
    const selected = index === state.selected;
    const cursor = selected ? theme.purple("❯") : " ";
    const label = selected ? theme.bold(item.label) : item.label;
    console.log(` ${cursor} ${label}`);
    if (selected && item.detail) console.log(theme.dim(`     ${item.detail}`));
  });
  console.log("");
  if (state.message) console.log(` ${theme.green(state.message)}\n`);
  console.log(theme.dim(" ↑↓ move · ⏎ run · r ingest · g graph estimate · d doctor · q quit"));
}

function headerLines(snapshot, width) {
  const usable = width - 6;
  const title = theme.bold(theme.purple("✻ Digital Brain"));
  const versionLabel = version ? theme.dim(`v${version}`) : "";
  const mode = [
    snapshot.config.setupMode || "guided",
    snapshot.config.schedule || "manual",
    snapshot.config.outboundMode || "draft",
  ].join(" · ");
  const status = snapshot.initialized
    ? theme.green("● ready")
    : theme.dim("○ not initialized");
  return [
    `${padVisible(title, usable - visibleWidth(versionLabel))}${versionLabel}`,
    "",
    `${theme.dim("Vault ")}  ${shortenPath(snapshot.vault)}`,
    `${theme.dim("Status")}  ${status}`,
    `${theme.dim("Mode  ")}  ${mode}`,
  ];
}

function menuItems(snapshot = readSnapshot()) {
  const initialized = snapshot.initialized;
  return [
    {
      label: initialized ? "Reconfigure vault and connectors" : "Create Digital Brain vault",
      detail: initialized ? "Runs guided init against the current vault." : "Creates a vault and asks what to connect.",
      action: () => runCommand(["init", snapshot.vault]),
    },
    {
      label: "Connect or toggle sources",
      detail: "Use arrows to pick a source; imports can save export paths.",
      disabled: !initialized,
      action: () => sourceMenu(),
    },
    {
      label: "Run ingest",
      detail: "Sync/import selected sources, then rebuild relationship memory.",
      disabled: !initialized,
      action: () => runCommand(["run", "--vault", snapshot.vault]),
    },
    {
      label: "Estimate AI graph review",
      detail: "Shows token and cost estimate. No provider call.",
      disabled: !initialized,
      action: () => runCommand(["graph-ai", "--vault", snapshot.vault]),
    },
    {
      label: "Run one-time AI graph review",
      detail: "Requires a provider API key and confirmation inside the command.",
      disabled: !initialized,
      action: () => runCommand(["graph-ai", "--vault", snapshot.vault, "--yes"]),
    },
    {
      label: "Start WhatsApp auto-reply",
      detail: "WhatsApp is the only live auto-reply loop right now.",
      disabled: !initialized,
      action: () => runCommand(["auto-whatsapp", "--vault", snapshot.vault]),
    },
    {
      label: "Send a draft/test message",
      detail: "Choose WhatsApp, Slack, Teams, or iMessage. Drafts by default.",
      disabled: !initialized,
      action: () => sendMenu(),
    },
    {
      label: "Open vault folder",
      detail: "Opens the vault in Finder or the platform file browser.",
      disabled: !initialized,
      action: () => openVault(snapshot.vault),
    },
    {
      label: "Doctor / setup check",
      detail: "Checks local requirements and selected source setup.",
      action: () => runCommand(["doctor"]),
    },
    {
      label: "Show command help",
      detail: "Prints scriptable CLI commands.",
      action: () => runCommand(["help"]),
    },
  ].filter((item) => !item.disabled);
}

async function activate(item) {
  if (!item) return;
  await item.action();
}

async function sourceMenu() {
  const snapshot = readSnapshot();
  const items = sourceList.map((source) => ({
    label: `${isSelected(source.key, snapshot) ? "Enabled" : "Disabled"} - ${source.label}`,
    detail: source.description,
    source,
  }));
  const picked = await pick("Connect sources", items);
  if (!picked) return render();
  const config = readConfig(snapshot.vault);
  config.selectedSources = Array.from(new Set(config.selectedSources || []));
  if (isSelected(picked.source.key, snapshot)) {
    config.selectedSources = config.selectedSources.filter((source) => source !== picked.source.key);
    writeConfig(snapshot.vault, config);
    state.message = `${picked.source.label} disabled.`;
    return render();
  }
  config.selectedSources.push(picked.source.key);
  if (picked.source.kind === "import") {
    const input = await askText(`${importSourceMeta[picked.source.key].hint}: `);
    if (input.trim()) {
      config.sourceInputs ||= {};
      config.sourceInputs[picked.source.key] = input.split(",").map((item) => item.trim()).filter(Boolean);
    }
  }
  writeConfig(snapshot.vault, config);
  state.message = `${picked.source.label} enabled.`;
  render();
}

async function sendMenu() {
  const picked = await pick("Send draft/test message", [
    { label: "WhatsApp", detail: "Finds chat by name/contact. Draft unless --yes is used.", command: "send-whatsapp" },
    { label: "Slack", detail: "Needs channel ID. Sends only with --yes and SLACK_BOT_TOKEN.", command: "send-slack" },
    { label: "Teams", detail: "Needs chat ID. Sends only with --yes and Microsoft Graph token.", command: "send-teams" },
    { label: "iMessage", detail: "Needs macOS Messages recipient. Sends only with --yes.", command: "send-imessage" },
  ]);
  if (!picked) return render();
  const snapshot = readSnapshot();
  const message = await askText("Message text: ");
  if (!message.trim()) {
    state.message = "Message cancelled.";
    return render();
  }
  if (picked.command === "send-whatsapp") {
    const to = await askText("WhatsApp chat/contact: ");
    if (to.trim()) return runCommand([picked.command, "--vault", snapshot.vault, "--to", to.trim(), "--message", message]);
  }
  if (picked.command === "send-slack") {
    const channel = await askText("Slack channel ID: ");
    if (channel.trim()) return runCommand([picked.command, "--vault", snapshot.vault, "--channel", channel.trim(), "--message", message]);
  }
  if (picked.command === "send-teams") {
    const chat = await askText("Teams chat ID: ");
    if (chat.trim()) return runCommand([picked.command, "--vault", snapshot.vault, "--chat", chat.trim(), "--message", message]);
  }
  if (picked.command === "send-imessage") {
    const to = await askText("iMessage recipient: ");
    if (to.trim()) return runCommand([picked.command, "--vault", snapshot.vault, "--to", to.trim(), "--message", message]);
  }
  state.message = "Send cancelled.";
  render();
}

async function pick(title, items) {
  let selected = 0;
  state.mode = "picker";
  while (true) {
    process.stdout.write("\x1Bc");
    console.log(sectionHeader(title, layoutWidth(process.stdout.columns), theme));
    console.log("");
    items.forEach((item, index) => {
      const active = index === selected;
      const cursor = active ? theme.purple("❯") : " ";
      const label = active ? theme.bold(item.label) : item.label;
      console.log(` ${cursor} ${label}`);
      if (active && item.detail) console.log(theme.dim(`     ${item.detail}`));
    });
    console.log("");
    console.log(theme.dim(" ↑↓ move · ⏎ choose · ←/esc back"));
    const key = await readKey();
    if (key.name === "escape" || key.name === "q" || key.name === "left") {
      state.mode = "main";
      return null;
    }
    if (key.name === "up") selected = Math.max(0, selected - 1);
    if (key.name === "down") selected = Math.min(items.length - 1, selected + 1);
    if (key.name === "return" || key.name === "space") {
      state.mode = "main";
      return items[selected];
    }
  }
}

function readKey() {
  return new Promise((resolve) => {
    process.stdin.once("keypress", (_str, key) => resolve(key));
  });
}

async function askText(question) {
  state.mode = "prompt";
  process.stdin.setRawMode(false);
  const rl = prompts.createInterface({ input: process.stdin, output: process.stdout });
  const result = await askCancelable(rl, question);
  rl.close();
  process.stdin.setRawMode(true);
  state.mode = "main";
  return result.cancelled ? "" : result.value.trim();
}

async function runCommand(argv) {
  state.mode = "command";
  process.stdin.setRawMode(false);
  process.stdout.write("\x1Bc");
  console.log(theme.purple(`$ digital-brain ${argv.join(" ")}`));
  console.log("");
  spawnSync(process.execPath, [bin, ...argv], { stdio: "inherit" });
  console.log("");
  const rl = prompts.createInterface({ input: process.stdin, output: process.stdout });
  await rl.question(theme.dim("Press Enter to return to Digital Brain..."));
  rl.close();
  process.stdin.setRawMode(true);
  state.mode = "main";
  state.message = "";
  render();
}

function openVault(vault) {
  const command = process.platform === "darwin" ? "open" : process.platform === "win32" ? "explorer" : "xdg-open";
  spawnSync(command, [vault], { stdio: "ignore" });
  state.message = `Opened ${vault}`;
  render();
}

function readSnapshot() {
  const vault = vaultPath();
  const config = readConfig(vault);
  return {
    vault,
    initialized: fs.existsSync(path.join(vault, "digital-brain.config.json")),
    config,
  };
}

function vaultPath() {
  if (args.vault) return path.resolve(String(args.vault));
  const resolved = resolveVault(process.cwd());
  if (fs.existsSync(path.join(resolved, "digital-brain.config.json"))) return resolved;
  const localDefault = path.resolve(process.cwd(), "Digital Brain Vault");
  if (fs.existsSync(path.join(localDefault, "digital-brain.config.json"))) return localDefault;
  return localDefault;
}

function sourceLine(source, snapshot) {
  const selected = isSelected(source.key, snapshot);
  const dot = selected ? theme.green("●") : theme.dim("○");
  const status = sourceStatus(source, snapshot);
  const text = `${source.label.padEnd(14)}${status.padEnd(22)}${source.description}`;
  return `${dot} ${selected ? text : theme.dim(text)}`;
}

function isSelected(source, snapshot) {
  return (snapshot.config.selectedSources || []).includes(source);
}

function sourceStatus(source, snapshot) {
  if (!snapshot.initialized) return "not configured";
  if (!isSelected(source.key, snapshot)) return "off";
  if (source.key === "whatsapp") return fs.existsSync(path.join(os.homedir(), "Library/Group Containers/group.net.whatsapp.WhatsApp.shared/ChatStorage.sqlite")) ? "db found" : "needs app access";
  if (source.key === "imessage") return fs.existsSync(path.join(os.homedir(), "Library/Messages/chat.db")) ? "db found" : "needs app access";
  if (source.key === "whatsapp-web") return "scan QR on run";
  if (source.key === "repos") return `${(snapshot.config.repoPaths || []).length} path(s)`;
  if (importSourceMeta[source.key]) return `${(snapshot.config.sourceInputs?.[source.key] || []).length} input(s)`;
  return "configured";
}

function readConfig(vault) {
  const file = path.join(vault, "digital-brain.config.json");
  if (!fs.existsSync(file)) return {};
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return {};
  }
}

function writeConfig(vault, config) {
  fs.mkdirSync(vault, { recursive: true });
  const file = path.join(vault, "digital-brain.config.json");
  fs.writeFileSync(file, `${JSON.stringify(config, null, 2)}\n`);
  if (process.platform !== "win32") {
    try {
      fs.chmodSync(file, 0o600);
    } catch {
      // Some filesystems (exFAT/NTFS mounts) do not support chmod; the
      // config is already written, so a failed permission tighten is non-fatal.
    }
  }
}

function readVersion() {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
    return typeof pkg.version === "string" ? pkg.version : "";
  } catch {
    return "";
  }
}

function shortenPath(target) {
  const home = os.homedir();
  return target.startsWith(home) ? `~${target.slice(home.length)}` : target;
}

function exit() {
  process.stdin.setRawMode(false);
  process.stdout.write("\x1Bc");
  process.exit(0);
}

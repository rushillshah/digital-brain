const state = {
  vaultPath: localStorage.getItem("digitalBrain.vaultPath") || "",
  config: null,
};

const views = {
  overview: ["Overview", "Your life, work, and relationships as a local Obsidian graph."],
  onboarding: ["Onboarding", "Create or connect a vault without memorizing terminal flags."],
  integrations: ["Integrations", "Connect sources now, or add them later as your context grows."],
  automation: ["Automation", "Run refreshes, open the vault, and check setup health."],
  logs: ["Logs", "Watch local command output without leaving the app."],
};

const integrations = [
  ["whatsapp", "WhatsApp", "Live local sync from WhatsApp for Mac database, plus optional Web outbound.", "Local database", "ready"],
  ["whatsapp-web", "WhatsApp Desktop/Web", "Cross-platform sync through a linked WhatsApp Web/Desktop session.", "Linked device", "ready"],
  ["imessage", "iMessage", "Local macOS Messages import for personal message context.", "macOS only", "ready"],
  ["slack", "Slack", "Import official Slack workspace exports into work and people context.", "Export", "manual"],
  ["teams", "Microsoft Teams", "Import Teams message exports and draft/send through Microsoft Graph.", "Export/API", "manual"],
  ["linkedin", "LinkedIn", "Import official LinkedIn archives for connections and messages.", "Export", "manual"],
  ["gmail", "Gmail", "Import Gmail Takeout .mbox files into email memory and open loops.", "Takeout", "manual"],
  ["calendar", "Google Calendar", "Import .ics exports for schedule rhythm and recurring people.", "Takeout", "manual"],
  ["repos", "GitHub/repos", "Index README, manifests, remotes, and recent commits for project context.", "Local/GitHub CLI", "ready"],
  ["obsidian", "Obsidian", "Open the generated vault directly in Obsidian for graph and notes.", "Vault", "ready"],
  ["providers", "AI providers", "Use Ollama, OpenAI, Anthropic, xAI, Codex CLI, or Codex app bridge.", "Optional", "manual"],
];

const $ = (id) => document.getElementById(id);

document.querySelectorAll(".nav-item").forEach((button) => {
  button.addEventListener("click", () => setView(button.dataset.view));
});

$("startOnboardingBtn").addEventListener("click", () => setView("onboarding"));
$("chooseVaultBtn").addEventListener("click", chooseVault);
$("openVaultBtn").addEventListener("click", () => window.digitalBrain.openVault(state.vaultPath));
$("openObsidianBtn").addEventListener("click", () => window.digitalBrain.openObsidian(state.vaultPath));
$("doctorBtn").addEventListener("click", () => runCommand("doctor", []));
$("doctorBtn2").addEventListener("click", () => runCommand("doctor", []));
$("runRefreshBtn").addEventListener("click", () => runCommand("run", []));
$("runRefreshBtn2").addEventListener("click", () => runCommand("run", []));
$("clearLogsBtn").addEventListener("click", () => {
  $("logOutput").textContent = "Ready.";
});
$("initBtn").addEventListener("click", initVault);

window.digitalBrain.onCliOutput((value) => appendLog(value));

renderIntegrations();
refreshVaultState();

function setView(view) {
  document.querySelectorAll(".nav-item").forEach((item) => item.classList.toggle("active", item.dataset.view === view));
  document.querySelectorAll(".view").forEach((item) => item.classList.toggle("active", item.id === view));
  $("viewTitle").textContent = views[view][0];
  $("viewSubtitle").textContent = views[view][1];
}

async function chooseVault() {
  const vaultPath = await window.digitalBrain.chooseVault();
  if (!vaultPath) return;
  state.vaultPath = vaultPath;
  localStorage.setItem("digitalBrain.vaultPath", vaultPath);
  await refreshVaultState();
}

async function refreshVaultState() {
  $("vaultName").textContent = state.vaultPath ? basename(state.vaultPath) : "Not selected";
  if (!state.vaultPath) {
    updateConfigSummary(null, "Waiting");
    return;
  }
  const result = await window.digitalBrain.readConfig(state.vaultPath);
  if (!result.ok) {
    updateConfigSummary(null, "No config");
    appendLog(`${result.error}\n`);
    return;
  }
  state.config = result.config;
  updateConfigSummary(result.config, "Ready");
}

async function initVault() {
  if (!state.vaultPath) {
    const selected = await window.digitalBrain.chooseVault();
    if (!selected) return;
    state.vaultPath = selected;
    localStorage.setItem("digitalBrain.vaultPath", selected);
  }
  const selectedSources = selectedIntegrationIds().filter((id) => !["obsidian", "providers"].includes(id));
  const args = [
    state.vaultPath,
    "--yes",
    "--connect-ai=false",
    "--responsibility-accepted=true",
    "--self-name", $("selfNameInput").value || "Me",
    "--data-window-days", $("historySelect").value,
    "--focus", $("focusSelect").value,
    "--schedule", $("scheduleSelect").value,
    "--outbound-mode", $("outboundSelect").value,
    "--auto-reply-provider", $("providerSelect").value,
    "--sources", selectedSources.length ? selectedSources.join(",") : "whatsapp",
  ];
  await runCommand("init", args, { withVault: false });
  await refreshVaultState();
}

async function runCommand(command, args, options = {}) {
  setView("logs");
  appendLog(`\n$ digital-brain ${command} ${args.join(" ")}\n`);
  const result = await window.digitalBrain.runCli({
    command,
    args,
    vaultPath: options.withVault === false ? "" : state.vaultPath,
  });
  if (!result.ok) appendLog(`\nCommand failed with code ${result.code}\n${result.stderr || ""}\n`);
  else appendLog("\nDone.\n");
  return result;
}

function updateConfigSummary(config, status) {
  $("vaultStatus").textContent = status;
  $("sourceCount").textContent = config?.selectedSources?.length ? `${config.selectedSources.length} selected` : "0 selected";
  $("outboundMode").textContent = config?.outboundMode || "Not configured";
  $("provider").textContent = config?.autoReplyProvider || "Not configured";
}

function renderIntegrations() {
  const grid = $("integrationGrid");
  grid.innerHTML = "";
  for (const [id, title, description, tag, status] of integrations) {
    const card = document.createElement("article");
    card.className = "integration-card";
    card.innerHTML = `
      <header>
        <h3>${title}</h3>
        <span class="pill ${status}">${tag}</span>
      </header>
      <p>${description}</p>
      <label class="field">
        <span>Include in setup</span>
        <select data-integration="${id}">
          <option value="yes"${defaultEnabled(id) ? " selected" : ""}>Yes</option>
          <option value="later"${defaultEnabled(id) ? "" : " selected"}>Later</option>
        </select>
      </label>
    `;
    grid.appendChild(card);
  }
}

function selectedIntegrationIds() {
  return [...document.querySelectorAll("[data-integration]")]
    .filter((select) => select.value === "yes")
    .map((select) => select.dataset.integration);
}

function defaultEnabled(id) {
  return ["whatsapp", "imessage", "obsidian"].includes(id);
}

function appendLog(value) {
  const output = $("logOutput");
  output.textContent += value;
  output.scrollTop = output.scrollHeight;
}

function basename(value) {
  return String(value || "").split(/[\\/]/).filter(Boolean).at(-1) || value;
}

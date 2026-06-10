import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export function telemetryConfigPath() {
  return path.join(os.homedir(), ".digital-brain", "telemetry.json");
}

export function readTelemetryPreference(vaultConfig = {}) {
  if (typeof vaultConfig.telemetryEnabled === "boolean") return vaultConfig.telemetryEnabled;
  try {
    const file = telemetryConfigPath();
    if (!fs.existsSync(file)) return false;
    return Boolean(JSON.parse(fs.readFileSync(file, "utf8")).enabled);
  } catch {
    return false;
  }
}

export function writeTelemetryPreference(enabled) {
  const file = telemetryConfigPath();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const existing = fs.existsSync(file) ? safeJson(file) : {};
  const next = {
    schemaVersion: 1,
    installId: existing.installId || crypto.randomUUID(),
    enabled: Boolean(enabled),
    updatedAt: new Date().toISOString(),
  };
  writeFileAtomic(file, `${JSON.stringify(next, null, 2)}\n`);
  return next;
}

export async function emitTelemetry(eventName, payload = {}, options = {}) {
  const enabled = options.enabled ?? readTelemetryPreference(options.vaultConfig || {});
  if (!enabled) return;
  const prefs = safeJson(telemetryConfigPath());
  const endpoint = options.endpoint || process.env.DIGITAL_BRAIN_TELEMETRY_URL || "";
  const event = sanitizeEvent({
    event: eventName,
    installId: prefs.installId || "unknown",
    version: packageVersion(),
    platform: process.platform,
    arch: process.arch,
    node: process.version,
    timestamp: new Date().toISOString(),
    ...payload,
  });
  appendLocalEvent(event);
  if (!endpoint) return;
  if (process.env.DIGITAL_BRAIN_TELEMETRY_OFFLINE === "1") return;
  try {
    await fetch(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(event),
      signal: AbortSignal.timeout(1500),
    });
  } catch {
    // Telemetry must never break user workflows.
  }
}

function sanitizeEvent(event) {
  const allowed = {};
  for (const [key, value] of Object.entries(event)) {
    if (value === undefined || value === null) continue;
    if (Array.isArray(value)) {
      allowed[key] = value.map((item) => String(item).slice(0, 80));
    } else if (typeof value === "object") {
      allowed[key] = Object.fromEntries(Object.entries(value).map(([k, v]) => [k, String(v).slice(0, 120)]));
    } else {
      allowed[key] = String(value).slice(0, 160);
    }
  }
  delete allowed.vault;
  delete allowed.vaultPath;
  delete allowed.message;
  delete allowed.body;
  delete allowed.chatName;
  delete allowed.name;
  delete allowed.apiKey;
  return allowed;
}

function appendLocalEvent(event) {
  const file = path.join(os.homedir(), ".digital-brain", "telemetry-events.jsonl");
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(file, `${JSON.stringify(event)}\n`);
}

function packageVersion() {
  try {
    const pkg = JSON.parse(fs.readFileSync(new URL("../package.json", import.meta.url), "utf8"));
    return pkg.version || "unknown";
  } catch {
    return "unknown";
  }
}

function safeJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return {};
  }
}

function writeFileAtomic(file, content) {
  const temp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temp, content);
  fs.renameSync(temp, file);
}

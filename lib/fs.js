import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

export function packageRoot(metaUrl) {
  return path.resolve(path.dirname(fileURLToPath(metaUrl)), "..");
}

export function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

export function copyDir(source, target) {
  ensureDir(target);
  for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
    const from = path.join(source, entry.name);
    const to = path.join(target, entry.name);
    if (entry.isDirectory()) copyDir(from, to);
    else if (!fs.existsSync(to)) fs.copyFileSync(from, to);
  }
}

export function resolveVault(cwd) {
  let current = path.resolve(cwd);
  while (true) {
    if (fs.existsSync(path.join(current, "digital-brain.config.json"))) return current;
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  const configured = readDefaultVault();
  if (configured) return configured;
  return path.resolve(cwd);
}

export function globalConfigPath() {
  return path.join(os.homedir(), ".digital-brain", "config.json");
}

export function readDefaultVault() {
  const file = globalConfigPath();
  if (!fs.existsSync(file)) return "";
  try {
    const config = JSON.parse(fs.readFileSync(file, "utf8"));
    if (config.defaultVault && fs.existsSync(path.join(config.defaultVault, "digital-brain.config.json"))) {
      return config.defaultVault;
    }
  } catch {
    return "";
  }
  return "";
}

export function writeDefaultVault(vault) {
  const file = globalConfigPath();
  ensureDir(path.dirname(file));
  fs.writeFileSync(file, `${JSON.stringify({ defaultVault: vault }, null, 2)}\n`);
}

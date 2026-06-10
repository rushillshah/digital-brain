import { app, BrowserWindow, dialog, ipcMain, shell } from "electron";
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const cliPath = path.join(repoRoot, "bin", "digital-brain.js");

let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1240,
    height: 820,
    minWidth: 1040,
    minHeight: 700,
    title: "Digital Brain",
    backgroundColor: "#171717",
    titleBarStyle: "hiddenInset",
    trafficLightPosition: { x: 16, y: 18 },
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  mainWindow.loadFile(path.join(__dirname, "renderer", "index.html"));
}

app.whenReady().then(() => {
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

ipcMain.handle("vault:choose", async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: "Choose Digital Brain vault",
    properties: ["openDirectory", "createDirectory"],
  });
  if (result.canceled || !result.filePaths[0]) return null;
  return result.filePaths[0];
});

ipcMain.handle("vault:read-config", async (_event, vaultPath) => {
  return readVaultConfig(vaultPath);
});

ipcMain.handle("vault:open", async (_event, vaultPath) => {
  if (!vaultPath) return { ok: false, error: "Choose a vault first." };
  await shell.openPath(vaultPath);
  return { ok: true };
});

ipcMain.handle("obsidian:open", async (_event, vaultPath) => {
  if (!vaultPath) return { ok: false, error: "Choose a vault first." };
  await shell.openExternal(`obsidian://open?path=${encodeURIComponent(vaultPath)}`);
  return { ok: true };
});

ipcMain.handle("cli:run", async (_event, payload) => {
  return runCli(payload.command, payload.args || [], payload.vaultPath || "");
});

function readVaultConfig(vaultPath) {
  if (!vaultPath) return { ok: false, error: "No vault selected." };
  const configPath = path.join(vaultPath, "digital-brain.config.json");
  if (!fs.existsSync(configPath)) return { ok: false, error: "No digital-brain.config.json found in this folder." };
  try {
    return { ok: true, config: JSON.parse(fs.readFileSync(configPath, "utf8")) };
  } catch (error) {
    return { ok: false, error: error.message };
  }
}

function runCli(command, args, vaultPath) {
  return new Promise((resolve) => {
    const finalArgs = [cliPath, command, ...args];
    if (vaultPath && !args.includes("--vault")) finalArgs.push("--vault", vaultPath);
    const child = spawn(process.execPath, finalArgs, {
      cwd: repoRoot,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
      mainWindow?.webContents.send("cli:output", chunk.toString());
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
      mainWindow?.webContents.send("cli:output", chunk.toString());
    });
    child.on("close", (code) => {
      resolve({ ok: code === 0, code, stdout, stderr });
    });
    child.on("error", (error) => {
      resolve({ ok: false, code: 1, stdout, stderr: error.message });
    });
  });
}

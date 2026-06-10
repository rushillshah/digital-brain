#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const OUT_DIR = process.argv[2] || "docs/assets";
const CDP_URL = process.env.OBSIDIAN_CDP_URL || "http://127.0.0.1:9222/json/list";

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function getTarget() {
  const targets = await fetch(CDP_URL).then((res) => res.json());
  const target = targets.find((item) => item.type === "page" && item.url === "app://obsidian.md/index.html");
  if (!target?.webSocketDebuggerUrl) {
    throw new Error("Obsidian DevTools page target was not found.");
  }
  return target.webSocketDebuggerUrl;
}

function connect(wsUrl) {
  const ws = new WebSocket(wsUrl);
  let nextId = 1;
  const pending = new Map();

  ws.onmessage = (event) => {
    const message = JSON.parse(event.data);
    if (!message.id || !pending.has(message.id)) return;
    const { resolve, reject } = pending.get(message.id);
    pending.delete(message.id);
    if (message.error) reject(new Error(message.error.message));
    else resolve(message.result);
  };

  return new Promise((resolve, reject) => {
    ws.onerror = () => reject(new Error("Could not connect to Obsidian DevTools."));
    ws.onopen = () => {
      resolve({
        send(method, params = {}) {
          const id = nextId++;
          ws.send(JSON.stringify({ id, method, params }));
          return new Promise((resolveCommand, rejectCommand) => {
            pending.set(id, { resolve: resolveCommand, reject: rejectCommand });
          });
        },
        close() {
          ws.close();
        },
      });
    };
  });
}

async function openNote(client, notePath) {
  const expression = `
    (async () => {
      const leaf = app.workspace.getLeaf(false);
      await leaf.openFile(app.vault.getAbstractFileByPath(${JSON.stringify(notePath)}), { active: true });
      await leaf.setViewState({ type: "markdown", state: { file: ${JSON.stringify(notePath)}, mode: "preview" } });
      return document.title;
    })()
  `;
  await client.send("Runtime.evaluate", { expression, awaitPromise: true });
  await wait(900);
}

async function capture(client, filename) {
  const result = await client.send("Page.captureScreenshot", {
    format: "png",
    fromSurface: true,
    captureBeyondViewport: false,
  });
  fs.writeFileSync(path.join(OUT_DIR, filename), Buffer.from(result.data, "base64"));
}

async function openGraphView(client) {
  const expression = `
    (async () => {
      app.commands.executeCommandById("graph:open");
      return document.title;
    })()
  `;
  await client.send("Runtime.evaluate", { expression, awaitPromise: true });
  await wait(1800);
}

fs.mkdirSync(OUT_DIR, { recursive: true });

const wsUrl = await getTarget();
const client = await connect(wsUrl);

try {
  await client.send("Page.enable");
  await client.send("Runtime.enable");

  const windowInfo = await client.send("Browser.getWindowForTarget").catch(() => null);
  if (windowInfo?.windowId) {
    await client.send("Browser.setWindowBounds", {
      windowId: windowInfo.windowId,
      bounds: { width: 1512, height: 900 },
    }).catch(() => {});
  }
  await wait(500);

  const captures = [
    ["00 Home/Demo Overview.md", "obsidian-overview.png"],
    ["06 AI Memory/Person Reply Context.md", "obsidian-person-context.png"],
    ["06 AI Memory/Life Context Graph.md", "obsidian-life-graph.png"],
    ["06 AI Memory/Conversation Continuity.md", "obsidian-context.png"],
  ];

  for (const [notePath, filename] of captures) {
    await openNote(client, notePath);
    await capture(client, filename);
    console.log(`Captured ${filename}`);
  }

  await openGraphView(client);
  await capture(client, "obsidian-graph-mode.png");
  console.log("Captured obsidian-graph-mode.png");
} finally {
  client.close();
}

#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const demoDir = path.join(repo, "demo-assets");
const assetsDir = path.join(repo, "docs", "assets");
fs.mkdirSync(assetsDir, { recursive: true });

const terminal = fs.readFileSync(path.join(demoDir, "terminal-demo.txt"), "utf8");
const personContext = fs.readFileSync(path.join(demoDir, "sample-vault", "06 AI Memory", "Person Reply Context.md"), "utf8");
const relationship = fs.readFileSync(path.join(demoDir, "sample-vault", "08 Sources", "Analysis", "Interpreted", "Mom (WhatsApp).md"), "utf8");

writeHtml("demo-overview.html", fs.readFileSync(path.join(demoDir, "screenshot-cards.html"), "utf8"));
writeHtml("terminal-demo.html", page("Terminal flow", "Install, initialize, and generate local memory.", `<pre>${escapeHtml(terminal)}</pre>`));
writeHtml("person-context.html", page("Person reply context", "Fake-data Obsidian memory generated for AI assistants.", markdownPanel(personContext)));
writeHtml("relationship-evidence.html", page("Relationship evidence", "Generated working notes with role, tone, and reply guidance.", markdownPanel(relationship)));
writeHtml("life-graph.html", graphPage());

render("demo-overview.html", "demo-overview.png");
render("terminal-demo.html", "terminal-demo.png");
render("person-context.html", "person-context.png");
render("relationship-evidence.html", "relationship-evidence.png");
render("life-graph.html", "life-graph.png");
makeGif();

console.log(`Rendered demo assets in ${assetsDir}`);

function writeHtml(name, content) {
  fs.writeFileSync(path.join(assetsDir, name), content);
}

function page(title, subtitle, body) {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)}</title>
  ${style()}
</head>
<body>
  <main>
    <section class="hero">
      <div>
        <div class="eyebrow">Digital Brain</div>
        <h1>${escapeHtml(title)}</h1>
        <p>${escapeHtml(subtitle)}</p>
      </div>
      <div class="pill">local-first</div>
    </section>
    ${body}
  </main>
</body>
</html>`;
}

function markdownPanel(markdown) {
  const lines = markdown.split("\n").slice(0, 54);
  let html = `<section class="panel markdown">`;
  for (const line of lines) {
    if (line.startsWith("# ")) html += `<h2>${escapeHtml(line.slice(2))}</h2>`;
    else if (line.startsWith("## ")) html += `<h3>${escapeHtml(line.slice(3))}</h3>`;
    else if (line.startsWith("- ")) html += `<div class="row">${inlineCode(escapeHtml(line))}</div>`;
    else if (line.trim()) html += `<p>${inlineCode(escapeHtml(line))}</p>`;
  }
  html += `</section>`;
  return html;
}

function graphPage() {
  const nodes = [
    ["You", 590, 320, "core"],
    ["WhatsApp", 300, 180, "source"],
    ["iMessage", 330, 470, "source"],
    ["Slack", 610, 120, "source"],
    ["Gmail", 840, 210, "source"],
    ["GitHub", 860, 470, "source"],
    ["Calendar", 590, 590, "source"],
    ["People", 170, 330, "memory"],
    ["Projects", 1010, 340, "memory"],
  ];
  const edges = [
    ["You", "WhatsApp"], ["You", "iMessage"], ["You", "Slack"], ["You", "Gmail"], ["You", "GitHub"], ["You", "Calendar"],
    ["WhatsApp", "People"], ["iMessage", "People"], ["Slack", "Projects"], ["Gmail", "People"], ["GitHub", "Projects"], ["Calendar", "People"],
  ];
  const byName = Object.fromEntries(nodes.map(([name, x, y]) => [name, { x, y }]));
  const edgeSvg = edges.map(([from, to]) => {
    const a = byName[from];
    const b = byName[to];
    return `<line x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}" />`;
  }).join("");
  const nodeSvg = nodes.map(([name, x, y, kind]) => `<g class="node ${kind}" transform="translate(${x} ${y})"><circle r="${kind === "core" ? 72 : 54}"></circle><text>${escapeHtml(name)}</text></g>`).join("");
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Digital Brain graph</title>
  ${style()}
</head>
<body>
  <main>
    <section class="hero">
      <div>
        <div class="eyebrow">Digital Brain</div>
        <h1>Your life context graph</h1>
        <p>People, projects, emails, calendars, messages, and repos become local context you can query.</p>
      </div>
      <div class="pill">fake data</div>
    </section>
    <section class="panel graph">
      <svg viewBox="0 0 1180 700" role="img" aria-label="Digital Brain local context graph">
        <g class="edges">${edgeSvg}</g>
        ${nodeSvg}
      </svg>
    </section>
  </main>
</body>
</html>`;
}

function style() {
  return `<style>
    :root {
      color-scheme: dark;
      font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      background: #101418;
      color: #f6f3ec;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      min-height: 100vh;
      padding: 42px;
      background:
        radial-gradient(circle at 18% 12%, rgba(115, 224, 169, .16), transparent 25%),
        radial-gradient(circle at 80% 18%, rgba(87, 155, 255, .16), transparent 24%),
        linear-gradient(135deg, #101418 0%, #17211f 55%, #151515 100%);
    }
    main { max-width: 1180px; margin: 0 auto; display: grid; gap: 24px; }
    .hero { display: flex; align-items: end; justify-content: space-between; gap: 28px; }
    .eyebrow { color: #73e0a9; font-size: 13px; text-transform: uppercase; letter-spacing: .1em; margin-bottom: 12px; }
    h1 { font-size: 48px; line-height: 1.04; margin: 0 0 12px; letter-spacing: 0; }
    h2 { font-size: 30px; margin: 0 0 18px; }
    h3 { font-size: 18px; margin: 18px 0 8px; color: #73e0a9; }
    p { color: #cfc8bb; font-size: 18px; line-height: 1.5; margin: 0 0 10px; }
    .pill { border: 1px solid rgba(255,255,255,.18); border-radius: 999px; padding: 10px 14px; color: #d9ffe9; background: rgba(0,0,0,.18); white-space: nowrap; }
    .panel { border: 1px solid rgba(255,255,255,.14); background: rgba(255,255,255,.06); border-radius: 8px; padding: 24px; box-shadow: 0 18px 50px rgba(0,0,0,.3); }
    pre { margin: 0; white-space: pre-wrap; font: 20px/1.55 "SFMono-Regular", ui-monospace, Menlo, monospace; color: #d9ffe9; }
    .markdown { columns: 2; column-gap: 26px; min-height: 580px; }
    .markdown h2, .markdown h3 { break-after: avoid; }
    .row { color: #eee8dd; font-size: 16px; line-height: 1.45; margin: 5px 0; break-inside: avoid; }
    code { color: #9bd8ff; background: rgba(0,0,0,.24); border-radius: 5px; padding: 1px 5px; }
    .graph { padding: 6px; }
    svg { width: 100%; height: 680px; display: block; }
    .edges line { stroke: rgba(255,255,255,.22); stroke-width: 2.5; }
    .node circle { fill: rgba(255,255,255,.08); stroke: rgba(255,255,255,.2); stroke-width: 2; }
    .node.source circle { fill: rgba(80, 160, 255, .16); }
    .node.memory circle { fill: rgba(115, 224, 169, .16); }
    .node.core circle { fill: rgba(255,255,255,.13); stroke: #73e0a9; stroke-width: 3; }
    .node text { fill: #f6f3ec; font-size: 18px; font-weight: 700; text-anchor: middle; dominant-baseline: central; }
  </style>`;
}

function render(htmlName, pngName) {
  const chrome = chromeBinary();
  const htmlPath = path.join(assetsDir, htmlName);
  const pngPath = path.join(assetsDir, pngName);
  const result = spawnSync(chrome, [
    "--headless",
    "--disable-gpu",
    "--hide-scrollbars",
    "--window-size=1400,900",
    `--screenshot=${pngPath}`,
    `file://${htmlPath}`,
  ], { encoding: "utf8" });
  if ((result.status ?? 1) !== 0) {
    throw new Error(`Chrome screenshot failed for ${htmlName}: ${result.stderr || result.stdout}`);
  }
}

function chromeBinary() {
  const candidates = [
    process.env.CHROME_BIN,
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    "/usr/local/bin/google-chrome",
    "/opt/homebrew/bin/chromium",
  ].filter(Boolean);
  const found = candidates.find((candidate) => fs.existsSync(candidate));
  if (!found) throw new Error("No Chrome/Chromium binary found for rendering screenshots.");
  return found;
}

function makeGif() {
  const frames = ["demo-overview.png", "life-graph.png", "person-context.png", "terminal-demo.png"];
  const frameDir = path.join(assetsDir, "gif-frames");
  fs.mkdirSync(frameDir, { recursive: true });
  frames.forEach((frame, index) => fs.copyFileSync(path.join(assetsDir, frame), path.join(frameDir, `frame-${String(index + 1).padStart(2, "0")}.png`)));
  const result = spawnSync("ffmpeg", [
    "-y",
    "-framerate", "0.65",
    "-i", path.join(frameDir, "frame-%02d.png"),
    "-vf", "scale=980:-1:flags=lanczos,fps=8",
    path.join(assetsDir, "digital-brain-demo.gif"),
  ], { encoding: "utf8" });
  if ((result.status ?? 1) !== 0) {
    throw new Error(`GIF render failed: ${result.stderr || result.stdout}`);
  }
}

function escapeHtml(value) {
  return String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}

function inlineCode(value) {
  return value.replace(/`([^`]+)`/g, "<code>$1</code>");
}

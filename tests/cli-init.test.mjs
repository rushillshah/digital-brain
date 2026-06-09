import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cli = path.join(repo, "bin", "digital-brain.js");

test("init writes configured vault files and scripts", () => {
  const root = tempDir();
  const vault = path.join(root, "Brain");
  run([
    cli,
    "init",
    vault,
    "--yes",
    "--self-name",
    "Test User",
    "--data-window-days",
    "90",
    "--focus",
    "reply-help",
    "--schedule",
    "always-on",
    "--refresh-interval-minutes",
    "5",
    "--active-window",
    "08:00-12:00",
    "--outbound-mode",
    "draft",
    "--connect-ai=false",
  ]);

  const config = readJson(path.join(vault, "digital-brain.config.json"));
  assert.equal(config.selfName, "Test User");
  assert.equal(config.dataWindowDays, 90);
  assert.equal(config.focus, "reply-help");
  assert.equal(config.schedule, "always-on");
  assert.equal(config.refreshIntervalMinutes, 5);
  assert.equal(config.activeWindow, "08:00-12:00");
  assert.equal(config.outboundMode, "draft");
  assert.equal(config.disclosureRule.discloseAfterAiAssistedSends, 2);

  assert.match(read(path.join(vault, "Tools", "digital-brain-refresh.sh")), /--days "\$DAYS"/);
  assert.match(read(path.join(vault, "Tools", "digital-brain-watch.sh")), /INTERVAL_MINUTES="5"/);
  assert.ok(fs.existsSync(path.join(vault, "AGENTS.md")));
  assert.ok(fs.existsSync(path.join(vault, "CLAUDE.md")));
  assert.ok(fs.existsSync(path.join(vault, "GEMINI.md")));
});

test("init clamps always-on interval to one minute", () => {
  const root = tempDir();
  const vault = path.join(root, "Brain");
  run([cli, "init", vault, "--yes", "--refresh-interval-minutes", "0", "--connect-ai=false"]);

  const config = readJson(path.join(vault, "digital-brain.config.json"));
  assert.equal(config.refreshIntervalMinutes, 1);
  assert.match(read(path.join(vault, "Tools", "digital-brain-watch.sh")), /INTERVAL_MINUTES="1"/);
});

test("init does not write global pointers when disabled", () => {
  const root = tempDir();
  const vault = path.join(root, "Brain");
  const home = path.join(root, "home");
  fs.mkdirSync(home, { recursive: true });

  run([cli, "init", vault, "--yes", "--connect-ai=false"], { HOME: home });

  assert.equal(fs.existsSync(path.join(home, ".codex", "AGENTS.md")), false);
  assert.equal(fs.existsSync(path.join(home, ".claude", "CLAUDE.md")), false);
  assert.equal(fs.existsSync(path.join(home, ".gemini", "GEMINI.md")), false);
});

test("init writes global pointers when enabled", () => {
  const root = tempDir();
  const vault = path.join(root, "Brain");
  const home = path.join(root, "home");
  fs.mkdirSync(home, { recursive: true });

  run([cli, "init", vault, "--yes", "--connect-ai=true"], { HOME: home });

  assert.match(read(path.join(home, ".codex", "AGENTS.md")), /Digital Brain vault:/);
  assert.match(read(path.join(home, ".claude", "CLAUDE.md")), /Digital Brain vault:/);
  assert.match(read(path.join(home, ".gemini", "GEMINI.md")), /Digital Brain vault:/);
});

test("sample extractor and interpreter produce relationship memory", () => {
  const root = tempDir();
  const vault = path.join(root, "sample-vault");
  fs.cpSync(path.join(repo, "examples", "sample-vault"), vault, { recursive: true });
  run([cli, "extract", "--vault", vault, "--days", "365", "--min-messages", "1"]);
  run([cli, "interpret", "--vault", vault, "--days", "365"]);

  const memory = read(path.join(vault, "06 AI Memory", "Interpreted Relationship Memory.md"));
  assert.match(memory, /Mom/);
  assert.match(memory, /Project Team/);
  assert.match(memory, /Close Friend/);
});

function run(args, env = {}) {
  const result = spawnSync(process.execPath, args, {
    cwd: repo,
    env: { ...process.env, ...env },
    encoding: "utf8",
  });
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  return result;
}

function read(file) {
  return fs.readFileSync(file, "utf8");
}

function readJson(file) {
  return JSON.parse(read(file));
}

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "digital-brain-test-"));
}

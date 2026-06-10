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
  const home = testHome(root);
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
  ], { HOME: home });

  const config = readJson(path.join(vault, "digital-brain.config.json"));
  assert.equal(config.selfName, "Test User");
  assert.equal(config.dataWindowDays, 90);
  assert.equal(config.focus, "reply-help");
  assert.equal(config.schedule, "always-on");
  assert.equal(config.refreshIntervalMinutes, 5);
  assert.equal(config.activeWindow, "08:00-12:00");
  assert.equal(config.outboundMode, "draft");
  assert.deepEqual(config.selectedSources, ["whatsapp"]);
  assert.equal(config.privacyMode, "standard");
  assert.equal(config.sourceMarkdownMode, "none");
  assert.equal(config.outboundLogMode, "metadata");
  assert.equal(config.schemaVersion, 1);
  assert.equal(config.setupMode, "guided");
  assert.equal(config.responsibilityAccepted, true);
  assert.equal(config.defaults.minimumRefreshIntervalMinutes, 1);
  assert.equal(config.disclosureRule.discloseAfterAiAssistedSends, 2);

  assert.match(read(path.join(vault, "Tools", "digital-brain-refresh.sh")), /--days "\$DAYS"/);
  assert.match(read(path.join(vault, "Tools", "digital-brain-refresh.sh")), /digital-brain run/);
  assert.match(read(path.join(vault, "Tools", "digital-brain-watch.sh")), /INTERVAL_MINUTES="5"/);
  assert.equal(readJson(path.join(home, ".digital-brain", "config.json")).defaultVault, vault);
  assert.ok(fs.existsSync(path.join(vault, "AGENTS.md")));
  assert.ok(fs.existsSync(path.join(vault, "CLAUDE.md")));
  assert.ok(fs.existsSync(path.join(vault, "GEMINI.md")));
});

test("init without a vault path creates the default vault in cwd", () => {
  const root = tempDir();
  run([cli, "init", "--yes", "--connect-ai=false"], { HOME: testHome(root) }, { cwd: root });

  const vault = path.join(root, "Digital Brain Vault");
  const config = readJson(path.join(vault, "digital-brain.config.json"));
  assert.equal(config.defaults.skippedVaultCreates, vault);
  assert.equal(config.schedule, "manual");
  assert.equal(config.outboundMode, "draft");
});

test("full-auto init configures always-on local refresh", () => {
  const root = tempDir();
  const vault = path.join(root, "Brain");
  run([cli, "init", vault, "--yes", "--full-auto", "--connect-ai=false"], { HOME: testHome(root) });

  const config = readJson(path.join(vault, "digital-brain.config.json"));
  assert.equal(config.setupMode, "full-auto");
  assert.equal(config.schedule, "always-on");
  assert.equal(config.refreshIntervalMinutes, 5);
  assert.equal(config.responsibilityAccepted, true);
  assert.match(read(path.join(vault, "Tools", "digital-brain-watch.sh")), /INTERVAL_MINUTES="5"/);
});

test("init can configure WhatsApp auto-send mode explicitly", () => {
  const root = tempDir();
  const vault = path.join(root, "Brain");
  run([
    cli,
    "init",
    vault,
    "--yes",
    "--outbound-mode",
    "auto-send",
    "--responsibility-accepted=true",
    "--connect-ai=false",
  ], { HOME: testHome(root) });

  const config = readJson(path.join(vault, "digital-brain.config.json"));
  assert.equal(config.outboundMode, "auto-send");
  assert.equal(config.responsibilityAccepted, true);
});

test("noninteractive auto-send init requires responsibility acceptance", () => {
  const root = tempDir();
  const vault = path.join(root, "Brain");
  const result = runRaw([
    cli,
    "init",
    vault,
    "--yes",
    "--outbound-mode",
    "auto-send",
    "--connect-ai=false",
  ], { HOME: testHome(root) });

  assert.notEqual(result.status, 0);
  assert.match(`${result.stdout}\n${result.stderr}`, /requires explicit responsibility acceptance/);
});

test("init clamps always-on interval to one minute", () => {
  const root = tempDir();
  const vault = path.join(root, "Brain");
  run([cli, "init", vault, "--yes", "--refresh-interval-minutes", "0", "--connect-ai=false"], { HOME: testHome(root) });

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

  const profiles = readJson(path.join(vault, "08 Sources", "WhatsApp", "Analysis", "relationship_profiles.json"));
  const mom = profiles.find((profile) => profile.chatName === "Mom");
  assert.equal(mom.sourceSystem, "WhatsApp");
  assert.ok(mom.typingStyle);
  assert.equal(typeof mom.typingStyle.signature, "string");
  assert.equal(typeof mom.typingStyle.avgWords, "number");

  const interpreted = read(path.join(vault, "06 AI Memory", "Generated Relationship Drafts", "Mom (WhatsApp).md"));
  assert.match(interpreted, /## Typing Style To Match/);
  assert.match(interpreted, /## Reply Guidance/);
  assert.match(interpreted, /Generated draft/);
});

test("extract writes self communication style from outbound messages", () => {
  const root = tempDir();
  const vault = path.join(root, "Brain");
  const raw = path.join(vault, "08 Sources", "WhatsApp", "Raw");
  fs.mkdirSync(raw, { recursive: true });
  fs.writeFileSync(path.join(raw, "2026-06-09.jsonl"), [
    {
      id: "friend-1",
      sourceSystem: "WhatsApp",
      timestamp: "2026-06-09T10:00:00+00:00",
      chatName: "Close Friend",
      isGroup: false,
      fromMe: false,
      author: "Close Friend",
      body: "you free later?",
    },
    {
      id: "me-1",
      sourceSystem: "WhatsApp",
      timestamp: "2026-06-09T10:01:00+00:00",
      chatName: "Close Friend",
      isGroup: false,
      fromMe: true,
      author: "Me",
      body: "yeah bro give me 10",
    },
    {
      id: "me-2",
      sourceSystem: "WhatsApp",
      timestamp: "2026-06-09T10:02:00+00:00",
      chatName: "Close Friend",
      isGroup: false,
      fromMe: true,
      author: "Me",
      body: "i'll call rn",
    },
  ].map((record) => JSON.stringify(record)).join("\n"));

  run([cli, "extract", "--vault", vault, "--days", "30", "--min-messages", "1"]);

  const profile = readJson(path.join(vault, "08 Sources", "Analysis", "self_profile.json"));
  assert.equal(profile.profileType, "self_communication_style");
  assert.equal(profile.messageCount, 2);
  assert.equal(profile.typingStyle.lowercaseShare, 1);
  assert.match(profile.typingStyle.signature, /lowercase-heavy/);
  assert.deepEqual(profile.typingStyle.slang, ["yeah", "bro", "rn"]);

  const memory = read(path.join(vault, "06 AI Memory", "My Communication Style.md"));
  assert.match(memory, /Prefer undercapitalized\/lowercase casual texting/);
  assert.match(memory, /bro, rn/);
});

test("run uses remembered default vault", () => {
  const root = tempDir();
  const vault = path.join(root, "sample-vault");
  const home = testHome(root);
  fs.cpSync(path.join(repo, "examples", "sample-vault"), vault, { recursive: true });
  run([cli, "init", vault, "--yes", "--connect-ai=false"], { HOME: home });
  run([cli, "run", "--skip-sync", "--days", "365", "--min-messages", "1"], { HOME: home });

  const memory = read(path.join(vault, "06 AI Memory", "Interpreted Relationship Memory.md"));
  assert.match(memory, /Mom/);
});

test("run dry-run uses selected sources and import guidance", () => {
  const root = tempDir();
  const vault = path.join(root, "Brain");
  const home = testHome(root);
  run([cli, "init", vault, "--yes", "--sources", "imessage,slack", "--connect-ai=false"], { HOME: home });
  const result = run([cli, "run", "--dry-run"], { HOME: home });

  assert.match(result.stdout, /sync iMessage/);
  assert.match(result.stdout, /Slack: import-only/);
  assert.doesNotMatch(result.stdout, /sync WhatsApp/);
});

test("tutorial prints setup guidance", () => {
  const root = tempDir();
  const result = run([cli, "tutorial"], { HOME: testHome(root) }, { cwd: root });
  assert.match(result.stdout, /Setup check/);
  assert.match(result.stdout, /No pip install is needed/);
  assert.match(result.stdout, /digital-brain init/);
});

test("auto-whatsapp requires an explicit allowlist", () => {
  const root = tempDir();
  const vault = path.join(root, "Brain");
  run([cli, "init", vault, "--yes", "--connect-ai=false"], { HOME: testHome(root) });
  const result = runRaw([cli, "auto-whatsapp", "--vault", vault], { HOME: testHome(root) });

  assert.notEqual(result.status, 0);
  assert.match(`${result.stdout}\n${result.stderr}`, /Refusing to auto-reply without an allowlist/);
});

test("slack and linkedin imports feed relationship memory", () => {
  const root = tempDir();
  const vault = path.join(root, "Brain");
  const slack = path.join(root, "slack-export");
  const linkedin = path.join(root, "linkedin-archive");
  fs.mkdirSync(path.join(slack, "general"), { recursive: true });
  fs.mkdirSync(path.join(slack, "D1"), { recursive: true });
  fs.writeFileSync(path.join(slack, "users.json"), JSON.stringify([
    { id: "U1", name: "teammate", profile: { real_name: "Team Mate" } },
    { id: "U2", name: "ada", profile: { real_name: "Ada Lovelace" } },
  ]));
  fs.writeFileSync(path.join(slack, "channels.json"), JSON.stringify([{ id: "C1", name: "general" }]));
  fs.writeFileSync(path.join(slack, "dms.json"), JSON.stringify([{ id: "D1" }]));
  fs.writeFileSync(path.join(slack, "general", "2026-01-01.json"), JSON.stringify([
    { type: "message", user: "U1", text: "Can you send the deck today?", ts: "1767225600.000100" },
  ]));
  fs.writeFileSync(path.join(slack, "D1", "2026-01-01.json"), JSON.stringify([
    { type: "message", user: "U2", text: "Can you review the launch note?", ts: "1767225601.000100" },
  ]));
  fs.mkdirSync(linkedin, { recursive: true });
  fs.writeFileSync(
    path.join(linkedin, "Connections.csv"),
    "First Name,Last Name,Company,Position,Connected On\nAda,Lovelace,Analytical Engines,Founder,2026-01-01\n",
  );
  fs.writeFileSync(
    path.join(linkedin, "Messages.csv"),
    "Date,From,To,Content\n2026-01-01,Ada Lovelace,Me,Great chatting about the launch\n",
  );

  run([cli, "init", vault, "--yes", "--connect-ai=false"], { HOME: testHome(root) });
  run([cli, "import-slack", "--vault", vault, "--input", slack, "--days", "3650"]);
  run([cli, "import-linkedin", "--vault", vault, "--input", linkedin, "--days", "3650"]);
  run([cli, "extract", "--vault", vault, "--days", "3650", "--min-messages", "1"]);
  run([cli, "interpret", "--vault", vault, "--days", "3650"]);

  const profiles = readJson(path.join(vault, "08 Sources", "Analysis", "relationship_profiles.json"));
  assert.ok(profiles.some((profile) => profile.sourceSystem === "Slack"));
  assert.ok(profiles.some((profile) => profile.sourceSystem === "LinkedIn"));
  const people = readJson(path.join(vault, "08 Sources", "Analysis", "person_identity_map.json"));
  const ada = people.find((person) => person.displayName === "Ada Lovelace");
  assert.deepEqual(ada.sources.sort(), ["LinkedIn", "Slack"]);
  assert.equal(ada.sourceProfiles.length, 2);
  assert.match(read(path.join(vault, "06 AI Memory", "Person Context Index.md")), /Ada Lovelace/);
  const replyContext = read(path.join(vault, "06 AI Memory", "Person Reply Context.md"));
  assert.match(replyContext, /Slack \/ D1/);
  assert.match(replyContext, /LinkedIn \/ Ada Lovelace/);
  assert.match(read(path.join(vault, "04 People", "LinkedIn Connections.md")), /Ada Lovelace/);
});

test("extract skips corrupt JSONL and keeps valid records", () => {
  const root = tempDir();
  const vault = path.join(root, "Brain");
  const raw = path.join(vault, "08 Sources", "WhatsApp", "Raw");
  fs.mkdirSync(raw, { recursive: true });
  fs.writeFileSync(path.join(raw, "2026-06-09.jsonl"), [
    "{bad json",
    JSON.stringify({
      id: "valid-1",
      sourceSystem: "WhatsApp",
      timestamp: "2026-06-09T10:00:00+00:00",
      chatName: "Corrupt Test",
      isGroup: false,
      fromMe: true,
      author: "Me",
      body: "valid line survives",
    }),
    "",
  ].join("\n"));

  const result = run([cli, "extract", "--vault", vault, "--days", "30", "--min-messages", "1"]);
  assert.match(result.stdout, /Skipping corrupt JSONL line/);
  const profiles = readJson(path.join(vault, "08 Sources", "Analysis", "relationship_profiles.json"));
  assert.ok(profiles.some((profile) => profile.chatName === "Corrupt Test"));
});

test("sync-imessage imports from a local Messages-style database", () => {
  const root = tempDir();
  const vault = path.join(root, "Brain");
  const db = path.join(root, "chat.db");
  createImessageDb(db);

  run([cli, "sync-imessage", "--vault", vault, "--db", db, "--days", "30", "--markdown-mode", "none"]);
  run([cli, "extract", "--vault", vault, "--days", "30", "--min-messages", "1"]);

  const raw = readAllJsonl(path.join(vault, "08 Sources", "iMessage", "Raw"));
  assert.equal(raw.length, 1);
  assert.equal(raw[0].sourceSystem, "iMessage");
  assert.match(raw[0].id, /^imessage::1::guid-1::1::/);
  const profiles = readJson(path.join(vault, "08 Sources", "Analysis", "relationship_profiles.json"));
  assert.ok(profiles.some((profile) => profile.sourceSystem === "iMessage" && profile.chatName === "Test Friend"));
});

test("sync-imessage fails clearly when selected database is missing", () => {
  const root = tempDir();
  const vault = path.join(root, "Brain");
  const result = runRaw([cli, "sync-imessage", "--vault", vault, "--db", path.join(root, "missing.db")]);

  assert.notEqual(result.status, 0);
  assert.match(`${result.stdout}\n${result.stderr}`, /Apple Messages database not found/);
});

test("sync-whatsapp dedupes with compound ids, not stanza id alone", () => {
  const root = tempDir();
  const vault = path.join(root, "Brain");
  const db = path.join(root, "ChatStorage.sqlite");
  createWhatsappDb(db);

  run([cli, "sync-whatsapp", "--vault", vault, "--db", db, "--days", "30", "--markdown-mode", "none"]);
  const raw = readAllJsonl(path.join(vault, "08 Sources", "WhatsApp", "Raw"));
  assert.equal(raw.length, 2);
  assert.equal(new Set(raw.map((record) => record.id)).size, 2);
  assert.ok(raw.every((record) => record.id.includes("same-stanza")));
});

function run(args, env = {}, options = {}) {
  const result = runRaw(args, env, options);
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  return result;
}

function runRaw(args, env = {}, options = {}) {
  return spawnSync(process.execPath, args, {
    cwd: options.cwd || repo,
    env: { ...process.env, ...env },
    encoding: "utf8",
  });
}

function read(file) {
  return fs.readFileSync(file, "utf8");
}

function readJson(file) {
  return JSON.parse(read(file));
}

function tempDir() {
  return fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "digital-brain-test-")));
}

function testHome(root) {
  const home = path.join(root, "home");
  fs.mkdirSync(home, { recursive: true });
  return home;
}

function readAllJsonl(dir) {
  return fs.readdirSync(dir)
    .filter((name) => name.endsWith(".jsonl"))
    .flatMap((name) => read(path.join(dir, name)).trim().split("\n").filter(Boolean).map((line) => JSON.parse(line)));
}

function createImessageDb(db) {
  const code = `
import sqlite3, sys, time
db = sys.argv[1]
conn = sqlite3.connect(db)
conn.executescript("""
CREATE TABLE message (ROWID INTEGER PRIMARY KEY, guid TEXT, date INTEGER, is_from_me INTEGER, text TEXT, service TEXT, handle_id INTEGER);
CREATE TABLE handle (ROWID INTEGER PRIMARY KEY, id TEXT);
CREATE TABLE chat (ROWID INTEGER PRIMARY KEY, display_name TEXT, chat_identifier TEXT);
CREATE TABLE chat_message_join (chat_id INTEGER, message_id INTEGER);
""")
apple_ns = int((time.time() - 978307200) * 1000000000)
conn.execute("INSERT INTO handle VALUES (1, '+15551234567')")
conn.execute("INSERT INTO chat VALUES (1, 'Test Friend', 'iMessage;+15551234567')")
conn.execute("INSERT INTO message VALUES (1, 'guid-1', ?, 0, 'hello from messages', 'iMessage', 1)", (apple_ns,))
conn.execute("INSERT INTO chat_message_join VALUES (1, 1)")
conn.commit()
conn.close()
`;
  const result = spawnSync("python3", ["-c", code, db], { encoding: "utf8" });
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
}

function createWhatsappDb(db) {
  const code = `
import sqlite3, sys, time
db = sys.argv[1]
conn = sqlite3.connect(db)
conn.executescript("""
CREATE TABLE ZWACHATSESSION (Z_PK INTEGER PRIMARY KEY, ZPARTNERNAME TEXT, ZCONTACTJID TEXT, ZSESSIONTYPE INTEGER);
CREATE TABLE ZWAMESSAGE (Z_PK INTEGER PRIMARY KEY, ZSTANZAID TEXT, ZMESSAGEDATE REAL, ZISFROMME INTEGER, ZFROMJID TEXT, ZTOJID TEXT, ZPUSHNAME TEXT, ZTEXT TEXT, ZMESSAGETYPE INTEGER, ZCHATSESSION INTEGER);
""")
core_date = time.time() - 978307200
conn.execute("INSERT INTO ZWACHATSESSION VALUES (1, 'Friend One', '111@s.whatsapp.net', 0)")
conn.execute("INSERT INTO ZWACHATSESSION VALUES (2, 'Friend Two', '222@s.whatsapp.net', 0)")
conn.execute("INSERT INTO ZWAMESSAGE VALUES (1, 'same-stanza', ?, 0, '111@s.whatsapp.net', 'me@s.whatsapp.net', 'Friend One', 'first message', 0, 1)", (core_date,))
conn.execute("INSERT INTO ZWAMESSAGE VALUES (2, 'same-stanza', ?, 0, '222@s.whatsapp.net', 'me@s.whatsapp.net', 'Friend Two', 'second message', 0, 2)", (core_date + 1,))
conn.commit()
conn.close()
`;
  const result = spawnSync("python3", ["-c", code, db], { encoding: "utf8" });
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
}

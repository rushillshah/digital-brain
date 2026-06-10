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
    "--reply-style-mode",
    "casual-imperfect",
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
  assert.equal(config.replyStyleMode, "casual-imperfect");
  assert.equal(config.autoReplyProvider, "ollama");
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
  assert.match(read(path.join(vault, "Tools", "Codex App Bridge Automation.md")), /Codex App Bridge Automation/);
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
  assert.equal(config.replyStyleMode, "match-user");
  assert.equal(config.autoReplyProvider, "ollama");
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

test("init can configure Codex app auto-reply provider", () => {
  const root = tempDir();
  const vault = path.join(root, "Brain");
  run([
    cli,
    "init",
    vault,
    "--yes",
    "--auto-reply-provider",
    "codex-app",
    "--connect-ai=false",
  ], { HOME: testHome(root) });

  const config = readJson(path.join(vault, "digital-brain.config.json"));
  assert.equal(config.autoReplyProvider, "codex-app");
  assert.match(read(path.join(vault, "Tools", "Codex App Bridge Automation.md")), /responsePath/);
  assert.ok(fs.existsSync(path.join(vault, "08 Sources", "WhatsApp", "Outbound", "Codex App Bridge", "requests")));
  assert.ok(fs.existsSync(path.join(vault, "08 Sources", "WhatsApp", "Outbound", "Codex App Bridge", "responses")));
});

test("init can configure OpenAI auto-reply provider and key", () => {
  const root = tempDir();
  const vault = path.join(root, "Brain");
  run([
    cli,
    "init",
    vault,
    "--yes",
    "--auto-reply-provider",
    "openai",
    "--openai-model",
    "gpt-4.1-mini",
    "--openai-api-key",
    "test-openai-key",
    "--connect-ai=false",
  ], { HOME: testHome(root) });

  const config = readJson(path.join(vault, "digital-brain.config.json"));
  assert.equal(config.autoReplyProvider, "openai");
  assert.equal(config.autoReplyModel, "gpt-4.1-mini");
  assert.equal(config.openaiApiKey, "test-openai-key");
});

test("init can configure Anthropic auto-reply provider and key", () => {
  const root = tempDir();
  const vault = path.join(root, "Brain");
  run([
    cli,
    "init",
    vault,
    "--yes",
    "--auto-reply-provider",
    "anthropic",
    "--anthropic-api-key",
    "test-anthropic-key",
    "--connect-ai=false",
  ], { HOME: testHome(root) });

  const config = readJson(path.join(vault, "digital-brain.config.json"));
  assert.equal(config.autoReplyProvider, "anthropic");
  assert.equal(config.autoReplyModel, "claude-sonnet-4-6");
  assert.equal(config.anthropicApiKey, "test-anthropic-key");
});

test("init can configure xAI auto-reply provider and key", () => {
  const root = tempDir();
  const vault = path.join(root, "Brain");
  run([
    cli,
    "init",
    vault,
    "--yes",
    "--auto-reply-provider",
    "xai",
    "--xai-api-key",
    "test-xai-key",
    "--connect-ai=false",
  ], { HOME: testHome(root) });

  const config = readJson(path.join(vault, "digital-brain.config.json"));
  assert.equal(config.autoReplyProvider, "xai");
  assert.equal(config.autoReplyModel, "grok-4.3");
  assert.equal(config.xaiApiKey, "test-xai-key");
});

test("init can opt into anonymous telemetry without content", () => {
  const root = tempDir();
  const vault = path.join(root, "Brain");
  const home = testHome(root);
  run([
    cli,
    "init",
    vault,
    "--yes",
    "--connect-ai=false",
    "--telemetry=true",
    "--sources",
    "whatsapp,repos",
  ], { HOME: home, DIGITAL_BRAIN_TELEMETRY_OFFLINE: "1" });

  const config = readJson(path.join(vault, "digital-brain.config.json"));
  assert.equal(config.telemetryEnabled, true);
  const telemetry = readJson(path.join(home, ".digital-brain", "telemetry.json"));
  assert.equal(telemetry.enabled, true);
  assert.ok(telemetry.installId);
  const events = read(path.join(home, ".digital-brain", "telemetry-events.jsonl")).trim().split("\n").map((line) => JSON.parse(line));
  assert.ok(events.some((event) => event.event === "init_completed"));
  assert.ok(events.some((event) => event.event === "source_selected" && event.source === "whatsapp"));
  assert.ok(events.every((event) => !event.vault && !event.vaultPath && !event.message && !event.chatName && !event.apiKey));
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

test("demo-proof writes fake-data launch assets", () => {
  const root = tempDir();
  const out = path.join(root, "demo-assets");

  run([cli, "demo-proof", "--out", out]);

  assert.ok(fs.existsSync(path.join(out, "sample-vault", "06 AI Memory", "Person Reply Context.md")));
  assert.match(read(path.join(out, "terminal-demo.txt")), /npx digital-brain init/);
  assert.match(read(path.join(out, "README.md")), /real Obsidian screenshots/);
  assert.match(read(path.join(out, "README.md")), /npm: https:\/\/www\.npmjs\.com\/package\/digital-brain/);
});

test("showcase aliases demo-proof for shareable fake-data assets", () => {
  const root = tempDir();
  const out = path.join(root, "showcase");

  run([cli, "showcase", "--out", out]);

  assert.ok(fs.existsSync(path.join(out, "sample-vault", "06 AI Memory", "Person Reply Context.md")));
  assert.match(read(path.join(out, "README.md")), /Digital Brain Demo Proof Assets/);
});

test("interpreter infers roles from conversation evidence, not just contact names", () => {
  const root = tempDir();
  const vault = path.join(root, "Brain");
  const raw = path.join(vault, "08 Sources", "WhatsApp", "Raw");
  fs.mkdirSync(raw, { recursive: true });
  fs.writeFileSync(path.join(raw, "2026-06-09.jsonl"), [
    {
      id: "sibling-1",
      sourceSystem: "WhatsApp",
      timestamp: "2026-06-09T10:00:00+00:00",
      chatName: "Avery",
      isGroup: false,
      fromMe: false,
      author: "Avery",
      body: "are you coming home for dinner?",
    },
    {
      id: "sibling-2",
      sourceSystem: "WhatsApp",
      timestamp: "2026-06-09T10:01:00+00:00",
      chatName: "Avery",
      isGroup: false,
      fromMe: true,
      author: "Me",
      body: "you're my younger sister obviously i'll ask mom",
    },
    {
      id: "sibling-3",
      sourceSystem: "WhatsApp",
      timestamp: "2026-06-09T10:02:00+00:00",
      chatName: "Avery",
      isGroup: false,
      fromMe: false,
      author: "Avery",
      body: "ok tell me when she says yes",
    },
  ].map((record) => JSON.stringify(record)).join("\n"));

  run([cli, "extract", "--vault", vault, "--days", "30", "--min-messages", "1"]);
  run([cli, "interpret", "--vault", vault, "--days", "30"]);

  const profiles = readJson(path.join(vault, "08 Sources", "Analysis", "relationship_profiles.json"));
  const profile = profiles.find((item) => item.chatName === "Avery");
  assert.equal(profile.roleEvidenceScores.sibling, 5);
  assert.ok(profile.roleEvidence.some((item) => item.signal === "explicit second-person kinship"));

  const interpreted = read(path.join(vault, "06 AI Memory", "Generated Relationship Drafts", "Avery (WhatsApp).md"));
  assert.match(interpreted, /Role: sibling/);
  assert.match(interpreted, /conversation evidence/);
  assert.match(interpreted, /Role Evidence From Conversation/);
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
      body: "yeah bro give me 10?",
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
  assert.deepEqual(profile.lexicalProfile.commonStyleWords, ["yeah", "bro", "rn"]);
  assert.ok(profile.lexicalProfile.commonPhrases.includes("yeah bro give"));
  assert.ok(profile.lexicalProfile.messageOpeners.includes("yeah bro give"));
  assert.ok(profile.lexicalProfile.contractions.includes("i'll"));
  assert.ok(profile.lexicalProfile.punctuationHabits.some((habit) => habit.startsWith("question marks")));
  assert.equal(profile.lexicalProfile.lowercaseIShare, 1);

  const memory = read(path.join(vault, "06 AI Memory", "My Communication Style.md"));
  assert.match(memory, /Prefer undercapitalized\/lowercase casual texting/);
  assert.match(memory, /Common style words: yeah, bro, rn/);
  assert.match(memory, /Common phrases:/);
  assert.match(memory, /The user often types lowercase `i`/);
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
  run([cli, "init", vault, "--yes", "--sources", "imessage,slack,whatsapp-web", "--connect-ai=false"], { HOME: home });
  const result = run([cli, "run", "--dry-run"], { HOME: home });

  assert.match(result.stdout, /sync iMessage/);
  assert.match(result.stdout, /sync WhatsApp Desktop\/Web/);
  assert.match(result.stdout, /Slack: import-only/);
  assert.doesNotMatch(result.stdout, /sync WhatsApp Mac/);
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

test("whatsapp web desktop sync is wired as a cross-platform source", () => {
  const source = read(path.join(repo, "bin", "digital-brain.js"));
  const syncSource = read(path.join(repo, "whatsapp-web", "sync.mjs"));
  const desktopSource = read(path.join(repo, "desktop", "renderer", "renderer.js"));

  assert.match(source, /sync-whatsapp-web/);
  assert.match(source, /WhatsApp Desktop\/Web/);
  assert.match(source, /whatsapp-web\/sync\.mjs/);
  assert.match(source, /runNodeStep/);
  assert.match(syncSource, /WhatsApp Web\/Desktop linked device/);
  assert.match(syncSource, /limit-per-chat/);
  assert.match(syncSource, /web-seen-message-ids\.json/);
  assert.match(desktopSource, /whatsapp-web/);
});

test("auto-reply prompt keeps WhatsApp replies terse and non-assistant-like", () => {
  const source = read(path.join(repo, "whatsapp-web", "auto-reply.mjs"));
  assert.match(source, /Default to 1-12 words for casual chats/);
  assert.match(source, /replyDebounceMs/);
  assert.match(source, /reply-debounce-ms", 12000/);
  assert.match(source, /latest unanswered inbound chunk/);
  assert.match(source, /output exactly NO_REPLY/);
  assert.match(source, /latestUnansweredInbound/);
  assert.match(source, /isNoReply/);
  assert.match(source, /answer the combined latest intent once/);
  assert.match(source, /do not pretend you opened or inspected it/);
  assert.match(source, /Primary style source: the user's recent messages in this exact chat/);
  assert.match(source, /Language guard: reply in English/);
  assert.match(source, /Never infer Hindi\/Hinglish from the recipient's name, family relationship, or location/);
  assert.match(source, /user's own recent messages in this exact chat/);
  assert.match(source, /Do not use Hindi, Hinglish, romanized Hindi/);
  assert.match(source, /Slang guard: do not use bro in this chat/);
  assert.match(source, /Do not transfer slang from other chats into this relationship/);
  assert.match(source, /languageProfile/);
  assert.match(source, /slangProfile/);
  assert.match(source, /Do not perform a persona/);
  assert.match(source, /Recent examples of the user's own messages in this chat/);
  assert.match(source, /Avoid polished punctuation/);
  assert.match(source, /replyStyleMode/);
  assert.match(source, /Reply style mode: casual imperfect/);
  assert.match(source, /Reply style mode: clean formal/);
  assert.match(source, /Reply style mode: match user/);
  assert.match(source, /clean spelling, normal capitalization, and normal punctuation/);
  assert.match(source, /matchPunctuationStyle/);
  assert.match(source, /readSelfPunctuationStyle/);
  assert.match(source, /prefersPunctuation/);
  assert.match(source, /Do not repeat facts, plans, suggestions, or context/);
  assert.match(source, /Shared group context involving this person/);
  assert.match(source, /readSharedGroupContext/);
  assert.match(source, /Use shared group context only when it explains the latest direct message/);
  assert.match(source, /no-shared-group-context/);
  assert.match(source, /shared-group-context-days", 14/);
  assert.match(source, /max-shared-group-context-chars", 3000/);
  assert.match(source, /Avoid assistant-like niceness and filler/);
  assert.match(source, /btw ai is helping me reply rn/);
  assert.match(source, /max_output_tokens: 80/);
  assert.match(source, /temperature: 0.25/);
  assert.match(source, /claude-sonnet-4-6/);
  assert.match(source, /grok-4\.3/);
  assert.match(source, /ANTHROPIC_API_KEY/);
  assert.match(source, /XAI_API_KEY/);
  assert.match(source, /https:\/\/api\.anthropic\.com\/v1\/messages/);
  assert.match(source, /https:\/\/api\.x\.ai\/v1\/responses/);
});

test("auto-reply allows explicitly whitelisted groups by name", () => {
  const source = read(path.join(repo, "whatsapp-web", "auto-reply.mjs"));
  assert.match(source, /chat\.isGroup && !includeGroups && !isChatWhitelisted\(chat\)/);
  assert.match(source, /function chatKeys/);
  assert.match(source, /`name:\$\{chatName\(chatOrName\)\.toLowerCase\(\)\}`/);
});

test("pause and resume commands write WhatsApp pause state", () => {
  const root = tempDir();
  const vault = path.join(root, "Brain");
  const home = testHome(root);
  run([cli, "init", vault, "--yes", "--connect-ai=false"], { HOME: home });
  run([cli, "pause-whatsapp", "--chat", "Mom"], { HOME: home });

  const pausePath = path.join(vault, "08 Sources", "WhatsApp", "Outbound", "auto-reply-pause.json");
  let pause = readJson(pausePath);
  assert.equal(Boolean(pause.pausedChats["name:mom"]), true);

  run([cli, "resume-whatsapp", "--chat", "Mom"], { HOME: home });
  pause = readJson(pausePath);
  assert.equal(Boolean(pause.pausedChats["name:mom"]), false);

  run([cli, "pause-whatsapp"], { HOME: home });
  pause = readJson(pausePath);
  assert.equal(pause.paused, true);

  run([cli, "resume-whatsapp"], { HOME: home });
  pause = readJson(pausePath);
  assert.equal(pause.paused, false);
});

test("auto-whatsapp supports keyboard pause controls", () => {
  const source = read(path.join(repo, "whatsapp-web", "auto-reply.mjs"));
  assert.match(source, /Keyboard controls: Space toggles pause\/resume/);
  assert.match(source, /toggleGlobalPause/);
  assert.match(source, /value === " "/);
  assert.match(source, /input\.setRawMode\(false\)/);
});

test("slack teams and linkedin imports feed relationship memory", () => {
  const root = tempDir();
  const vault = path.join(root, "Brain");
  const slack = path.join(root, "slack-export");
  const teams = path.join(root, "teams-export");
  const linkedin = path.join(root, "linkedin-archive");
  fs.mkdirSync(path.join(slack, "general"), { recursive: true });
  fs.mkdirSync(path.join(slack, "D1"), { recursive: true });
  fs.writeFileSync(path.join(slack, "users.json"), JSON.stringify([
    { id: "U1", name: "teammate", profile: { real_name: "Team Mate" } },
    { id: "U2", name: "ada", profile: { real_name: "Ada Lovelace", title: "Founder", email: "ada@analytical.example" } },
  ]));
  fs.writeFileSync(path.join(slack, "channels.json"), JSON.stringify([{ id: "C1", name: "general" }]));
  fs.writeFileSync(path.join(slack, "dms.json"), JSON.stringify([{ id: "D1" }]));
  fs.writeFileSync(path.join(slack, "general", "2026-01-01.json"), JSON.stringify([
    { type: "message", user: "U1", text: "Can you send the deck today?", ts: "1767225600.000100" },
  ]));
  fs.writeFileSync(path.join(slack, "D1", "2026-01-01.json"), JSON.stringify([
    { type: "message", user: "U2", text: "Can you review the launch note?", ts: "1767225601.000100" },
  ]));
  fs.mkdirSync(teams, { recursive: true });
  fs.writeFileSync(path.join(teams, "messages.json"), JSON.stringify({
    value: [
      {
        id: "m1",
        createdDateTime: "2026-01-01T00:00:02Z",
        chatId: "19:teams-chat",
        chatDisplayName: "Ada Lovelace",
        from: { user: { id: "aad-1", displayName: "Ada Lovelace", userPrincipalName: "ada@example.com", jobTitle: "Principal Engineer", department: "Engineering" } },
        body: { contentType: "html", content: "<p>Teams note: can you check the launch dashboard?</p>" },
      },
    ],
  }));
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
  run([cli, "import-teams", "--vault", vault, "--input", teams, "--days", "3650"]);
  run([cli, "import-linkedin", "--vault", vault, "--input", linkedin, "--days", "3650"]);
  run([cli, "extract", "--vault", vault, "--days", "3650", "--min-messages", "1"]);
  run([cli, "interpret", "--vault", vault, "--days", "3650"]);

  const profiles = readJson(path.join(vault, "08 Sources", "Analysis", "relationship_profiles.json"));
  assert.ok(profiles.some((profile) => profile.sourceSystem === "Slack"));
  assert.ok(profiles.some((profile) => profile.sourceSystem === "Microsoft Teams"));
  assert.ok(profiles.some((profile) => profile.sourceSystem === "LinkedIn"));
  const slackAda = profiles.find((profile) => profile.sourceSystem === "Slack" && profile.chatName === "D1");
  assert.match(slackAda.metadataSignals.titles[0].value, /Founder/);
  const teamsAda = profiles.find((profile) => profile.sourceSystem === "Microsoft Teams");
  assert.match(teamsAda.metadataSignals.titles[0].value, /Principal Engineer/);
  assert.match(teamsAda.metadataSignals.departments[0].value, /Engineering/);
  assert.ok(teamsAda.roleEvidence.some((item) => item.signal === "profile metadata role/title"));
  const people = readJson(path.join(vault, "08 Sources", "Analysis", "person_identity_map.json"));
  const ada = people.find((person) => person.displayName === "Ada Lovelace");
  assert.deepEqual(ada.sources.sort(), ["LinkedIn", "Microsoft Teams", "Slack"]);
  assert.equal(ada.sourceProfiles.length, 3);
  assert.match(read(path.join(vault, "06 AI Memory", "Person Context Index.md")), /Ada Lovelace/);
  const replyContext = read(path.join(vault, "06 AI Memory", "Person Reply Context.md"));
  assert.match(replyContext, /Slack \/ D1/);
  assert.match(replyContext, /Metadata: titles: Founder/);
  assert.match(replyContext, /Microsoft Teams \/ Ada Lovelace/);
  assert.match(replyContext, /Principal Engineer/);
  assert.match(replyContext, /LinkedIn \/ Ada Lovelace/);
  assert.match(read(path.join(vault, "04 People", "LinkedIn Connections.md")), /Ada Lovelace/);
});

test("gmail takeout import writes email memory", () => {
  const root = tempDir();
  const vault = path.join(root, "Brain");
  const mbox = path.join(root, "mail.mbox");
  fs.writeFileSync(mbox, [
    "From sender@example.com Tue Jun 09 10:00:00 2026",
    "Message-ID: <m1@example.com>",
    "Date: Tue, 09 Jun 2026 10:00:00 +0000",
    "From: Friend <friend@example.com>",
    "To: Me <me@example.com>",
    "Subject: Re: Demo follow up",
    "Content-Type: text/plain; charset=utf-8",
    "",
    "Can you send the demo later today?",
    "",
    "From sender@example.com Tue Jun 09 10:05:00 2026",
    "Message-ID: <m2@example.com>",
    "Date: Tue, 09 Jun 2026 10:05:00 +0000",
    "From: Me <me@example.com>",
    "To: Friend <friend@example.com>",
    "Subject: Re: Demo follow up",
    "Content-Type: text/plain; charset=utf-8",
    "",
    "yes will send it",
    "",
  ].join("\n"));

  run([cli, "import-gmail", "--vault", vault, "--input", mbox, "--self-email", "me@example.com", "--days", "30"]);
  run([cli, "extract", "--vault", vault, "--days", "30", "--min-messages", "1"]);

  const raw = readAllJsonl(path.join(vault, "08 Sources", "Gmail", "Raw"));
  assert.equal(raw.length, 2);
  assert.equal(raw[1].fromMe, true);
  assert.equal(raw[0].sourceSystem, "Gmail");
  const memory = read(path.join(vault, "06 AI Memory", "Email Context.md"));
  assert.match(memory, /Demo follow up/);
  assert.match(memory, /friend@example.com/);
});

test("google calendar import writes calendar memory", () => {
  const root = tempDir();
  const vault = path.join(root, "Brain");
  const ics = path.join(root, "calendar.ics");
  fs.writeFileSync(ics, [
    "BEGIN:VCALENDAR",
    "BEGIN:VEVENT",
    "UID:event-1",
    "DTSTART:20260610T100000Z",
    "DTEND:20260610T103000Z",
    "SUMMARY:Project standup",
    "DESCRIPTION:Discuss launch checklist",
    "LOCATION:Zoom",
    "ORGANIZER:mailto:lead@example.com",
    "ATTENDEE:mailto:me@example.com",
    "ATTENDEE:mailto:teammate@example.com",
    "END:VEVENT",
    "END:VCALENDAR",
  ].join("\n"));

  run([cli, "import-calendar", "--vault", vault, "--input", ics, "--past-days", "365", "--future-days", "365"]);

  const events = read(path.join(vault, "08 Sources", "Google Calendar", "Raw", "events.jsonl")).trim().split("\n").map((line) => JSON.parse(line));
  assert.equal(events.length, 1);
  assert.equal(events[0].title, "Project standup");
  assert.equal(events[0].sourceSystem, "Google Calendar");
  const memory = read(path.join(vault, "06 AI Memory", "Calendar Context.md"));
  assert.match(memory, /Project standup/);
  assert.match(memory, /teammate@example.com/);
});

test("slack teams and imessage send commands draft by default", () => {
  const root = tempDir();
  const vault = path.join(root, "Brain");
  fs.mkdirSync(vault, { recursive: true });
  fs.writeFileSync(path.join(vault, "digital-brain.config.json"), "{}");

  run([cli, "send-slack", "--vault", vault, "--channel", "C123", "--message", "hello"]);
  run([cli, "send-teams", "--vault", vault, "--chat", "19:abc", "--message", "hello"]);
  run([cli, "send-imessage", "--vault", vault, "--to", "+15551234567", "--message", "hello"]);

  assert.match(read(path.join(vault, "08 Sources", "Slack", "Outbound", "Sent.md")), /draft/);
  assert.match(read(path.join(vault, "08 Sources", "Microsoft Teams", "Outbound", "Sent.md")), /draft/);
  assert.match(read(path.join(vault, "08 Sources", "iMessage", "Outbound", "Sent.md")), /draft/);
});

test("import-repos writes project context from local repositories", () => {
  const root = tempDir();
  const vault = path.join(root, "Brain");
  const project = path.join(root, "codewiser-frontend");
  fs.mkdirSync(project, { recursive: true });
  fs.writeFileSync(path.join(project, "README.md"), "# CodeWiser Frontend\n\nFrontend app for readiness and review workflows.\n");
  fs.writeFileSync(path.join(project, "package.json"), JSON.stringify({
    name: "codewiser-frontend",
    scripts: { dev: "next dev" },
    dependencies: { next: "^15.0.0" },
  }, null, 2));

  run([
    cli,
    "init",
    vault,
    "--yes",
    "--sources",
    "repos",
    "--repo-paths",
    project,
    "--connect-ai=false",
  ], { HOME: testHome(root) });
  run([cli, "import-repos", "--vault", vault, "--input", project]);

  const config = readJson(path.join(vault, "digital-brain.config.json"));
  assert.deepEqual(config.selectedSources, ["repos"]);
  assert.deepEqual(config.repoPaths, [project]);
  assert.match(read(path.join(vault, "06 AI Memory", "Project Context.md")), /CodeWiser Frontend/);
  assert.match(read(path.join(vault, "08 Sources", "Repositories", "codewiser-frontend.md")), /package\.json/);
  const records = readJson(path.join(vault, "08 Sources", "Repositories", "repository_context.json"));
  assert.equal(records[0].name, "codewiser-frontend");
});

test("connect-repos can add repository context after init", () => {
  const root = tempDir();
  const vault = path.join(root, "Brain");
  const project = path.join(root, "later-repo");
  fs.mkdirSync(project, { recursive: true });
  fs.writeFileSync(path.join(project, "README.md"), "# Later Repo\n\nAdded after setup.\n");

  run([cli, "init", vault, "--yes", "--connect-ai=false"], { HOME: testHome(root) });
  run([cli, "connect-repos", "--vault", vault, "--yes", "--input", project]);

  const config = readJson(path.join(vault, "digital-brain.config.json"));
  assert.ok(config.selectedSources.includes("repos"));
  assert.deepEqual(config.repoPaths, [project]);
  assert.match(read(path.join(vault, "06 AI Memory", "Project Context.md")), /Later Repo/);
});

test("init supports GitHub CLI repository onboarding", () => {
  const source = read(path.join(repo, "bin", "digital-brain.js"));
  assert.match(source, /Connect GitHub/);
  assert.match(source, /gh auth login --web/);
  assert.match(source, /ghIsAuthenticated/);
  assert.match(source, /"repo", "list"/);
  assert.match(source, /cloneOrPullRepo/);
  assert.match(source, /\.digital-brain", "github-repos"/);
});

test("auto-whatsapp updates conversation continuity memory", () => {
  const source = read(path.join(repo, "whatsapp-web", "auto-reply.mjs"));
  assert.match(source, /Conversation Continuity\.md/);
  assert.match(source, /conversation-continuity\.json/);
  assert.match(source, /updateConversationContinuity/);
  assert.match(source, /Generated from AI-assisted WhatsApp drafts\/sends/);
  assert.match(source, /Last inbound/);
  assert.match(source, /Last AI reply/);
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

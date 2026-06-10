# Digital Brain

Your private digital imprint for AI.

Digital Brain turns your local notes and message history into an editable memory vault that AI assistants can use to understand your people, patterns, tone, and context.

It is not a chatbot. It is not a cloud memory service. It is the local context layer that makes your existing AI tools feel less generic.

## Why

AI tools are powerful, but they usually start every personal question cold.

Digital Brain gives them a structured, local map of:

- who matters in your life
- how you communicate with different people
- which relationships are warm, operational, difficult, or high-context
- what tone to use when drafting replies
- what not to assume

## Install

```bash
npx digital-brain init
```

The installer asks a short setup quiz: setup mode, history window, primary focus, refresh cadence, always-on interval, active time window, outbound mode, and AI adapter setup.

The quiz is mostly multiple choice. Pick with `A/B/C`, `1/2/3`, the exact value, or press Enter to accept the default. If you skip the vault path, Digital Brain creates a new folder in the current directory:

```text
./Digital Brain Vault
```

For a non-interactive setup:

```bash
npx digital-brain init --yes
```

Inside the quiz, choose `Auto mode` to use recommended always-on local refresh settings. You can also start there directly:

```bash
npx digital-brain init --full-auto
```

Full-auto means local repeated refreshes. It does not mean blind auto-send. WhatsApp sending still defaults to drafts or explicit confirmation, and the AI-disclosure guard stays enabled.

`init` also runs a setup check. npm installs the package dependencies automatically, and Digital Brain does not require pip packages. If Python or a selected source is missing, the check prints the exact next step and setup link. See [docs/SETUP.md](docs/SETUP.md).

For local development:

```bash
npm install
node ./bin/digital-brain.js init ./Digital Brain\ Vault
```

## What It Creates

- An Obsidian-friendly Markdown vault.
- AI adapter files for Codex, Claude, and Gemini.
- WhatsApp Mac import tools.
- Apple iMessage import tools.
- Slack export import tools.
- LinkedIn data archive import tools.
- Relationship extraction and interpretation models.
- Optional WhatsApp Web outbound sender.
- A refresh script based on your install-time answers.
- An optional always-on watch script that can pull every N minutes.

## What It Can Do

- Import recent WhatsApp history from the local macOS WhatsApp database.
- Import recent iMessage history from the local macOS Messages database.
- Import Slack workspace exports.
- Import LinkedIn data archives for connections and messages when available.
- Build relationship profiles from message patterns.
- Merge confirmed-looking same-person profiles across sources into a person context index.
- Infer provisional roles like parent, family group, work collaborator, close personal contact, or unlabeled contact.
- Extract relationship-specific typing style: casing, message length, punctuation, emoji, and slang.
- Generate "how to continue this relationship" notes.
- Generate reply-ready person context that keeps WhatsApp, iMessage, Slack, and LinkedIn evidence separate under the same person.
- Create AI-readable memory files for future prompts.
- Draft WhatsApp sends by default, and only send with explicit `--yes`.
- Run an explicit WhatsApp auto-responder that uses local Ollama plus vault memory while the command is running.
- Enforce an AI-disclosure guard after repeated AI-assisted sends.

## Core Commands

```bash
digital-brain init
digital-brain run
digital-brain doctor
digital-brain sync-imessage --days 30
digital-brain import-slack --input ./slack-export.zip
digital-brain import-linkedin --input ./linkedin-archive.zip
digital-brain send-whatsapp --to "Name" --message "text"
digital-brain auto-whatsapp --allow "Name" --model llama3.1
```

`init` remembers your vault globally, so `run` works from anywhere. `run` syncs the live local sources you selected, extracts relationships, and writes interpreted memory in one command.

Slack and LinkedIn are import-based. Digital Brain reads official export archives; it does not scrape LinkedIn or automate private app UIs. See [docs/INTEGRATIONS.md](docs/INTEGRATIONS.md).

Use `digital-brain doctor` or `digital-brain tutorial` anytime to see dependency status and next steps.

The lower-level commands still exist for debugging:

```bash
digital-brain sync-whatsapp
digital-brain sync-imessage
digital-brain extract
digital-brain interpret
```

The sender drafts by default. Add `--yes` to actually send.

The auto-responder is opt-in and runs only while the command is active. It requires an allowlist unless you explicitly pass `--allow-all`. Without `--yes`, it only logs drafts:

```bash
digital-brain auto-whatsapp --allow "Mom" --model llama3.1
digital-brain auto-whatsapp --allow "Mom" --model llama3.1 --yes
```

If Digital Brain has already sent two AI-assisted messages to the same chat in the last 24 hours, the next send must disclose that AI is helping unless you explicitly bypass the check.

## Automation

Each vault gets:

```bash
Tools/digital-brain-refresh.sh
```

For 24/7 local polling:

```bash
Tools/digital-brain-watch.sh
```

Use these with Codex automations, local cron, launchd, or another scheduler. See [docs/AUTOMATIONS.md](docs/AUTOMATIONS.md).

## Example

Before Digital Brain:

> Help me reply to my mom.

Generic AI gives generic advice.

After Digital Brain:

> Help me reply to my mom.

Your AI can use local context: this person is your mother, the tone should be warm, the thread may be logistical, and the reply should not sound like a work update.

## Try Fake Data

```bash
npm run test:sample
```

This uses fake WhatsApp-style messages in `examples/sample-vault`.

## Privacy

Digital Brain is local-first. It does not upload messages or notes.

WhatsApp support reads the local macOS WhatsApp database when available. This is experimental and unofficial. Outbound messaging uses WhatsApp Web through `whatsapp-web.js`.

Apple iMessage support reads the local macOS Messages `chat.db` when available. If the database is missing or inaccessible and iMessage was selected, `digital-brain run` fails with a clear setup error instead of silently skipping it.

Slack support reads Slack workspace export JSON. LinkedIn support reads LinkedIn data archive CSV files when LinkedIn includes the relevant files in your archive.

Relationship labels are working notes, not truth. You can edit them with `relationship_overrides.json`.

Always-on and outbound modes depend on local app databases, WhatsApp Web, and third-party behavior that can change. You are responsible for consent, privacy, message content, and anything sent from your machine.

## Status

Alpha. Expect rough edges.

Do not use this for regulated, emergency, legal, medical, or safety-critical communication.

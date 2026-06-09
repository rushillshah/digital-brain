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

The installer asks a short setup quiz: history window, primary focus, refresh cadence, always-on interval, active time window, outbound mode, and AI adapter setup.

For local development:

```bash
npm install
node ./bin/digital-brain.js init ./Digital Brain\ Vault
```

## What It Creates

- An Obsidian-friendly Markdown vault.
- AI adapter files for Codex, Claude, and Gemini.
- WhatsApp Mac import tools.
- Relationship extraction and interpretation models.
- Optional WhatsApp Web outbound sender.
- A refresh script based on your install-time answers.
- An optional always-on watch script that can pull every N minutes.

## What It Can Do

- Import recent WhatsApp history from the local macOS WhatsApp database.
- Build relationship profiles from message patterns.
- Infer provisional roles like parent, family group, work collaborator, close personal contact, or unlabeled contact.
- Generate "how to continue this relationship" notes.
- Create AI-readable memory files for future prompts.
- Draft WhatsApp sends by default, and only send with explicit `--yes`.
- Enforce an AI-disclosure guard after repeated AI-assisted sends.

## Core Commands

```bash
digital-brain init ./Digital Brain\ Vault
digital-brain sync-whatsapp --vault ./Digital Brain\ Vault --days 30
digital-brain extract --vault ./Digital Brain\ Vault --days 30
digital-brain interpret --vault ./Digital Brain\ Vault --days 30
digital-brain send-whatsapp --vault ./Digital Brain\ Vault --to "Name" --message "text"
```

The sender drafts by default. Add `--yes` to actually send.

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

Relationship labels are working notes, not truth. You can edit them with `relationship_overrides.json`.

## Status

Alpha. Expect rough edges.

Do not use this for regulated, emergency, legal, medical, or safety-critical communication.

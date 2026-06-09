# Selfprint

Your private digital imprint for AI.

Selfprint turns your local notes and message history into an editable memory vault that AI assistants can use to understand your people, patterns, tone, and context.

It is not a chatbot. It is not a cloud memory service. It is the local context layer that makes your existing AI tools feel less generic.

## Why

AI tools are powerful, but they usually start every personal question cold.

Selfprint gives them a structured, local map of:

- who matters in your life
- how you communicate with different people
- which relationships are warm, operational, difficult, or high-context
- what tone to use when drafting replies
- what not to assume

## Install

```bash
npx selfprint init
```

For local development:

```bash
npm install
node ./bin/selfprint.js init ./Selfprint\ Vault
```

## What It Creates

- An Obsidian-friendly Markdown vault.
- AI adapter files for Codex, Claude, and Gemini.
- WhatsApp Mac import tools.
- Relationship extraction and interpretation models.
- Optional WhatsApp Web outbound sender.

## What It Can Do

- Import recent WhatsApp history from the local macOS WhatsApp database.
- Build relationship profiles from message patterns.
- Infer provisional roles like parent, family group, work collaborator, close personal contact, or unlabeled contact.
- Generate "how to continue this relationship" notes.
- Create AI-readable memory files for future prompts.
- Draft WhatsApp sends by default, and only send with explicit `--yes`.

## Core Commands

```bash
selfprint init ./Selfprint\ Vault
selfprint sync-whatsapp --vault ./Selfprint\ Vault --days 30
selfprint extract --vault ./Selfprint\ Vault --days 30
selfprint interpret --vault ./Selfprint\ Vault --days 30
selfprint send-whatsapp --vault ./Selfprint\ Vault --to "Name" --message "text"
```

The sender drafts by default. Add `--yes` to actually send.

## Example

Before Selfprint:

> Help me reply to my mom.

Generic AI gives generic advice.

After Selfprint:

> Help me reply to my mom.

Your AI can use local context: this person is your mother, the tone should be warm, the thread may be logistical, and the reply should not sound like a work update.

## Try Fake Data

```bash
npm run test:sample
```

This uses fake WhatsApp-style messages in `examples/sample-vault`.

## Privacy

Selfprint is local-first. It does not upload messages or notes.

WhatsApp support reads the local macOS WhatsApp database when available. This is experimental and unofficial. Outbound messaging uses WhatsApp Web through `whatsapp-web.js`.

Relationship labels are working notes, not truth. You can edit them with `relationship_overrides.json`.

## Status

Alpha. Expect rough edges.

Do not use this for regulated, emergency, legal, medical, or safety-critical communication.

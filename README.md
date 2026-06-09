# Selfprint

Selfprint builds a local personal context layer for AI assistants.

It turns local notes and WhatsApp history into an editable vault of relationship models, communication patterns, and AI-usable memory. Your data stays on your machine.

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
- Relationship extraction and interpretation.
- Optional WhatsApp Web outbound sender.

## Core Commands

```bash
selfprint init ./Selfprint\ Vault
selfprint sync-whatsapp --vault ./Selfprint\ Vault --days 30
selfprint extract --vault ./Selfprint\ Vault --days 30
selfprint interpret --vault ./Selfprint\ Vault --days 30
selfprint send-whatsapp --vault ./Selfprint\ Vault --to "Name" --message "text"
```

The sender drafts by default. Add `--yes` to actually send.

## Try Fake Data

```bash
npm run test:sample
```

This uses fake WhatsApp-style messages in `examples/sample-vault`.

## Privacy

Selfprint is local-first. It does not upload messages or notes.

WhatsApp support reads the local macOS WhatsApp database when available. This is experimental and unofficial. Outbound messaging uses WhatsApp Web through `whatsapp-web.js`.

## Status

Alpha. Expect rough edges.

Do not use this for regulated, emergency, legal, medical, or safety-critical communication.

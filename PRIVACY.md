# Privacy

Digital Brain is local-first. It is designed to turn your own exports, local notes, and local app data into an editable Obsidian-compatible vault.

## What It Reads

- WhatsApp for Mac local database, when selected and available.
- Apple Messages local `chat.db`, when selected and permissioned.
- Slack export archives.
- LinkedIn data archives.
- Gmail Takeout `.mbox` files.
- Google Calendar `.ics` files.
- Local Git repositories or repos cloned through your GitHub CLI.
- Existing Obsidian/vault files that you point it at.

## Where It Stores Data

- Raw/source data: `08 Sources/`
- Generated drafts and derived JSON/Markdown: source-specific folders under `08 Sources/` and generated memory folders.
- AI-readable summaries: `06 AI Memory/`
- Human-editable notes and overrides: normal vault notes plus override files.
- Optional local telemetry copies: `~/.digital-brain/telemetry-events.jsonl`

## What It Does Not Upload By Default

- Messages.
- Names or chat names.
- Vault files.
- API keys.
- Raw exports.
- Generated memory.

Hosted providers are optional. If you choose OpenAI, Anthropic, xAI, Codex CLI, or another provider, Digital Brain sends the reply prompt/context needed for that request to that provider.

## Telemetry

Telemetry is off by default. If enabled, it is intended to include only setup and error metadata: event name, version, platform, selected sources, setup mode, schedule, provider, and error step/status. It must not include message content, names, API keys, vault paths, raw exports, or generated memory.

## Outbound Messaging

Outbound messaging can send from your machine. Keep allowlists narrow, use draft mode first, and do not use auto-reply for sensitive, regulated, emergency, medical, legal, financial, or safety-critical communication.

See also: [docs/PRIVACY.md](docs/PRIVACY.md).

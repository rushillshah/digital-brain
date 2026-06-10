# Security Policy

Digital Brain handles private local data, app databases, generated memory, API keys, browser sessions, and optional outbound messaging. Treat security and privacy reports as high priority.

## Supported Versions

The latest npm release and `main` branch receive security fixes.

## Reporting A Concern

Do not open public issues that include secrets, private messages, database paths, auth tokens, QR/session data, or exploit details.

Open a minimal public issue titled `Security: private report needed`, or contact the maintainer privately if you already have a private channel.

## Defaults

- No cloud API is called by default.
- Messages and generated memory are stored as local files.
- Telemetry is opt-in, anonymous, and content-free.
- Outbound sending requires explicit configuration and should be tested in draft mode first.

## High-Risk Areas

- WhatsApp Web sessions and send automation.
- Local WhatsApp and iMessage databases.
- Provider prompts sent to OpenAI, Anthropic, xAI, Codex CLI, or other configured providers.
- Logs, telemetry, screenshots, and generated vault files.
- Raw source data under `08 Sources/`.

## Maintainer Checklist

- Never ask users to paste real chats into public issues.
- Never commit `.npmrc`, API keys, browser sessions, generated vaults, or local databases.
- Keep raw data, derived data, and AI-readable memory boundaries visible.
- Make network/API behavior explicit in docs and prompts.

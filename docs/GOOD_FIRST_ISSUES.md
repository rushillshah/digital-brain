# Good First Issues

These are intentionally scoped so contributors can help without touching private data or unsafe outbound behavior.

## Integrations

- Add fake Slack export fixtures for channels, DMs, and thread replies.
- Add fake LinkedIn archive fixtures for connections and messages.
- Add fake Gmail `.mbox` fixtures with multiple participants and quoted replies.
- Add fake Calendar `.ics` fixtures with recurring meetings and attendees.
- Add repo context fixtures for monorepos, package-only repos, and README-only repos.

## Docs

- Improve setup docs for macOS permissions.
- Add screenshots for common setup errors.
- Add provider setup examples for Ollama, OpenAI, Anthropic, xAI, and Codex.
- Add privacy diagrams for raw data vs derived memory vs AI-readable summaries.

## Safety

- Add tests proving logs do not include message content in metadata-only mode.
- Add tests for outbound allowlists and blocked business/service chats.
- Add tests for corrupt exports and interrupted imports.

## Demo

- Improve fake-data sample vault links so the Obsidian graph is richer.
- Add more fake people, projects, and source nodes.
- Add a script that records a local demo video from fake data only.

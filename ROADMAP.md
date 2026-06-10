# Roadmap

Digital Brain should become a local life/work context layer, not a cloud memory silo.

## Current Focus

- Better Obsidian graph output and fake-data demo assets.
- Safer setup defaults and clearer dependency checks.
- Stronger role and relationship evidence extraction.
- WhatsApp, iMessage, Slack, Microsoft Teams, LinkedIn, Gmail, Calendar, and Git repository context.
- Provider choice for reply assistance: local Ollama, OpenAI, Anthropic, xAI, Codex CLI, and Codex app bridge.

## Near-Term

- Gmail and Calendar importer hardening.
- Slack output/listener beyond draft sends.
- iMessage output/listener beyond draft sends.
- Better GitHub/repo ingestion after init.
- Safer outbound approval queue.
- More fixture-based tests for importers and corrupt exports.
- Better same-person merging across sources.

## Later

- Local dashboard for people, sources, open loops, and graph health.
- Optional graph database export.
- Plugin system for new sources and destinations.
- Packaged desktop app after the CLI is stable.
- Sanitized showcase generator for users to share their own fake/redacted graphs.

## Not Planned As Defaults

- Cloud-hosted personal memory storage.
- Silent telemetry.
- Unbounded auto-send defaults.
- Scraping private services where official exports or local APIs are the safer path.

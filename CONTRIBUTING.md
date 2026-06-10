# Contributing

Digital Brain handles private personal data, local app databases, and optional message sending. Treat every change as privacy-sensitive.

## Ground Rules

- Do not commit real vaults, chats, screenshots with names/messages, API keys, browser sessions, `.npmrc`, `.wwebjs_cache`, or local database files.
- Use fake fixtures under `examples/` or `tests/` for demos and tests.
- Keep raw source data, derived generated data, and AI-readable memory clearly separated.
- Default to local-first behavior. Any network/API use must be explicit and documented.
- Do not add silent telemetry. Analytics must be opt-in, anonymous, and content-free.
- Outbound messaging changes need extra care: no silent auto-send paths, no disclosure bypasses without loud warnings, and no broad sending defaults.
- Relationship labels are draft suggestions, not truth. Prefer user overrides and conservative wording.

## Pull Requests

PRs should include:

- What changed and why.
- Which data sources are affected: WhatsApp, iMessage, Slack, LinkedIn, repositories, or core vault logic.
- Privacy/safety impact, especially for auto-reply, outbound sending, logs, or provider prompts.
- Tests run, with exact commands.
- Screenshots/GIFs only when UI or docs output changes, with all personal data redacted.

Keep PRs focused. Avoid bundling unrelated provider, import, UI, and docs changes together.

## Testing

Run the smallest relevant set first, then broaden for risky changes:

```bash
npm test
python3 -m py_compile scripts/*.py
```

For importer changes, test with fake or redacted exports. For outbound WhatsApp changes, test draft mode before send mode.

## Versioning

This package follows semver:

- Patch: docs, tests, bug fixes, safer defaults, compatible importer fixes.
- Minor: new commands, new integrations, new provider options, new config fields with safe defaults.
- Major: breaking config/schema changes, changed default safety behavior, removed commands, incompatible vault layout changes.

Update `package.json`, `package-lock.json`, docs, and release notes together when preparing a publish.

## Security Reports

Do not open public issues containing secrets, private chat excerpts, auth tokens, or exploit details. Open a minimal issue saying there is a security/privacy concern, then coordinate privately.

# Privacy Model

Digital Brain is designed for local use.

- Messages are read from local files or local app databases.
- Relationship models are written as local Markdown and JSON.
- No cloud API is called by default.
- Ollama interpretation is local when enabled.
- WhatsApp sending uses a local WhatsApp Web session.
- Raw source data stays under `08 Sources/`; normal AI context should use `06 AI Memory/` and human notes under `04 People/`.

Things to be careful about:

- Do not commit a generated vault.
- Do not paste private message exports into GitHub issues.
- Do not enable outbound sending without understanding the risk.
- Treat WhatsApp database access, iMessage database access, and WhatsApp Web automation as local, permission-sensitive integrations that can change.
- Always-on mode runs on your machine and inherits your local permissions.
- You are responsible for consent, privacy, message content, and sends made from your machine.
- Treat relationship labels as editable working notes, not truth.

# Setup

Digital Brain is designed to install with one npm command:

```bash
npx digital-brain
```

The default command opens the interactive terminal dashboard. Use arrow keys to create a vault, connect sources, run ingest, estimate AI graph review cost, or open setup checks.

Scriptable setup still works:

```bash
npx digital-brain init
digital-brain run
```

npm installs the Node dependencies. No pip install is needed; the Python scripts only use the standard library.

## What Init Checks

After the quiz, `init` runs a setup check for:

- Node 20+
- npm package dependencies
- Python 3
- Python sqlite3 support
- selected live source access:
  - WhatsApp for Mac local database access
  - WhatsApp Desktop/Web linked-device sync
  - Apple Messages local database access
- selected import source instructions:
  - Slack export link
  - Microsoft Teams export instructions
  - LinkedIn archive link
  - Gmail Takeout instructions
  - Google Calendar export instructions
- optional Ollama

Run the check again anytime:

```bash
digital-brain doctor
```

For a short usage guide:

```bash
digital-brain tutorial
digital-brain help
```

## What Cannot Be Silently Installed

Digital Brain does not silently install or configure system apps.

- WhatsApp for Mac must be installed and logged in by the user.
- WhatsApp Desktop/Web sync requires scanning a QR with WhatsApp > Linked devices.
- Apple Messages must be opened by the user before iMessage sync can read `~/Library/Messages/chat.db`.
- macOS may require Full Disk Access for the terminal app.
- Ollama is optional and only needed for local LLM workflows.

Useful links:

- Node: https://nodejs.org
- WhatsApp for Mac: https://faq.whatsapp.com/686469079565350
- Apple Messages: https://support.apple.com/guide/messages/welcome/mac
- Slack exports: https://slack.com/help/articles/201658943-Export-your-workspace-data
- Microsoft Teams exports: use Microsoft Graph/Teams export tooling, then run `digital-brain import-teams --input <export.zip|folder>`
- LinkedIn data archive: https://www.linkedin.com/help/linkedin/answer/a566336

Once setup passes, normal use is:

```bash
digital-brain run
```

`run` executes the live local sources selected during setup, imports any saved export paths, extracts relationships, and updates the vault indexes. `digital-brain ingest` is the same command.

If you skipped export paths during setup, pass them to `run`:

```bash
digital-brain run --sources slack --slack-input ./slack-export.zip
digital-brain run --sources teams --teams-input ./teams-export.zip
digital-brain run --sources linkedin --linkedin-input ./linkedin-archive.zip
digital-brain run --sources gmail --gmail-input ./takeout.mbox --self-email you@example.com
digital-brain run --sources calendar --calendar-input ./calendar.ics
```

Direct source-specific commands still exist for debugging:

```bash
digital-brain sync-whatsapp --days 30
digital-brain sync-whatsapp-web --days 30
digital-brain sync-imessage --days 30
```

## Which Commands Should I Run?

Start with this:

```bash
npx digital-brain init
digital-brain run
```

To connect everything supported:

```bash
digital-brain init --sources all
digital-brain run --sources all
```

For one-off export ingestion without re-running setup:

```bash
digital-brain run --sources slack,teams,gmail --slack-input ./slack-export.zip --teams-input ./teams-export.zip --gmail-input ./takeout.mbox --self-email you@example.com
```

One-time AI graph review:

```bash
digital-brain graph-ai
digital-brain graph-ai --provider anthropic --yes
```

The first command estimates tokens and cost. The second sends the compact graph bundle to the provider and writes reviewed graph notes back into the vault.

Best with a local LLM:

```bash
ollama pull llama3.1
digital-brain auto-whatsapp --allow "Name" --provider ollama --model llama3.1
```

Hosted providers work too:

```bash
OPENAI_API_KEY="sk-..." digital-brain auto-whatsapp --allow "Name" --provider openai --model gpt-4.1-mini --yes
ANTHROPIC_API_KEY="sk-ant-..." digital-brain auto-whatsapp --allow "Name" --provider anthropic --yes
XAI_API_KEY="xai-..." digital-brain auto-whatsapp --allow "Name" --provider xai --yes
```

`XCI_API_KEY`, `--xci-api-key`, and `--provider xci` are accepted as aliases for xAI.

# Setup

Digital Brain is designed to install with one npm command:

```bash
npx digital-brain init
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
  - LinkedIn archive link
- optional Ollama

Run the check again anytime:

```bash
digital-brain doctor
```

For a short usage guide:

```bash
digital-brain tutorial
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
- LinkedIn data archive: https://www.linkedin.com/help/linkedin/answer/a566336

Once setup passes, normal use is:

```bash
digital-brain run
```

`run` executes the live local sources selected during setup. If a selected live source does not exist or cannot be opened, the command fails with a setup error.

Optional imports:

```bash
digital-brain import-slack --input ./slack-export.zip
digital-brain import-linkedin --input ./linkedin-archive.zip
digital-brain extract
digital-brain interpret
```

Useful direct sync commands:

```bash
digital-brain sync-whatsapp --days 30
digital-brain sync-whatsapp-web --days 30
digital-brain sync-imessage --days 30
```

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
- WhatsApp for Mac local database access
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
- macOS may require Full Disk Access for the terminal app.
- Ollama is optional and only needed for local LLM workflows.

Once setup passes, normal use is:

```bash
digital-brain run
```

Optional imports:

```bash
digital-brain import-slack --input ./slack-export.zip
digital-brain import-linkedin --input ./linkedin-archive.zip
digital-brain extract
digital-brain interpret
```

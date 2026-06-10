# Automations

Digital Brain can run manually, on your machine, or through an AI/workspace automation system.

The generated vault includes:

```bash
Tools/digital-brain-refresh.sh
```

That script runs sync, extract, and interpret using the install-time config.

After setup, the normal manual command is:

```bash
digital-brain run
```

`init` saves your default vault in `~/.digital-brain/config.json`, so `run` does not need a vault path.

## Configurable At Install

`digital-brain init` asks:

- vault path
- your name
- history window in days
- setup mode: guided or auto mode
- primary focus: relationship memory, reply help, work context
- refresh cadence: manual, daily, hourly, every 30 minutes, or always-on
- refresh interval in minutes for always-on mode, clamped to a minimum of 1
- active time window
- WhatsApp outbound mode
- WhatsApp auto-reply provider: Ollama, OpenAI API, Anthropic API, xAI API, Codex app bridge, or Codex CLI
- whether to add AI adapter pointers

Most questions are multiple choice. Pick with `A/B/C`, `1/2/3`, the exact value, or press Enter to use the displayed default.

Important defaults:

- skipped vault path creates `./Digital Brain Vault` in the current directory
- skipped name uses `Me`
- skipped history window uses 30 days
- skipped focus uses relationship memory
- skipped schedule uses manual refresh
- skipped always-on interval uses 5 minutes, with a hard minimum of 1 minute
- skipped active window uses `08:00-12:00`
- skipped outbound mode uses draft-only
- skipped auto-reply provider uses Ollama
- auto-send mode can be selected during init, but only after the responsibility check
- skipped AI pointers are added during the guided quiz

The answers are saved in:

```bash
digital-brain.config.json
```

## Auto Mode

Choose `Auto mode` during `digital-brain init`, or use:

```bash
digital-brain init --full-auto
```

Auto mode configures local always-on refreshes with a 5 minute default interval. It still uses the local watch script, so it only runs while the machine and runner are awake.

During the guided quiz, always-on, send-with-confirmation, and auto-send require an explicit responsibility check. Pressing Enter does not approve that check. If it is skipped, Digital Brain falls back to manual refresh and draft-only outbound.

## Codex App

Use a Codex cron automation pointed at the generated vault.

Prompt:

```text
Run `digital-brain run`. Verify completion and report only counts plus output paths. Do not print private message contents.
```

Example schedule ideas:

- Every morning: `FREQ=DAILY;BYHOUR=8;BYMINUTE=0;BYSECOND=0`
- Every 30 minutes from 8-12: `FREQ=DAILY;BYHOUR=8,9,10,11;BYMINUTE=0,30;BYSECOND=0`
- Weekly: `FREQ=WEEKLY;BYDAY=MO;BYHOUR=9;BYMINUTE=0;BYSECOND=0`

If Codex supports minute-based schedules in your environment, point it at `Tools/digital-brain-refresh.sh`. Otherwise, use the generated local watch script below.

## Always-On Local Watch

For 24/7 local polling, run:

```bash
/path/to/vault/Tools/digital-brain-watch.sh
```

The generated script loops forever and sleeps for `refreshIntervalMinutes`. The minimum supported interval is 1 minute. A practical default is 5 minutes.

## WhatsApp Auto-Reply

`digital-brain auto-whatsapp` is separate from refresh automation. It uses WhatsApp Web for live incoming messages and Ollama, OpenAI, Anthropic, xAI, or Codex for reply generation. On startup it scans unread WhatsApp Web chats, then continues listening for new messages.

Draft-only:

```bash
digital-brain auto-whatsapp --allow "Mom" --model llama3.1
digital-brain auto-whatsapp --contact "+15551234567" --model llama3.1
OPENAI_API_KEY="sk-..." digital-brain auto-whatsapp --allow-all --provider openai --model gpt-4.1-mini
ANTHROPIC_API_KEY="sk-ant-..." digital-brain auto-whatsapp --allow-all --provider anthropic
XAI_API_KEY="xai-..." digital-brain auto-whatsapp --allow-all --provider xai
digital-brain auto-whatsapp --allow-all --provider codex
digital-brain auto-whatsapp --allow-all --provider codex-app
```

Auto-send while the command is running:

```bash
digital-brain auto-whatsapp --allow "Mom" --model llama3.1 --yes
digital-brain auto-whatsapp --contact "+15551234567" --model llama3.1 --yes
OPENAI_API_KEY="sk-..." digital-brain auto-whatsapp --allow-all --provider openai --model gpt-4.1-mini --yes
ANTHROPIC_API_KEY="sk-ant-..." digital-brain auto-whatsapp --allow-all --provider anthropic --yes
XAI_API_KEY="xai-..." digital-brain auto-whatsapp --allow-all --provider xai --yes
digital-brain auto-whatsapp --allow-all --provider codex --yes
digital-brain auto-whatsapp --allow-all --provider codex-app --yes
```

Broad auto-send for personal chats:

```bash
digital-brain auto-whatsapp --allow-all --model llama3.1 --yes
```

`--allow-all` still skips likely business, notification, OTP, bank, delivery, and support chats by default. Use `--include-businesses` only when you intentionally want those chats included. Prefer explicit `--allow "Name"` or `--contact "+15551234567"` for friends and family.

When `--allow-all` is used, Digital Brain asks once before the first AI reply to each new chat and stores allow/deny decisions in `08 Sources/WhatsApp/Outbound/auto-reply-whitelist.json`. Use `--auto-approve-new-chats` only for fully unattended first sends.

Provider options:

```bash
digital-brain auto-whatsapp --allow "Mom" --provider ollama --model llama3.1 --yes
OPENAI_API_KEY="sk-..." digital-brain auto-whatsapp --allow "Mom" --provider openai --model gpt-4.1-mini --yes
ANTHROPIC_API_KEY="sk-ant-..." digital-brain auto-whatsapp --allow "Mom" --provider anthropic --yes
XAI_API_KEY="xai-..." digital-brain auto-whatsapp --allow "Mom" --provider xai --yes
digital-brain auto-whatsapp --allow "Mom" --provider codex --yes
digital-brain auto-whatsapp --allow "Mom" --provider codex-app --yes
digital-brain auto-whatsapp --allow "Mom" --provider codex --codex-command "codex exec --skip-git-repo-check" --yes
```

`--provider openai` sends the same Digital Brain prompt and relevant vault context to the OpenAI API. Set `OPENAI_API_KEY`, pass `--openai-api-key`, or choose OpenAI during `digital-brain init` and paste the key into the local vault config.

`--provider anthropic` uses Anthropic's Messages API with default model `claude-sonnet-4-6`. Set `ANTHROPIC_API_KEY`, pass `--anthropic-api-key`, or choose Anthropic during `digital-brain init` and paste the key into the local vault config.

`--provider xai` uses xAI's OpenAI-compatible Responses API with default model `grok-4.3`. Set `XAI_API_KEY`, pass `--xai-api-key`, or choose xAI during `digital-brain init` and paste the key into the local vault config.

Pause/resume while `auto-whatsapp` is running:

```bash
digital-brain pause-whatsapp
digital-brain resume-whatsapp
digital-brain pause-whatsapp --chat "Mom"
digital-brain resume-whatsapp --chat "Mom"
digital-brain whatsapp-status
```

The running bot checks the pause file before each reply, so these commands do not require restarting the bot. When the `auto-whatsapp` terminal is focused, press `Space` to pause/resume globally and `Ctrl+C` to exit.

`--provider codex` runs a local Codex command. If `--codex-command` contains `{promptFile}`, Digital Brain writes the prompt to a temp file and substitutes the path; otherwise it pipes the prompt to stdin.

`--provider codex-app` does not use the Codex CLI. It writes request JSON files to `08 Sources/WhatsApp/Outbound/Codex App Bridge/requests` and waits for response JSON files in `responses`. A Codex desktop automation or live Codex thread must process those request files and write `{"reply":"..."}` to the provided `responsePath`.

When `codex-app` is selected during `init`, Digital Brain creates `Tools/Codex App Bridge Automation.md` with the exact Codex automation prompt and bridge folder paths.

If you selected `Auto-send while running` during init, `auto-whatsapp` can send without `--yes` while it is running:

```bash
digital-brain auto-whatsapp --allow "Mom" --model llama3.1
```

Guardrails:

- with `--provider ollama`, requires Ollama running locally
- with `--provider ollama`, requires the selected model, for example `ollama pull llama3.1`
- with `--provider openai`, requires `OPENAI_API_KEY`, `--openai-api-key`, or `openaiApiKey` in the vault config
- with `--provider anthropic`, requires `ANTHROPIC_API_KEY`, `--anthropic-api-key`, or `anthropicApiKey` in the vault config
- with `--provider xai`, requires `XAI_API_KEY`, `--xai-api-key`, or `xaiApiKey` in the vault config
- with `--provider codex`, requires a working local Codex command
- with `--provider codex-app`, requires a Codex desktop bridge automation/thread that writes response files
- requires `--allow "Name"` or `--contact "+15551234567"` unless `--allow-all` is explicitly passed
- single-threads reply generation so multiple incoming chats do not trigger overlapping sends
- debounces live messages per chat, default 12000ms, so message bursts get one combined reply; override with `--reply-debounce-ms <ms>`
- supports global and per-chat pause with `pause-whatsapp` / `resume-whatsapp`
- supports a focused-terminal hotkey: `Space` toggles global pause/resume
- skips likely business, notification, OTP, and service chats unless `--include-businesses` is passed or the chat is explicitly allowlisted by name or contact number
- processes unread chats on startup unless `--no-process-unread` is passed
- skips groups unless `--include-groups` is passed
- uses a per-chat cooldown, default 20 minutes
- no reply cap by default, so conversations can continue naturally; pass `--max-replies-per-chat <n>` to add one
- logs metadata by default, not full sent text
- enforces the AI disclosure rule after repeated AI-assisted sends, but does not repeat it after that chat has already received a disclosure

## Local Cron

Run every 30 minutes from 8-12:

```cron
0,30 8-11 * * * /path/to/vault/Tools/digital-brain-refresh.sh >> /path/to/vault/08\ Sources/WhatsApp/.sync-state/cron.log 2>&1
```

Run every 5 minutes all day:

```cron
*/5 * * * * /path/to/vault/Tools/digital-brain-refresh.sh >> /path/to/vault/08\ Sources/WhatsApp/.sync-state/cron.log 2>&1
```

## macOS launchd

Use launchd if you want a native background job. Be aware macOS privacy permissions may block background access to app databases unless Terminal or the runner has Full Disk Access.

## Cloud

Cloud schedulers are useful for notes and non-sensitive sources, but WhatsApp Mac database sync requires the local Mac.

Recommended cloud pattern:

1. Keep WhatsApp ingestion local.
2. Sync only generated, reviewed memory summaries if you choose.
3. Run cloud jobs on sanitized vault summaries, not raw chats.

Do not upload raw WhatsApp exports to a cloud automation unless you explicitly want that privacy tradeoff.

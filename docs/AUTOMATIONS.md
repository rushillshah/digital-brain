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

`digital-brain auto-whatsapp` is separate from refresh automation. It uses WhatsApp Web for live incoming messages and Ollama for local reply generation. On startup it scans unread WhatsApp Web chats, then continues listening for new messages.

Draft-only:

```bash
digital-brain auto-whatsapp --allow "Mom" --model llama3.1
```

Auto-send while the command is running:

```bash
digital-brain auto-whatsapp --allow "Mom" --model llama3.1 --yes
```

Broad auto-send for personal chats:

```bash
digital-brain auto-whatsapp --allow-all --model llama3.1 --yes
```

`--allow-all` still skips likely business, notification, OTP, bank, delivery, and support chats by default. Use `--include-businesses` only when you intentionally want those chats included. Prefer explicit `--allow "Name"` for friends and family.

If you selected `Auto-send while running` during init, `auto-whatsapp` can send without `--yes` while it is running:

```bash
digital-brain auto-whatsapp --allow "Mom" --model llama3.1
```

Guardrails:

- requires Ollama running locally
- requires the selected model, for example `ollama pull llama3.1`
- requires `--allow "Name"` unless `--allow-all` is explicitly passed
- skips likely business, notification, OTP, and service chats unless `--include-businesses` is passed or the chat is explicitly allowlisted
- processes unread chats on startup unless `--no-process-unread` is passed
- skips groups unless `--include-groups` is passed
- uses a per-chat cooldown, default 20 minutes
- caps replies per chat per run, default 5
- logs metadata by default, not full sent text
- still enforces the AI disclosure rule after repeated AI-assisted sends

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

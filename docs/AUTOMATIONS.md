# Automations

Digital Brain can run manually, on your machine, or through an AI/workspace automation system.

The generated vault includes:

```bash
Tools/digital-brain-refresh.sh
```

That script runs sync, extract, and interpret using the install-time config.

## Configurable At Install

`digital-brain init` asks:

- vault path
- your name
- history window in days
- primary focus: relationship memory, reply help, work context
- refresh cadence: manual, daily, hourly, every 30 minutes, or always-on
- refresh interval in minutes for always-on mode, clamped to a minimum of 1
- active time window
- WhatsApp outbound mode
- whether to add AI adapter pointers

The answers are saved in:

```bash
digital-brain.config.json
```

## Codex App

Use a Codex cron automation pointed at the generated vault.

Prompt:

```text
Run `Tools/digital-brain-refresh.sh`. Verify completion and report only counts plus output paths. Do not print private message contents.
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

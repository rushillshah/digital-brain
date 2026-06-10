# Growth

Digital Brain should grow through proof, useful defaults, and contributors. Do not fake npm downloads, stars, comments, or installs. Fake metrics pollute product signal and can get the package or repository flagged.

## Demo Proof

Generate fake-data demo assets:

```bash
digital-brain demo-proof --out ./demo-assets
```

This writes:

- `sample-vault/`: fake-data vault for screenshots.
- `terminal-demo.txt`: sanitized terminal transcript.
- `screenshot-cards.html`: screenshot-ready cards for README, X, LinkedIn, Reddit, or Product Hunt.
- `README.md`: launch copy and links.

Use fake data only. Blur or avoid names, message text, API keys, browser sessions, and private vault paths.

## Contributor Loop

The repo includes:

- GitHub issue templates for bugs, integrations, privacy concerns, and showcases.
- A pull request template with privacy and safety checks.
- An issue onboarding workflow that labels new issues and comments setup instructions.

Good public calls to action:

```text
If this worked, star the repo or open an integration request.
```

```text
If you want to help, pick a good first issue or add a fake-data integration fixture.
```

## Opt-In Telemetry

Telemetry is disabled by default. During `digital-brain init`, users can opt in to anonymous setup/error telemetry. Opt-in events are recorded locally. They are sent over the network only when `DIGITAL_BRAIN_TELEMETRY_URL` is set.

Allowed event data:

- event name
- package version
- platform/architecture/Node version
- selected source names
- setup mode, schedule, provider, and error step/status

Never collect:

- message content
- names or chat names
- vault paths
- API keys
- raw exports
- generated memory

Set a custom endpoint when running your own collection service:

```bash
DIGITAL_BRAIN_TELEMETRY_URL="https://example.com/events" digital-brain run
```

For local testing without network sends:

```bash
DIGITAL_BRAIN_TELEMETRY_OFFLINE=1 digital-brain run
```

Local event copies are written to:

```text
~/.digital-brain/telemetry-events.jsonl
```

## Launch Order

1. GitHub README with demo assets.
2. npm package install CTA.
3. Reddit posts with fake-data screenshots.
4. LinkedIn/X posts with a short demo video.
5. Product Hunt later, after setup and demos are smooth.

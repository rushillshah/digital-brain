# Examples

Use fake or redacted data only when sharing examples publicly.

## Before / After Reply Context

Before Digital Brain:

```text
User: help me reply to Maya
AI: Sure, what should you say?
```

After Digital Brain:

```text
User: help me reply to Maya
AI context:
- Maya is a close friend and launch collaborator.
- Style: short, lowercase-heavy, warm.
- Open loop: send the graph video and npm link.
- Reply should not over-explain.

Draft:
yeah sending the graph video + npm link today
```

## Work Context

```text
User: what am i working on with Arjun?
AI context:
- Arjun appears in Slack, GitHub, and Calendar.
- Active project: Digital Brain Launch.
- Repo context: onboarding, README, integrations, CI.
- Next useful action: review launch docs and graph screenshot.
```

## Obsidian Graph Demo

Run:

```bash
digital-brain showcase --out ./demo-assets
```

Then open the generated fake-data vault in Obsidian and capture:

- overview note
- native graph view
- person reply context
- conversation continuity

The public README assets in `docs/assets/` are built from fake data.

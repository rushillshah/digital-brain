# Integrations

Digital Brain prefers official exports and local files over scraping.

## WhatsApp

```bash
digital-brain run
```

WhatsApp support reads the local macOS WhatsApp database when available.

## Slack

Use Slack's official workspace export ZIP or extracted export folder.

```bash
digital-brain import-slack --input ./slack-export.zip
digital-brain extract
digital-brain interpret
```

Slack export access depends on workspace permissions and plan. Public-channel exports are common; private channels and DMs may require elevated workspace export permissions.

## LinkedIn

Use LinkedIn's official data archive ZIP or extracted archive folder.

```bash
digital-brain import-linkedin --input ./linkedin-archive.zip
digital-brain extract
digital-brain interpret
```

Digital Brain does not scrape LinkedIn or automate the LinkedIn app. LinkedIn controls what appears in the archive, so connections/messages may vary by account and export type.

## Useful Next Sources

- Calendar: recurring people, meetings, and relationship cadence.
- Email export: long-form relationship and work context, but privacy risk is high.
- GitHub: collaborators, repos, review style, and work graph.
- Linear/Jira: active projects and operating context.
- Contacts: canonical names, phones, companies, and relationship labels.
- Browser bookmarks/read-later: interests and research areas.

The right rule: add sources that improve memory without turning Digital Brain into spyware. Prefer explicit exports, clear consent, and source-specific privacy controls.

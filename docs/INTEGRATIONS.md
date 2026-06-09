# Integrations

Digital Brain prefers official exports and local files over scraping.

## WhatsApp

```bash
digital-brain run
```

WhatsApp support reads the local macOS WhatsApp database when available.

Dependency selected in setup:

- Install/open WhatsApp for Mac and log in: https://faq.whatsapp.com/686469079565350
- If macOS blocks access, grant Full Disk Access to the terminal app running Digital Brain.
- If WhatsApp is selected and the database is missing, `digital-brain run` exits with an error.

## Apple iMessage

```bash
digital-brain sync-imessage --days 30
digital-brain extract
digital-brain interpret
```

iMessage support reads the local macOS Messages database at `~/Library/Messages/chat.db`.

Dependency selected in setup:

- Open Messages on macOS at least once: https://support.apple.com/guide/messages/welcome/mac
- If macOS blocks access, grant Full Disk Access to the terminal app running Digital Brain.
- If iMessage is selected and the database is missing, `digital-brain run` exits with an error.

## Slack

Use Slack's official workspace export ZIP or extracted export folder.

```bash
digital-brain import-slack --input ./slack-export.zip
digital-brain extract
digital-brain interpret
```

Slack export access depends on workspace permissions and plan. Public-channel exports are common; private channels and DMs may require elevated workspace export permissions.

Export guide: https://slack.com/help/articles/201658943-Export-your-workspace-data

## LinkedIn

Use LinkedIn's official data archive ZIP or extracted archive folder.

```bash
digital-brain import-linkedin --input ./linkedin-archive.zip
digital-brain extract
digital-brain interpret
```

Digital Brain does not scrape LinkedIn or automate the LinkedIn app. LinkedIn controls what appears in the archive, so connections/messages may vary by account and export type.

Data archive guide: https://www.linkedin.com/help/linkedin/answer/a566336

## Useful Next Sources

- Calendar: recurring people, meetings, and relationship cadence.
- Email export: long-form relationship and work context, but privacy risk is high.
- GitHub: collaborators, repos, review style, and work graph.
- Linear/Jira: active projects and operating context.
- Contacts: canonical names, phones, companies, and relationship labels.
- Browser bookmarks/read-later: interests and research areas.

The right rule: add sources that improve memory without turning Digital Brain into spyware. Prefer explicit exports, clear consent, and source-specific privacy controls.

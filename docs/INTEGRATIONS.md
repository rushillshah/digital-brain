# Integrations

Digital Brain prefers official exports and local files over scraping.

## WhatsApp

```bash
digital-brain run
```

WhatsApp has two ingestion paths:

- `sync-whatsapp`: reads the local macOS WhatsApp database when available.
- `sync-whatsapp-web`: uses a linked WhatsApp Web/Desktop session as a cross-platform fallback for Mac, Windows, and Linux.

Dependency selected in setup:

- Install/open WhatsApp for Mac and log in: https://faq.whatsapp.com/686469079565350
- If macOS blocks access, grant Full Disk Access to the terminal app running Digital Brain.
- If WhatsApp is selected and the database is missing, `digital-brain run` exits with an error.
- For WhatsApp Desktop/Web, run `digital-brain sync-whatsapp-web --days 30` and scan the QR from WhatsApp > Linked devices on first use.

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

When Slack exports include user profile metadata, Digital Brain stores title, department, company/team, email domain, and admin/bot flags as source metadata for relationship inference.

Export guide: https://slack.com/help/articles/201658943-Export-your-workspace-data

### Slack outbound

Digital Brain can send a Slack message through a Slack bot token:

```bash
SLACK_BOT_TOKEN="xoxb-..." digital-brain send-slack --channel C123 --message "text" --yes
```

Without `--yes`, the command logs a draft only. The token needs Slack `chat:write` permission and the bot must be in the target channel. This is an outbound primitive, not a full Slack auto-reply loop yet.

## Microsoft Teams

Use Microsoft Teams message export JSON from Microsoft Graph/Teams export tooling. Digital Brain accepts a ZIP, extracted folder, or directory containing Teams JSON files with Graph-style `chatMessage` records.

Export API docs: https://learn.microsoft.com/en-us/microsoftteams/export-teams-content

```bash
digital-brain import-teams --input ./teams-export.zip --self-email you@example.com
digital-brain extract
digital-brain interpret
```

Teams import writes normalized records under `08 Sources/Microsoft Teams/Raw` and month chat notes under `08 Sources/Microsoft Teams/ChatsByMonth`. When exports include Graph user fields, Digital Brain stores job title, department, company, email domain, office location, and channel/team IDs as source metadata for relationship inference. Use `--privacy-mode metadata-only` to store message metadata without bodies.

### Microsoft Teams outbound

Digital Brain can send Teams messages through Microsoft Graph:

```bash
MICROSOFT_GRAPH_TOKEN="..." digital-brain send-teams --chat 19:abc --message "text" --yes
MICROSOFT_GRAPH_TOKEN="..." digital-brain send-teams --team <team-id> --channel <channel-id> --message "text" --yes
```

Without `--yes`, the command logs a draft only. The token must be a Microsoft Graph access token with permission to send chat/channel messages in the target tenant. This is an outbound primitive, not a full Teams auto-reply loop yet.

Graph send docs:

- Chat messages: https://learn.microsoft.com/en-us/graph/api/chat-post-messages
- Channel messages: https://learn.microsoft.com/en-us/graph/api/channel-post-messages

## LinkedIn

Use LinkedIn's official data archive ZIP or extracted archive folder.

```bash
digital-brain import-linkedin --input ./linkedin-archive.zip
digital-brain extract
digital-brain interpret
```

Digital Brain does not scrape LinkedIn or automate the LinkedIn app. LinkedIn controls what appears in the archive, so connections/messages may vary by account and export type.

Data archive guide: https://www.linkedin.com/help/linkedin/answer/a566336

## Gmail

Use Gmail's official Google Takeout export. Digital Brain reads `.mbox` files directly or from a Takeout ZIP/folder.

```bash
digital-brain import-gmail --input ./takeout.mbox --self-email you@example.com
digital-brain extract
digital-brain interpret
```

Gmail output includes normalized raw email records plus `06 AI Memory/Email Context.md` with active threads, frequent people/domains, and latest snippets. Use `--privacy-mode metadata-only` to omit email bodies from raw records.

Google Takeout: https://takeout.google.com/

## Google Calendar

Use Google Calendar's official `.ics` export from Google Takeout.

```bash
digital-brain import-calendar --input ./calendar.ics --past-days 365 --future-days 365
```

Calendar output includes `08 Sources/Google Calendar/Raw/events.jsonl` plus `06 AI Memory/Calendar Context.md` with upcoming/recent events, frequent people, recurring event counts, and schedule context.

Google Takeout: https://takeout.google.com/

## iMessage outbound

Digital Brain can send through the macOS Messages app using AppleScript:

```bash
digital-brain send-imessage --to "+15551234567" --message "text" --yes
```

Without `--yes`, the command logs a draft only. This requires macOS, Messages login, and the recipient must be reachable by Messages. This is an outbound primitive, not a full iMessage auto-reply loop yet.

## Useful Next Sources

- GitHub: collaborators, repos, review style, and work graph.
- Linear/Jira: active projects and operating context.
- Contacts: canonical names, phones, companies, and relationship labels.
- Browser bookmarks/read-later: interests and research areas.

The right rule: add sources that improve memory without turning Digital Brain into spyware. Prefer explicit exports, clear consent, and source-specific privacy controls.

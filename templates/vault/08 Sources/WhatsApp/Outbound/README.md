# WhatsApp Outbound

Outbound sending is disabled unless you explicitly run the sender with `--yes`.

Draft:

```bash
digital-brain send-whatsapp --to "Name" --message "Text"
```

Send:

```bash
digital-brain send-whatsapp --to "Name" --message "Text" --yes
```

Disclosure rule:

- If Digital Brain sends multiple AI-assisted messages in the same chat, it must disclose that AI is helping after roughly 2 messages.
- The sender enforces this on the third AI-assisted send within 24 hours unless the message already includes a disclosure.

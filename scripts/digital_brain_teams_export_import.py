#!/usr/bin/env python3
import argparse
import html
import json
import re
import tempfile
import zipfile
from datetime import datetime, timezone
from pathlib import Path


def main():
    args = parse_args()
    with unpack(args.input) as source:
        import_export(
            args.vault.resolve(),
            source,
            args.days,
            args.self_name,
            args.self_email,
            args.privacy_mode,
        )


def import_export(vault, source, days, self_name, self_email, privacy_mode):
    teams = vault / "08 Sources" / "Microsoft Teams"
    raw_dir = teams / "Raw"
    chats_dir = teams / "ChatsByMonth"
    state_dir = teams / ".sync-state"
    for directory in (raw_dir, chats_dir, state_dir):
        directory.mkdir(parents=True, exist_ok=True)

    seen_path = state_dir / "teams-seen-message-ids.json"
    seen = load_seen(seen_path)
    cutoff = datetime.now(timezone.utc).timestamp() - days * 24 * 60 * 60 if days else None
    added = 0

    for file_path in sorted(source.rglob("*.json")):
        for item in iter_messages(load_json(file_path, None)):
            record = teams_record(item, file_path, source, self_name, self_email, privacy_mode)
            if not record:
                continue
            timestamp = parse_timestamp(record["timestamp"])
            if cutoff and timestamp and timestamp < cutoff:
                continue
            if record["id"] in seen:
                continue
            append_jsonl(raw_dir, record)
            append_markdown(chats_dir, record)
            seen.add(record["id"])
            added += 1

    save_seen(seen_path, seen)
    print(f"Imported {added} Microsoft Teams messages.")


def iter_messages(value):
    if value is None:
        return
    if isinstance(value, list):
        for item in value:
            yield from iter_messages(item)
        return
    if not isinstance(value, dict):
        return
    if looks_like_message(value):
        yield value
    for key in ("value", "messages", "chatMessages", "items", "data"):
        child = value.get(key)
        if isinstance(child, (list, dict)):
            yield from iter_messages(child)


def looks_like_message(value):
    return any(value.get(key) for key in ("body", "content", "text")) and any(
        value.get(key) for key in ("createdDateTime", "lastModifiedDateTime", "timestamp", "id")
    )


def teams_record(item, file_path, source_root, self_name, self_email, privacy_mode):
    timestamp = normalize_timestamp(item.get("createdDateTime") or item.get("lastModifiedDateTime") or item.get("timestamp"))
    if not timestamp:
        return None
    body = message_body(item)
    if not body and privacy_mode != "metadata-only":
        return None
    author = message_author(item)
    author_email = message_author_email(item)
    author_metadata = message_author_metadata(item)
    from_me = is_self(author, author_email, self_name, self_email)
    chat_name = message_chat_name(item, file_path, source_root)
    chat_id = item.get("chatId") or nested_get(item, "chat", "id") or nested_get(item, "channelIdentity", "channelId") or chat_name
    is_channel = bool(nested_get(item, "channelIdentity", "channelId") or item.get("channelId") or item.get("teamId"))
    is_group = is_channel or str(item.get("chatType") or "").lower() in {"group", "meeting"}
    message_id = item.get("id") or f"{chat_id}-{timestamp}-{hash_text(body)}"
    return {
        "id": f"teams-{chat_id}-{message_id}",
        "source": "Microsoft Teams export",
        "sourceSystem": "Microsoft Teams",
        "timestamp": timestamp,
        "chatName": chat_name,
        "chatId": chat_id,
        "teamId": nested_get(item, "channelIdentity", "teamId") or item.get("teamId"),
        "channelId": nested_get(item, "channelIdentity", "channelId") or item.get("channelId"),
        "isGroup": is_group,
        "fromMe": from_me,
        "author": self_name if from_me and self_name else author,
        "authorId": nested_get(item, "from", "user", "id") or nested_get(item, "from", "application", "id") or "",
        "authorEmail": author_email,
        "authorMetadata": author_metadata,
        "replyToId": item.get("replyToId") or "",
        "messageType": item.get("messageType") or item.get("type") or "",
        "body": "" if privacy_mode == "metadata-only" else body,
        "bodyHash": hash_text(body) if privacy_mode == "metadata-only" else "",
        "bodyCharCount": len(body),
    }


def message_body(item):
    body = item.get("body")
    if isinstance(body, dict):
        content = body.get("content") or ""
    else:
        content = body or item.get("content") or item.get("text") or ""
    return strip_html(content)


def message_author(item):
    user = nested_get(item, "from", "user")
    application = nested_get(item, "from", "application")
    device = nested_get(item, "from", "device")
    if isinstance(user, dict):
        return user.get("displayName") or user.get("userPrincipalName") or user.get("email") or user.get("id") or "Unknown"
    if isinstance(application, dict):
        return application.get("displayName") or application.get("id") or "Teams App"
    if isinstance(device, dict):
        return device.get("displayName") or device.get("id") or "Teams Device"
    return item.get("from") or item.get("author") or item.get("sender") or "Unknown"


def message_author_email(item):
    user = nested_get(item, "from", "user")
    if isinstance(user, dict):
        return user.get("email") or user.get("userPrincipalName") or ""
    return item.get("authorEmail") or item.get("senderEmail") or ""


def message_author_metadata(item):
    user = nested_get(item, "from", "user")
    if not isinstance(user, dict):
        user = {}
    metadata = {
        "jobTitle": user.get("jobTitle") or item.get("authorJobTitle") or item.get("jobTitle") or "",
        "department": user.get("department") or item.get("authorDepartment") or item.get("department") or "",
        "company": user.get("companyName") or item.get("authorCompany") or item.get("companyName") or "",
        "officeLocation": user.get("officeLocation") or item.get("officeLocation") or "",
        "email": user.get("email") or user.get("userPrincipalName") or item.get("authorEmail") or "",
        "userPrincipalName": user.get("userPrincipalName") or "",
        "userIdentityType": user.get("userIdentityType") or nested_get(item, "from", "user", "userIdentityType") or "",
        "teamId": nested_get(item, "channelIdentity", "teamId") or item.get("teamId") or "",
        "channelId": nested_get(item, "channelIdentity", "channelId") or item.get("channelId") or "",
    }
    return {key: value for key, value in metadata.items() if value not in ("", None)}


def message_chat_name(item, file_path, source_root):
    channel = item.get("channelDisplayName") or nested_get(item, "channelIdentity", "channelDisplayName")
    team = item.get("teamDisplayName") or nested_get(item, "channelIdentity", "teamDisplayName")
    chat = item.get("chatDisplayName") or nested_get(item, "chat", "displayName") or item.get("chatName")
    if team and channel:
        return f"{team} / {channel}"
    if channel:
        return channel
    if chat:
        return chat
    try:
        relative = file_path.relative_to(source_root)
        parts = [part for part in relative.parts[:-1] if part]
        if parts:
            return " / ".join(parts[-2:])
    except ValueError:
        pass
    return item.get("chatId") or item.get("id") or "Microsoft Teams"


def is_self(author, author_email, self_name, self_email):
    if self_email and normalize(author_email) == normalize(self_email):
        return True
    if self_name and normalize(author) == normalize(self_name):
        return True
    return False


def normalize_timestamp(value):
    if value is None:
        return ""
    if isinstance(value, (int, float)):
        return datetime.fromtimestamp(float(value), tz=timezone.utc).isoformat()
    text = str(value).strip()
    if not text:
        return ""
    if text.isdigit():
        timestamp = int(text)
        if timestamp > 10_000_000_000:
            timestamp = timestamp / 1000
        return datetime.fromtimestamp(timestamp, tz=timezone.utc).isoformat()
    if text.endswith("Z"):
        text = f"{text[:-1]}+00:00"
    try:
        parsed = datetime.fromisoformat(text)
    except ValueError:
        return ""
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc).isoformat()


def parse_timestamp(value):
    if not value:
        return None
    try:
        return datetime.fromisoformat(str(value)).timestamp()
    except ValueError:
        return None


def strip_html(value):
    text = str(value or "")
    text = re.sub(r"(?i)<br\s*/?>", "\n", text)
    text = re.sub(r"(?i)</p\s*>", "\n", text)
    text = re.sub(r"<[^>]+>", " ", text)
    text = html.unescape(text)
    return " ".join(text.split())


def append_jsonl(raw_dir, record):
    with (raw_dir / f"{record['timestamp'][:10]}.jsonl").open("a", encoding="utf-8") as handle:
        handle.write(json.dumps(record, ensure_ascii=False) + "\n")


def append_markdown(chats_dir, record):
    directory = chats_dir / record["timestamp"][:7]
    directory.mkdir(parents=True, exist_ok=True)
    file_path = directory / f"{safe_filename(record['chatName'])}.md"
    if not file_path.exists():
        file_path.write_text(f"# {escape_markdown(record['chatName'])}\n\nImported from Microsoft Teams export.\n\n", encoding="utf-8")
    body = escape_markdown(record.get("body") or "")
    author = escape_markdown(record.get("author") or "Unknown")
    with file_path.open("a", encoding="utf-8") as handle:
        handle.write(f"- {record['timestamp']} | {author}: {body}\n")


def load_json(path, fallback):
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return fallback


def load_seen(path):
    if not path.exists():
        return set()
    try:
        return set(json.loads(path.read_text(encoding="utf-8")))
    except Exception:
        return set()


def save_seen(path, seen):
    temp = path.with_name(f"{path.name}.tmp")
    temp.write_text(json.dumps(sorted(seen), indent=2), encoding="utf-8")
    temp.replace(path)


def safe_filename(value):
    cleaned = "".join("-" if char in '/:\\?%*"<>|' else char for char in str(value or "Microsoft Teams"))
    return (" ".join(cleaned.split()).strip() or "Microsoft Teams")[:120]


def escape_markdown(value):
    return str(value or "").replace("\\", "\\\\").replace("[", "\\[").replace("]", "\\]").replace("|", "\\|")


def hash_text(value):
    import hashlib

    return hashlib.sha256(str(value or "").encode("utf-8")).hexdigest()


def nested_get(value, *keys):
    current = value
    for key in keys:
        if not isinstance(current, dict):
            return None
        current = current.get(key)
    return current


def normalize(value):
    return " ".join(str(value or "").lower().split())


def unpack(input_path):
    input_path = input_path.resolve()
    if input_path.is_dir():
        return NullContext(input_path)
    temp = tempfile.TemporaryDirectory()
    with zipfile.ZipFile(input_path) as archive:
        archive.extractall(temp.name)
    return TempContext(Path(temp.name), temp)


class NullContext:
    def __init__(self, path):
        self.path = path

    def __enter__(self):
        return self.path

    def __exit__(self, *_):
        return False


class TempContext:
    def __init__(self, path, temp):
        self.path = path
        self.temp = temp

    def __enter__(self):
        return self.path

    def __exit__(self, *_):
        self.temp.cleanup()
        return False


def parse_args():
    parser = argparse.ArgumentParser()
    parser.add_argument("--vault", type=Path, required=True)
    parser.add_argument("--input", type=Path, required=True)
    parser.add_argument("--days", type=int, default=365)
    parser.add_argument("--self-name", default="Me")
    parser.add_argument("--self-email", default="")
    parser.add_argument("--privacy-mode", default="standard", choices=("standard", "metadata-only"))
    return parser.parse_args()


if __name__ == "__main__":
    main()

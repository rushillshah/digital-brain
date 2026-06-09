#!/usr/bin/env python3
import argparse
import json
import tempfile
import zipfile
from datetime import datetime, timezone
from pathlib import Path


def main():
    args = parse_args()
    with unpack(args.input) as source:
        import_export(args.vault.resolve(), source, args.days)


def import_export(vault, source, days):
    slack = vault / "08 Sources" / "Slack"
    raw_dir = slack / "Raw"
    chats_dir = slack / "ChatsByMonth"
    state_dir = slack / ".sync-state"
    for directory in (raw_dir, chats_dir, state_dir):
        directory.mkdir(parents=True, exist_ok=True)

    users = load_users(source / "users.json")
    conversations = load_conversations(source)
    seen_path = state_dir / "slack-seen-message-ids.json"
    seen = load_seen(seen_path)
    cutoff = datetime.now(timezone.utc).timestamp() - days * 24 * 60 * 60 if days else None
    added = 0

    for folder in sorted(path for path in source.iterdir() if path.is_dir()):
        conversation = conversations.get(folder.name, {"name": folder.name, "is_group": True})
        chat_name = conversation.get("name") or folder.name
        is_group = conversation.get("is_group", True)
        for file in sorted(folder.glob("*.json")):
            for item in load_json(file, []):
                if "ts" not in item or not item.get("text"):
                    continue
                timestamp = float(item["ts"])
                if cutoff and timestamp < cutoff:
                    continue
                record = slack_record(item, users, chat_name, is_group, folder.name)
                if record["id"] in seen:
                    continue
                append_jsonl(raw_dir, record)
                append_markdown(chats_dir, record)
                seen.add(record["id"])
                added += 1

    save_seen(seen_path, seen)
    print(f"Imported {added} Slack messages.")


def slack_record(item, users, chat_name, is_group, conversation_id):
    user_id = item.get("user") or item.get("bot_id") or "unknown"
    author = users.get(user_id, user_id)
    timestamp = datetime.fromtimestamp(float(item["ts"]), tz=timezone.utc).isoformat()
    return {
        "id": f"slack-{conversation_id}-{item['ts']}",
        "source": "Slack export",
        "sourceSystem": "Slack",
        "timestamp": timestamp,
        "chatName": chat_name,
        "chatId": conversation_id,
        "isGroup": is_group,
        "fromMe": False,
        "author": author,
        "authorId": user_id,
        "body": item.get("text") or "",
    }


def load_users(path):
    users = {}
    for item in load_json(path, []):
        user_id = item.get("id")
        if not user_id:
            continue
        profile = item.get("profile") or {}
        users[user_id] = profile.get("real_name") or profile.get("display_name") or item.get("name") or user_id
    return users


def load_conversations(source):
    conversations = {}
    for filename in ("channels.json", "groups.json", "dms.json", "mpims.json"):
        for item in load_json(source / filename, []):
            conversation_id = item.get("id") or item.get("name")
            if not conversation_id:
                continue
            conversations[conversation_id] = {
                "name": item.get("name") or item.get("name_normalized") or conversation_id,
                "is_group": not filename == "dms.json",
            }
    return conversations


def append_jsonl(raw_dir, record):
    with (raw_dir / f"{record['timestamp'][:10]}.jsonl").open("a", encoding="utf-8") as f:
        f.write(json.dumps(record, ensure_ascii=False) + "\n")


def append_markdown(chats_dir, record):
    directory = chats_dir / record["timestamp"][:7]
    directory.mkdir(parents=True, exist_ok=True)
    file_path = directory / f"{safe_filename(record['chatName'])}.md"
    if not file_path.exists():
        file_path.write_text(f"# {record['chatName']}\n\nSynced from Slack export.\n\n", encoding="utf-8")
    body = " ".join((record.get("body") or "").split())
    with file_path.open("a", encoding="utf-8") as f:
        f.write(f"- {record['timestamp']} | {record['author']}: {body}\n")


def load_json(path, fallback):
    if not path.exists():
        return fallback
    return json.loads(path.read_text(encoding="utf-8"))


def load_seen(path):
    if not path.exists():
        return set()
    try:
        return set(json.loads(path.read_text(encoding="utf-8")))
    except Exception:
        return set()


def save_seen(path, seen):
    path.write_text(json.dumps(sorted(seen), indent=2), encoding="utf-8")


def safe_filename(value):
    cleaned = "".join("-" if char in '/:\\?%*"<>|' else char for char in value)
    return (" ".join(cleaned.split()).strip() or "Unknown Chat")[:120]


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
    return parser.parse_args()


if __name__ == "__main__":
    main()

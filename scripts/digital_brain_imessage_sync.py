#!/usr/bin/env python3
import argparse
import hashlib
import json
import sqlite3
import time
from datetime import datetime, timezone
from pathlib import Path

CORE_DATA_EPOCH_OFFSET = 978_307_200
DEFAULT_DB = Path.home() / "Library" / "Messages" / "chat.db"


def main():
    args = parse_args()
    if not args.db.exists():
        raise SystemExit(
            f"Apple Messages database not found: {args.db}\n"
            "Open Messages on macOS and grant Terminal Full Disk Access if macOS blocks access."
        )

    vault = args.vault.resolve()
    source_dir = vault / "08 Sources" / "iMessage"
    raw_dir = source_dir / "Raw"
    chats_dir = source_dir / "ChatsByMonth"
    state_dir = source_dir / ".sync-state"
    for directory in (raw_dir, chats_dir, state_dir):
        directory.mkdir(parents=True, exist_ok=True)

    seen_path = state_dir / "imessage-seen-message-ids.json"
    seen = load_seen(seen_path)
    added = sync_once(args, seen, raw_dir, chats_dir)
    save_seen(seen_path, seen)
    print(f"Imported {added} iMessage messages.")


def sync_once(args, seen, raw_dir, chats_dir):
    cutoff = datetime.now(timezone.utc).timestamp() - args.days * 24 * 60 * 60 if args.days else None
    conn = sqlite3.connect(f"file:{args.db}?mode=ro", uri=True)
    conn.row_factory = sqlite3.Row
    rows = conn.execute(
        """
        SELECT m.ROWID message_pk, m.guid guid, m.date message_date,
               m.is_from_me is_from_me, m.text text, m.service service,
               h.id handle_id,
               c.ROWID chat_pk, c.display_name display_name, c.chat_identifier chat_identifier
        FROM message m
        LEFT JOIN handle h ON h.ROWID = m.handle_id
        LEFT JOIN chat_message_join cmj ON cmj.message_id = m.ROWID
        LEFT JOIN chat c ON c.ROWID = cmj.chat_id
        WHERE m.text IS NOT NULL
          AND length(m.text) > 0
        ORDER BY m.date ASC, m.ROWID ASC
        """
    ).fetchall()
    conn.close()

    added = 0
    for row in rows:
        record = row_to_record(row, args.self_name, args.privacy_mode)
        if cutoff and datetime.fromisoformat(record["timestamp"]).timestamp() < cutoff:
            continue
        if args.chat and args.chat.lower() not in record["chatName"].lower():
            continue
        if record["id"] in seen:
            continue
        append_jsonl(raw_dir, record)
        append_markdown(chats_dir, record, args.markdown_mode)
        seen.add(record["id"])
        added += 1
    return added


def row_to_record(row, self_name, privacy_mode):
    timestamp = apple_timestamp(row["message_date"])
    body = row["text"] or ""
    from_me = bool(row["is_from_me"])
    chat_name = row["display_name"] or row["chat_identifier"] or row["handle_id"] or "iMessage"
    return {
        "id": compound_id(row, timestamp),
        "source": "Apple Messages chat.db",
        "sourceSystem": "iMessage",
        "timestamp": timestamp,
        "chatPk": row["chat_pk"],
        "chatName": chat_name,
        "chatIdentifier": row["chat_identifier"],
        "isGroup": bool(row["display_name"]) or str(row["chat_identifier"] or "").startswith("chat"),
        "fromMe": from_me,
        "author": self_name if from_me else (row["handle_id"] or "Unknown"),
        "handleId": row["handle_id"],
        "service": row["service"],
        "body": "" if privacy_mode == "metadata-only" else body,
        "bodyHash": hashlib.sha256(body.encode("utf-8")).hexdigest() if privacy_mode == "metadata-only" else "",
        "bodyCharCount": len(body),
    }


def apple_timestamp(value):
    raw = float(value or 0)
    seconds = raw / 1_000_000_000 if abs(raw) > 10_000_000_000 else raw
    return datetime.fromtimestamp(seconds + CORE_DATA_EPOCH_OFFSET, tz=timezone.utc).isoformat()


def compound_id(row, timestamp):
    return "::".join([
        "imessage",
        str(row["chat_pk"] or row["chat_identifier"] or row["handle_id"] or "unknown-chat"),
        str(row["guid"] or "no-guid"),
        str(row["message_pk"] or "no-pk"),
        timestamp,
    ])


def append_jsonl(raw_dir, record):
    with (raw_dir / f"{record['timestamp'][:10]}.jsonl").open("a", encoding="utf-8") as f:
        f.write(json.dumps(record, ensure_ascii=False) + "\n")


def append_markdown(chats_dir, record, mode):
    if mode == "none":
        return
    directory = chats_dir / record["timestamp"][:7]
    directory.mkdir(parents=True, exist_ok=True)
    file_path = directory / f"{safe_filename(record['chatName'])}.md"
    if not file_path.exists():
        write_text_atomic(file_path, f"# {escape_markdown(record['chatName'])}\n\nSynced from Apple Messages.\n\n")
    speaker = escape_markdown(record["author"])
    body = escape_markdown(" ".join(record["body"].split()))
    with file_path.open("a", encoding="utf-8") as f:
        f.write(f"- {record['timestamp']} | {speaker}: {body}\n")


def load_seen(path):
    if not path.exists():
        return set()
    try:
        return set(json.loads(path.read_text(encoding="utf-8")))
    except Exception:
        return set()


def save_seen(path, seen):
    write_text_atomic(path, json.dumps(sorted(seen), indent=2))


def safe_filename(value):
    cleaned = "".join("-" if char in '/:\\?%*"<>|' else char for char in value)
    return (" ".join(cleaned.split()).strip() or "iMessage")[:120]


def escape_markdown(value):
    text = str(value).replace("\n", " ").replace("\r", " ")
    return text.replace("\\", "\\\\").replace("[", "\\[").replace("]", "\\]").replace("|", "\\|")


def write_text_atomic(path, content):
    temp = path.with_name(f"{path.name}.{time.time_ns()}.tmp")
    temp.write_text(content, encoding="utf-8")
    temp.replace(path)


def parse_args():
    parser = argparse.ArgumentParser()
    parser.add_argument("--vault", type=Path, required=True)
    parser.add_argument("--days", type=int, default=30)
    parser.add_argument("--chat", default="")
    parser.add_argument("--db", type=Path, default=DEFAULT_DB)
    parser.add_argument("--self-name", default="Me")
    parser.add_argument("--markdown-mode", choices=["chat", "month", "none"], default="none")
    parser.add_argument("--privacy-mode", choices=["standard", "metadata-only"], default="standard")
    return parser.parse_args()


if __name__ == "__main__":
    main()

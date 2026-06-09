#!/usr/bin/env python3
import argparse
import hashlib
import json
import sqlite3
import time
from datetime import datetime, timezone
from pathlib import Path

CORE_DATA_EPOCH_OFFSET = 978_307_200
DEFAULT_DB = Path.home() / "Library/Group Containers/group.net.whatsapp.WhatsApp.shared/ChatStorage.sqlite"


def main():
    args = parse_args()
    vault = args.vault.resolve()
    whats_app = vault / "08 Sources" / "WhatsApp"
    raw_dir = whats_app / "Raw"
    chats_dir = whats_app / "Chats"
    state_dir = whats_app / ".sync-state"
    seen_path = state_dir / "mac-seen-message-ids.json"
    for directory in (raw_dir, chats_dir, state_dir):
        directory.mkdir(parents=True, exist_ok=True)

    seen = load_seen(seen_path)
    total = 0
    while True:
        added = sync_once(args, seen, raw_dir, chats_dir, whats_app)
        total += added
        save_seen(seen_path, seen)
        print(f"Added {added} new messages. Total this run: {total}.")
        if not args.live:
            break
        time.sleep(args.interval)


def sync_once(args, seen, raw_dir, chats_dir, whats_app):
    if not args.db.exists():
        raise SystemExit(f"WhatsApp database not found: {args.db}")

    cutoff = time.time() - args.days * 24 * 60 * 60 - CORE_DATA_EPOCH_OFFSET
    conn = sqlite3.connect(f"file:{args.db}?mode=ro", uri=True)
    conn.row_factory = sqlite3.Row
    rows = conn.execute(
        """
        SELECT m.Z_PK message_pk, m.ZSTANZAID stanza_id, m.ZMESSAGEDATE message_date,
               m.ZISFROMME is_from_me, m.ZFROMJID from_jid, m.ZTOJID to_jid,
               m.ZPUSHNAME push_name, m.ZTEXT text, m.ZMESSAGETYPE message_type,
               c.Z_PK chat_pk, c.ZPARTNERNAME chat_name, c.ZCONTACTJID chat_jid,
               c.ZSESSIONTYPE session_type
        FROM ZWAMESSAGE m
        LEFT JOIN ZWACHATSESSION c ON c.Z_PK = m.ZCHATSESSION
        WHERE m.ZMESSAGEDATE >= ?
          AND m.ZTEXT IS NOT NULL
          AND length(m.ZTEXT) > 0
        ORDER BY m.ZMESSAGEDATE ASC, m.Z_PK ASC
        """,
        (cutoff,),
    ).fetchall()
    conn.close()

    added = 0
    for row in rows:
        record = row_to_record(row, args.self_name, args.privacy_mode)
        if args.no_groups and record["isGroup"]:
            continue
        if args.chat and args.chat.lower() not in record["chatName"].lower():
            continue
        if record["id"] in seen:
            continue
        append_jsonl(raw_dir, record)
        append_markdown(chats_dir, whats_app, record, args.markdown_mode)
        seen.add(record["id"])
        added += 1
    return added


def row_to_record(row, self_name, privacy_mode):
    timestamp = datetime.fromtimestamp(float(row["message_date"]) + CORE_DATA_EPOCH_OFFSET, tz=timezone.utc).isoformat()
    chat_name = row["chat_name"] or row["chat_jid"] or "Unknown Chat"
    from_me = bool(row["is_from_me"])
    body = row["text"] or ""
    record_id = compound_id(row, timestamp)
    return {
        "id": record_id,
        "source": "WhatsApp Mac app ChatStorage.sqlite",
        "sourceSystem": "WhatsApp",
        "timestamp": timestamp,
        "chatPk": row["chat_pk"],
        "chatName": chat_name,
        "chatJid": row["chat_jid"],
        "isGroup": bool(row["chat_jid"] and "@g.us" in row["chat_jid"]) or row["session_type"] not in (None, 0),
        "fromMe": from_me,
        "author": self_name if from_me else (row["push_name"] or row["from_jid"] or "Unknown"),
        "fromJid": row["from_jid"],
        "toJid": row["to_jid"],
        "messageType": row["message_type"],
        "body": "" if privacy_mode == "metadata-only" else body,
        "bodyHash": hashlib.sha256(body.encode("utf-8")).hexdigest() if privacy_mode == "metadata-only" else "",
        "bodyCharCount": len(body),
    }


def compound_id(row, timestamp):
    parts = [
        "whatsapp",
        str(row["chat_pk"] or row["chat_jid"] or "unknown-chat"),
        str(row["stanza_id"] or "no-stanza"),
        str(row["message_pk"] or "no-pk"),
        timestamp,
    ]
    return "::".join(parts)


def append_jsonl(raw_dir, record):
    with (raw_dir / f"{record['timestamp'][:10]}.jsonl").open("a", encoding="utf-8") as f:
        f.write(json.dumps(record, ensure_ascii=False) + "\n")


def append_markdown(chats_dir, whats_app, record, mode):
    if mode == "none":
        return
    if mode == "month":
        directory = whats_app / "ChatsByMonth" / record["timestamp"][:7]
        directory.mkdir(parents=True, exist_ok=True)
        file_path = directory / f"{safe_filename(record['chatName'])}.md"
    else:
        file_path = chats_dir / f"{safe_filename(record['chatName'])}.md"
    if not file_path.exists():
        write_text_atomic(file_path, f"# {escape_markdown(record['chatName'])}\n\nSynced from WhatsApp Mac app.\n\n")
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
    return (" ".join(cleaned.split()).strip() or "Unknown Chat")[:120]


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
    parser.add_argument("--live", action="store_true")
    parser.add_argument("--interval", type=int, default=60)
    parser.add_argument("--chat", default="")
    parser.add_argument("--no-groups", action="store_true")
    parser.add_argument("--db", type=Path, default=DEFAULT_DB)
    parser.add_argument("--self-name", default="Me")
    parser.add_argument("--markdown-mode", choices=["chat", "month", "none"], default="chat")
    parser.add_argument("--privacy-mode", choices=["standard", "metadata-only"], default="standard")
    return parser.parse_args()


if __name__ == "__main__":
    main()

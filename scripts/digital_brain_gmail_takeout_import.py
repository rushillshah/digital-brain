#!/usr/bin/env python3
import argparse
import email
import hashlib
import json
import mailbox
import re
import tempfile
import time
import zipfile
from collections import Counter, defaultdict
from datetime import datetime, timezone
from email.header import decode_header
from email.utils import getaddresses, parsedate_to_datetime
from pathlib import Path


def main():
    args = parse_args()
    with unpack(args.input) as source:
        import_gmail(args.vault.resolve(), source, args)


def import_gmail(vault, source, args):
    gmail = vault / "08 Sources" / "Gmail"
    raw_dir = gmail / "Raw"
    threads_dir = gmail / "ThreadsByMonth"
    state_dir = gmail / ".sync-state"
    memory_dir = vault / "06 AI Memory"
    for directory in (raw_dir, threads_dir, state_dir, memory_dir):
        directory.mkdir(parents=True, exist_ok=True)

    seen_path = state_dir / "gmail-seen-message-ids.json"
    seen = load_seen(seen_path)
    cutoff = datetime.now(timezone.utc).timestamp() - args.days * 24 * 60 * 60 if args.days else None
    imported = 0
    records = []

    for mbox_path in find_mboxes(source):
        box = mailbox.mbox(mbox_path, create=False)
        for message in box:
            record = email_record(message, args.self_email, args.privacy_mode, mbox_path)
            if not record:
                continue
            if cutoff and datetime.fromisoformat(record["timestamp"]).timestamp() < cutoff:
                continue
            if record["id"] in seen:
                continue
            append_jsonl(raw_dir, record)
            append_markdown(threads_dir, record, args.markdown_mode)
            seen.add(record["id"])
            imported += 1
            records.append(record)
        box.close()

    save_seen(seen_path, seen)
    write_email_memory(memory_dir / "Email Context.md", load_recent_records(raw_dir, args.days))
    print(f"Imported {imported} Gmail messages.")


def email_record(message, self_email, privacy_mode, source_path):
    timestamp = parse_date(message.get("Date"))
    if not timestamp:
        return None
    subject = decode_value(message.get("Subject") or "(no subject)")
    sender = address_list(message.get("From"))
    recipients = address_list(",".join(filter(None, [message.get("To"), message.get("Cc")])))
    sender_email = sender[0]["email"] if sender else ""
    participant_emails = {item["email"].lower() for item in sender + recipients if item.get("email")}
    self_emails = {item.strip().lower() for item in str(self_email or "").split(",") if item.strip()}
    from_me = bool(self_emails and sender_email.lower() in self_emails)
    other_people = [item for item in (recipients if from_me else sender) if item.get("email")]
    chat_name = clean_subject(subject) or (other_people[0]["name"] if other_people else sender_email or "Gmail")
    body = extract_text(message)
    body_hash = hashlib.sha256(body.encode("utf-8")).hexdigest()
    message_id = (message.get("Message-ID") or "").strip()
    return {
        "id": message_id or f"gmail::{timestamp}::{body_hash[:16]}",
        "source": f"Gmail Takeout mbox: {source_path.name}",
        "sourceSystem": "Gmail",
        "timestamp": timestamp,
        "chatName": chat_name,
        "subject": subject,
        "threadKey": normalize_thread(subject),
        "isGroup": len(participant_emails) > 2,
        "fromMe": from_me,
        "author": sender[0]["name"] if sender else sender_email or "Unknown",
        "authorEmail": sender_email,
        "to": [format_address(item) for item in recipients],
        "participantEmails": sorted(participant_emails),
        "body": "" if privacy_mode == "metadata-only" else body,
        "bodyHash": body_hash if privacy_mode == "metadata-only" else "",
        "bodyCharCount": len(body),
    }


def find_mboxes(source):
    if source.is_file() and source.suffix.lower() in {".mbox", ".mbx"}:
        return [source]
    return sorted(path for path in source.rglob("*") if path.is_file() and path.suffix.lower() in {".mbox", ".mbx"})


def parse_date(value):
    if not value:
        return ""
    try:
        dt = parsedate_to_datetime(value)
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt.astimezone(timezone.utc).isoformat()
    except Exception:
        return ""


def decode_value(value):
    parts = []
    for text, charset in decode_header(value or ""):
        if isinstance(text, bytes):
            parts.append(text.decode(charset or "utf-8", errors="replace"))
        else:
            parts.append(text)
    return " ".join("".join(parts).split())


def address_list(value):
    items = []
    for name, address in getaddresses([value or ""]):
        if not address:
            continue
        items.append({"name": decode_value(name) or address, "email": address})
    return items


def format_address(item):
    name = item.get("name") or item.get("email") or ""
    email_address = item.get("email") or ""
    return f"{name} <{email_address}>" if name and name != email_address else email_address


def extract_text(message):
    if message.is_multipart():
        parts = []
        for part in message.walk():
            content_type = part.get_content_type()
            disposition = (part.get("Content-Disposition") or "").lower()
            if content_type != "text/plain" or "attachment" in disposition:
                continue
            parts.append(payload_text(part))
        return clean_body("\n".join(parts))
    return clean_body(payload_text(message))


def payload_text(part):
    payload = part.get_payload(decode=True)
    if payload is None:
        payload = part.get_payload()
        return str(payload or "")
    return payload.decode(part.get_content_charset() or "utf-8", errors="replace")


def clean_body(value):
    text = re.sub(r"\r\n?", "\n", value or "")
    lines = []
    for line in text.splitlines():
        stripped = line.strip()
        if stripped.startswith(">"):
            continue
        if re.match(r"On .+ wrote:$", stripped):
            continue
        lines.append(stripped)
    return "\n".join(line for line in lines if line)[:12000]


def clean_subject(subject):
    cleaned = re.sub(r"^\s*((re|fw|fwd):\s*)+", "", subject or "", flags=re.I).strip()
    return cleaned[:140] or "(no subject)"


def normalize_thread(subject):
    return re.sub(r"[^a-z0-9]+", " ", clean_subject(subject).lower()).strip()


def append_jsonl(raw_dir, record):
    with (raw_dir / f"{record['timestamp'][:10]}.jsonl").open("a", encoding="utf-8") as f:
        f.write(json.dumps(record, ensure_ascii=False) + "\n")


def append_markdown(threads_dir, record, mode):
    if mode == "none":
        return
    directory = threads_dir / record["timestamp"][:7]
    directory.mkdir(parents=True, exist_ok=True)
    file_path = directory / f"{safe_filename(record['chatName'])}.md"
    if not file_path.exists():
        write_text_atomic(file_path, f"# {escape_markdown(record['chatName'])}\n\nImported from Gmail Takeout.\n\n")
    body = escape_markdown(" ".join((record.get("body") or "").split())[:500])
    speaker = "Me" if record.get("fromMe") else record.get("author") or "Unknown"
    with file_path.open("a", encoding="utf-8") as f:
        f.write(f"- {record['timestamp']} | {escape_markdown(speaker)}: {body}\n")


def load_recent_records(raw_dir, days):
    cutoff = datetime.now(timezone.utc).timestamp() - days * 24 * 60 * 60 if days else None
    records = []
    for path in sorted(raw_dir.glob("*.jsonl")):
        with path.open("r", encoding="utf-8") as f:
            for line in f:
                if not line.strip():
                    continue
                record = json.loads(line)
                if cutoff and datetime.fromisoformat(record["timestamp"]).timestamp() < cutoff:
                    continue
                records.append(record)
    return records


def write_email_memory(path, records):
    by_thread = defaultdict(list)
    people = Counter()
    domains = Counter()
    for record in records:
        by_thread[record.get("threadKey") or record.get("chatName")].append(record)
        for participant in record.get("participantEmails") or []:
            people[participant] += 1
            if "@" in participant:
                domains[participant.split("@", 1)[1].lower()] += 1
    threads = sorted(by_thread.values(), key=lambda items: (len(items), items[-1]["timestamp"]), reverse=True)[:20]
    lines = [
        "# Email Context",
        "",
        "Generated from Gmail Takeout. Treat this as searchable professional/personal email memory, not raw truth.",
        "",
        f"- Messages indexed: {len(records)}",
        f"- Top people: {', '.join(name for name, _ in people.most_common(12)) or 'none'}",
        f"- Top domains: {', '.join(name for name, _ in domains.most_common(12)) or 'none'}",
        "",
        "## Active Threads",
        "",
    ]
    for items in threads:
        latest = items[-1]
        direction = "outbound" if latest.get("fromMe") else "inbound"
        participants = ", ".join((latest.get("participantEmails") or [])[:6])
        snippet = " ".join((latest.get("body") or "").split())[:220]
        lines.extend([
            f"### {latest.get('chatName') or latest.get('subject')}",
            f"- Messages: {len(items)}",
            f"- Latest: {latest.get('timestamp')} ({direction})",
            f"- Participants: {participants or 'unknown'}",
            f"- Latest snippet: {snippet or '[metadata only]'}",
            "",
        ])
    write_text_atomic(path, "\n".join(lines).rstrip() + "\n")


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
    return (" ".join(cleaned.split()).strip() or "Gmail")[:120]


def escape_markdown(value):
    text = str(value).replace("\n", " ").replace("\r", " ")
    return text.replace("\\", "\\\\").replace("[", "\\[").replace("]", "\\]").replace("|", "\\|")


def write_text_atomic(path, content):
    temp = path.with_name(f"{path.name}.{time.time_ns()}.tmp")
    temp.write_text(content, encoding="utf-8")
    temp.replace(path)


def unpack(input_path):
    input_path = input_path.resolve()
    if input_path.is_dir() or input_path.suffix.lower() in {".mbox", ".mbx"}:
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
    parser.add_argument("--days", type=int, default=3650)
    parser.add_argument("--self-email", default="")
    parser.add_argument("--markdown-mode", choices=["thread", "month", "none"], default="none")
    parser.add_argument("--privacy-mode", choices=["standard", "metadata-only"], default="standard")
    return parser.parse_args()


if __name__ == "__main__":
    main()

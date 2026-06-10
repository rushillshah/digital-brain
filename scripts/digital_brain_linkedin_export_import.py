#!/usr/bin/env python3
import argparse
import csv
import json
import tempfile
import zipfile
from datetime import datetime, timezone
from pathlib import Path
from digital_brain_safe_zip import safe_extract_zip


def main():
    args = parse_args()
    with unpack(args.input) as source:
        import_archive(args.vault.resolve(), source, args.days)


def import_archive(vault, source, days):
    linkedin = vault / "08 Sources" / "LinkedIn"
    raw_dir = linkedin / "Raw"
    state_dir = linkedin / ".sync-state"
    people_dir = vault / "04 People"
    for directory in (raw_dir, state_dir, people_dir):
        directory.mkdir(parents=True, exist_ok=True)

    cutoff = datetime.now(timezone.utc).timestamp() - days * 24 * 60 * 60 if days else None
    seen_path = state_dir / "linkedin-seen-message-ids.json"
    seen = load_seen(seen_path)
    imported_messages = 0
    imported_connections = write_connections(source, people_dir)

    for file in find_csvs(source, "message"):
        for row in read_csv(file):
            record = message_record(row, file)
            if not record:
                continue
            if cutoff and datetime.fromisoformat(record["timestamp"]).timestamp() < cutoff:
                continue
            if record["id"] in seen:
                continue
            append_jsonl(raw_dir, record)
            seen.add(record["id"])
            imported_messages += 1

    save_seen(seen_path, seen)
    print(f"Imported {imported_messages} LinkedIn messages.")
    print(f"Indexed {imported_connections} LinkedIn connections.")


def write_connections(source, people_dir):
    files = find_csvs(source, "connection")
    if not files:
        return 0
    rows = []
    for file in files:
        rows.extend(read_csv(file))
    lines = ["# LinkedIn Connections", "", "Imported from LinkedIn data archive.", ""]
    count = 0
    for row in rows:
        name = first_value(row, ["First Name", "FirstName", "First name"])
        last = first_value(row, ["Last Name", "LastName", "Last name"])
        full_name = " ".join(part for part in [name, last] if part).strip() or first_value(row, ["Name", "Full Name"])
        company = first_value(row, ["Company", "Company Name"])
        position = first_value(row, ["Position", "Title"])
        connected_on = first_value(row, ["Connected On", "ConnectedOn"])
        if not full_name:
            continue
        detail = ", ".join(part for part in [position, company, connected_on] if part)
        lines.append(f"- {full_name}{f' - {detail}' if detail else ''}")
        count += 1
    if count:
        (people_dir / "LinkedIn Connections.md").write_text("\n".join(lines) + "\n", encoding="utf-8")
    return count


def message_record(row, file):
    body = first_value(row, ["Content", "Message", "Body", "Text"])
    if not body:
        return None
    timestamp = parse_timestamp(first_value(row, ["Date", "Created At", "Timestamp", "Sent Date"]))
    if not timestamp:
        return None
    sender = first_value(row, ["From", "Sender", "Sender Name", "From Name"]) or "Unknown"
    recipients = first_value(row, ["To", "Recipient", "Recipients", "To Name"]) or "Unknown"
    explicit_conversation = first_value(row, ["Conversation Title", "Subject", "Conversation"])
    conversation = explicit_conversation or other_party(sender, recipients)
    return {
        "id": f"linkedin-{file.name}-{timestamp}-{sender}-{hash(body)}",
        "source": "LinkedIn data archive",
        "sourceSystem": "LinkedIn",
        "timestamp": timestamp,
        "chatName": conversation,
        "isGroup": "," in recipients,
        "fromMe": False,
        "author": sender,
        "to": recipients,
        "body": body,
    }


def other_party(sender, recipients):
    if sender and sender.lower() not in {"me", "you"}:
        return sender
    if recipients and recipients.lower() not in {"me", "you"}:
        return recipients.split(",")[0].strip()
    return sender or recipients or "Unknown"


def parse_timestamp(value):
    if not value:
        return ""
    value = value.strip()
    formats = [
        "%Y-%m-%d %H:%M:%S",
        "%Y-%m-%dT%H:%M:%S.%fZ",
        "%Y-%m-%dT%H:%M:%SZ",
        "%m/%d/%Y, %I:%M %p",
        "%m/%d/%Y",
        "%Y-%m-%d",
    ]
    for fmt in formats:
        try:
            return datetime.strptime(value, fmt).replace(tzinfo=timezone.utc).isoformat()
        except ValueError:
            pass
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00")).astimezone(timezone.utc).isoformat()
    except ValueError:
        return ""


def append_jsonl(raw_dir, record):
    with (raw_dir / f"{record['timestamp'][:10]}.jsonl").open("a", encoding="utf-8") as f:
        f.write(json.dumps(record, ensure_ascii=False) + "\n")


def find_csvs(source, needle):
    return sorted(path for path in source.rglob("*.csv") if needle.lower() in path.name.lower())


def read_csv(path):
    with path.open("r", encoding="utf-8-sig", newline="") as f:
        return list(csv.DictReader(f))


def first_value(row, keys):
    for key in keys:
        value = row.get(key)
        if value:
            return value.strip()
    lower = {key.lower(): value for key, value in row.items()}
    for key in keys:
        value = lower.get(key.lower())
        if value:
            return value.strip()
    return ""


def load_seen(path):
    if not path.exists():
        return set()
    try:
        return set(json.loads(path.read_text(encoding="utf-8")))
    except Exception:
        return set()


def save_seen(path, seen):
    path.write_text(json.dumps(sorted(seen), indent=2), encoding="utf-8")


def unpack(input_path):
    input_path = input_path.resolve()
    if input_path.is_dir():
        return NullContext(input_path)
    temp = tempfile.TemporaryDirectory()
    with zipfile.ZipFile(input_path) as archive:
        safe_extract_zip(archive, temp.name)
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
    return parser.parse_args()


if __name__ == "__main__":
    main()

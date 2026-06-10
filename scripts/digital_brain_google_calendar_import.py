#!/usr/bin/env python3
import argparse
import json
import re
import tempfile
import time
import zipfile
from collections import Counter
from datetime import datetime, timedelta, timezone
from pathlib import Path


def main():
    args = parse_args()
    with unpack(args.input) as source:
        import_calendar(args.vault.resolve(), source, args)


def import_calendar(vault, source, args):
    calendar = vault / "08 Sources" / "Google Calendar"
    raw_dir = calendar / "Raw"
    memory_dir = vault / "06 AI Memory"
    for directory in (raw_dir, memory_dir):
        directory.mkdir(parents=True, exist_ok=True)

    start_cutoff = datetime.now(timezone.utc) - timedelta(days=args.past_days) if args.past_days else None
    end_cutoff = datetime.now(timezone.utc) + timedelta(days=args.future_days) if args.future_days else None
    records = []
    for ics_path in find_ics(source):
        for event in parse_ics(ics_path):
            record = event_record(event, ics_path)
            if not record:
                continue
            starts_at = datetime.fromisoformat(record["startsAt"])
            if start_cutoff and starts_at < start_cutoff:
                continue
            if end_cutoff and starts_at > end_cutoff:
                continue
            records.append(record)

    records.sort(key=lambda item: item["startsAt"])
    write_jsonl(raw_dir / "events.jsonl", records)
    write_calendar_memory(memory_dir / "Calendar Context.md", records)
    print(f"Imported {len(records)} Google Calendar events.")


def find_ics(source):
    if source.is_file() and source.suffix.lower() == ".ics":
        return [source]
    return sorted(path for path in source.rglob("*.ics") if path.is_file())


def parse_ics(path):
    events = []
    current = None
    for key, value in unfolded_lines(path):
        if key == "BEGIN" and value == "VEVENT":
            current = {}
        elif key == "END" and value == "VEVENT":
            if current is not None:
                events.append(current)
            current = None
        elif current is not None:
            base_key = key.split(";", 1)[0]
            current.setdefault(base_key, []).append(value)
    return events


def unfolded_lines(path):
    raw_lines = path.read_text(encoding="utf-8", errors="replace").splitlines()
    lines = []
    for line in raw_lines:
        if line.startswith((" ", "\t")) and lines:
            lines[-1] += line[1:]
        else:
            lines.append(line)
    for line in lines:
        if ":" not in line:
            continue
        key, value = line.split(":", 1)
        yield key, unescape_ics(value)


def event_record(event, ics_path):
    starts_at = parse_ics_datetime(first(event, "DTSTART"))
    if not starts_at:
        return None
    ends_at = parse_ics_datetime(first(event, "DTEND"))
    summary = first(event, "SUMMARY") or "(no title)"
    attendees = [extract_attendee(value) for value in event.get("ATTENDEE", [])]
    organizer = extract_attendee(first(event, "ORGANIZER"))
    people = [item for item in [organizer, *attendees] if item]
    uid = first(event, "UID") or f"{ics_path.name}:{starts_at}:{summary}"
    return {
        "id": f"gcal::{uid}",
        "source": f"Google Calendar export: {ics_path.name}",
        "sourceSystem": "Google Calendar",
        "startsAt": starts_at,
        "endsAt": ends_at,
        "timestamp": starts_at,
        "title": summary,
        "calendarName": ics_path.stem,
        "location": first(event, "LOCATION"),
        "description": clean_text(first(event, "DESCRIPTION")),
        "organizer": organizer,
        "attendees": attendees,
        "people": people,
        "isRecurring": bool(event.get("RRULE")),
    }


def parse_ics_datetime(value):
    if not value:
        return ""
    value = value.strip()
    formats = [
        "%Y%m%dT%H%M%SZ",
        "%Y%m%dT%H%M%S",
        "%Y%m%d",
    ]
    for fmt in formats:
        try:
            dt = datetime.strptime(value, fmt)
            if fmt.endswith("Z"):
                dt = dt.replace(tzinfo=timezone.utc)
            else:
                dt = dt.replace(tzinfo=timezone.utc)
            return dt.astimezone(timezone.utc).isoformat()
        except ValueError:
            pass
    return ""


def extract_attendee(value):
    if not value:
        return ""
    email_match = re.search(r"mailto:([^;,\s]+)", value, flags=re.I)
    return email_match.group(1) if email_match else value.strip()


def write_calendar_memory(path, records):
    people = Counter()
    recurring = 0
    now = datetime.now(timezone.utc)
    upcoming = []
    recent = []
    for record in records:
        for person in record.get("people") or []:
            people[person] += 1
        if record.get("isRecurring"):
            recurring += 1
        starts = datetime.fromisoformat(record["startsAt"])
        if starts >= now:
            upcoming.append(record)
        else:
            recent.append(record)
    upcoming = sorted(upcoming, key=lambda item: item["startsAt"])[:20]
    recent = sorted(recent, key=lambda item: item["startsAt"], reverse=True)[:20]
    lines = [
        "# Calendar Context",
        "",
        "Generated from Google Calendar export. Use this for schedule, recurring people, work/life rhythm, and open-loop context.",
        "",
        f"- Events indexed: {len(records)}",
        f"- Recurring events: {recurring}",
        f"- Frequent people: {', '.join(name for name, _ in people.most_common(15)) or 'none'}",
        "",
        "## Upcoming",
        "",
    ]
    for record in upcoming:
        lines.extend(event_lines(record))
    lines.extend(["", "## Recent", ""])
    for record in recent:
        lines.extend(event_lines(record))
    write_text_atomic(path, "\n".join(lines).rstrip() + "\n")


def event_lines(record):
    people = ", ".join((record.get("people") or [])[:8])
    description = " ".join((record.get("description") or "").split())[:180]
    return [
        f"### {record.get('title')}",
        f"- When: {record.get('startsAt')} to {record.get('endsAt') or 'unknown'}",
        f"- Calendar: {record.get('calendarName')}",
        f"- Location: {record.get('location') or 'none'}",
        f"- People: {people or 'none'}",
        f"- Notes: {description or 'none'}",
        "",
    ]


def write_jsonl(path, records):
    write_text_atomic(path, "".join(json.dumps(record, ensure_ascii=False) + "\n" for record in records))


def first(event, key):
    values = event.get(key) or []
    return values[0] if values else ""


def clean_text(value):
    return " ".join(str(value or "").split())


def unescape_ics(value):
    return value.replace("\\n", "\n").replace("\\,", ",").replace("\\;", ";").replace("\\\\", "\\")


def write_text_atomic(path, content):
    temp = path.with_name(f"{path.name}.{time.time_ns()}.tmp")
    temp.write_text(content, encoding="utf-8")
    temp.replace(path)


def unpack(input_path):
    input_path = input_path.resolve()
    if input_path.is_dir() or input_path.suffix.lower() == ".ics":
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
    parser.add_argument("--past-days", type=int, default=365)
    parser.add_argument("--future-days", type=int, default=365)
    return parser.parse_args()


if __name__ == "__main__":
    main()

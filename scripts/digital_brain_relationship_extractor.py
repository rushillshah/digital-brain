#!/usr/bin/env python3
import argparse
import json
import math
import re
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path

POSITIVE = {"love", "thanks", "thank", "amazing", "great", "good", "nice", "perfect", "proud", "happy", "haha", "lol", "miss", "excited", "best", "awesome", "appreciate", "congrats"}
NEGATIVE = {"angry", "annoyed", "upset", "sad", "bad", "hate", "sorry", "fight", "problem", "issue", "wrong", "stress", "fuck", "shit", "worried", "pain", "hurt", "confused"}
LOGISTICS = {"when", "where", "time", "today", "tomorrow", "meeting", "call", "send", "sent", "come", "coming", "reach", "book", "plan", "schedule"}
WORK = {"pr", "repo", "client", "customer", "meeting", "deck", "code", "ship", "product", "founder", "startup", "work", "office", "investor", "sales", "demo", "launch"}
SLANG = {"lol", "lmao", "haha", "hahaha", "bro", "bruh", "wtf", "omg", "ngl", "idk", "rn", "btw", "bc", "pls", "plz", "ya", "yeah", "yep", "nah", "fuck", "shit"}


def main():
    args = parse_args()
    vault = args.vault.resolve()
    whatsapp = vault / "08 Sources" / "WhatsApp"
    output_dir = whatsapp / "Analysis"
    output_dir.mkdir(parents=True, exist_ok=True)
    messages = load_messages(whatsapp / "Raw", args.days)
    profiles = build_profiles(messages, args.min_messages)
    (output_dir / "relationship_profiles.json").write_text(json.dumps(profiles, indent=2, ensure_ascii=False), encoding="utf-8")
    write_markdown(output_dir / "Relationship Map.md", profiles, args.days)
    print(f"Analyzed {len(messages)} messages.")
    print(f"Wrote {len(profiles)} relationship profiles.")


def load_messages(raw_dir, days):
    cutoff = datetime.now(timezone.utc).timestamp() - days * 24 * 60 * 60 if days else None
    messages = []
    for path in sorted(raw_dir.glob("*.jsonl")):
        with path.open("r", encoding="utf-8") as f:
            for line in f:
                if not line.strip():
                    continue
                record = json.loads(line)
                dt = datetime.fromisoformat(record["timestamp"].replace("Z", "+00:00"))
                if cutoff and dt.timestamp() < cutoff:
                    continue
                record["_dt"] = dt
                messages.append(record)
    return messages


def build_profiles(messages, min_messages):
    by_chat = defaultdict(list)
    for message in messages:
        by_chat[message.get("chatName") or "Unknown Chat"].append(message)
    profiles = [profile_chat(name, items) for name, items in by_chat.items() if len(items) >= min_messages]
    profiles.sort(key=lambda p: (p["messageCount"], p["lastSeen"]), reverse=True)
    return profiles


def profile_chat(chat_name, messages):
    count = len(messages)
    outbound = sum(1 for m in messages if m.get("fromMe"))
    inbound = count - outbound
    dates = [m["_dt"] for m in messages]
    text = "\n".join(m.get("body") or "" for m in messages)
    outbound_messages = [m for m in messages if m.get("fromMe") and (m.get("body") or "").strip()]
    words = Counter(re.findall(r"[a-zA-Z']+", text.lower()))
    positive = score(words, POSITIVE)
    negative = score(words, NEGATIVE)
    logistics = score(words, LOGISTICS)
    work = score(words, WORK)
    warmth = (positive + text.count("!") * 0.25) / max(count, 1)
    friction = negative / max(count, 1)
    operational = (logistics + work) / max(count, 1)
    sentiment = normalized_sentiment(positive, negative, count)
    tags = infer_tags(any(m.get("isGroup") for m in messages), count, inbound, outbound, warmth, friction, operational, work, logistics, text.count("?"))
    guess = infer_relationship(tags, count, warmth, friction, operational, work, outbound / count)
    return {
        "chatName": chat_name,
        "messageCount": count,
        "inbound": inbound,
        "outbound": outbound,
        "outboundShare": round(outbound / count, 2),
        "firstSeen": min(dates).date().isoformat(),
        "lastSeen": max(dates).date().isoformat(),
        "isGroup": any(m.get("isGroup") for m in messages),
        "sentimentScore": round(sentiment, 3),
        "warmthScore": round(warmth, 3),
        "frictionScore": round(friction, 3),
        "operationalScore": round(operational, 3),
        "questionCount": text.count("?"),
        "relationshipGuess": guess,
        "tags": tags,
        "typingStyle": typing_style(outbound_messages),
    }


def infer_tags(group, count, inbound, outbound, warmth, friction, operational, work, logistics, questions):
    tags = ["group-chat" if group else "direct-chat"]
    tags.append("high-volume" if count >= 500 else "active" if count >= 100 else "light")
    if warmth > 0.08:
        tags.append("warm")
    if friction > 0.035:
        tags.append("friction-present")
    if operational > 0.12:
        tags.append("logistics-heavy")
    if work > logistics and work > 5:
        tags.append("work-signal")
    if questions / max(count, 1) > 0.25:
        tags.append("question-heavy")
    if outbound / max(count, 1) > 0.7:
        tags.append("user-driving")
    if inbound / max(count, 1) > 0.7:
        tags.append("other-driving")
    return tags


def infer_relationship(tags, count, warmth, friction, operational, work, balance):
    if "group-chat" in tags:
        return "group, likely work/project or operational" if work > 10 else "group, likely social or mixed context"
    if count >= 500 and warmth > 0.06:
        return "close/high-context personal relationship"
    if count >= 200 and operational > 0.1:
        return "active operational relationship"
    if work > 10 and operational > 0.08:
        return "work or project relationship"
    if warmth > 0.08:
        return "warm personal relationship"
    if friction > 0.05:
        return "relationship with friction or emotionally charged moments"
    if balance < 0.25 or balance > 0.75:
        return "asymmetric communication pattern"
    return "general relationship, needs human labeling"


def write_markdown(path, profiles, days):
    lines = ["# Relationship Map", "", f"Window: last {days} days", "", "Generated signals. Treat as editable working notes.", ""]
    for profile in profiles:
        lines.extend([
            f"## {profile['chatName']}",
            "",
            f"- Guess: {profile['relationshipGuess']}",
            f"- Messages: {profile['messageCount']} ({profile['inbound']} inbound, {profile['outbound']} outbound)",
            f"- Dates: {profile['firstSeen']} to {profile['lastSeen']}",
            f"- Scores: sentiment {profile['sentimentScore']}, warmth {profile['warmthScore']}, friction {profile['frictionScore']}, operational {profile['operationalScore']}",
            f"- Tags: {', '.join(profile['tags'])}",
            f"- Typing style: {typing_style_summary(profile['typingStyle'])}",
            "",
        ])
    path.write_text("\n".join(lines), encoding="utf-8")


def score(words, lexicon):
    return sum(words[word] for word in lexicon)


def typing_style(messages):
    bodies = [(m.get("body") or "").strip() for m in messages if (m.get("body") or "").strip()]
    count = len(bodies)
    if not count:
        return {
            "sampleSize": 0,
            "avgChars": 0,
            "avgWords": 0,
            "lowercaseShare": 0,
            "uppercaseShare": 0,
            "questionShare": 0,
            "exclamationShare": 0,
            "emojiShare": 0,
            "slang": [],
            "signature": "no outbound sample",
        }
    word_lists = [re.findall(r"[A-Za-z']+", body) for body in bodies]
    all_words = [word.lower() for words in word_lists for word in words]
    slang = Counter(word for word in all_words if word in SLANG)
    avg_chars = sum(len(body) for body in bodies) / count
    avg_words = sum(len(words) for words in word_lists) / count
    lowercase = sum(1 for body in bodies if has_letters(body) and body == body.lower()) / count
    uppercase = sum(1 for body in bodies if has_letters(body) and body == body.upper()) / count
    questions = sum(1 for body in bodies if "?" in body) / count
    exclaims = sum(1 for body in bodies if "!" in body) / count
    emojis = sum(1 for body in bodies if has_emoji(body)) / count
    return {
        "sampleSize": count,
        "avgChars": round(avg_chars, 1),
        "avgWords": round(avg_words, 1),
        "lowercaseShare": round(lowercase, 2),
        "uppercaseShare": round(uppercase, 2),
        "questionShare": round(questions, 2),
        "exclamationShare": round(exclaims, 2),
        "emojiShare": round(emojis, 2),
        "slang": [word for word, _ in slang.most_common(8)],
        "signature": infer_typing_signature(avg_words, lowercase, questions, exclaims, emojis, slang),
    }


def typing_style_summary(style):
    slang = ", ".join(style.get("slang", [])) or "none"
    return (
        f"{style.get('signature', 'unknown')}; avg {style.get('avgWords', 0)} words; "
        f"lowercase {style.get('lowercaseShare', 0)}; emoji {style.get('emojiShare', 0)}; slang {slang}"
    )


def infer_typing_signature(avg_words, lowercase, questions, exclaims, emojis, slang):
    parts = []
    if avg_words <= 4:
        parts.append("very short")
    elif avg_words <= 10:
        parts.append("short")
    else:
        parts.append("longer-form")
    if lowercase > 0.55:
        parts.append("lowercase-heavy")
    if questions > 0.25:
        parts.append("question-heavy")
    if exclaims > 0.2:
        parts.append("expressive")
    if emojis > 0.2:
        parts.append("emoji-friendly")
    if slang:
        parts.append("slangy")
    return ", ".join(parts)


def has_letters(text):
    return any(char.isalpha() for char in text)


def has_emoji(text):
    return any(ord(char) > 10000 for char in text)


def normalized_sentiment(positive, negative, count):
    if positive + negative == 0:
        return 0
    return ((positive - negative) / (positive + negative)) * min(1, math.log10(count + 1) / 3)


def parse_args():
    parser = argparse.ArgumentParser()
    parser.add_argument("--vault", type=Path, required=True)
    parser.add_argument("--days", type=int, default=30)
    parser.add_argument("--min-messages", type=int, default=20)
    return parser.parse_args()


if __name__ == "__main__":
    main()

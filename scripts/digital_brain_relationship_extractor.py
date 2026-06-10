#!/usr/bin/env python3
import argparse
import json
import math
import re
import time
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path

POSITIVE = {"love", "thanks", "thank", "amazing", "great", "good", "nice", "perfect", "proud", "happy", "haha", "lol", "miss", "excited", "best", "awesome", "appreciate", "congrats"}
NEGATIVE = {"angry", "annoyed", "upset", "sad", "bad", "hate", "sorry", "fight", "problem", "issue", "wrong", "stress", "fuck", "shit", "worried", "pain", "hurt", "confused"}
LOGISTICS = {"when", "where", "time", "today", "tomorrow", "meeting", "call", "send", "sent", "come", "coming", "reach", "book", "plan", "schedule"}
WORK = {"pr", "repo", "client", "customer", "meeting", "deck", "code", "ship", "product", "founder", "startup", "work", "office", "investor", "sales", "demo", "launch"}
SLANG = {"lol", "lmao", "haha", "hahaha", "bro", "bruh", "wtf", "omg", "ngl", "idk", "rn", "btw", "bc", "pls", "plz", "ya", "yeah", "yep", "nah", "fuck", "shit"}
DISCOURSE_MARKERS = {"actually", "basically", "bro", "cool", "like", "literally", "no", "okay", "so", "wait", "yeah"}
ROLE_TERMS = {
    "mother": {"mom", "mum", "mummy", "maa", "mother"},
    "father": {"dad", "papa", "father"},
    "sibling": {"sister", "brother", "sis", "didi", "behen"},
    "family": {"cousin", "uncle", "aunt", "aunty", "family"},
    "romantic partner": {"babe", "baby", "jaan"},
}
POSSESSIVE_ROLE_RE = re.compile(r"\b(my|your|his|her|their|our|the)\s+(mom|mum|mummy|maa|mother|dad|papa|father|sister|brother|cousin|uncle|aunt|aunty)\b")
SECOND_PERSON_KINSHIP_RE = re.compile(r"\b(you are|you're|u are|ur|as my|my|as your|your)\s+(older|younger|little|big)?\s*(sister|brother|sis)\b")
WORK_SIGNAL_RE = re.compile(r"\b(pr|pull request|merge|deploy|deployment|github|repo|frontend|backend|client|customer|intern|manager|founder|investor|meeting|standup|sprint|ticket|issue|bug|production|staging|dev)\b")
ROMANTIC_SIGNAL_RE = re.compile(r"\b(babe|baby|my love|love you|ily|miss you|girlfriend|boyfriend)\b")
FAMILY_CONTEXT_RE = re.compile(r"\b(home|parents|family|mom|mum|mummy|maa|dad|papa|father|mother|cousin|uncle|aunt|aunty)\b")
STOPWORDS = {
    "a", "about", "all", "am", "an", "and", "are", "as", "at", "be", "been", "but", "by", "can", "could", "did", "do", "does",
    "for", "from", "get", "got", "had", "has", "have", "he", "her", "here", "him", "his", "how", "i", "if", "in", "is", "it",
    "its", "just", "me", "my", "not", "of", "on", "or", "our", "she", "so", "that", "the", "their", "them", "then", "there",
    "they", "this", "to", "too", "up", "was", "we", "were", "what", "when", "where", "who", "why", "will", "with", "would",
    "you", "your",
}


def main():
    args = parse_args()
    vault = args.vault.resolve()
    sources = vault / "08 Sources"
    output_dir = sources / "Analysis"
    output_dir.mkdir(parents=True, exist_ok=True)
    messages = load_messages(sources, args.days)
    profiles = build_profiles(messages, args.min_messages)
    people = build_people(profiles)
    self_profile = build_self_profile(messages)
    write_json_atomic(output_dir / "relationship_profiles.json", profiles)
    write_json_atomic(output_dir / "person_identity_map.json", people)
    write_json_atomic(output_dir / "self_profile.json", self_profile)
    write_markdown(output_dir / "Relationship Map.md", profiles, args.days)
    write_self_memory(vault / "06 AI Memory" / "My Communication Style.md", self_profile, args.days)
    write_people_memory(vault / "06 AI Memory" / "Person Context Index.md", people, args.days)
    write_legacy_whatsapp_outputs(vault, output_dir)
    print(f"Analyzed {len(messages)} messages.")
    print(f"Wrote {len(profiles)} relationship profiles.")
    print(f"Wrote {len(people)} canonical person records.")


def load_messages(sources_dir, days):
    cutoff = datetime.now(timezone.utc).timestamp() - days * 24 * 60 * 60 if days else None
    messages = []
    raw_files = sorted(sources_dir.glob("*/Raw/*.jsonl"))
    for path in raw_files:
        with path.open("r", encoding="utf-8") as f:
            for line in f:
                if not line.strip():
                    continue
                try:
                    record = json.loads(line)
                except json.JSONDecodeError:
                    print(f"Skipping corrupt JSONL line in {path}")
                    continue
                dt = datetime.fromisoformat(record["timestamp"].replace("Z", "+00:00"))
                if cutoff and dt.timestamp() < cutoff:
                    continue
                record["_dt"] = dt
                messages.append(record)
    return messages


def build_profiles(messages, min_messages):
    by_chat = defaultdict(list)
    for message in messages:
        key = f"{message.get('sourceSystem') or source_system(message)}::{message.get('chatName') or 'Unknown Chat'}"
        by_chat[key].append(message)
    profiles = [profile_chat(key, items) for key, items in by_chat.items() if len(items) >= min_messages]
    profiles.sort(key=lambda p: (p["messageCount"], p["lastSeen"]), reverse=True)
    return profiles


def profile_chat(chat_key, messages):
    source, chat_name = split_chat_key(chat_key)
    count = len(messages)
    outbound = sum(1 for m in messages if m.get("fromMe"))
    inbound = count - outbound
    dates = [m["_dt"] for m in messages]
    text = "\n".join(m.get("body") or "" for m in messages)
    outbound_messages = [m for m in messages if m.get("fromMe") and (m.get("body") or "").strip()]
    role_evidence = extract_role_evidence(messages)
    role_scores = role_evidence_scores(role_evidence)
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
    identity = infer_identity(source, chat_name, messages)
    return {
        "chatName": chat_name,
        "sourceSystem": source,
        "displayName": f"{chat_name} ({source})",
        "identityName": identity["name"],
        "canonicalPersonKey": identity["key"],
        "identityConfidence": identity["confidence"],
        "identityEvidence": identity["evidence"],
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
        "roleEvidence": role_evidence,
        "roleEvidenceScores": role_scores,
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


def extract_role_evidence(messages):
    evidence = []
    seen = set()
    for message in messages:
        body = (message.get("body") or "").strip()
        if not body:
            continue
        normalized = normalize_message(body)
        if not normalized:
            continue
        direction = "outbound" if message.get("fromMe") else "inbound"
        add_direct_address_evidence(evidence, seen, normalized, body, direction)
        add_context_evidence(evidence, seen, normalized, body, direction)
        if len(evidence) >= 24:
            break
    return evidence[:12]


def add_direct_address_evidence(evidence, seen, normalized, body, direction):
    if SECOND_PERSON_KINSHIP_RE.search(normalized):
        add_role_evidence(evidence, seen, "sibling", "explicit second-person kinship", 5, body, direction)
        return
    if POSSESSIVE_ROLE_RE.search(normalized):
        return
    for role, terms in ROLE_TERMS.items():
        for term in sorted(terms, key=len, reverse=True):
            if re.search(rf"\b{re.escape(term)}\b", normalized):
                weight = 4 if role in {"mother", "father", "sibling"} else 3
                signal = "direct kinship/address term" if role != "romantic partner" else "romantic address term"
                add_role_evidence(evidence, seen, role, signal, weight, body, direction)
                return


def add_context_evidence(evidence, seen, normalized, body, direction):
    work_hits = WORK_SIGNAL_RE.findall(normalized)
    if len(set(work_hits)) >= 2:
        add_role_evidence(evidence, seen, "work collaborator", "work/project conversation signals", 2, body, direction)
    elif len(set(work_hits)) == 1:
        add_role_evidence(evidence, seen, "work collaborator", "work/project term", 1, body, direction)
    if ROMANTIC_SIGNAL_RE.search(normalized) and not re.search(r"\b(do not|don't|dont)\s+(love|miss)\b", normalized):
        add_role_evidence(evidence, seen, "romantic partner", "romantic phrase", 3, body, direction)
    if FAMILY_CONTEXT_RE.search(normalized) and re.search(r"\b(come|coming|home|parents|family|dinner|hospital|doctor)\b", normalized):
        add_role_evidence(evidence, seen, "family", "family/logistics context", 1, body, direction)


def add_role_evidence(evidence, seen, role, signal, weight, body, direction):
    snippet = clean_snippet(body)
    key = (role, signal, direction, snippet.lower())
    if key in seen:
        return
    seen.add(key)
    evidence.append({
        "role": role,
        "signal": signal,
        "weight": weight,
        "direction": direction,
        "snippet": snippet,
    })


def role_evidence_scores(evidence):
    scores = Counter()
    for item in evidence:
        scores[item["role"]] += item.get("weight", 1)
    return dict(scores.most_common())


def clean_snippet(value):
    text = " ".join(str(value or "").split())
    text = re.sub(r"https?://\S+", "[link]", text)
    return text[:180]


def normalize_message(value):
    text = str(value or "").lower()
    text = re.sub(r"https?://\S+", " ", text)
    text = re.sub(r"[^a-z0-9'+]+", " ", text)
    return " ".join(text.split())


def infer_identity(source, chat_name, messages):
    is_group = any(m.get("isGroup") for m in messages)
    if is_group:
        return {
            "name": chat_name,
            "key": f"group::{source.lower()}::{normalize_identity(chat_name)}",
            "confidence": "medium",
            "evidence": "group chat kept source-specific",
        }
    candidates = []
    if source in {"Slack", "LinkedIn"}:
        candidates.extend((m.get("author") or "").strip() for m in messages if not m.get("fromMe"))
    if source == "LinkedIn":
        candidates.extend((m.get("to") or "").split(",")[0].strip() for m in messages if m.get("fromMe"))
    candidates.append(chat_name)
    name = best_identity_name(candidates) or chat_name
    key = f"person::{normalize_identity(name)}"
    confidence = "medium" if normalize_identity(name) == normalize_identity(chat_name) else "low"
    if source in {"Slack", "LinkedIn"} and normalize_identity(name) != normalize_identity(chat_name):
        confidence = "medium"
    return {
        "name": name,
        "key": key,
        "confidence": confidence,
        "evidence": f"{source} direct chat identity",
    }


def best_identity_name(candidates):
    cleaned = [candidate for candidate in candidates if usable_identity_name(candidate)]
    if not cleaned:
        return ""
    counts = Counter(normalize_identity(candidate) for candidate in cleaned)
    best_key, _ = counts.most_common(1)[0]
    for candidate in cleaned:
        if normalize_identity(candidate) == best_key:
            return candidate
    return cleaned[0]


def usable_identity_name(value):
    if not value:
        return False
    normalized = normalize_identity(value)
    if not normalized or normalized in {"me", "you", "unknown", "unknown chat", "imessage"}:
        return False
    return True


def normalize_identity(value):
    text = str(value or "").lower()
    text = re.sub(r"<[^>]+>", " ", text)
    text = re.sub(r"https?://\S+", " ", text)
    text = re.sub(r"[^a-z0-9@+]+", " ", text)
    return " ".join(text.split())


def build_people(profiles):
    grouped = defaultdict(list)
    for profile in profiles:
        key = profile.get("canonicalPersonKey")
        if key and not key.startswith("group::"):
            grouped[key].append(profile)
    people = []
    for key, items in grouped.items():
        items.sort(key=lambda item: (item["messageCount"], item["lastSeen"]), reverse=True)
        sources = sorted({item["sourceSystem"] for item in items})
        names = [item.get("identityName") or item["chatName"] for item in items]
        people.append({
            "canonicalPersonKey": key,
            "displayName": names[0],
            "aliases": sorted({name for name in names if name}),
            "sources": sources,
            "sourceProfiles": [
                {
                    "sourceSystem": item["sourceSystem"],
                    "chatName": item["chatName"],
                    "displayName": item["displayName"],
                    "messageCount": item["messageCount"],
                    "firstSeen": item["firstSeen"],
                    "lastSeen": item["lastSeen"],
                    "relationshipGuess": item["relationshipGuess"],
                    "roleEvidenceSummary": role_evidence_summary(item),
                    "typingStyle": item["typingStyle"],
                    "identityConfidence": item["identityConfidence"],
                    "identityEvidence": item["identityEvidence"],
                }
                for item in items
            ],
            "totalMessages": sum(item["messageCount"] for item in items),
            "firstSeen": min(item["firstSeen"] for item in items),
            "lastSeen": max(item["lastSeen"] for item in items),
        })
    people.sort(key=lambda person: (len(person["sources"]), person["totalMessages"], person["lastSeen"]), reverse=True)
    return people


def build_self_profile(messages):
    outbound = [m for m in messages if m.get("fromMe") and (m.get("body") or "").strip()]
    by_source = defaultdict(list)
    for message in outbound:
        by_source[message.get("sourceSystem") or source_system(message)].append(message)
    dates = [m["_dt"] for m in outbound]
    style = typing_style(outbound)
    lexical = lexical_profile(outbound)
    return {
        "profileType": "self_communication_style",
        "messageCount": len(outbound),
        "firstSeen": min(dates).date().isoformat() if dates else None,
        "lastSeen": max(dates).date().isoformat() if dates else None,
        "sources": sorted(by_source.keys()),
        "sourceBreakdown": {
            source: {
                "messageCount": len(items),
                "typingStyle": typing_style(items),
            }
            for source, items in sorted(by_source.items())
        },
        "typingStyle": style,
        "lexicalProfile": lexical,
        "replyGuidance": self_reply_guidance(style, lexical),
    }


def write_markdown(path, profiles, days):
    lines = ["# Relationship Map", "", f"Window: last {days} days", "", "Generated signals. Treat as editable working notes.", ""]
    for profile in profiles:
        lines.extend([
            f"## {profile['displayName']}",
            "",
            f"- Source: {profile['sourceSystem']}",
            f"- Canonical person: {profile['identityName']} ({profile['canonicalPersonKey']})",
            f"- Guess: {profile['relationshipGuess']}",
            f"- Messages: {profile['messageCount']} ({profile['inbound']} inbound, {profile['outbound']} outbound)",
            f"- Dates: {profile['firstSeen']} to {profile['lastSeen']}",
            f"- Scores: sentiment {profile['sentimentScore']}, warmth {profile['warmthScore']}, friction {profile['frictionScore']}, operational {profile['operationalScore']}",
            f"- Tags: {', '.join(profile['tags'])}",
            f"- Role evidence: {role_evidence_summary(profile)}",
            f"- Typing style: {typing_style_summary(profile['typingStyle'])}",
            "",
        ])
    write_text_atomic(path, "\n".join(lines))


def write_self_memory(path, profile, days):
    path.parent.mkdir(parents=True, exist_ok=True)
    style = profile.get("typingStyle", {})
    lexical = profile.get("lexicalProfile", {})
    lines = [
        "# My Communication Style",
        "",
        f"Window: last {days} days",
        "",
        "Generated from the user's own outbound messages. Treat this as the default voice for drafts and auto-replies.",
        "",
        f"- Outbound sample: {profile.get('messageCount', 0)} messages",
        f"- Sources: {', '.join(profile.get('sources', [])) or 'none'}",
        f"- Dates: {profile.get('firstSeen') or 'n/a'} to {profile.get('lastSeen') or 'n/a'}",
        f"- Signature: {style.get('signature', 'unknown')}",
        f"- Average length: {style.get('avgWords', 0)} words / {style.get('avgChars', 0)} chars",
        f"- Lowercase share: {style.get('lowercaseShare', 0)}",
        f"- Questions: {style.get('questionShare', 0)}",
        f"- Exclamations: {style.get('exclamationShare', 0)}",
        f"- Emoji share: {style.get('emojiShare', 0)}",
        f"- Slang: {', '.join(style.get('slang', [])) or 'none'}",
        "",
        "## Lexical Profile",
        "",
        f"- Vocabulary density: {lexical.get('uniqueTokenShare', 0)} unique-token share",
        f"- Common style words: {', '.join(lexical.get('commonStyleWords', [])) or 'none'}",
        f"- Common content words: {', '.join(lexical.get('topContentWords', [])) or 'none'}",
        f"- Common phrases: {', '.join(lexical.get('commonPhrases', [])) or 'none'}",
        f"- Common openers: {', '.join(lexical.get('messageOpeners', [])) or 'none'}",
        f"- Common endings: {', '.join(lexical.get('messageEndings', [])) or 'none'}",
        f"- Contractions: {', '.join(lexical.get('contractions', [])) or 'none'}",
        f"- Abbreviations: {', '.join(lexical.get('abbreviations', [])) or 'none'}",
        f"- Punctuation habits: {', '.join(lexical.get('punctuationHabits', [])) or 'none'}",
        f"- Lowercase `i` share: {lexical.get('lowercaseIShare', 0)}",
        "",
        "## Reply Guidance",
        "",
    ]
    for item in profile.get("replyGuidance", []):
        lines.append(f"- {item}")
    lines.extend(["", "## Source Breakdown", ""])
    for source, data in profile.get("sourceBreakdown", {}).items():
        lines.append(f"- {source}: {data.get('messageCount', 0)} outbound messages; {typing_style_summary(data.get('typingStyle', {}))}")
    write_text_atomic(path, "\n".join(lines) + "\n")


def write_people_memory(path, people, days):
    path.parent.mkdir(parents=True, exist_ok=True)
    lines = ["# Person Context Index", "", f"Window: last {days} days", "", "Canonical people matched across sources. Treat matches as provisional unless manually confirmed.", ""]
    for person in people:
        lines.extend([
            f"## {person['displayName']}",
            "",
            f"- Canonical key: `{person['canonicalPersonKey']}`",
            f"- Aliases: {', '.join(person['aliases'])}",
            f"- Sources: {', '.join(person['sources'])}",
            f"- Messages: {person['totalMessages']}",
            f"- Dates: {person['firstSeen']} to {person['lastSeen']}",
            "- Source-specific context:",
        ])
        for source in person["sourceProfiles"]:
            style = typing_style_summary(source.get("typingStyle", {}))
            evidence = source.get("roleEvidenceSummary") or "no direct role evidence"
            lines.append(f"  - {source['sourceSystem']} / {source['chatName']}: {source['relationshipGuess']}; role evidence {evidence}; {source['messageCount']} messages; style {style}")
        lines.append("")
    write_text_atomic(path, "\n".join(lines) + "\n")


def write_legacy_whatsapp_outputs(vault, output_dir):
    legacy_dir = vault / "08 Sources" / "WhatsApp" / "Analysis"
    legacy_dir.mkdir(parents=True, exist_ok=True)
    for name in ("relationship_profiles.json", "person_identity_map.json", "self_profile.json", "Relationship Map.md"):
        source = output_dir / name
        target = legacy_dir / name
        if source.exists():
            write_text_atomic(target, source.read_text(encoding="utf-8"))


def role_evidence_summary(profile):
    scores = profile.get("roleEvidenceScores") or {}
    if not scores:
        return "none detected"
    return ", ".join(f"{role}={score}" for role, score in list(scores.items())[:3])


def write_json_atomic(path, data):
    write_text_atomic(path, json.dumps(data, indent=2, ensure_ascii=False))


def write_text_atomic(path, content):
    temp = path.with_name(f"{path.name}.{time.time_ns()}.tmp")
    temp.write_text(content, encoding="utf-8")
    temp.replace(path)


def source_system(message):
    source = message.get("source") or ""
    if "Slack" in source:
        return "Slack"
    if "LinkedIn" in source:
        return "LinkedIn"
    if "WhatsApp" in source:
        return "WhatsApp"
    return "Unknown"


def split_chat_key(key):
    if "::" not in key:
        return "Unknown", key
    source, chat_name = key.split("::", 1)
    return source, chat_name


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


def lexical_profile(messages):
    bodies = [(m.get("body") or "").strip() for m in messages if (m.get("body") or "").strip()]
    tokens_by_body = [tokenize_words(body) for body in bodies]
    tokens = [token for body_tokens in tokens_by_body for token in body_tokens]
    if not bodies or not tokens:
        return empty_lexical_profile()

    content_counts = Counter(token for token in tokens if token not in STOPWORDS and not token.isdigit() and len(token) > 1)
    style_counts = Counter(token for token in tokens if token in SLANG or token in DISCOURSE_MARKERS)
    bigrams = Counter(ngram for body_tokens in tokens_by_body for ngram in ngrams(body_tokens, 2))
    trigrams = Counter(ngram for body_tokens in tokens_by_body for ngram in ngrams(body_tokens, 3))
    openers = Counter(message_opener(body_tokens) for body_tokens in tokens_by_body if body_tokens)
    endings = Counter(message_ending(body) for body in bodies if message_ending(body))
    contractions = Counter(token for token in tokens if "'" in token)
    abbreviations = Counter(token for token in tokens if token in SLANG or (token.isupper() and len(token) <= 5))
    lowercase_i = sum(1 for body in bodies if re.search(r"(^|[^A-Za-z])i([^A-Za-z]|$)", body))
    uppercase_i = sum(1 for body in bodies if re.search(r"(^|[^A-Za-z])I([^A-Za-z]|$)", body))

    return {
        "sampleSize": len(bodies),
        "tokenCount": len(tokens),
        "uniqueTokenShare": round(len(set(tokens)) / max(len(tokens), 1), 2),
        "commonStyleWords": top_keys(style_counts, 12),
        "topContentWords": top_keys(content_counts, 12),
        "commonPhrases": top_phrases(bigrams, trigrams),
        "messageOpeners": top_keys(openers, 8),
        "messageEndings": top_keys(endings, 8),
        "contractions": top_keys(contractions, 8),
        "abbreviations": top_keys(abbreviations, 8),
        "punctuationHabits": punctuation_habits(bodies),
        "lowercaseIShare": round(lowercase_i / max(lowercase_i + uppercase_i, 1), 2),
    }


def empty_lexical_profile():
    return {
        "sampleSize": 0,
        "tokenCount": 0,
        "uniqueTokenShare": 0,
        "commonStyleWords": [],
        "topContentWords": [],
        "commonPhrases": [],
        "messageOpeners": [],
        "messageEndings": [],
        "contractions": [],
        "abbreviations": [],
        "punctuationHabits": [],
        "lowercaseIShare": 0,
    }


def tokenize_words(text):
    return re.findall(r"[A-Za-z][A-Za-z']*|\d+", text.lower())


def ngrams(tokens, size):
    return [" ".join(tokens[index:index + size]) for index in range(0, max(len(tokens) - size + 1, 0))]


def message_opener(tokens):
    return " ".join(tokens[:min(3, len(tokens))])


def message_ending(text):
    stripped = text.strip()
    if not stripped:
        return ""
    match = re.search(r"([!?.,]+)$", stripped)
    if match:
        return match.group(1)
    words = tokenize_words(stripped)
    return words[-1] if words else ""


def top_keys(counter, limit):
    return [key for key, _ in counter.most_common(limit)]


def top_phrases(bigrams, trigrams):
    phrases = []
    for counter in (trigrams, bigrams):
        for phrase, count in counter.most_common(10):
            tokens = phrase.split()
            if count < 2 and len(phrases) >= 3:
                continue
            if all(token in STOPWORDS for token in tokens):
                continue
            phrases.append(phrase)
            if len(phrases) >= 8:
                return phrases
    return phrases


def punctuation_habits(bodies):
    habits = []
    checks = [
        ("no terminal punctuation", lambda body: bool(body) and body[-1].isalnum()),
        ("question marks", lambda body: "?" in body),
        ("exclamation marks", lambda body: "!" in body),
        ("ellipsis", lambda body: "..." in body),
        ("repeated punctuation", lambda body: bool(re.search(r"[!?.,]{2,}", body))),
    ]
    for label, predicate in checks:
        share = sum(1 for body in bodies if predicate(body)) / max(len(bodies), 1)
        if share >= 0.2:
            habits.append(f"{label} ({round(share, 2)})")
    return habits


def typing_style_summary(style):
    slang = ", ".join(style.get("slang", [])) or "none"
    return (
        f"{style.get('signature', 'unknown')}; avg {style.get('avgWords', 0)} words; "
        f"lowercase {style.get('lowercaseShare', 0)}; emoji {style.get('emojiShare', 0)}; slang {slang}"
    )


def self_reply_guidance(style, lexical=None):
    lexical = lexical or empty_lexical_profile()
    guidance = []
    signature = style.get("signature") or ""
    if style.get("sampleSize", 0) == 0:
        return ["No outbound sample yet; keep replies concise and natural."]
    if style.get("lowercaseShare", 0) >= 0.45 or "lowercase-heavy" in signature:
        guidance.append("Prefer undercapitalized/lowercase casual texting unless the context is formal.")
    if style.get("avgWords", 0) <= 8:
        guidance.append("Keep most replies short. Avoid polished essay-like phrasing.")
    else:
        guidance.append("Longer replies are normal when the topic needs context, but avoid sounding corporate.")
    if style.get("questionShare", 0) >= 0.2:
        guidance.append("It is natural to ask direct follow-up questions.")
    if style.get("exclamationShare", 0) < 0.1:
        guidance.append("Use exclamation marks sparingly.")
    if style.get("emojiShare", 0) < 0.1:
        guidance.append("Do not add emoji unless the recent chat already uses them.")
    slang = style.get("slang", [])
    if slang:
        guidance.append(f"Known casual words/slang from the user's style: {', '.join(slang)}.")
    style_words = lexical.get("commonStyleWords", [])
    phrases = lexical.get("commonPhrases", [])
    openers = lexical.get("messageOpeners", [])
    if style_words:
        guidance.append(f"Prefer the user's recurring style words when natural: {', '.join(style_words[:8])}.")
    if phrases:
        guidance.append(f"Reuse short recurring phrase shapes only when they fit: {', '.join(phrases[:5])}.")
    if openers:
        guidance.append(f"Common message starts include: {', '.join(openers[:5])}.")
    if lexical.get("lowercaseIShare", 0) >= 0.45:
        guidance.append("The user often types lowercase `i`; preserve that in casual replies.")
    return guidance


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

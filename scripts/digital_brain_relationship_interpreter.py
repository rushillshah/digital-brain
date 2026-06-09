#!/usr/bin/env python3
import argparse
import json
from datetime import datetime, timezone
from pathlib import Path

ROLE_KEYWORDS = [
    ("mother", ["mom", "mum", "mummy", "maa", "mother"]),
    ("father", ["dad", "papa", "father"]),
    ("sibling", ["brother", "sister", "bhai", "behen", "sis"]),
    ("family", ["family", "cousin", "uncle", "aunt", "mama", "maasi"]),
    ("romantic partner", ["girlfriend", "boyfriend", "babe", "baby"]),
    ("work collaborator", ["intern", "client", "work", "team", "project", "founder"]),
    ("friend", ["boys", "friends", "trip", "dance"]),
    ("medical/support", ["doctor", "dr ", "hospital"]),
]


def main():
    args = parse_args()
    vault = args.vault.resolve()
    sources = vault / "08 Sources"
    whatsapp = sources / "WhatsApp"
    analysis = sources / "Analysis"
    profile_path = analysis / "relationship_profiles.json"
    if not profile_path.exists():
        profile_path = whatsapp / "Analysis" / "relationship_profiles.json"
    profiles = json.loads(profile_path.read_text(encoding="utf-8"))
    overrides = load_overrides(sources)
    out_dir = analysis / "Interpreted"
    legacy_out_dir = whatsapp / "Analysis" / "Interpreted"
    people_dir = vault / "04 People" / "Interpreted Relationships"
    out_dir.mkdir(parents=True, exist_ok=True)
    legacy_out_dir.mkdir(parents=True, exist_ok=True)
    people_dir.mkdir(parents=True, exist_ok=True)

    models = []
    for profile in profiles:
        override = overrides.get(profile_key(profile), overrides.get(profile["chatName"], {}))
        model = build_model(profile, override)
        note = render_note(model)
        filename = safe_filename(profile.get("displayName") or profile["chatName"]) + ".md"
        (out_dir / filename).write_text(note, encoding="utf-8")
        (legacy_out_dir / filename).write_text(note, encoding="utf-8")
        (people_dir / filename).write_text(note, encoding="utf-8")
        models.append(model)

    (analysis / "interpreted_relationship_models.json").write_text(json.dumps(models, indent=2, ensure_ascii=False), encoding="utf-8")
    (whatsapp / "Analysis" / "interpreted_relationship_models.json").write_text(json.dumps(models, indent=2, ensure_ascii=False), encoding="utf-8")
    write_index(vault / "06 AI Memory" / "Interpreted Relationship Memory.md", models)
    print(f"Wrote interpreted notes: {len(models)}")


def build_model(profile, override):
    role, confidence, reason = infer_role(profile, override)
    return {
        **profile,
        "role": role,
        "roleConfidence": confidence,
        "roleReason": reason,
        "closeness": infer_closeness(profile),
        "conversationDifficulty": infer_difficulty(profile),
        "reciprocity": infer_reciprocity(profile),
        "howToContinue": infer_continuity(profile, role),
        "boundaries": infer_boundaries(role, infer_difficulty(profile)),
        "replyStyle": infer_reply_style(profile),
    }


def infer_role(profile, override):
    if override.get("role"):
        return override["role"], override.get("confidence", "high"), "manual override"
    name = profile["chatName"].lower()
    for role, keywords in ROLE_KEYWORDS:
        if any(keyword in name for keyword in keywords):
            return role, "high" if role in {"mother", "father"} else "medium", "matched chat name"
    if profile["isGroup"]:
        return "work/project group" if "work-signal" in profile["tags"] else "group", "medium", "group chat"
    if "work-signal" in profile["tags"]:
        return "work collaborator", "medium", "work/project signal"
    if "warm" in profile["tags"] and profile["messageCount"] > 300:
        return "close personal contact", "low", "high volume and warmth, no explicit label"
    if "logistics-heavy" in profile["tags"]:
        return "operational contact", "low", "logistics-heavy communication"
    return "unlabeled contact", "low", "no reliable role evidence"


def infer_closeness(profile):
    if profile["messageCount"] >= 500 and profile["warmthScore"] > 0.06:
        return "high"
    if profile["messageCount"] >= 200:
        return "medium-high"
    if profile["messageCount"] >= 75 or profile["warmthScore"] > 0.08:
        return "medium"
    return "low/unclear"


def infer_difficulty(profile):
    if profile["frictionScore"] > 0.06:
        return "high"
    if profile["frictionScore"] > 0.03 or "friction-present" in profile["tags"]:
        return "medium"
    if profile["operationalScore"] > 0.15 and profile["warmthScore"] < 0.03:
        return "practical/low-emotional"
    return "low"


def infer_reciprocity(profile):
    share = profile["outboundShare"]
    if share > 0.68:
        return "user drives most of the conversation"
    if share < 0.32:
        return "other side drives most of the conversation"
    return "balanced"


def infer_continuity(profile, role):
    guidance = []
    if role in {"mother", "father", "family"}:
        guidance += ["Use warmer language than a work chat.", "Do not make the interaction purely transactional."]
    elif "work" in role:
        guidance += ["Lead with context, next steps, and clear asks.", "Keep emotional interpretation light."]
    elif role == "romantic partner":
        guidance += ["Use extra care with tone.", "Prefer warmth and specificity over generic advice."]
    else:
        guidance.append("Keep tone neutral until the user labels this relationship.")
    if "logistics-heavy" in profile["tags"]:
        guidance.append("Track open loops, plans, dates, and commitments.")
    return guidance


def infer_boundaries(role, difficulty):
    boundaries = ["Do not expose private summaries unless asked."]
    if role == "unlabeled contact":
        boundaries.append("Do not invent a relationship category.")
    if difficulty in {"medium", "high"}:
        boundaries.append("Do not assume friction means the relationship is bad.")
    return boundaries


def render_note(model):
    return f"""# {model.get('displayName') or model['chatName']}

Generated: {datetime.now(timezone.utc).isoformat()}
Source: {model.get('sourceSystem', 'Unknown')}
Role: {model['role']}
Role confidence: {model['roleConfidence']}
Closeness: {model['closeness']}
Conversation difficulty: {model['conversationDifficulty']}
Typing style: {model['typingStyle'].get('signature', 'unknown')}

These are private working notes. Edit them where wrong.

## Role / Relationship Label
- {model['role']} ({model['roleConfidence']} confidence).
- Reason: {model['roleReason']}.

## Closeness And Importance
- Closeness: {model['closeness']}.
- Reciprocity: {model['reciprocity']}.
- Conversation difficulty: {model['conversationDifficulty']}.

## Communication Pattern
- Messages: {model['messageCount']} ({model['inbound']} inbound, {model['outbound']} outbound).
- Tags: {', '.join(model['tags'])}.

## Typing Style To Match
{render_typing_style(model)}

## How To Continue This Relationship
{bullets(model['howToContinue'])}

## Reply Guidance
{bullets(model['replyStyle'])}

## What Not To Assume
{bullets(model['boundaries'])}
"""


def write_index(path, models):
    path.parent.mkdir(parents=True, exist_ok=True)
    lines = ["# Interpreted Relationship Memory", "", "Generated working notes. Treat as editable, not truth.", ""]
    for model in models:
        style = model.get("typingStyle", {}).get("signature", "unknown style")
        display = model.get("displayName") or model["chatName"]
        lines.append(f"- [[{safe_filename(display)}]]: {model['role']} ({model['roleConfidence']}), closeness {model['closeness']}, difficulty {model['conversationDifficulty']}, style {style}")
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")


def bullets(items):
    return "\n".join(f"- {item}" for item in items)


def render_typing_style(model):
    style = model.get("typingStyle", {})
    slang = ", ".join(style.get("slang", [])) or "none detected"
    lines = [
        f"- Signature: {style.get('signature', 'unknown')}.",
        f"- Average length: {style.get('avgWords', 0)} words / {style.get('avgChars', 0)} chars.",
        f"- Lowercase share: {style.get('lowercaseShare', 0)}.",
        f"- Question share: {style.get('questionShare', 0)}.",
        f"- Exclamation share: {style.get('exclamationShare', 0)}.",
        f"- Emoji share: {style.get('emojiShare', 0)}.",
        f"- Slang: {slang}.",
    ]
    return "\n".join(lines)


def infer_reply_style(profile):
    style = profile.get("typingStyle", {})
    guidance = []
    avg_words = style.get("avgWords", 0)
    if avg_words and avg_words <= 5:
        guidance.append("Keep replies very short unless context demands detail.")
    elif avg_words <= 12:
        guidance.append("Use concise replies with one clear point.")
    else:
        guidance.append("Longer replies are acceptable in this relationship.")
    if style.get("lowercaseShare", 0) > 0.55:
        guidance.append("Lowercase is acceptable; avoid making it too formal.")
    if style.get("emojiShare", 0) > 0.2:
        guidance.append("A light emoji can fit this relationship.")
    if style.get("questionShare", 0) > 0.25:
        guidance.append("Asking a direct question fits the existing rhythm.")
    if style.get("slang"):
        guidance.append(f"Some familiar slang appears here: {', '.join(style['slang'][:4])}.")
    guidance.append("Match style without exaggerating or parodying the person.")
    return guidance


def safe_filename(value):
    cleaned = "".join("-" if char in '/:\\?%*"<>|' else char for char in value)
    return (" ".join(cleaned.split()).strip() or "Unknown Chat")[:120]


def load_json(path, fallback):
    if not path.exists():
        return fallback
    return json.loads(path.read_text(encoding="utf-8"))


def load_overrides(sources):
    merged = {}
    for path in sorted(sources.glob("*/relationship_overrides.json")):
        merged.update(load_json(path, {}))
    return merged


def profile_key(profile):
    return f"{profile.get('sourceSystem') or 'Unknown'}::{profile.get('chatName') or 'Unknown Chat'}"


def parse_args():
    parser = argparse.ArgumentParser()
    parser.add_argument("--vault", type=Path, required=True)
    parser.add_argument("--days", type=int, default=30)
    parser.add_argument("--max-messages", type=int, default=120)
    parser.add_argument("--provider", choices=["heuristic"], default="heuristic")
    return parser.parse_args()


if __name__ == "__main__":
    main()

#!/usr/bin/env python3
import argparse
import json
import subprocess
from datetime import datetime, timezone
from pathlib import Path


README_NAMES = ("README.md", "README.mdx", "README.txt", "README")
MANIFEST_NAMES = (
    "package.json",
    "pyproject.toml",
    "requirements.txt",
    "Cargo.toml",
    "go.mod",
    "Gemfile",
    "composer.json",
)
MAX_TEXT_CHARS = 12000


def main():
    args = parse_args()
    repos = [path.resolve() for path in args.input]
    import_repos(args.vault.resolve(), repos)


def import_repos(vault, repos):
    source_dir = vault / "08 Sources" / "Repositories"
    memory_dir = vault / "06 AI Memory"
    source_dir.mkdir(parents=True, exist_ok=True)
    memory_dir.mkdir(parents=True, exist_ok=True)

    summaries = []
    for repo in repos:
      if not repo.exists() or not repo.is_dir():
          print(f"Skipping missing repo: {repo}")
          continue
      summaries.append(summarize_repo(repo, source_dir))

    write_json_atomic(source_dir / "repository_context.json", summaries)
    write_project_context(memory_dir / "Project Context.md", summaries)
    print(f"Indexed {len(summaries)} repository context record(s).")


def summarize_repo(repo, source_dir):
    name = repo.name
    summary = {
        "schemaVersion": 1,
        "sourceSystem": "Git repository",
        "name": name,
        "path": str(repo),
        "indexedAt": datetime.now(timezone.utc).isoformat(),
        "remote": git(repo, ["remote", "get-url", "origin"]),
        "branch": git(repo, ["branch", "--show-current"]),
        "latestCommits": git_lines(repo, ["log", "-5", "--pretty=format:%h %ad %s", "--date=short"]),
        "readme": read_first_existing(repo, README_NAMES),
        "manifests": read_manifests(repo),
        "topLevelFiles": top_level_files(repo),
    }
    write_repo_markdown(source_dir / f"{safe_filename(name)}.md", summary)
    return summary


def read_first_existing(repo, names):
    for name in names:
        path = repo / name
        if path.exists() and path.is_file():
            return {
                "file": name,
                "text": read_text_limited(path),
            }
    return {}


def read_manifests(repo):
    manifests = {}
    for name in MANIFEST_NAMES:
        path = repo / name
        if path.exists() and path.is_file():
            manifests[name] = read_text_limited(path)
    return manifests


def top_level_files(repo):
    ignored = {".git", "node_modules", "dist", "build", ".next", "__pycache__"}
    files = []
    for path in sorted(repo.iterdir(), key=lambda item: item.name.lower()):
        if path.name in ignored:
            continue
        suffix = "/" if path.is_dir() else ""
        files.append(f"{path.name}{suffix}")
        if len(files) >= 80:
            break
    return files


def write_repo_markdown(path, summary):
    lines = [
        f"# {summary['name']}",
        "",
        "Generated repository context. Do not edit directly; re-run import-repos to refresh.",
        "",
        f"- Path: `{summary['path']}`",
        f"- Remote: `{summary.get('remote') or 'unknown'}`",
        f"- Branch: `{summary.get('branch') or 'unknown'}`",
        "",
        "## Latest Commits",
        "",
    ]
    if summary["latestCommits"]:
        lines.extend(f"- {line}" for line in summary["latestCommits"])
    else:
        lines.append("- No git commits found.")
    lines.extend(["", "## Top Level", ""])
    lines.extend(f"- `{item}`" for item in summary["topLevelFiles"])
    if summary["readme"]:
        lines.extend(["", f"## {summary['readme']['file']}", "", fenced(summary["readme"]["text"], "markdown")])
    if summary["manifests"]:
        lines.extend(["", "## Manifests", ""])
        for filename, text in summary["manifests"].items():
            lines.extend([f"### {filename}", "", fenced(text, language_for(filename)), ""])
    write_text_atomic(path, "\n".join(lines).rstrip() + "\n")


def write_project_context(path, summaries):
    lines = [
        "# Project Context",
        "",
        "Generated from local repositories. Use this for high-level project context; do not assume it contains full source code.",
        "",
    ]
    for summary in summaries:
        readme_text = (summary.get("readme") or {}).get("text", "")
        first_lines = "\n".join(line for line in readme_text.splitlines()[:25] if line.strip())
        lines.extend([
            f"## {summary['name']}",
            "",
            f"- Path: `{summary['path']}`",
            f"- Remote: `{summary.get('remote') or 'unknown'}`",
            f"- Branch: `{summary.get('branch') or 'unknown'}`",
            "",
            "Recent commits:",
        ])
        if summary["latestCommits"]:
            lines.extend(f"- {line}" for line in summary["latestCommits"])
        else:
            lines.append("- No git commits found.")
        if first_lines:
            lines.extend(["", "README excerpt:", "", first_lines[:3000]])
        lines.append("")
    write_text_atomic(path, "\n".join(lines).rstrip() + "\n")


def git(repo, args):
    try:
        result = subprocess.run(["git", "-C", str(repo), *args], text=True, capture_output=True, timeout=5)
    except Exception:
        return ""
    return result.stdout.strip() if result.returncode == 0 else ""


def git_lines(repo, args):
    value = git(repo, args)
    return [line.strip() for line in value.splitlines() if line.strip()]


def read_text_limited(path):
    try:
        text = path.read_text(encoding="utf-8", errors="replace")
    except Exception:
        return ""
    return text[:MAX_TEXT_CHARS]


def fenced(text, language):
    return f"```{language}\n{text.rstrip()}\n```"


def language_for(filename):
    if filename.endswith(".json"):
        return "json"
    if filename.endswith(".toml"):
        return "toml"
    if filename in {"Gemfile"}:
        return "ruby"
    return ""


def safe_filename(value):
    cleaned = "".join("-" if char in '/:\\?%*"<>|' else char for char in value)
    return (" ".join(cleaned.split()).strip() or "Repository")[:120]


def write_text_atomic(path, text):
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(text, encoding="utf-8")
    tmp.replace(path)


def write_json_atomic(path, value):
    write_text_atomic(path, json.dumps(value, indent=2, ensure_ascii=False) + "\n")


def parse_args():
    parser = argparse.ArgumentParser()
    parser.add_argument("--vault", type=Path, required=True)
    parser.add_argument("--input", type=Path, action="append", required=True)
    return parser.parse_args()


if __name__ == "__main__":
    main()

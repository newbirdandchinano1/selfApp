"""One-shot: strip localOnly / offlineFallback from selfApp source."""
from __future__ import annotations

import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SKIP_DIRS = {"node_modules", ".git", "dist", "build", ".expo"}

LINE_FIELD = re.compile(
    r"^[ \t]*(?:/\*[^*]*\*/[ \t]*)?(?:offlineFallback|localOnly)\??:[ \t].*$",
    re.M,
)
INLINE_PROP = re.compile(
    r",?[ \t]*(?:offlineFallback|localOnly)[ \t]*:[ \t]*(?:true(?:[ \t]+as[ \t]+const)?|false(?:[ \t]+as[ \t]+const)?|[^,\n}]+)",
)
IF_OFFLINE_FALSE = re.compile(
    r"[ \t]*if\s*\(\s*opts\??\.(?:offlineFallback)\s*===\s*false\s*\)\s*throw\s+e;\s*\n"
)
IF_NOT_OFFLINE = re.compile(
    r"[ \t]*if\s*\(\s*!opts\??\.offlineFallback\s*\)\s*throw\s+e;\s*\n"
)


def clean(text: str) -> str:
    text = LINE_FIELD.sub("", text)
    text = INLINE_PROP.sub("", text)
    text = IF_OFFLINE_FALSE.sub("      throw e;\n", text)
    text = IF_NOT_OFFLINE.sub("      throw e;\n", text)
    text = re.sub(r"\{\s*,", "{", text)
    text = re.sub(r",\s*,", ",", text)
    text = re.sub(r",\s*}", "}", text)
    text = re.sub(r"\(\s*,", "(", text)
    text = re.sub(r",\s*\)", ")", text)
    return text


def main() -> None:
    changed = 0
    for path in ROOT.rglob("*"):
        if path.suffix not in {".ts", ".tsx"}:
            continue
        if any(p in SKIP_DIRS for p in path.parts):
            continue
        if path.name == Path(__file__).name:
            continue
        original = path.read_text(encoding="utf-8")
        updated = clean(original)
        if updated != original:
            path.write_text(updated, encoding="utf-8", newline="\n")
            changed += 1
            print(path.relative_to(ROOT))
    print(f"updated {changed} files")


if __name__ == "__main__":
    main()

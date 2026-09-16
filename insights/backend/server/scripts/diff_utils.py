"""Helpers for summarising unified diff payloads."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Optional

_BINARY_MARKERS = (
    "Binary files",
    "GIT binary patch",
    "Cannot display: file marked as a binary type.",
)

_IGNORE_PREFIXES = (
    "diff --git",
    "index ",
    "old mode ",
    "new mode ",
    "deleted file mode ",
    "new file mode ",
    "--- ",
    "+++ ",
)


@dataclass
class DiffSummary:
    lines_added: Optional[int]
    lines_deleted: Optional[int]
    replacements: Optional[int]


def summarize_unified_diff(diff_text: Optional[str]) -> DiffSummary:
    """Return per-file stats; None values mean stats could not be derived."""
    if diff_text is None:
        return DiffSummary(None, None, None)
    if not diff_text:
        return DiffSummary(0, 0, 0)

    lines_added = 0
    lines_deleted = 0
    replacements = 0
    pending_removed = 0

    for raw_line in diff_text.splitlines():
        line = raw_line.rstrip("\n\r")
        if not line:
            continue
        if line.startswith(_IGNORE_PREFIXES):
            continue
        if line.startswith("@@"):
            pending_removed = 0
            continue
        if line.startswith("\\"):
            # "\ No newline at end of file"
            continue
        prefix = line[0]
        if prefix == "-":
            pending_removed += 1
            continue
        if prefix == "+":
            if pending_removed > 0:
                replacements += 1
                pending_removed -= 1
            else:
                lines_added += 1
            continue
        if prefix == " ":
            if pending_removed > 0:
                lines_deleted += pending_removed
                pending_removed = 0
            continue
        # Any other prefix is treated as context separator
        if pending_removed > 0:
            lines_deleted += pending_removed
            pending_removed = 0

    if pending_removed > 0:
        lines_deleted += pending_removed

    return DiffSummary(lines_added, lines_deleted, replacements)


def looks_binary(diff_text: Optional[str]) -> bool:
    if not diff_text:
        return False
    return any(marker in diff_text for marker in _BINARY_MARKERS)

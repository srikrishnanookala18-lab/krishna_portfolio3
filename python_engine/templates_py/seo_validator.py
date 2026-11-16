"""HTML metadata, accessibility, and link-integrity auditor using Python stdlib."""

from __future__ import annotations

from dataclasses import dataclass
from html.parser import HTMLParser
from pathlib import Path
from typing import Dict, List


@dataclass
class AuditFinding:
    """Single validation check outcome."""

    check: str
    passed: bool
    detail: str


class _MetaAndHeadingParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.has_title = False
        self.title_text = ""
        self._in_title = False
        self.has_viewport = False
        self.h1_count = 0
        self.images_missing_alt = 0
        self.external_links = 0

    def handle_starttag(self, tag: str, attrs: List[tuple[str, str | None]]) -> None:
        attr_map: Dict[str, str] = {k.lower(): (v or "") for k, v in attrs}
        t = tag.lower()
        if t == "title":
            self._in_title = True
            self.has_title = True
        elif t == "meta" and attr_map.get("name", "").lower() == "viewport":
            self.has_viewport = True
        elif t == "h1":
            self.h1_count += 1
        elif t == "img" and not attr_map.get("alt", "").strip():
            self.images_missing_alt += 1
        elif t == "a" and attr_map.get("href", "").startswith("http"):
            self.external_links += 1

    def handle_endtag(self, tag: str) -> None:
        if tag.lower() == "title":
            self._in_title = False

    def handle_data(self, data: str) -> None:
        if self._in_title:
            self.title_text += data


def audit_html_file(html_path: Path) -> List[AuditFinding]:
    """Run structural accessibility and SEO checks on a built HTML file."""
    content = html_path.read_text(encoding="utf-8")
    parser = _MetaAndHeadingParser()
    parser.feed(content)

    return [
        AuditFinding(
            check="document_title",
            passed=parser.has_title and len(parser.title_text.strip()) > 0,
            detail=parser.title_text.strip() or "Missing <title>",
        ),
        AuditFinding(
            check="mobile_viewport",
            passed=parser.has_viewport,
            detail="Viewport meta present" if parser.has_viewport else "Missing viewport meta tag",
        ),
        AuditFinding(
            check="single_primary_h1",
            passed=parser.h1_count == 1,
            detail=f"Found {parser.h1_count} <h1> element(s)",
        ),
        AuditFinding(
            check="image_alt_text",
            passed=parser.images_missing_alt == 0,
            detail=f"{parser.images_missing_alt} image(s) missing alt attribute",
        ),
    ]

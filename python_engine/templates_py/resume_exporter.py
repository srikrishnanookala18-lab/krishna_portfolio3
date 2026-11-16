"""Resume and structured JSON-CV exporter driven by portfolio_data.py."""

from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any, Dict, List, Optional

from analytics import compute_gpa_metrics
from portfolio_data import (
    CERTIFICATIONS,
    PROFILE,
    PROJECTS,
    SKILLS_DATA,
    get_semester_records,
)


def to_json_resume() -> Dict[str, Any]:
    """Generate a JSON-Resume compatible dictionary from Python portfolio models."""
    gpa_stats = compute_gpa_metrics()
    semesters = get_semester_records()

    grouped_skills: Dict[str, List[str]] = {}
    for skill in SKILLS_DATA:
        cat = str(skill.get("cat", "General"))
        grouped_skills.setdefault(cat, []).append(str(skill.get("name", "")))

    return {
        "basics": {
            "name": PROFILE.full_name,
            "label": PROFILE.role,
            "email": PROFILE.email,
            "phone": PROFILE.phone,
            "summary": PROFILE.summary,
            "location": {"city": PROFILE.location},
            "profiles": [
                {"network": "GitHub", "username": PROFILE.github_username},
                {"network": "LinkedIn", "url": PROFILE.linkedin_url},
            ],
        },
        "education": [
            {
                "institution": PROFILE.university,
                "area": PROFILE.degree,
                "studyType": "Bachelor of Technology",
                "score": f"{gpa_stats['cgpa']:.2f} CGPA",
                "courses": [
                    f"{s.label}: {s.gpa:.2f} ({s.note})"
                    for s in semesters
                    if s.gpa is not None
                ],
            }
        ],
        "skills": [
            {"name": category, "keywords": names}
            for category, names in grouped_skills.items()
        ],
        "projects": [
            {
                "name": proj.title,
                "description": proj.subtitle,
                "highlights": proj.highlights,
                "keywords": proj.stack,
                "roles": [proj.role],
            }
            for proj in PROJECTS
        ],
        "certificates": [
            {"name": cert["title"], "issuer": cert["issuer"]}
            for cert in CERTIFICATIONS
        ],
    }


def to_markdown_cv() -> str:
    """Render a clean Markdown resume from portfolio_data.py."""
    gpa_stats = compute_gpa_metrics()
    lines: List[str] = [
        f"# {PROFILE.full_name}",
        f"**{PROFILE.role}**  ",
        f"{PROFILE.location} | {PROFILE.email} | {PROFILE.phone}",
        "",
        "## Summary",
        PROFILE.summary,
        "",
        "## Education",
        f"- **{PROFILE.university}** — {PROFILE.degree} ({PROFILE.batch}) · CGPA: **{gpa_stats['cgpa']:.2f}**",
        "",
        "## Technical Skills",
    ]

    for skill in SKILLS_DATA:
        lines.append(f"- **{skill.get('name')}** ({skill.get('level')}): {skill.get('desc')}")

    lines.extend(["", "## Projects"])
    for proj in PROJECTS:
        lines.append(f"### {proj.title} — {proj.role}")
        lines.append(proj.subtitle)
        for item in proj.highlights:
            lines.append(f"- {item}")
        lines.append("")

    return "\n".join(lines)


def main(argv: Optional[list[str]] = None) -> int:
    parser = argparse.ArgumentParser(description="Export portfolio CV as JSON or Markdown.")
    parser.add_argument("--format", choices=["json", "markdown"], default="markdown")
    parser.add_argument("--out", help="Optional output file path.")
    args = parser.parse_args(argv)

    content = (
        json.dumps(to_json_resume(), indent=2, ensure_ascii=False)
        if args.format == "json"
        else to_markdown_cv()
    )

    if args.out:
        Path(args.out).write_text(content, encoding="utf-8")
        print(f"Exported {args.format} resume to {args.out}")
    else:
        print(content)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

"""Skill-to-project knowledge graph and role-alignment engine."""

from __future__ import annotations

from typing import Any, Dict, List, Set

from portfolio_data import PROJECTS, SKILLS_DATA


def build_skill_project_adjacency() -> Dict[str, List[str]]:
    """Map each technical skill to featured projects that utilize it."""
    adjacency: Dict[str, List[str]] = {}
    for skill in SKILLS_DATA:
        skill_name = str(skill.get("name", ""))
        skill_lower = skill_name.lower()
        linked: List[str] = []

        for project in PROJECTS:
            stack_tokens = " ".join(project.stack).lower()
            if skill_lower in stack_tokens or any(
                skill_lower in str(ref.get("label", "")).lower()
                for ref in skill.get("refs", [])
            ):
                linked.append(project.title)

        adjacency[skill_name] = linked
    return adjacency


def search_skills_by_keyword(keyword: str) -> List[Dict[str, Any]]:
    """Perform case-insensitive search across skill names, categories, and descriptions."""
    q = keyword.strip().lower()
    if not q:
        return list(SKILLS_DATA)
    return [
        s
        for s in SKILLS_DATA
        if q in str(s.get("name", "")).lower()
        or q in str(s.get("cat", "")).lower()
        or q in str(s.get("desc", "")).lower()
    ]


def compute_track_coverage() -> Dict[str, Any]:
    """Measure skill coverage across Python/AI-ML, Backend/DB, and Web tracks."""
    skill_names: Set[str] = {str(s.get("name", "")).lower() for s in SKILLS_DATA}
    tracks = {
        "python_ai_ml": ["python", "numpy", "pandas", "pytorch"],
        "backend_and_db": [
            "java",
            "mysql",
            "data structures & algorithms (dsa)",
            "object-oriented programming (oop)",
        ],
        "web_and_tooling": ["html", "css", "vs code", "github"],
    }

    summary: Dict[str, Dict[str, Any]] = {}
    for track, expected in tracks.items():
        matched = [item for item in expected if item in skill_names]
        pct = round((len(matched) / len(expected)) * 100.0, 1) if expected else 0.0
        summary[track] = {
            "matched_count": len(matched),
            "expected_count": len(expected),
            "coverage_pct": pct,
        }
    return summary

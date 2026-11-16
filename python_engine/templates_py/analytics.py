"""Academic performance and skill-matrix analytics module.

Computes GPA trajectories, category distributions, and cross-referenced
project technology coverage from portfolio_data.py.
"""

from __future__ import annotations

from collections import Counter
from typing import Any, Dict, List

from portfolio_data import (
    CAMPUS_ROOMS,
    PROJECTS,
    SKILLS_DATA,
    WEATHER_SAMPLE,
    get_semester_records,
)


def compute_gpa_metrics() -> Dict[str, Any]:
    """Compute cumulative GPA, semester delta, min/max, and trend direction."""
    records = get_semester_records()
    gpas = [r.gpa for r in records if r.gpa is not None]
    if not gpas:
        return {
            "cgpa": 0.0,
            "latest_gpa": 0.0,
            "highest_gpa": 0.0,
            "lowest_gpa": 0.0,
            "delta": 0.0,
            "semesters_completed": 0,
            "semesters_total": len(records),
            "trend": "none",
        }

    cgpa = round(sum(gpas) / len(gpas), 2)
    latest = gpas[-1]
    delta = round(gpas[-1] - gpas[-2], 2) if len(gpas) >= 2 else 0.0

    if delta > 0:
        trend = "upward"
    elif delta < 0:
        trend = "slight_dip"
    else:
        trend = "steady"

    return {
        "cgpa": cgpa,
        "latest_gpa": latest,
        "highest_gpa": max(gpas),
        "lowest_gpa": min(gpas),
        "delta": delta,
        "semesters_completed": len(gpas),
        "semesters_total": len(records),
        "trend": trend,
    }


def compute_skill_distribution() -> Dict[str, Any]:
    """Aggregate skills by category and proficiency level."""
    by_category: Counter[str] = Counter()
    by_level: Counter[str] = Counter()

    for skill in SKILLS_DATA:
        by_category[str(skill.get("cat", "Uncategorized"))] += 1
        by_level[str(skill.get("level", "Unspecified"))] += 1

    python_related = [
        str(s.get("name"))
        for s in SKILLS_DATA
        if "python" in str(s.get("name", "")).lower()
        or "python" in str(s.get("cat", "")).lower()
        or "python" in str(s.get("desc", "")).lower()
    ]

    return {
        "total": len(SKILLS_DATA),
        "by_category": dict(by_category),
        "by_level": dict(by_level),
        "python_ecosystem_skills": python_related,
    }


def compute_project_coverage() -> Dict[str, Any]:
    """Summarize project stack coverage and interactive dataset counts."""
    tech_counter: Counter[str] = Counter()
    for project in PROJECTS:
        for tech in project.stack:
            tech_counter[tech] += 1

    available_rooms = sum(1 for r in CAMPUS_ROOMS if r.get("status") == "Available")

    return {
        "count": len(PROJECTS),
        "technologies": dict(tech_counter),
        "weather_cities_modeled": len(WEATHER_SAMPLE),
        "campus_rooms_indexed": len(CAMPUS_ROOMS),
        "campus_rooms_available": available_rooms,
    }


def build_portfolio_report() -> Dict[str, Any]:
    """Generate unified analytics dictionary consumed by CLI, API, and static builds."""
    return {
        "gpa": compute_gpa_metrics(),
        "skills": compute_skill_distribution(),
        "projects": compute_project_coverage(),
    }


def format_terminal_summary(report: Dict[str, Any]) -> str:
    """Format portfolio analytics as a readable terminal table."""
    gpa = report["gpa"]
    skills = report["skills"]
    projects = report["projects"]

    lines: List[str] = [
        "Portfolio Analytics Summary",
        "---------------------------",
        f"Cumulative GPA      : {gpa['cgpa']:.2f} ({gpa['semesters_completed']} semesters)",
        f"Latest Semester GPA : {gpa['latest_gpa']:.2f} (delta {gpa['delta']:+.2f})",
        f"Total Skills        : {skills['total']}",
        f"Featured Projects   : {projects['count']}",
        f"Weather Cities      : {projects['weather_cities_modeled']}",
        f"Campus Rooms        : {projects['campus_rooms_indexed']} ({projects['campus_rooms_available']} available)",
        "",
        "Skills by Category:",
    ]

    for cat, count in sorted(skills["by_category"].items()):
        lines.append(f"  - {cat}: {count}")

    return "\n".join(lines)

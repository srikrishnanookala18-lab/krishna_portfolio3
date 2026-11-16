"""Generator for portfolio_data.py from extracted JavaScript portfolio datasets."""

from __future__ import annotations

import json
from typing import Any, Dict


def to_python_literal(value: Any, indent: int = 0) -> str:
    """Format JSON-compatible Python data structures as clean PEP-8 literals."""
    pad = " " * indent
    next_pad = " " * (indent + 4)

    if value is None:
        return "None"
    if isinstance(value, bool):
        return "True" if value else "False"
    if isinstance(value, (int, float)):
        return str(value)
    if isinstance(value, str):
        return json.dumps(value, ensure_ascii=False)

    if isinstance(value, list):
        if not value:
            return "[]"
        items = [f"{next_pad}{to_python_literal(item, indent + 4)}" for item in value]
        return "[\n" + ",\n".join(items) + f",\n{pad}]"

    if isinstance(value, dict):
        if not value:
            return "{}"
        lines = [
            f"{next_pad}{json.dumps(str(k), ensure_ascii=False)}: {to_python_literal(v, indent + 4)}"
            for k, v in value.items()
        ]
        return "{\n" + ",\n".join(lines) + f",\n{pad}}}"

    return json.dumps(str(value), ensure_ascii=False)


def render_portfolio_data_py(
    owner: str,
    repo: str,
    title: str,
    owner_name: str,
    extracted_datasets: Dict[str, Any],
) -> str:
    """Render portfolio_data.py source code with extracted datasets."""
    semesters_py = to_python_literal(
        extracted_datasets.get(
            "semesters",
            [
                {"label": "Sem 1", "gpa": 9.02, "note": "Completed"},
                {"label": "Sem 2", "gpa": 8.86, "note": "Completed"},
            ],
        )
    )
    skills_py = to_python_literal(extracted_datasets.get("skillsData", []))
    weather_py = to_python_literal(extracted_datasets.get("weatherSample", {}))
    campus_py = to_python_literal(extracted_datasets.get("campusRooms", []))

    return f'''"""Structured portfolio models and datasets.

Serves as the single source of truth for both the Flask runtime API
and the static site generator targeting Netlify deployment.
"""

from __future__ import annotations

from dataclasses import asdict, dataclass, field
from typing import Any, Dict, List, Optional


@dataclass(frozen=True)
class Profile:
    """Core candidate identity and academic metadata."""

    full_name: str
    title: str
    role: str
    university: str
    degree: str
    batch: str
    location: str
    email: str
    phone: str
    github_username: str
    github_repo: str
    linkedin_url: str
    summary: str


@dataclass(frozen=True)
class SemesterRecord:
    """Academic performance record for a single university semester."""

    sem: str
    label: str
    gpa: Optional[float]
    note: str


@dataclass(frozen=True)
class ProjectSummary:
    """Summary metadata for featured engineering and team projects."""

    slug: str
    title: str
    subtitle: str
    role: str
    stack: List[str] = field(default_factory=list)
    highlights: List[str] = field(default_factory=list)


PROFILE = Profile(
    full_name={json.dumps(owner_name, ensure_ascii=False)},
    title={json.dumps(title, ensure_ascii=False)},
    role="Second-Year B.Tech CSE (AI & ML) · Python Developer & AI/ML Engineer Aspirant",
    university="Jain University",
    degree="B.Tech Computer Science and Engineering (AI & ML)",
    batch="2025 - 2029",
    location="Hyderabad, Telangana",
    email="srikrishnanookala18@gmail.com",
    phone="8790761414",
    github_username={json.dumps(owner, ensure_ascii=False)},
    github_repo={json.dumps(repo, ensure_ascii=False)},
    linkedin_url="https://www.linkedin.com/in/sri-krishna-nookala-19758a44b",
    summary=(
        "Second-year B.Tech Computer Science and Engineering (AI & ML) student at "
        "Jain University, aspiring to work as a Python Developer or AI/ML Engineer. "
        "Brings intermediate Python and Java skills, team project experience, and "
        "exposure to data and machine-learning libraries, API integration, and backend development."
    ),
)

CERTIFICATIONS: List[Dict[str, str]] = [
    {{
        "title": "100 Days of Code: The Complete Python Pro Bootcamp",
        "issuer": "Udemy",
        "focus": "Python scripting, OOP, automation, APIs, and data analysis",
    }},
    {{
        "title": "B.Tech CSE (AI & ML) Core Track",
        "issuer": "Jain University",
        "focus": "Data Structures & Algorithms, OOP, DBMS, and Machine Learning",
    }},
]

PROJECTS: List[ProjectSummary] = [
    ProjectSummary(
        slug="jiosense",
        title="Jio Sense Weather Dashboard",
        subtitle="Multi-city meteorological telemetry & forecast dashboard",
        role="Frontend & API Integration Contributor",
        stack=["Python", "HTML", "CSS", "JavaScript", "Weather API"],
        highlights=[
            "Multi-city temperature, humidity, wind, UV, and pressure metrics",
            "Hourly and 7-day forecast curve visualizations",
            "Automated weather advisory alert thresholds",
        ],
    ),
    ProjectSummary(
        slug="jainsmart",
        title="JAIN Smart Navigation",
        subtitle="Natural-language campus room & lab locator",
        role="Database Management & Backend Integration",
        stack=["Python", "MySQL", "Express", "Gemini NLP"],
        highlights=[
            "Natural-language intent routing for classrooms and AI/ML laboratories",
            "Floor-by-floor interactive SVG schematic lookup",
            "Structured relational room availability tracking",
        ],
    ),
]

SEMESTERS_RAW: List[Dict[str, Any]] = {semesters_py}

SKILLS_DATA: List[Dict[str, Any]] = {skills_py}

WEATHER_SAMPLE: Dict[str, Any] = {weather_py}

CAMPUS_ROOMS: List[Dict[str, Any]] = {campus_py}


def get_semester_records() -> List[SemesterRecord]:
    """Return typed SemesterRecord instances from SEMESTERS_RAW."""
    records: List[SemesterRecord] = []
    for item in SEMESTERS_RAW:
        raw_gpa = item.get("gpa")
        parsed_gpa = float(raw_gpa) if raw_gpa is not None else None
        label = str(item.get("label", ""))
        records.append(
            SemesterRecord(
                sem=str(item.get("sem") or label),
                label=label,
                gpa=parsed_gpa,
                note=str(item.get("note", "")),
            )
        )
    return records


def filter_skills(category: Optional[str] = None) -> List[Dict[str, Any]]:
    """Filter skills by category name; returns all skills when category is None or 'All'."""
    if not category or category.strip().lower() == "all":
        return list(SKILLS_DATA)
    target = category.strip().lower()
    return [s for s in SKILLS_DATA if str(s.get("cat", "")).lower() == target]


def export_bootstrap_payload() -> Dict[str, Any]:
    """Serialize all client-side interactive data for static and Flask HTML rendering."""
    return {{
        "profile": asdict(PROFILE),
        "semesters": SEMESTERS_RAW,
        "skillsData": SKILLS_DATA,
        "weatherSample": WEATHER_SAMPLE,
        "campusRooms": CAMPUS_ROOMS,
        "projects": [asdict(p) for p in PROJECTS],
        "certifications": CERTIFICATIONS,
    }}
'''

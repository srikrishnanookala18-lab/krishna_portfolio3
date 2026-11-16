"""Unit tests for resume_exporter, seo_validator, and skill_graph modules."""

from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from build_static import build_site
from resume_exporter import to_json_resume, to_markdown_cv
from seo_validator import audit_html_file
from skill_graph import (
    build_skill_project_adjacency,
    compute_track_coverage,
    search_skills_by_keyword,
)


class ExporterAndSeoTests(unittest.TestCase):
    """Validate CV export, HTML structural audit, and skill graph lookups."""

    def test_json_and_markdown_resume_exports(self) -> None:
        resume = to_json_resume()
        self.assertIn("basics", resume)
        self.assertIn("education", resume)
        self.assertIn("skills", resume)

        md = to_markdown_cv()
        self.assertIn("## Education", md)
        self.assertIn("## Technical Skills", md)

    def test_seo_audit_on_compiled_html(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            built = build_site(Path(tmp) / "dist")
            findings = audit_html_file(built)
            self.assertTrue(all(f.passed for f in findings), msg=str(findings))

    def test_skill_graph_queries(self) -> None:
        adjacency = build_skill_project_adjacency()
        self.assertIsInstance(adjacency, dict)
        matches = search_skills_by_keyword("python")
        self.assertGreaterEqual(len(matches), 1)
        coverage = compute_track_coverage()
        self.assertIn("python_ai_ml", coverage)


if __name__ == "__main__":
    unittest.main()

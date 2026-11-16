"""Unit test suite for portfolio data, analytics, and static site generation."""

from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path

from analytics import build_portfolio_report, compute_gpa_metrics
from build_static import build_site
from campus_engine import query_campus_rooms
from portfolio_data import (
    CAMPUS_ROOMS,
    PROFILE,
    SKILLS_DATA,
    export_bootstrap_payload,
    filter_skills,
)


class PortfolioDataTests(unittest.TestCase):
    """Validate structured portfolio datasets and lookup helpers."""

    def test_profile_identity(self) -> None:
        self.assertTrue(len(PROFILE.full_name) > 0)
        self.assertIn("@", PROFILE.email)

    def test_filter_skills_all_and_category(self) -> None:
        all_skills = filter_skills("All")
        self.assertEqual(len(all_skills), len(SKILLS_DATA))

        if SKILLS_DATA:
            first_cat = str(SKILLS_DATA[0]["cat"])
            filtered = filter_skills(first_cat)
            self.assertGreaterEqual(len(filtered), 1)
            self.assertTrue(all(s["cat"] == first_cat for s in filtered))

    def test_campus_query_resolution(self) -> None:
        if not CAMPUS_ROOMS:
            self.skipTest("No campus rooms present in extracted dataset")
        vacant = query_campus_rooms("Show vacant rooms")
        self.assertGreaterEqual(len(vacant), 1)
        ai_lab = query_campus_rooms("Find available AI Lab")
        self.assertGreaterEqual(len(ai_lab), 1)

    def test_bootstrap_payload_json_serializable(self) -> None:
        payload = export_bootstrap_payload()
        encoded = json.dumps(payload)
        self.assertIn("profile", encoded)
        self.assertIn("semesters", encoded)


class AnalyticsAndBuildTests(unittest.TestCase):
    """Validate GPA analytics calculations and static site compilation."""

    def test_gpa_metrics(self) -> None:
        metrics = compute_gpa_metrics()
        self.assertGreater(metrics["cgpa"], 0.0)
        self.assertGreaterEqual(metrics["semesters_completed"], 1)

    def test_portfolio_report_structure(self) -> None:
        report = build_portfolio_report()
        self.assertIn("gpa", report)
        self.assertIn("skills", report)
        self.assertIn("projects", report)

    def test_static_build_creates_index_and_summary(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            out_dir = Path(tmp) / "dist"
            index_file = build_site(out_dir)
            self.assertTrue(index_file.exists())
            html = index_file.read_text(encoding="utf-8")
            self.assertIn("<!DOCTYPE html>", html)
            self.assertNotIn("{{PORTFOLIO_JSON}}", html)
            self.assertTrue((out_dir / "portfolio-summary.json").exists())
            self.assertTrue((out_dir / "artifacts" / "gpa-chart.svg").exists())


if __name__ == "__main__":
    unittest.main()

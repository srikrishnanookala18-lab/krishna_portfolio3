"""Unit tests for PyRefactor Studio's Python refactoring CLI engine."""

from __future__ import annotations

import base64
import io
import sys
import unittest
import zipfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from refactor_cli import (  # noqa: E402
    analyze_html_bytes,
    create_zip_base64,
    extract_js_const_span,
    js_literal_to_python,
    refactor_portfolio,
)

SAMPLE_HTML = """<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Sample Portfolio</title>
  <style>
    body { margin: 0; font-family: sans-serif; }
  </style>
</head>
<body>
  <h1>Sample Developer</h1>
  <script>
    (function () {
      const semesters = [
        { label: "Sem 1", gpa: 9.02, note: "Completed" },
        { label: "Sem 2", gpa: 8.86, note: "Completed" },
        { label: "Sem 3", gpa: null, note: "Upcoming" }
      ];
      const skillsData = [
        { name: "Python", level: "Intermediate", cat: "Programming Languages", desc: "Core language", refs: [] }
      ];
      const weatherSample = {
        Hyderabad: {
          temp: "31°C", humidity: "44%", wind: "14 km/h", pressure: "1011 hPa", uv: "7 (High)",
          alert: { level: "Advisory", text: "Hydrate regularly." },
          hourly: [{ t: "09h", v: 26 }, { t: "12h", v: 31 }]
        }
      };
      const campusRooms = [
        { id: "R201", name: "AI & ML Lab", floor: 2, type: "Laboratory", status: "Available", x: 60 }
      ];
      console.log(semesters.length, skillsData.length, Object.keys(weatherSample).length, campusRooms.length);
    })();
  </script>
</body>
</html>
"""


class RefactorCliTests(unittest.TestCase):
    """Validate HTML byte analysis, JS literal extraction, and full refactor pipeline."""

    def test_analyze_html_bytes(self) -> None:
        stats = analyze_html_bytes(SAMPLE_HTML)
        self.assertGreater(stats["totalBytes"], 0)
        self.assertGreater(stats["styleBytes"], 0)
        self.assertGreater(stats["scriptBytes"], 0)
        self.assertEqual(
            stats["totalBytes"],
            stats["styleBytes"] + stats["scriptBytes"] + stats["htmlBytes"],
        )

    def test_js_const_extraction_and_parsing(self) -> None:
        span = extract_js_const_span(SAMPLE_HTML, "semesters")
        self.assertIsNotNone(span)
        assert span is not None
        parsed = js_literal_to_python(span[2])
        self.assertIsInstance(parsed, list)
        self.assertEqual(len(parsed), 3)
        self.assertIsNone(parsed[2]["gpa"])

    def test_full_refactor_pipeline_and_zip(self) -> None:
        result = refactor_portfolio(
            {
                "owner": "srikrishnanookala18-lab",
                "repo": "portfolio2",
                "originalFilename": "sample.html",
                "rawHtml": SAMPLE_HTML,
                "preset": "python-first",
                "netlifyMode": "netlify-toml",
            }
        )
        self.assertTrue(result["verification"]["buildSuccess"])
        self.assertTrue(result["verification"]["testsSuccess"])
        self.assertGreater(result["pythonPercentage"], 45.0)

        b64_zip = create_zip_base64(result["files"])
        raw_bytes = base64.b64decode(b64_zip)
        with zipfile.ZipFile(io.BytesIO(raw_bytes), "r") as zf:
            names = set(zf.namelist())
            self.assertIn("portfolio_data.py", names)
            self.assertIn("build_static.py", names)
            self.assertIn("netlify.toml", names)


if __name__ == "__main__":
    unittest.main()

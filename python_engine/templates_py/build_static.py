"""Zero-dependency Python static site generator for Netlify deployment.

Reads templates/index.html, injects serialized portfolio data from portfolio_data.py,
renders server-side SVG charts, copies static assets, and emits dist/index.html.

Usage:
    python3 build_static.py --out dist
"""

from __future__ import annotations

import argparse
import json
import shutil
from pathlib import Path
from typing import Optional

from analytics import build_portfolio_report
from portfolio_data import export_bootstrap_payload
from svg_charts import render_gpa_trajectory_svg, render_skill_breakdown_svg
from weather_service import list_all_city_reports

ROOT_DIR = Path(__file__).resolve().parent
TEMPLATE_PATH = ROOT_DIR / "templates" / "index.html"
STATIC_DIR = ROOT_DIR / "static"


def render_static_html(template_text: str) -> str:
    """Inject the Python-serialized portfolio JSON payload into the HTML template."""
    payload = export_bootstrap_payload()
    serialized = json.dumps(payload, ensure_ascii=False).replace("</", "<\\/")

    rendered = template_text.replace("{{PORTFOLIO_JSON}}", serialized)
    rendered = rendered.replace("{{ PORTFOLIO_JSON | tojson }}", serialized)
    return rendered


def build_site(out_dir: Path, inline_assets: bool = False) -> Path:
    """Compile the portfolio HTML, SVG artifacts, and static CSS/JS assets into out_dir."""
    if not TEMPLATE_PATH.exists():
        raise FileNotFoundError(f"Missing template file: {TEMPLATE_PATH}")

    out_dir.mkdir(parents=True, exist_ok=True)
    template_text = TEMPLATE_PATH.read_text(encoding="utf-8")
    compiled_html = render_static_html(template_text)

    if inline_assets:
        css_path = STATIC_DIR / "css" / "styles.css"
        js_path = STATIC_DIR / "js" / "main.js"
        if css_path.exists():
            css_text = css_path.read_text(encoding="utf-8")
            compiled_html = compiled_html.replace(
                '<link rel="stylesheet" href="static/css/styles.css" />',
                f"<style>\n{css_text}\n</style>",
            )
        if js_path.exists():
            js_text = js_path.read_text(encoding="utf-8")
            compiled_html = compiled_html.replace(
                '<script src="static/js/main.js"></script>',
                f"<script>\n{js_text}\n</script>",
            )
    else:
        dest_static = out_dir / "static"
        if dest_static.exists():
            shutil.rmtree(dest_static)
        if STATIC_DIR.exists():
            shutil.copytree(STATIC_DIR, dest_static)

    output_index = out_dir / "index.html"
    output_index.write_text(compiled_html, encoding="utf-8")

    artifacts_dir = out_dir / "artifacts"
    artifacts_dir.mkdir(parents=True, exist_ok=True)
    (artifacts_dir / "gpa-chart.svg").write_text(render_gpa_trajectory_svg(), encoding="utf-8")
    (artifacts_dir / "skills-chart.svg").write_text(render_skill_breakdown_svg(), encoding="utf-8")

    summary_payload = {
        "analytics": build_portfolio_report(),
        "weather_reports": list_all_city_reports(),
    }
    (out_dir / "portfolio-summary.json").write_text(
        json.dumps(summary_payload, indent=2, ensure_ascii=False) + "\n",
        encoding="utf-8",
    )
    return output_index


def main(argv: Optional[list[str]] = None) -> int:
    parser = argparse.ArgumentParser(description="Build static portfolio site for Netlify.")
    parser.add_argument(
        "--out",
        default="dist",
        help="Output directory for generated static files (default: dist).",
    )
    parser.add_argument(
        "--inline-assets",
        action="store_true",
        help="Inline CSS and JavaScript into a single self-contained HTML artifact.",
    )
    args = parser.parse_args(argv)

    out_path = (ROOT_DIR / args.out).resolve() if not Path(args.out).is_absolute() else Path(args.out)
    built = build_site(out_path, inline_assets=args.inline_assets)
    report = build_portfolio_report()

    print(f"Built static portfolio -> {built}")
    print(
        f"CGPA: {report['gpa']['cgpa']:.2f} | "
        f"Skills: {report['skills']['total']} | "
        f"Projects: {report['projects']['count']}"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

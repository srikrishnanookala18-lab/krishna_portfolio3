"""Developer CLI for managing, inspecting, and building the portfolio.

Commands:
    python3 cli.py stats
    python3 cli.py build --out dist
    python3 cli.py skills --category "Programming Languages"
    python3 cli.py campus --query "Find available AI Lab"
    python3 cli.py weather --city Hyderabad
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Optional

from analytics import build_portfolio_report, format_terminal_summary
from build_static import build_site
from campus_engine import route_campus_query
from portfolio_data import filter_skills
from weather_service import analyze_city_weather, summarize_forecast_series


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="portfolio-cli",
        description="Inspect portfolio analytics, query datasets, and build static Netlify output.",
    )
    sub = parser.add_subparsers(dest="command", required=True)

    stats_cmd = sub.add_parser("stats", help="Print GPA, skill, and project summary.")
    stats_cmd.add_argument("--json", action="store_true", help="Output raw JSON report.")

    build_cmd = sub.add_parser("build", help="Compile static portfolio output.")
    build_cmd.add_argument("--out", default="dist", help="Target output directory.")
    build_cmd.add_argument("--inline", action="store_true", help="Inline CSS and JS into index.html.")

    skills_cmd = sub.add_parser("skills", help="List skills optionally filtered by category.")
    skills_cmd.add_argument("--category", default="All", help="Skill category filter.")

    campus_cmd = sub.add_parser("campus", help="Test natural-language campus room query.")
    campus_cmd.add_argument("--query", required=True, help="Natural language room query.")

    weather_cmd = sub.add_parser("weather", help="Analyze weather telemetry for a city.")
    weather_cmd.add_argument("--city", required=True, help="City name (e.g. Hyderabad).")

    return parser


def main(argv: Optional[list[str]] = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)

    if args.command == "stats":
        report = build_portfolio_report()
        if args.json:
            print(json.dumps(report, indent=2))
        else:
            print(format_terminal_summary(report))
        return 0

    if args.command == "build":
        out_path = Path(args.out).resolve()
        built = build_site(out_path, inline_assets=args.inline)
        print(f"Static build complete: {built}")
        return 0

    if args.command == "skills":
        items = filter_skills(args.category)
        for item in items:
            print(f"- {item.get('name')} ({item.get('level')}) [{item.get('cat')}]")
        return 0

    if args.command == "campus":
        routed = route_campus_query(args.query)
        print(f"Intent: {routed['intent']} | Target Floor: {routed['target_floor']}")
        for step in routed["directions"]:
            print(f"  -> {step}")
        return 0

    if args.command == "weather":
        reading = analyze_city_weather(args.city)
        if not reading:
            print(f"City not found: {args.city}")
            return 1
        forecast = summarize_forecast_series(args.city, mode="hourly")
        print(
            f"{reading.city}: {reading.temperature_c}C | "
            f"Heat Index {reading.heat_index_c}C | "
            f"Comfort {reading.comfort_score}/100 | UV {reading.uv_band}"
        )
        print(f"Hourly mean: {forecast.get('mean_c')}C (peak at {forecast.get('peak_slot')})")
        return 0

    return 1


if __name__ == "__main__":
    raise SystemExit(main())

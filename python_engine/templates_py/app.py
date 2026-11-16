"""Flask web application and REST API for Nookala Sri Krishna's Portfolio.

Run locally with:
    python3 app.py
"""

from __future__ import annotations

import os
from typing import Any, Dict

from flask import Flask, Response, jsonify, render_template, request

from analytics import build_portfolio_report
from campus_engine import get_floor_occupancy_summary, route_campus_query
from portfolio_data import (
    CERTIFICATIONS,
    PROJECTS,
    export_bootstrap_payload,
    filter_skills,
)
from svg_charts import render_gpa_trajectory_svg, render_skill_breakdown_svg
from weather_service import (
    analyze_city_weather,
    list_all_city_reports,
    summarize_forecast_series,
)

app = Flask(__name__, static_folder="static", template_folder="templates")


@app.route("/")
def index() -> str:
    """Render the interactive portfolio page hydrated from Python portfolio_data."""
    payload = export_bootstrap_payload()
    return render_template("index.html", PORTFOLIO_JSON=payload)


@app.route("/health")
def health() -> Any:
    """Health check endpoint for WSGI / container probes."""
    return jsonify({"status": "ok", "service": "portfolio-python-app"})


@app.route("/api/profile")
def api_profile() -> Any:
    """Return candidate profile, certifications, and academic analytics."""
    report = build_portfolio_report()
    return jsonify(
        {
            "profile": export_bootstrap_payload()["profile"],
            "certifications": CERTIFICATIONS,
            "analytics": report,
        }
    )


@app.route("/api/skills")
def api_skills() -> Any:
    """Return all skills or filter by ?category=... query parameter."""
    category = request.args.get("category")
    items = filter_skills(category)
    return jsonify({"count": len(items), "category": category or "All", "skills": items})


@app.route("/api/projects")
def api_projects() -> Any:
    """Return structured project summaries."""
    return jsonify({"projects": [p.__dict__ for p in PROJECTS]})


@app.route("/api/weather")
def api_weather_all() -> Any:
    """Return normalized telemetry across all modeled cities."""
    return jsonify({"cities": list_all_city_reports()})


@app.route("/api/weather/<city>")
def api_weather(city: str) -> Any:
    """Return derived meteorological indices and forecast stats for a city."""
    reading = analyze_city_weather(city)
    if reading is None:
        return jsonify({"error": f"City '{city}' not found"}), 404
    mode = request.args.get("mode", "hourly")
    forecast = summarize_forecast_series(city, mode=mode)
    return jsonify({"telemetry": reading.__dict__, "forecast_summary": forecast})


@app.route("/api/campus/query")
def api_campus_query() -> Any:
    """Run natural-language room & laboratory lookup + routing for JAIN Smart Navigation."""
    q = request.args.get("q", "").strip()
    if not q:
        return jsonify({"error": "Missing required query parameter 'q'"}), 400
    start_floor = int(request.args.get("start_floor", "1"))
    return jsonify(route_campus_query(q, start_floor=start_floor))


@app.route("/api/campus/floors")
def api_campus_floors() -> Any:
    """Return occupancy statistics grouped by floor."""
    return jsonify({"floors": get_floor_occupancy_summary()})


@app.route("/api/charts/gpa.svg")
def api_chart_gpa() -> Response:
    """Serve Python-rendered SVG GPA trajectory graphic."""
    return Response(render_gpa_trajectory_svg(), mimetype="image/svg+xml")


@app.route("/api/charts/skills.svg")
def api_chart_skills() -> Response:
    """Serve Python-rendered SVG skill distribution graphic."""
    return Response(render_skill_breakdown_svg(), mimetype="image/svg+xml")


@app.route("/api/report")
def api_report() -> Any:
    """Expose computed academic GPA and technical skill distribution metrics."""
    report: Dict[str, Any] = build_portfolio_report()
    return jsonify(report)


if __name__ == "__main__":
    port = int(os.environ.get("PORT", "5000"))
    debug = os.environ.get("FLASK_DEBUG", "false").lower() == "true"
    app.run(host="0.0.0.0", port=port, debug=debug)

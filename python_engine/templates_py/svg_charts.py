"""Server-side SVG chart generator for GPA trajectories and skill distributions."""

from __future__ import annotations

from html import escape
from typing import List

from analytics import compute_skill_distribution
from portfolio_data import get_semester_records


def render_gpa_trajectory_svg(width: int = 560, height: int = 180) -> str:
    """Render an accessible vector SVG line chart of completed semester GPAs."""
    records = [r for r in get_semester_records() if r.gpa is not None]
    if not records:
        return '<svg viewBox="0 0 400 100" xmlns="http://www.w3.org/2000/svg"><text x="20" y="50">No GPA records</text></svg>'

    pad_l, pad_r, pad_t, pad_b = 42, 24, 26, 30
    plot_w = width - pad_l - pad_r
    plot_h = height - pad_t - pad_b
    min_g, max_g = 7.5, 10.0

    def x_for(idx: int) -> float:
        if len(records) == 1:
            return pad_l + plot_w / 2.0
        return pad_l + (idx / (len(records) - 1)) * plot_w

    def y_for(val: float) -> float:
        clamped = max(min_g, min(max_g, val))
        return pad_t + ((max_g - clamped) / (max_g - min_g)) * plot_h

    points: List[str] = []
    markers: List[str] = []
    for idx, rec in enumerate(records):
        assert rec.gpa is not None
        x = x_for(idx)
        y = y_for(rec.gpa)
        points.append(f"{x:.1f},{y:.1f}")
        markers.append(
            f'<circle cx="{x:.1f}" cy="{y:.1f}" r="4.5" fill="#2557d6" stroke="#ffffff" stroke-width="2" />'
        )
        markers.append(
            f'<text x="{x:.1f}" y="{y - 10:.1f}" text-anchor="middle" font-size="11" '
            f'font-family="monospace" fill="#111318">{rec.gpa:.2f}</text>'
        )
        markers.append(
            f'<text x="{x:.1f}" y="{height - 8}" text-anchor="middle" font-size="11" '
            f'font-family="sans-serif" fill="#555b66">{escape(rec.label)}</text>'
        )

    grid_lines: List[str] = []
    for tick in (8.0, 8.5, 9.0, 9.5, 10.0):
        ty = y_for(tick)
        grid_lines.append(
            f'<line x1="{pad_l}" y1="{ty:.1f}" x2="{width - pad_r}" y2="{ty:.1f}" '
            'stroke="#e4e2dc" stroke-dasharray="3 3" />'
        )
        grid_lines.append(
            f'<text x="{pad_l - 8}" y="{ty + 4:.1f}" text-anchor="end" font-size="10" '
            f'font-family="monospace" fill="#848b98">{tick:.1f}</text>'
        )

    polyline = (
        f'<polyline fill="none" stroke="#2557d6" stroke-width="2.4" '
        f'stroke-linecap="round" stroke-linejoin="round" points="{" ".join(points)}" />'
        if len(points) >= 2
        else ""
    )

    return "\n".join(
        [
            f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {width} {height}" role="img" aria-label="Academic GPA Trajectory">',
            '  <rect width="100%" height="100%" rx="12" fill="#ffffff" stroke="#e4e2dc" />',
            *[f"  {g}" for g in grid_lines],
            f"  {polyline}",
            *[f"  {m}" for m in markers],
            "</svg>",
        ]
    )


def render_skill_breakdown_svg(width: int = 560, height: int = 210) -> str:
    """Render a horizontal SVG bar chart summarizing skills by category."""
    dist = compute_skill_distribution()["by_category"]
    if not dist:
        return '<svg viewBox="0 0 400 80" xmlns="http://www.w3.org/2000/svg"><text x="20" y="40">No skills</text></svg>'

    items = sorted(dist.items(), key=lambda kv: kv[1], reverse=True)
    max_val = max(v for _, v in items) or 1
    bar_area_x = 200
    bar_max_w = width - bar_area_x - 56
    row_h = 32
    computed_h = max(height, 44 + len(items) * row_h)

    rows: List[str] = []
    for idx, (cat, count) in enumerate(items):
        y = 32 + idx * row_h
        bar_w = max(8.0, (count / max_val) * bar_max_w)
        rows.append(
            f'<text x="16" y="{y + 14}" font-size="12" font-family="sans-serif" fill="#111318">{escape(cat)}</text>'
        )
        rows.append(
            f'<rect x="{bar_area_x}" y="{y}" width="{bar_w:.1f}" height="18" rx="4" fill="#2557d6" />'
        )
        rows.append(
            f'<text x="{bar_area_x + bar_w + 8:.1f}" y="{y + 14}" font-size="12" font-family="monospace" fill="#555b66">{count}</text>'
        )

    return "\n".join(
        [
            f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {width} {computed_h}" role="img" aria-label="Skill Category Distribution">',
            '  <rect width="100%" height="100%" rx="12" fill="#ffffff" stroke="#e4e2dc" />',
            *[f"  {r}" for r in rows],
            "</svg>",
        ]
    )

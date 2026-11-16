"""Core Python refactoring CLI for PyRefactor Studio.

Parses monolithic HTML portfolios into modular Python applications,
extracts embedded CSS/JS and structured datasets, verifies static builds
and unit tests in an isolated sandbox, and packages downloadable ZIP bundles.
"""

from __future__ import annotations

import argparse
import base64
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import zipfile
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

ENGINE_DIR = Path(__file__).resolve().parent
TEMPLATES_PY_DIR = ENGINE_DIR / "templates_py"

sys.path.insert(0, str(ENGINE_DIR))
from portfolio_data_builder import render_portfolio_data_py  # noqa: E402

LANGUAGE_COLORS: Dict[str, str] = {
    "Python": "#3572A5",
    "HTML": "#e34c26",
    "CSS": "#563d7c",
    "JavaScript": "#f1e05a",
}


def detect_language(file_path: str) -> str:
    """Return GitHub Linguist language classification for a generated path."""
    if file_path.endswith(".py"):
        return "Python"
    if file_path.endswith(".html"):
        return "HTML"
    if file_path.endswith(".css"):
        return "CSS"
    if file_path.endswith(".js"):
        return "JavaScript"
    if file_path.endswith(".toml"):
        return "TOML"
    if file_path.endswith(".md"):
        return "Markdown"
    return "Text"


def byte_length(text: str) -> int:
    """Return exact UTF-8 byte count."""
    return len(text.encode("utf-8"))


def analyze_html_bytes(html: str) -> Dict[str, int]:
    """Compute byte breakdown across inline <style>, <script>, and remaining HTML."""
    style_bytes = sum(
        byte_length(m.group(0))
        for m in re.finditer(r"<style\b[^>]*>[\s\S]*?</style>", html, re.IGNORECASE)
    )
    script_bytes = sum(
        byte_length(m.group(0))
        for m in re.finditer(r"<script\b[^>]*>[\s\S]*?</script>", html, re.IGNORECASE)
    )
    total_bytes = byte_length(html)
    return {
        "totalBytes": total_bytes,
        "styleBytes": style_bytes,
        "scriptBytes": script_bytes,
        "htmlBytes": max(0, total_bytes - style_bytes - script_bytes),
    }


def extract_title_and_owner(html: str) -> Tuple[str, str]:
    """Extract document <title> and primary <h1> owner name."""
    title_match = re.search(r"<title[^>]*>([\s\S]*?)</title>", html, re.IGNORECASE)
    title = re.sub(r"\s+", " ", title_match.group(1)).strip() if title_match else "Interactive Portfolio"

    h1_match = re.search(r"<h1[^>]*>([\s\S]*?)</h1>", html, re.IGNORECASE)
    if h1_match:
        plain = re.sub(r"<[^>]+>", "", h1_match.group(1))
        owner_name = re.sub(r"\s+", " ", plain).strip()
    else:
        owner_name = "Portfolio Owner"

    return title, owner_name


def extract_js_const_span(js: str, var_name: str) -> Optional[Tuple[int, int, str]]:
    """Locate a `const <var_name> = [...]|{...};` assignment and return (start, end, literal)."""
    marker = f"const {var_name} ="
    idx = js.find(marker)
    if idx == -1:
        return None

    i = idx + len(marker)
    n = len(js)
    while i < n and js[i].isspace():
        i += 1
    if i >= n or js[i] not in ("[", "{"):
        return None

    open_char = js[i]
    close_char = "]" if open_char == "[" else "}"
    depth = 0
    in_string: Optional[str] = None
    escaped = False
    literal_start = i

    while i < n:
        ch = js[i]
        if escaped:
            escaped = False
            i += 1
            continue
        if in_string is not None:
            if ch == "\\":
                escaped = True
            elif ch == in_string:
                in_string = None
            i += 1
            continue
        if ch in ('"', "'", "`"):
            in_string = ch
            i += 1
            continue
        if ch == open_char:
            depth += 1
        elif ch == close_char:
            depth -= 1
            if depth == 0:
                literal_end = i + 1
                end = literal_end
                while end < n and js[end] in (";", " "):
                    if js[end] == ";":
                        end += 1
                        break
                    end += 1
                return idx, end, js[literal_start:literal_end]
        i += 1

    return None


def js_literal_to_python(literal: str) -> Any:
    """Convert a static JavaScript object/array literal into Python data structures."""
    try:
        return json.loads(literal)
    except json.JSONDecodeError:
        pass

    # Normalize JS object literal -> valid JSON (quote unquoted identifier keys, normalize single quotes)
    out: List[str] = []
    i = 0
    n = len(literal)
    in_string: Optional[str] = None
    escaped = False

    while i < n:
        ch = literal[i]
        if escaped:
            out.append(ch)
            escaped = False
            i += 1
            continue
        if in_string is not None:
            if ch == "\\":
                escaped = True
                out.append(ch)
            elif ch == in_string:
                out.append('"')
                in_string = None
            elif ch == '"' and in_string == "'":
                out.append('\\"')
            else:
                out.append(ch)
            i += 1
            continue

        if ch in ('"', "'"):
            in_string = ch
            out.append('"')
            i += 1
            continue

        # Check for unquoted object key like `label:` or `alert:`
        if ch.isalpha() or ch == "_":
            j = i
            while j < n and (literal[j].isalnum() or literal[j] == "_"):
                j += 1
            ident = literal[i:j]
            k = j
            while k < n and literal[k].isspace():
                k += 1
            if k < n and literal[k] == ":":
                out.append(f'"{ident}"')
                i = j
                continue
            out.append(ident)
            i = j
            continue

        out.append(ch)
        i += 1

    normalized = "".join(out)
    # Remove trailing commas before } or ]
    normalized = re.sub(r",\s*([}\]])", r"\1", normalized)
    try:
        return json.loads(normalized)
    except json.JSONDecodeError:
        return None


def dedent_block(block: str) -> str:
    """Strip uniform HTML-nesting indentation from extracted CSS and JS blocks."""
    lines = [re.sub(r"^ {2,6}", "", line) for line in block.split("\n")]
    return "\n".join(lines).strip()


def load_template_py(rel_path: str) -> str:
    """Load a verified Python module template from templates_py/."""
    return (TEMPLATES_PY_DIR / rel_path).read_text(encoding="utf-8")


def build_readme_md(owner_name: str) -> str:
    """Generate repository README documentation."""
    return f"""# {owner_name} — Python-Powered Portfolio

Modular Python + Flask + Static Site Generator architecture refactored from the original single-file portfolio while preserving full interactive behavior on Netlify.

## Project Structure

- `portfolio_data.py` — Typed dataclasses and structured datasets (academics, skills, weather telemetry, campus rooms, projects)
- `app.py` — Flask web application and JSON API endpoints (`/api/profile`, `/api/skills`, `/api/projects`, `/api/weather/<city>`, `/api/campus/query`)
- `build_static.py` — Zero-dependency Python static site builder generating `dist/` for Netlify
- `analytics.py` — GPA trajectory and skill distribution analytics
- `weather_service.py` — Meteorological comfort index, heat index, and UV risk engine
- `campus_engine.py` — NLP query parser and corridor routing engine
- `svg_charts.py` — Server-side vector chart renderer
- `tests/` — Automated `unittest` suites
- `templates/index.html` — Semantic HTML template
- `static/css/styles.css` & `static/js/main.js` — Extracted stylesheet and client interactivity
- `netlify.toml` — Netlify build configuration (`python3 build_static.py --out dist`)

## Local Development

```bash
pip install -r requirements.txt
python3 app.py

# Build static Netlify bundle (zero external dependencies)
python3 build_static.py --out dist

# Run automated tests
python3 -m unittest discover -s tests -v
```
"""


def compute_language_stats(files: List[Dict[str, Any]]) -> Tuple[List[Dict[str, Any]], float, int]:
    """Compute GitHub Linguist byte percentages across code & markup files."""
    counts: Dict[str, int] = {}
    for file in files:
        lang = file["language"]
        if lang in LANGUAGE_COLORS:
            counts[lang] = counts.get(lang, 0) + int(file["bytes"])

    total_code_bytes = sum(counts.values()) or 1
    languages = sorted(
        [
            {
                "language": lang,
                "bytes": b,
                "percentage": round((b / total_code_bytes) * 100.0, 1),
                "color": LANGUAGE_COLORS.get(lang, "#64748b"),
            }
            for lang, b in counts.items()
        ],
        key=lambda item: item["bytes"],
        reverse=True,
    )
    py_pct = next((item["percentage"] for item in languages if item["language"] == "Python"), 0.0)
    return languages, float(py_pct), total_code_bytes


def verify_generated_repo(files: List[Dict[str, Any]]) -> Tuple[Dict[str, Any], str]:
    """Write generated files to a temp directory and execute static build + unittest."""
    tmp_dir = Path(tempfile.mkdtemp(prefix="pyrefactor-"))
    try:
        for file in files:
            target = tmp_dir / file["path"]
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_text(file["content"], encoding="utf-8")

        build_proc = subprocess.run(
            [sys.executable, "build_static.py", "--out", "dist"],
            cwd=str(tmp_dir),
            capture_output=True,
            text=True,
            timeout=15,
        )
        build_output = "\n".join(p for p in [build_proc.stdout.strip(), build_proc.stderr.strip()] if p)
        dist_index = tmp_dir / "dist" / "index.html"
        rendered_html = dist_index.read_text(encoding="utf-8") if dist_index.exists() else ""
        build_success = build_proc.returncode == 0 and len(rendered_html) > 0

        test_proc = subprocess.run(
            [sys.executable, "-m", "unittest", "discover", "-s", "tests", "-v"],
            cwd=str(tmp_dir),
            capture_output=True,
            text=True,
            timeout=15,
        )
        test_output = "\n".join(p for p in [test_proc.stdout.strip(), test_proc.stderr.strip()] if p)
        tests_success = test_proc.returncode == 0

        verification = {
            "buildSuccess": build_success,
            "testsSuccess": tests_success,
            "buildOutput": build_output,
            "testOutput": test_output,
            "renderedHtmlBytes": byte_length(rendered_html),
        }
        return verification, rendered_html
    finally:
        shutil.rmtree(tmp_dir, ignore_errors=True)


def build_self_contained_preview(compiled_html: str, css: str, js: str) -> str:
    """Inline static CSS and JS into compiled HTML for sandboxed iframe rendering."""
    out = re.sub(
        r'<link\b[^>]*href=["\']static/css/styles\.css["\'][^>]*\/?>',
        lambda _m: f"<style>\n{css}\n</style>",
        compiled_html,
        flags=re.IGNORECASE,
    )
    out = re.sub(
        r'<script\b[^>]*src=["\']static/js/main\.js["\'][^>]*><\/script>',
        lambda _m: f"<script>\n{js}\n</script>",
        out,
        flags=re.IGNORECASE,
    )
    return out


def refactor_portfolio(payload: Dict[str, Any]) -> Dict[str, Any]:
    """Transform monolithic HTML input into a modular Python portfolio repository."""
    owner = str(payload.get("owner", "srikrishnanookala18-lab"))
    repo = str(payload.get("repo", "portfolio2"))
    original_filename = str(
        payload.get("originalFilename", "nookala-sri-krishna-modern-interactive-portfolio (1).html")
    )
    raw_html = str(payload.get("rawHtml", ""))
    preset = str(payload.get("preset", "python-first"))
    netlify_mode = str(payload.get("netlifyMode", "netlify-toml"))

    original_breakdown = analyze_html_bytes(raw_html)
    title, owner_name = extract_title_and_owner(raw_html)

    style_blocks: List[str] = []

    def _replace_style(match: re.Match[str]) -> str:
        style_blocks.append(match.group(1).strip())
        return '  <link rel="stylesheet" href="static/css/styles.css" />'

    stripped_html = re.sub(
        r"<style\b[^>]*>([\s\S]*?)</style>",
        _replace_style,
        raw_html,
        flags=re.IGNORECASE,
    )

    script_blocks: List[str] = []
    replaced_first_script = False

    def _replace_script(match: re.Match[str]) -> str:
        nonlocal replaced_first_script
        attrs = match.group(1)
        inner = match.group(2)
        if re.search(r"\bsrc\s*=", attrs, re.IGNORECASE):
            return match.group(0)
        if inner.strip():
            script_blocks.append(inner)
        if not replaced_first_script:
            replaced_first_script = True
            return (
                '  <script id="portfolio-data" type="application/json">{{PORTFOLIO_JSON}}</script>\n'
                '  <script src="static/js/main.js"></script>'
            )
        return ""

    stripped_html = re.sub(
        r"<script\b([^>]*)>([\s\S]*?)</script>",
        _replace_script,
        stripped_html,
        flags=re.IGNORECASE,
    )

    template_html = re.sub(r"\n{3,}", "\n\n", stripped_html).strip() + "\n"
    combined_css = dedent_block("\n\n".join(style_blocks)) + "\n"
    combined_js = dedent_block("\n\n".join(script_blocks))

    extracted_datasets: Dict[str, Any] = {}
    for var_name in ("semesters", "skillsData", "weatherSample", "campusRooms"):
        span = extract_js_const_span(combined_js, var_name)
        if span is not None:
            start, end, literal = span
            parsed = js_literal_to_python(literal)
            if parsed is not None:
                extracted_datasets[var_name] = parsed
                combined_js = (
                    combined_js[:start]
                    + f"const {var_name} = __PORTFOLIO_BOOTSTRAP__.{var_name} ?? [];"
                    + combined_js[end:]
                )

    if extracted_datasets:
        bootstrap_header = "\n".join(
            [
                'const __portfolioDataEl = document.getElementById("portfolio-data");',
                'const __PORTFOLIO_BOOTSTRAP__ = __portfolioDataEl ? JSON.parse(__portfolioDataEl.textContent || "{}") : {};',
                "",
            ]
        )
        if "(function () {" in combined_js:
            combined_js = combined_js.replace("(function () {", f"(function () {{\n{bootstrap_header}", 1)
        else:
            combined_js = f"{bootstrap_header}\n{combined_js}"

    final_js = combined_js.strip() + "\n"

    portfolio_data_py = render_portfolio_data_py(
        owner=owner,
        repo=repo,
        title=title,
        owner_name=owner_name,
        extracted_datasets=extracted_datasets,
    )

    raw_files: List[Dict[str, str]] = [
        {
            "path": "portfolio_data.py",
            "content": portfolio_data_py,
            "description": "Typed Python dataclasses and structured portfolio datasets extracted from the original SPA.",
        },
        {
            "path": "app.py",
            "content": load_template_py("app.py"),
            "description": "Flask WSGI web application and JSON API endpoints serving dynamic portfolio routes.",
        },
        {
            "path": "build_static.py",
            "content": load_template_py("build_static.py"),
            "description": "Zero-dependency Python static site generator compiling templates, SVGs, and assets for Netlify.",
        },
        {
            "path": "analytics.py",
            "content": load_template_py("analytics.py"),
            "description": "Academic GPA trajectory, skill distribution, and portfolio telemetry engine.",
        },
        {
            "path": "weather_service.py",
            "content": load_template_py("weather_service.py"),
            "description": "Python meteorological engine for Jio Sense comfort index, dew point, and UV risk scoring.",
        },
        {
            "path": "campus_engine.py",
            "content": load_template_py("campus_engine.py"),
            "description": "Python NLP intent parser and floor-by-floor shortest-path router for JAIN Smart Navigation.",
        },
        {
            "path": "svg_charts.py",
            "content": load_template_py("svg_charts.py"),
            "description": "Server-side Python SVG generator rendering GPA trajectory and skill distribution graphics.",
        },
        {
            "path": "tests/test_portfolio.py",
            "content": load_template_py("tests/test_portfolio.py"),
            "description": "Automated unittest suite verifying data integrity, analytics math, and static builds.",
        },
    ]

    if preset in ("standard", "python-first"):
        raw_files.extend(
            [
                {
                    "path": "cli.py",
                    "content": load_template_py("cli.py"),
                    "description": "Command-line interface for inspecting GPA stats, building dist/, and testing campus routing.",
                },
                {
                    "path": "skill_graph.py",
                    "content": load_template_py("skill_graph.py"),
                    "description": "Python skill-to-project adjacency graph and role-readiness scoring model.",
                },
                {
                    "path": "tests/test_engines.py",
                    "content": load_template_py("tests/test_engines.py"),
                    "description": "Extended unittest suite covering weather telemetry, campus pathfinding, and SVG output.",
                },
            ]
        )

    if preset == "python-first":
        raw_files.extend(
            [
                {
                    "path": "resume_exporter.py",
                    "content": load_template_py("resume_exporter.py"),
                    "description": "Exports structured JSON-Resume and Markdown CV artifacts directly from portfolio_data.py.",
                },
                {
                    "path": "seo_validator.py",
                    "content": load_template_py("seo_validator.py"),
                    "description": "Python HTML accessibility, heading hierarchy, and metadata validator for build output.",
                },
                {
                    "path": "tests/test_exporter_and_seo.py",
                    "content": load_template_py("tests/test_exporter_and_seo.py"),
                    "description": "Unit tests validating JSON-Resume, Markdown CV export, skill graph, and HTML audit checks.",
                },
            ]
        )

    raw_files.extend(
        [
            {
                "path": "templates/index.html",
                "content": template_html,
                "description": "Semantic HTML template populated dynamically via Python JSON bootstrap injection.",
            },
            {
                "path": "static/css/styles.css",
                "content": combined_css,
                "description": "Extracted responsive layout, Bento grid, and dark/light theme stylesheet.",
            },
            {
                "path": "static/js/main.js",
                "content": final_js,
                "description": "Client-side interactive demos hydrated from Python-generated portfolio JSON.",
            },
            {
                "path": "netlify.toml",
                "content": (
                    '[build]\n'
                    '  command = "python3 build_static.py --out dist"\n'
                    '  publish = "dist"\n\n'
                    '[build.environment]\n'
                    '  PYTHON_VERSION = "3.10"\n\n'
                    '[[headers]]\n'
                    '  for = "/*"\n'
                    '  [headers.values]\n'
                    '    X-Content-Type-Options = "nosniff"\n'
                    '    X-Frame-Options = "SAMEORIGIN"\n'
                ),
                "description": "Netlify build configuration running python3 build_static.py on deploy.",
            },
            {
                "path": "requirements.txt",
                "content": "Flask>=3.0.0\nJinja2>=3.1.4\nWerkzeug>=3.0.3\n",
                "description": "Python runtime dependencies for local Flask development server.",
            },
            {
                "path": ".gitignore",
                "content": "__pycache__/\n*.py[cod]\n.pytest_cache/\n.venv/\nvenv/\ndist/\nbuild/\n*.egg-info/\n.DS_Store\n",
                "description": "Excludes Python bytecode caches, virtual environments, and generated dist output.",
            },
            {
                "path": "README.md",
                "content": build_readme_md(owner_name),
                "description": "Repository documentation covering Python architecture, local server, and Netlify deploy.",
            },
        ]
    )

    files: List[Dict[str, Any]] = [
        {
            "path": f["path"],
            "content": f["content"],
            "language": detect_language(f["path"]),
            "bytes": byte_length(f["content"]),
            "description": f["description"],
        }
        for f in raw_files
    ]

    verification, rendered_html = verify_generated_repo(files)

    if netlify_mode == "root-index" and rendered_html:
        files.append(
            {
                "path": "index.html",
                "content": rendered_html,
                "language": "HTML",
                "bytes": byte_length(rendered_html),
                "description": "Pre-built static entrypoint for zero-build hosting.",
            }
        )

    languages, python_pct, total_code_bytes = compute_language_stats(files)
    preview_html = build_self_contained_preview(
        rendered_html or template_html,
        combined_css,
        final_js,
    )

    return {
        "owner": owner,
        "repo": repo,
        "originalFilename": original_filename,
        "originalBytes": original_breakdown["totalBytes"],
        "originalBreakdown": {
            "htmlBytes": original_breakdown["htmlBytes"],
            "styleBytes": original_breakdown["styleBytes"],
            "scriptBytes": original_breakdown["scriptBytes"],
        },
        "preset": preset,
        "netlifyMode": netlify_mode,
        "files": files,
        "languages": languages,
        "pythonPercentage": python_pct,
        "totalCodeBytes": total_code_bytes,
        "verification": verification,
        "renderedPreviewHtml": preview_html,
    }


def create_zip_base64(files: List[Dict[str, Any]]) -> str:
    """Package generated files into an in-memory ZIP archive encoded as base64."""
    tmp_dir = Path(tempfile.mkdtemp(prefix="pyrefactor-zip-"))
    try:
        zip_path = tmp_dir / "bundle.zip"
        with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as zf:
            for item in files:
                zf.writestr(item["path"], item["content"].encode("utf-8"))
        return base64.b64encode(zip_path.read_bytes()).decode("ascii")
    finally:
        shutil.rmtree(tmp_dir, ignore_errors=True)


def main(argv: Optional[List[str]] = None) -> int:
    parser = argparse.ArgumentParser(description="PyRefactor Studio Python CLI bridge.")
    parser.add_argument(
        "--mode",
        choices=["analyze", "refactor", "zip"],
        required=True,
        help="Execution mode.",
    )
    args = parser.parse_args(argv)

    raw_stdin = sys.stdin.read()
    payload = json.loads(raw_stdin) if raw_stdin.strip() else {}

    if args.mode == "analyze":
        result = analyze_html_bytes(str(payload.get("rawHtml", "")))
        print(json.dumps(result))
        return 0

    if args.mode == "refactor":
        result = refactor_portfolio(payload)
        print(json.dumps(result))
        return 0

    if args.mode == "zip":
        b64 = create_zip_base64(list(payload.get("files", [])))
        print(json.dumps({"zipBase64": b64}))
        return 0

    return 1


if __name__ == "__main__":
    raise SystemExit(main())

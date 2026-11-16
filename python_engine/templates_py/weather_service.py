"""Meteorological analytics & advisory engine for Jio Sense Weather Dashboard.

Parses temperature, humidity, wind, pressure, and UV values from WEATHER_SAMPLE
to calculate heat index, dew point approximation, comfort classification,
and forecast statistics.
"""

from __future__ import annotations

import math
import re
from dataclasses import asdict, dataclass
from typing import Any, Dict, List, Optional

from portfolio_data import WEATHER_SAMPLE


@dataclass(frozen=True)
class WeatherReading:
    """Normalized meteorological metrics for a single city."""

    city: str
    temperature_c: float
    humidity_pct: float
    wind_kmh: float
    pressure_hpa: float
    uv_index: int
    uv_band: str
    heat_index_c: float
    dew_point_c: float
    comfort_score: int
    advisory_level: str
    advisory_text: str


def _extract_number(raw: Any, default: float = 0.0) -> float:
    """Extract the leading floating-point value from formatted sensor strings."""
    if isinstance(raw, (int, float)):
        return float(raw)
    match = re.search(r"-?\d+(?:\.\d+)?", str(raw))
    return float(match.group(0)) if match else default


def calculate_dew_point(temp_c: float, humidity_pct: float) -> float:
    """Compute Magnus-formula dew point temperature in Celsius."""
    rh = max(1.0, min(100.0, humidity_pct))
    a = 17.625
    b = 243.04
    gamma = math.log(rh / 100.0) + (a * temp_c) / (b + temp_c)
    return round((b * gamma) / (a - gamma), 1)


def calculate_heat_index(temp_c: float, humidity_pct: float) -> float:
    """Compute Steadman apparent heat index when temperature >= 26C."""
    if temp_c < 26.0:
        return round(temp_c, 1)
    t_f = temp_c * 9.0 / 5.0 + 32.0
    rh = max(0.0, min(100.0, humidity_pct))
    hi_f = (
        -42.379
        + 2.04901523 * t_f
        + 10.14333127 * rh
        - 0.22475541 * t_f * rh
        - 0.00683783 * t_f * t_f
        - 0.05481717 * rh * rh
        + 0.00122874 * t_f * t_f * rh
        + 0.00085282 * t_f * rh * rh
        - 0.00000199 * t_f * t_f * rh * rh
    )
    return round((hi_f - 32.0) * 5.0 / 9.0, 1)


def classify_uv_band(uv_index: int) -> str:
    """Map numeric UV index to WHO risk band."""
    if uv_index <= 2:
        return "Low"
    if uv_index <= 5:
        return "Moderate"
    if uv_index <= 7:
        return "High"
    if uv_index <= 10:
        return "Very High"
    return "Extreme"


def compute_comfort_score(temp_c: float, humidity_pct: float, wind_kmh: float) -> int:
    """Return a 0-100 outdoor comfort index peaking around 23C and 50% humidity."""
    temp_penalty = abs(temp_c - 23.0) * 3.2
    humidity_penalty = abs(humidity_pct - 50.0) * 0.45
    breeze_bonus = min(8.0, wind_kmh * 0.3) if temp_c > 25.0 else 0.0
    raw = 100.0 - temp_penalty - humidity_penalty + breeze_bonus
    return max(0, min(100, int(round(raw))))


def analyze_city_weather(city: str) -> Optional[WeatherReading]:
    """Build a normalized WeatherReading with derived meteorological indices."""
    matched_key = next(
        (key for key in WEATHER_SAMPLE.keys() if key.lower() == city.strip().lower()),
        None,
    )
    if not matched_key:
        return None

    data = WEATHER_SAMPLE[matched_key]
    temp_c = _extract_number(data.get("temp"), 25.0)
    humidity = _extract_number(data.get("humidity"), 50.0)
    wind = _extract_number(data.get("wind"), 10.0)
    pressure = _extract_number(data.get("pressure"), 1013.0)
    uv_val = int(round(_extract_number(data.get("uv"), 3)))

    alert = data.get("alert", {})
    return WeatherReading(
        city=matched_key,
        temperature_c=temp_c,
        humidity_pct=humidity,
        wind_kmh=wind,
        pressure_hpa=pressure,
        uv_index=uv_val,
        uv_band=classify_uv_band(uv_val),
        heat_index_c=calculate_heat_index(temp_c, humidity),
        dew_point_c=calculate_dew_point(temp_c, humidity),
        comfort_score=compute_comfort_score(temp_c, humidity, wind),
        advisory_level=str(alert.get("level", "Clear")),
        advisory_text=str(alert.get("text", "")),
    )


def summarize_forecast_series(city: str, mode: str = "hourly") -> Dict[str, Any]:
    """Compute min, max, mean, and peak slot for a city's hourly or daily series."""
    matched_key = next(
        (key for key in WEATHER_SAMPLE.keys() if key.lower() == city.strip().lower()),
        None,
    )
    if not matched_key:
        return {"error": f"Unknown city: {city}", "available": list(WEATHER_SAMPLE.keys())}

    series: List[Dict[str, Any]] = WEATHER_SAMPLE[matched_key].get(mode, [])
    if not series:
        return {"city": matched_key, "mode": mode, "points": 0}

    temps = [float(point["v"]) for point in series]
    peak_point = max(series, key=lambda p: float(p["v"]))
    low_point = min(series, key=lambda p: float(p["v"]))

    return {
        "city": matched_key,
        "mode": mode,
        "points": len(series),
        "min_c": min(temps),
        "max_c": max(temps),
        "mean_c": round(sum(temps) / len(temps), 1),
        "peak_slot": peak_point["t"],
        "coolest_slot": low_point["t"],
    }


def list_all_city_reports() -> List[Dict[str, Any]]:
    """Return normalized telemetry reports for all modeled cities."""
    reports: List[Dict[str, Any]] = []
    for city in WEATHER_SAMPLE.keys():
        reading = analyze_city_weather(city)
        if reading is not None:
            reports.append(asdict(reading))
    return reports

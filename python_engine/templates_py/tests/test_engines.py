"""Extended unittest suite for weather analytics, campus navigation, and SVG charts."""

from __future__ import annotations

import unittest

from campus_engine import (
    get_floor_occupancy_summary,
    parse_campus_intent,
    route_campus_query,
)
from portfolio_data import CAMPUS_ROOMS, WEATHER_SAMPLE
from svg_charts import render_gpa_trajectory_svg, render_skill_breakdown_svg
from weather_service import (
    analyze_city_weather,
    calculate_dew_point,
    calculate_heat_index,
    classify_uv_band,
    summarize_forecast_series,
)


class WeatherServiceTests(unittest.TestCase):
    """Verify meteorological index calculations and forecast aggregation."""

    def test_dew_point_and_heat_index(self) -> None:
        dew = calculate_dew_point(30.0, 60.0)
        self.assertGreater(dew, 15.0)
        self.assertLess(dew, 30.0)

        hi = calculate_heat_index(34.0, 55.0)
        self.assertGreaterEqual(hi, 34.0)

    def test_uv_band_classification(self) -> None:
        self.assertEqual(classify_uv_band(1), "Low")
        self.assertEqual(classify_uv_band(5), "Moderate")
        self.assertEqual(classify_uv_band(7), "High")
        self.assertEqual(classify_uv_band(9), "Very High")

    def test_city_analysis_and_forecast_summary(self) -> None:
        if not WEATHER_SAMPLE:
            self.skipTest("No weather cities present in extracted dataset")
        first_city = next(iter(WEATHER_SAMPLE.keys()))
        reading = analyze_city_weather(first_city)
        self.assertIsNotNone(reading)
        assert reading is not None
        self.assertGreaterEqual(reading.comfort_score, 0)
        self.assertLessEqual(reading.comfort_score, 100)

        summary = summarize_forecast_series(first_city, mode="hourly")
        self.assertGreater(summary["points"], 0)


class CampusEngineTests(unittest.TestCase):
    """Verify intent classification, floor summaries, and routing steps."""

    def test_intent_parsing(self) -> None:
        self.assertEqual(parse_campus_intent("Find available AI Lab"), "locate_ai_lab")
        self.assertEqual(parse_campus_intent("Show vacant rooms"), "find_vacant_rooms")
        self.assertEqual(parse_campus_intent("Where is Classroom 304?"), "lookup_room_number")

    def test_route_campus_query(self) -> None:
        if not CAMPUS_ROOMS:
            self.skipTest("No campus rooms in extracted dataset")
        routed = route_campus_query("Find available AI Lab", start_floor=1)
        self.assertGreaterEqual(len(routed["matched_rooms"]), 1)
        self.assertGreaterEqual(len(routed["directions"]), 2)
        floors = get_floor_occupancy_summary()
        self.assertTrue(len(floors) >= 1)


class SvgChartsTests(unittest.TestCase):
    """Verify vector chart generation outputs valid SVG markup."""

    def test_svg_outputs(self) -> None:
        gpa_svg = render_gpa_trajectory_svg()
        self.assertIn("<svg", gpa_svg)
        self.assertIn("</svg>", gpa_svg)

        skills_svg = render_skill_breakdown_svg()
        self.assertIn("<svg", skills_svg)
        self.assertIn("</svg>", skills_svg)


if __name__ == "__main__":
    unittest.main()

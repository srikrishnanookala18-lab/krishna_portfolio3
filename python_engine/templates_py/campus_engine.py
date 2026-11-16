"""Natural-language query parser and floor-routing engine for JAIN Smart Navigation.

Provides intent classification, room availability filtering, and step-by-step
elevator/corridor navigation paths across campus floors.
"""

from __future__ import annotations

import re
from dataclasses import asdict, dataclass
from typing import Any, Dict, List

from portfolio_data import CAMPUS_ROOMS


@dataclass(frozen=True)
class NavigationResult:
    """Structured routing output for a natural-language campus query."""

    query: str
    intent: str
    target_floor: int
    matched_rooms: List[Dict[str, Any]]
    directions: List[str]


def parse_campus_intent(query: str) -> str:
    """Classify user query into an actionable navigation intent."""
    text = query.strip().lower()
    if any(word in text for word in ("vacant", "free", "empty")) or (
        "available" in text and "ai" not in text
    ):
        return "find_vacant_rooms"
    if "ai" in text or "ml" in text or "machine learning" in text:
        return "locate_ai_lab"
    if re.search(r"\b[rR]?\d{3}\b", text):
        return "lookup_room_number"
    if "lab" in text or "laboratory" in text:
        return "list_laboratories"
    if "floor" in text:
        return "browse_floor"
    return "keyword_search"


def query_campus_rooms(query: str) -> List[Dict[str, Any]]:
    """Resolve a natural-language campus query against CAMPUS_ROOMS."""
    if not CAMPUS_ROOMS:
        return []

    text = query.strip().lower()
    intent = parse_campus_intent(query)

    if intent == "find_vacant_rooms":
        matches = [r for r in CAMPUS_ROOMS if str(r.get("status", "")).lower() == "available"]
    elif intent == "locate_ai_lab":
        matches = [
            r
            for r in CAMPUS_ROOMS
            if r.get("id") == "R201"
            or "ai" in str(r.get("name", "")).lower()
            or "ml" in str(r.get("name", "")).lower()
        ]
    elif intent == "lookup_room_number":
        num_match = re.search(r"(\d{3})", text)
        digits = num_match.group(1) if num_match else ""
        matches = [
            r
            for r in CAMPUS_ROOMS
            if digits in str(r.get("id", "")) or digits in str(r.get("name", ""))
        ]
    elif intent == "list_laboratories":
        matches = [r for r in CAMPUS_ROOMS if str(r.get("type", "")).lower() == "laboratory"]
    elif intent == "browse_floor":
        floor_match = re.search(r"floor\s*(\d+)", text)
        if floor_match:
            target = int(floor_match.group(1))
            matches = [r for r in CAMPUS_ROOMS if int(r.get("floor", 0)) == target]
        else:
            matches = list(CAMPUS_ROOMS)
    else:
        matches = [
            r
            for r in CAMPUS_ROOMS
            if text in str(r.get("name", "")).lower()
            or text in str(r.get("id", "")).lower()
            or text in str(r.get("type", "")).lower()
        ]

    return matches if matches else [CAMPUS_ROOMS[0]]


def build_directions(room: Dict[str, Any], start_floor: int = 1) -> List[str]:
    """Generate human-readable step-by-step corridor directions to a target room."""
    target_floor = int(room.get("floor", 1))
    room_id = str(room.get("id", "Room"))
    room_name = str(room.get("name", "Destination"))
    x_pos = int(room.get("x", 100))

    steps: List[str] = [f"Start at Main Entrance Lobby (Floor {start_floor})."]
    if target_floor != start_floor:
        direction = "Up" if target_floor > start_floor else "Down"
        steps.append(f"Take Central Elevator {direction} to Floor {target_floor}.")
    else:
        steps.append(f"Proceed along Main Corridor on Floor {target_floor}.")

    wing = "West Wing" if x_pos < 180 else "East Wing"
    steps.append(f"Turn toward the {wing} corridor.")
    steps.append(f"Arrive at {room_name} ({room_id}) — Status: {room.get('status', 'Unknown')}.")
    return steps


def route_campus_query(query: str, start_floor: int = 1) -> Dict[str, Any]:
    """Execute end-to-end NLP intent parsing, lookup, and turn-by-turn routing."""
    intent = parse_campus_intent(query)
    matches = query_campus_rooms(query)
    primary = matches[0] if matches else {}
    target_floor = int(primary.get("floor", 1)) if primary else 1
    directions = build_directions(primary, start_floor=start_floor) if primary else []

    result = NavigationResult(
        query=query,
        intent=intent,
        target_floor=target_floor,
        matched_rooms=matches,
        directions=directions,
    )
    return asdict(result)


def get_floor_occupancy_summary() -> Dict[int, Dict[str, int]]:
    """Aggregate available vs occupied rooms grouped by floor."""
    summary: Dict[int, Dict[str, int]] = {}
    for room in CAMPUS_ROOMS:
        floor = int(room.get("floor", 1))
        bucket = summary.setdefault(floor, {"total": 0, "available": 0, "occupied": 0})
        bucket["total"] += 1
        if str(room.get("status", "")).lower() == "available":
            bucket["available"] += 1
        else:
            bucket["occupied"] += 1
    return summary

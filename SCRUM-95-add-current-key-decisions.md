# SCRUM-95: Key Decisions for Water Current Visualization

**Ticket:** SCRUM-95  
**Feature:** Water Current Information Layer (Direction & Velocity using Chevrons)  
**Project:** `wind-map`  
**Date:** November 17, 2026  
**Status:** Pending User Confirmation / Sign-Off  

---

## Overview

Following the feasibility assessment for **SCRUM-95**, this document records the key architectural, user experience, and visual design decisions required before starting implementation.

---

## Decision 1: Map Layer Control Behavior & Presentation

How should the user toggle and interact with the wind barbs and water currents on the Leaflet map?

| Option | Description | Pros | Cons |
| :--- | :--- | :--- | :--- |
| **Option A (Recommended): Dual Independent Toggles** | Two independent toggle checkboxes/switches in `MapSettingsModal` and navbar: `[x] Wind Barbs` and `[ ] Water Currents`. | Maximum flexibility; users can view wind only, currents only, both, or clear map. | May produce visual clutter if both are turned on simultaneously in crowded harbor areas. |
| **Option B: Mutually Exclusive Mode Switch** | Radio selector: `Wind Barbs` \| `Water Currents` \| `Combined Overlay`. | Enforces clear mental mode for the user; simpler state machine. | Less granular control if user wants custom overlay combinations. |
| **Option C: Single Global Layer Selector** | Top-right map control dropdown: selects the active overlay layer. | Compact UI footprint on mobile/tablets. | Requires extra clicks to toggle layers. |

* **Recommended Default:** **Option A (Dual Independent Toggles)** with `Wind Barbs: ON` and `Water Currents: OFF` by default. Include a subtle visual offset or distinct color scheme when both layers are enabled.

---

## Decision 2: Chevron Visual Encoding & Styling

How should the water current direction and speed be represented visually?

### Direction Convention: "Set"
* **Standard:** In oceanography and marine navigation, currents are reported as **Set** (the compass heading toward which the water flows).
* **Decision:** Chevrons **must point in the direction of the set (flow direction)**. This is opposite to wind barbs (which point in the direction the wind arrives from).

### Speed & Glyph Representation

| Option | Description | Pros | Cons |
| :--- | :--- | :--- | :--- |
| **Option A (Recommended): Hybrid Glyphs + Marine Color Tiers** | Number of chevron heads (`›`, `»`, `»›`) indicates speed bracket, colored with a marine cyan/teal palette (`#38bdf8`, `#06b6d4`, `#0284c7`, `#f59e0b`). | Instantly readable at a glance; distinct shape and color from wind barbs. | Slightly more SVG path definitions. |
| **Option B: Uniform Chevron with Color-Only Scale** | A single standard chevron shape `»` rotated to heading, colored strictly by current velocity (e.g. green → yellow → red). | Simple rendering. | Can visually clash or be confused with wind barb colors; hard to read for colorblind users. |
| **Option C: Animated Particle / Flow Streamlines** | Flow lines animating along the vector field. | Visually stunning. | High CPU/GPU overhead on low-end devices, complex implementation, outside ticket scope. |

* **Recommended Default:** **Option A**.
  * **Light (< 0.5 kt):** Single chevron `›` (`#38bdf8`, sky blue, 60% opacity)
  * **Moderate (0.5 – 1.5 kt):** Double chevron `»` (`#06b6d4`, vibrant cyan, 85% opacity)
  * **Strong (1.5 – 3.0 kt):** Heavy double chevron `»` (`#0284c7`, deep ocean blue, 100% opacity)
  * **Extreme (> 3.0 kt):** Warning chevron `»›` (`#f59e0b`, amber alert)

---

## Decision 3: Forecast Drawer & Popover Display

How should detailed current metrics be integrated into the existing drawer and map popovers?

### Map Popover / Tooltip
* **Click / Hover on Chevron:** Displays a clean popup card:
  * Heading: `🌊 Water Current`
  * Velocity: `1.2 kt` (with `2.2 km/h` in secondary muted text)
  * Direction / Set: `333° (NNW)`
  * Model Source: `Copernicus Marine (via Open-Meteo)`

### 48-Hour Forecast Drawer Integration

| Option | Description | Pros | Cons |
| :--- | :--- | :--- | :--- |
| **Option A (Recommended): Dual Card + Timeline Row** | If the selected location has marine data: 1) Add a "Current" metric card (Speed & Direction) next to Wind & Gusts in the header, and 2) Add a "Water Current" row with micro-chevrons along the 48-hour timeline. | Complete temporal and spatial visibility; sailors can see slack water and peak currents. | Slightly taller drawer when marine data is present. |
| **Option B: Metric Card Only** | Show current velocity/direction only for current hour in the drawer header cards; timeline remains wind-only. | Minimal UI impact. | Misses the predictive timeline value for tides/currents. |
| **Option C: Tabbed Drawer Mode** | Tabs in the drawer: `[Wind & Weather]` \| `[Marine & Currents]`. | Keeps each tab clean. | Hides wind and currents from being viewed side-by-side. |

* **Recommended Default:** **Option A**. If a location is inland (`ocean_current_velocity is None`), the marine row and card are cleanly hidden, maintaining the exact current wind-only UI.

---

## Decision 4: Backend Marine Grid Caching & Sampling

How should Open-Meteo Marine API calls and caching be handled?

1. **Endpoint Design:**
   * `GET /api/currents/grid`: Accepts bounding box (`min_lat`, `max_lat`, `min_lon`, `max_lon`, `step`) and returns water nodes with `velocity` and `direction`.
   * `GET /api/currents/point`: Accepts `lat`, `lon` and returns 48-hour hourly current forecast for a specific point.
2. **Caching Strategy:**
   * SQLite table `grid_currents_cache` (similar to `grid_weather_cache`).
   * **Cache TTL:** 30 minutes (Copernicus updates 6–12 hours; 30 minutes provides fresh data while minimizing upstream API calls).
3. **Inland Handling:**
   * Open-Meteo returns `null` for land coordinates. The backend discards `null` nodes before serializing the JSON response, keeping payload sizes small and preventing frontend overhead.
4. **Sampling Step / Density:**
   * Adapt grid step to Leaflet zoom level (e.g. step `0.5°` at zoom 6–7 down to `0.05°` at zoom 12+), capping max displayed chevrons at 120 per viewport.

---

## Decision 5: Phased Implementation Plan

| Phase | Description | Deliverables | Est. Hours |
| :--- | :--- | :--- | :--- |
| **Phase 1** | **Backend Marine Service & Caching** | • `currents_service.py` & router `/api/currents`<br>• SQLite `grid_currents_cache` with cleanup<br>• Pytest test suite (`test_currents.py`) | 3–4 hrs |
| **Phase 2** | **Chevron SVG & Leaflet Overlay** | • `WaterCurrentChevron.tsx`<br>• `CurrentOverlay.tsx` & `useCurrentGrid.ts`<br>• Vitest unit tests | 4–5 hrs |
| **Phase 3** | **Controls & Drawer Integration** | • Toggle switches in `MapSettingsModal.tsx`<br>• Marine card & timeline row in `WeatherDrawer.tsx`<br>• E2E integration verification | 3–4 hrs |
| **Phase 4** | **Testing, Documentation & Release** | • Regression tests (pytest + vitest)<br>• Update `requirements.md`<br>• Git commit adhering to `SCRUM-95:` | 2–3 hrs |

---

## Sign-Off & Notes

* **Decision Status:** Recommended defaults ready for user confirmation.
* **Next Action:** Upon confirmation, proceed with **Phase 1** implementation.

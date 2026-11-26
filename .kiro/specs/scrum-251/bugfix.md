# Bugfix: SCRUM-251 — edge-click pop-up closes itself

## 1. Current Behavior (Defect)

1.1 WHEN a wind barb is clicked near an edge of the map, the pop-up opens and then closes
immediately, before its values can be read.

1.2 The defect appears only where Leaflet has to auto-pan the map to fit the pop-up, which is why
barbs near the centre behave normally.

1.3 The pop-up closes because the auto-pan fires `moveend`; the grid hook refetches, the points
array changes, and the overlay's effect removes and recreates every marker, destroying the open
pop-up's marker.

## 2. Expected Behavior (Correct)

2.1 WHEN a barb is clicked at any edge, its pop-up shall stay open after the auto-pan and be fully
inside the map.

2.2 The auto-pan itself shall remain, so the pop-up is never rendered partly off-screen.

2.3 The grid shall still refresh after a user pan or zoom, including a pan that starts while the
suppression is pending.

## 3. Unchanged Behavior (Regression Prevention)

3.1 WHEN the user pans or zooms with a pop-up open, the pop-up shall still close and the grid
shall still refetch.

3.2 WHEN the view has not changed, no second request shall be made.

3.3 The selected barb highlight, the tide slot and the pop-up content shall be unchanged.

3.4 Existing lint, typecheck and coverage thresholds shall stay unchanged.

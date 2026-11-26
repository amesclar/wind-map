# Bugfix: current chevrons drawn on land (SCRUM-238)

## 1. Current Behavior (Defect)

1.1 WHEN the Marine API answers a requested map point with its nearest sea cell THEN the service returns the requested coordinates with that cell's value, so a chevron is drawn at a point the model treats as land (reported on Camano Island: the island's western third borrows Saratoga Passage's current).
1.2 WHEN several requested map points snap to the same model cell THEN each one becomes its own point, so identical chevrons stack on that cell.
1.3 WHEN a response is served from `grid_currents_cache` THEN only the requested coordinates are known, so a cached response cannot place chevrons at the cell either.
1.4 WHEN the user looks at Map Settings THEN nothing explains why narrow waters can show no current.

## 2. Expected Behavior (Correct)

2.1 WHEN Open-Meteo returns `latitude`/`longitude` for a point THEN the service shall return those cell coordinates with the value, so each chevron sits at the model cell it came from.
2.2 WHEN two or more requested points map to one cell THEN the grid response shall contain one point for that cell.
2.3 WHEN a grid response is served from the cache THEN it shall use the cell coordinates stored with the cached value.
2.4 WHEN a cell has no current THEN it shall still be dropped, never drawn.
2.5 WHEN Map Settings is open THEN the Water Currents section shall explain that the model's cells are about 6 to 9 km, so narrow waters such as Port Susan may show no current.
2.6 WHEN a chevron is clicked THEN its pop-up shall show the cell's coordinates, the true source of the value.

## 3. Unchanged Behavior (Regression Prevention)

3.1 WHEN the upstream call is made THEN it shall still batch every point, request knots and the two current variables, and use the shared retry/quota path.
3.2 WHEN a point has no current THEN it shall still be cached as an empty row, so an inland view is not refetched on every pan.
3.3 WHEN a forecast hour is requested THEN the response shall still include every hour of that UTC day from the one response and echo the requested hour.
3.4 WHEN the point-series endpoint is used THEN it shall return the same hourly values as before.
3.5 WHEN the layer draws THEN the chevron glyph, tiers, legend and hour handling shall be unchanged.

## 4. Follow-up after user testing (Whidbey Island)

4.1 WHEN the Marine model treats a narrow island as sea (its cells are about 6 to 9 km; Whidbey is about one cell wide) THEN placing the chevron at the cell centre still draws it on land: reported inland at Oak Harbor, Cornet Bay and Polnell Point.
4.2 WHEN a returned cell's centre is above sea level according to the Open-Meteo Elevation API THEN the service shall drop that cell, so a chevron is only drawn over water.
4.3 WHEN several values share a cell THEN the elevation shall be looked up once for that cell, batched with the other cells of the request.
4.4 WHEN the elevation lookup fails THEN the service shall keep the values rather than hiding real water (the land test is an improvement, not a dependency for showing data).
4.5 WHEN a cell is found on land THEN it shall be cached as an empty row, so the lookup is not repeated on later pans.
4.6 WHEN caches were written before the land test THEN schema v7 shall recreate them, so no previously cached land cell survives the deploy.

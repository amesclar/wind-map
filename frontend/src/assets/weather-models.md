# Weather prediction models update frequency comparison

| Model / Family | Region | Update Frequency | Cycle Times (UTC) / Notes | Time Horizon |
|--------|--------|--------|--------|--------|
| NOAA HRRR | North America | Every 1 hour | 18-hour horizon hourly; 48-hour horizon at 00, 06, 12, 18 UTC. | 18 h (48 h on 00/06/12/18 UTC) |
| NOAA RRFS | North America | Every 1 hour | NOAA's next-gen convective-allowing model (implemented Oct 2026 to succeed HRRR/NAM). | — |
| Météo-France AROME | France / W. Europe | Every 1 hour | High-res (1.3–2.5 km) regional model. | 4 days |
| MET Nordic | Scandinavia | Every 1 hour | 1 km grid, 2.5-day horizon. | 2.5 days |
| DWD ICON-D2 | Central Europe | Every 3 hours | 2 km grid (00, 03, 06, 09, 12, 15, 18, 21 UTC). | — |
| DWD ICON-EU | Europe | Every 3 hours | 7 km grid, 5-day horizon. | 5 days |
| JMA MSM / GSM | Japan / Global | Every 3 hours | 11-day horizon on GSM. | 11 days |
| NOAA GFS | Global | Every 6 hours | 00, 06, 12, 18 UTC (16-day horizon). | 16 days |
| ECMWF IFS (HRES 9 km) | Global | Every 6 hours | 00, 06, 12, 18 UTC (Note: Open-Data 0.25° has a ~2 hr dissemination lag). | 15 days |
| ECMWF AIFS (AI) | Global | Every 6 hours | 00, 06, 12, 18 UTC, 6-hourly time steps. | 15 days |
| DWD ICON Global | Global | Every 6 hours | 11 km grid, 7.5-day horizon. | 7.5 days |
| CMC GEM | Global / Canada | Every 6 hours | 00, 06, 12, 18 UTC (Regional 2.5 km & Global). | 16 days |
| Open-Meteo Marine (Waves) | Global / Coastal | Every 6 hours | Wave height, period, and direction. | — |

create a standalone application that shows weather predictions on a map

# weather data
the weather data should come from open source api sources (ie. meteo, etc.) and the data should be displayed in a map

provide dropdown for weather model options with Open-Meteo as the default option

the default location should be the user's current location. if not able to determine current location, default to Oak Harbor, Washington, are 48.2939° N, 122.6064° W

the application should be able to show multiple locations at once, each marked with an icon, and the user should be able to click on an icon to see the weather predictions for that location

the web ui should have a text box allowing users to add locations - the locations should be verified and converted to lat/long before adding to location database

provide a button to list saved locations with minus sign buttons for removal

cache weather data with 30min TTL

# map data
use an open-source map library (e.g., Leaflet.js with OpenStreetMap or CartoDB)

# location
the user should be able to select a location and see the weather predictions for that location

Typing in the search box queries https://geocoding-api.open-meteo.com/v1/search?name=... and displays a dropdown matching name, admin1 (state/region), country, allowing one-click addition with exact coordinates.

# data presentation
show 16 data points for each location starting from now and every 3 hours after that for the next 48 hours based on the user selected timezone with a default of Pacific

Wind Barb Markers: SVG wind barbs with speed feathers (knots) and temperature color-coding on the map.

Drawer: Bottom timeline showing 16 time slices (every 3h for 48h) in Pacific Time by default.

# data persistence
use a local SQLite database to store the locations and weather data

data should persist across docker container restarts

Backend: FastAPI (Python 3.11+) with SQLite caching (30min TTL), geocoding proxy, and location CRUD endpoints (GET/POST/DELETE).

## units
there should be a toggle between Metric and Imperial

user selects units

Temperature: Celsius or Fahrenheit (default)
Wind speed: knots (default), km/h, m/s, or mph
Wind direction: Degrees (0, 90, 180, 270, 360) or cardinal directions (N, NE, SW) or wind barbs with feathers showing direction and speed (default)

# ui design
use a minimalist ui

Frontend: React + Vite + Leaflet + TailwindCSS in dark minimalist style.

# containerization
the application should run in a self contained docker environment, using a lightweight framework (ie. Flask, FastAPI, etc.) and a database to store the locations and weather data and open source map library to display the map and open source weather api

use node.js for frontend and python for backend

use a multi-stage Dockerfile:
+ Stage 1 (Node.js): Builds the frontend assets (e.g., Vite/React or static bundle).
+ Stage 2 (Python/FastAPI or Flask): Runs the backend API and serves the compiled static frontend files on port 5000.

Docker: Multi-stage build producing a single lightweight image run via docker run -p 5000:5000 -v wind_data:/app/data wind-map

# git and code layout
locate the project in /Users/fredames/Projects/wind-map

include gitignore, dockerignore, requirements.txt, Dockerfile

# testing and documentation
Testing & Docs: Unit and integration tests (pytest for backend, frontend component tests) with comprehensive README.md.

# performance
the application should be respond to users request within 3 seconds 

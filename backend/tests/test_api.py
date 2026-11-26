"""API endpoint tests using FastAPI TestClient."""

from backend.app.config import parse_cors_origins


def test_health_check(client):
    response = client.get("/api/health")
    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "ok"
    assert "version" in body  # SCRUM-91; exact value checked in test_version.py


def test_config(client):
    response = client.get("/api/config")
    assert response.status_code == 200
    assert "carto_api_key" in response.json()


def test_default_seeded_location(client):
    response = client.get("/api/locations")
    assert response.status_code == 200
    data = response.json()
    assert len(data) >= 1
    default_loc = data[0]
    assert "Oak Harbor" in default_loc["name"]
    assert abs(default_loc["latitude"] - 48.2939) < 0.01
    assert abs(default_loc["longitude"] - (-122.6064)) < 0.01


def test_create_and_delete_location(client):
    # Add new location
    new_loc = {
        "name": "Seattle, WA",
        "latitude": 47.6062,
        "longitude": -122.3321,
        "admin1": "Washington",
        "country": "United States",
    }
    create_resp = client.post("/api/locations", json=new_loc)
    assert create_resp.status_code == 201
    created_data = create_resp.json()
    assert created_data["name"] == "Seattle, WA"
    loc_id = created_data["id"]

    # Verify present in list
    list_resp = client.get("/api/locations")
    ids = [loc["id"] for loc in list_resp.json()]
    assert loc_id in ids

    # Delete location
    del_resp = client.delete(f"/api/locations/{loc_id}")
    assert del_resp.status_code == 204

    # Verify removed
    list_resp_after = client.get("/api/locations")
    ids_after = [loc["id"] for loc in list_resp_after.json()]
    assert loc_id not in ids_after


def test_weather_models_list(client):
    resp = client.get("/api/weather/models")
    assert resp.status_code == 200
    models = resp.json()
    model_ids = [m["id"] for m in models]
    assert "best_match" in model_ids
    assert "ecmwf_ifs" in model_ids
    assert "ecmwf_ifs04" not in model_ids
    assert "ecmwf_aifs025_single" in model_ids
    assert "gfs_seamless" in model_ids
    assert "gem_seamless" in model_ids
    assert "icon_seamless" in model_ids
    ecmwf = next(m for m in models if m["id"] == "ecmwf_ifs")
    assert ecmwf["name"] == "ECMWF IFS HRES 9 km"
    assert ecmwf["horizon_hours"] == 360
    aifs = next(m for m in models if m["id"] == "ecmwf_aifs025_single")
    assert aifs["name"] == "ECMWF AIFS (AI)"
    assert aifs["horizon_hours"] == 360
    assert aifs["update_hours"] == 6
    gem = next(m for m in models if m["id"] == "gem_seamless")
    assert gem["name"] == "CMC GEM Seamless"
    assert gem["horizon_hours"] == 240
    assert gem["update_hours"] == 6


def test_aifs_model_is_accepted_and_forwarded(client, open_meteo):
    """AIFS is a real Open-Meteo model id, not a display-only entry (SCRUM-227)."""
    from factories import grid_item, grid_payload

    open_meteo.respond(grid_payload(*[grid_item(), grid_item(), grid_item(), grid_item()]))
    resp = client.get(
        "/api/weather/grid",
        params={
            "min_lat": 47.0,
            "max_lat": 49.0,
            "min_lon": -123.0,
            "max_lon": -121.0,
            "cols": 2,
            "rows": 2,
            "model": "ecmwf_aifs025_single",
        },
    )

    assert resp.status_code == 200
    assert open_meteo.last_params.get("models") == "ecmwf_aifs025_single"


def test_retired_ecmwf_model_id_is_answered_as_ecmwf_ifs(client, open_meteo):
    """A cached frontend may still ask for the retired id (SCRUM-226)."""
    from factories import grid_item, grid_payload

    open_meteo.respond(grid_payload(*[grid_item()] * 4))
    resp = client.get(
        "/api/weather/grid",
        params={
            "min_lat": 47.0,
            "max_lat": 49.0,
            "min_lon": -123.0,
            "max_lon": -121.0,
            "cols": 2,
            "rows": 2,
            "model": "ecmwf_ifs04",
        },
    )

    assert resp.status_code == 200
    assert open_meteo.last_params.get("models") == "ecmwf_ifs"


# ---------------------------------------------------------------------------
# SCRUM-92 phase 1: CORS is off unless CORS_ORIGINS is set
# ---------------------------------------------------------------------------


def test_parse_cors_origins():
    assert parse_cors_origins(None) == []
    assert parse_cors_origins("") == []
    assert parse_cors_origins(" http://a:5173 , ,http://b ") == ["http://a:5173", "http://b"]


def test_cross_origin_requests_get_no_cors_headers_by_default(client):
    resp = client.get("/api/health", headers={"Origin": "https://evil.example"})
    assert resp.status_code == 200
    assert "access-control-allow-origin" not in resp.headers
    assert "access-control-allow-credentials" not in resp.headers


# ---------------------------------------------------------------------------
# SCRUM-92 phase 3: locations repository behaviour
# ---------------------------------------------------------------------------


def test_deleting_a_location_cascades_to_its_cached_forecasts(client, open_meteo):
    from backend.app.database import db_connection
    from factories import forecast_payload

    loc = client.post("/api/locations", json={"name": "Tmp", "latitude": 10.0, "longitude": 20.0}).json()
    open_meteo.respond(forecast_payload())
    assert client.get(f"/api/weather?location_id={loc['id']}").status_code == 200

    def cached_rows() -> int:
        with db_connection() as conn:
            return conn.execute(
                "SELECT COUNT(*) AS n FROM weather_cache WHERE location_id = ?;", (loc["id"],)
            ).fetchone()["n"]

    assert cached_rows() == 1
    assert client.delete(f"/api/locations/{loc['id']}").status_code == 204
    assert cached_rows() == 0  # removed by ON DELETE CASCADE, not by router code


def test_delete_unknown_location_is_404(client):
    resp = client.delete("/api/locations/9999")
    assert resp.status_code == 404


def test_nearby_location_returns_the_existing_one(client):
    first = client.post("/api/locations", json={"name": "A", "latitude": 10.0, "longitude": 20.0}).json()
    near = client.post("/api/locations", json={"name": "B", "latitude": 10.004, "longitude": 20.004}).json()
    far = client.post("/api/locations", json={"name": "C", "latitude": 10.01, "longitude": 20.0}).json()
    assert near["id"] == first["id"] and near["name"] == "A"
    assert far["id"] != first["id"]


def test_weather_for_unknown_location_is_404(client, open_meteo):
    assert client.get("/api/weather?location_id=9999").status_code == 404
    assert open_meteo.call_count == 0


def test_every_response_carries_the_security_headers(client):
    # A single-page app behind one shared password had none of these (SCRUM-272).
    response = client.get("/api/health")

    assert response.headers["x-content-type-options"] == "nosniff"
    assert response.headers["referrer-policy"] == "same-origin"
    assert response.headers["x-frame-options"] == "DENY"
    policy = response.headers["content-security-policy"]
    assert "default-src 'self'" in policy
    assert "frame-ancestors 'none'" in policy
    assert "object-src 'none'" in policy

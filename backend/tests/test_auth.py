"""HTTP Basic authentication over the API and the SPA (SCRUM-134)."""

import base64
import logging
import secrets

import pytest

from backend.app import auth, config
from backend.app.auth import parse_basic_auth, password_matches

# Generated per run, never stored (SCRUM-254): a literal here is what a generic-password scan
# reports on a public repository. The deployed password lives in Secret Manager, not in the tests.
PASSWORD = secrets.token_hex(16)


def basic_header(password: str, username: str = "wind") -> dict[str, str]:
    token = base64.b64encode(f"{username}:{password}".encode()).decode()
    return {"Authorization": f"Basic {token}"}


@pytest.fixture
def open_app(monkeypatch):
    """No password configured: the middleware must be a no-op."""
    monkeypatch.setattr(config, "APP_PASSWORD", "")


@pytest.fixture
def protected(monkeypatch):
    """A password configured, as on the public deployment."""
    monkeypatch.setattr(config, "APP_PASSWORD", PASSWORD)
    return PASSWORD


def test_api_is_open_when_no_password_is_configured(client, open_app):
    assert client.get("/api/locations").status_code == 200


def test_spa_is_open_when_no_password_is_configured(client, open_app):
    assert client.get("/").status_code != 401


def test_api_requires_credentials_when_a_password_is_configured(client, protected):
    response = client.get("/api/locations")

    assert response.status_code == 401
    assert response.headers["www-authenticate"].startswith("Basic")
    assert "authentication required" in response.text.lower()


def test_spa_requires_credentials_when_a_password_is_configured(client, protected):
    response = client.get("/")

    assert response.status_code == 401
    assert response.headers["www-authenticate"].startswith("Basic")


def test_wrong_password_is_rejected(client, protected):
    assert client.get("/api/locations", headers=basic_header("nope")).status_code == 401


def test_malformed_and_non_basic_headers_are_rejected(client, protected):
    for header in ("Basic !!!not-base64!!!", "Bearer abc", "Basic", ""):
        response = client.get("/api/locations", headers={"Authorization": header})
        assert response.status_code == 401, header


def test_correct_password_is_accepted(client, protected):
    response = client.get("/api/locations", headers=basic_header(protected))

    assert response.status_code == 200
    assert isinstance(response.json(), list)


def test_username_is_ignored(client, protected):
    """One shared password: whoever the user claims to be, the password decides."""
    response = client.get("/api/locations", headers=basic_header(protected, username="anyone"))

    assert response.status_code == 200


def test_health_stays_open_when_a_password_is_configured(client, protected):
    response = client.get("/api/health")

    assert response.status_code == 200
    assert response.json()["status"] == "ok"


def test_health_stays_open_with_wrong_credentials(client, protected):
    assert client.get("/api/health", headers=basic_header("nope")).status_code == 200


def test_credentials_are_never_logged(client, protected, caplog):
    with caplog.at_level(logging.DEBUG):
        client.get("/api/locations", headers=basic_header(protected))
        client.get("/api/locations", headers=basic_header("wrong"))
        client.get("/")

    assert protected not in caplog.text
    assert "authorization" not in caplog.text.lower()


def test_parse_basic_auth_reads_the_password():
    header = f"Basic {base64.b64encode(b'wind:hunter2').decode()}"

    assert parse_basic_auth(header) == "hunter2"


def test_parse_basic_auth_rejects_missing_or_broken_headers():
    assert parse_basic_auth(None) is None
    assert parse_basic_auth("") is None
    assert parse_basic_auth("Basic") is None
    assert parse_basic_auth("Basic ") is None
    assert parse_basic_auth("Bearer token") is None
    assert parse_basic_auth("Basic " + base64.b64encode(b"nocolonhere").decode()) is None
    assert parse_basic_auth("Basic " + base64.b64encode(b"\xff\xfe:nope").decode(errors="replace")) is None


def test_password_matches_compares_only_the_password():
    header = f"Basic {base64.b64encode(b'wind:right').decode()}"

    assert password_matches(header, "right")
    assert not password_matches(header, "wrong")
    assert not password_matches(header, "")
    assert not password_matches(None, "right")


# ---------------------------------------------------------------------------
# Slowing repeated failures (SCRUM-282)
# ---------------------------------------------------------------------------


@pytest.fixture(autouse=True)
def _fresh_failures():
    auth.reset_failures()
    yield
    auth.reset_failures()


def test_repeated_failures_are_slowed_down(client, protected):
    for _ in range(auth.FAILURE_LIMIT):
        assert client.get("/api/locations", headers=basic_header("wrong")).status_code == 401

    response = client.get("/api/locations", headers=basic_header("wrong"))

    assert response.status_code == 429
    assert int(response.headers["retry-after"]) > 0


def test_a_correct_password_clears_the_failures(client, protected):
    for _ in range(auth.FAILURE_LIMIT - 1):
        client.get("/api/locations", headers=basic_header("wrong"))

    assert client.get("/api/locations", headers=basic_header(protected)).status_code == 200

    for _ in range(auth.FAILURE_LIMIT - 1):
        assert client.get("/api/locations", headers=basic_header("wrong")).status_code == 401


def test_the_cooldown_expires(monkeypatch, client, protected):
    clock = {"now": 1000.0}
    monkeypatch.setattr(auth, "monotonic", lambda: clock["now"])
    for _ in range(auth.FAILURE_LIMIT):
        client.get("/api/locations", headers=basic_header("wrong"))
    assert client.get("/api/locations", headers=basic_header("wrong")).status_code == 429

    clock["now"] += auth.COOLDOWN_SECONDS

    assert client.get("/api/locations", headers=basic_header(protected)).status_code == 200


def test_health_stays_open_while_a_client_cools_down(client, protected):
    for _ in range(auth.FAILURE_LIMIT):
        client.get("/api/locations", headers=basic_header("wrong"))

    assert client.get("/api/health").status_code == 200


def test_the_cooldown_logs_no_secret(client, protected, caplog):
    caplog.set_level(logging.WARNING)
    for _ in range(auth.FAILURE_LIMIT + 1):
        client.get("/api/locations", headers=basic_header("attempted-secret"))

    assert "attempted-secret" not in caplog.text
    assert PASSWORD not in caplog.text

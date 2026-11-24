"""POST /api/feedback (SCRUM-179): validation, Jira mapping, limits and error handling."""

import httpx
import pytest

from backend.app import config
from backend.app.routers import feedback as feedback_router
from backend.app.services.feedback_limiter import FeedbackLimiter
from factories import http_response

VALID = {
    "type": "bug",
    "subject": "Map will not load",
    "comments": "It stays blank after I pan.",
    "contact_email": "sailor@example.com",
    "app_version": "0.9.2-2af202f",
    "timezone": "America/Los_Angeles",
    "user_agent": "Mozilla/5.0 (Test)",
}


class JiraStub:
    def __init__(self):
        self.calls: list[dict] = []
        self.responses: list = []

    def queue(self, *items):
        self.responses.extend(items)

    async def post(self, client_self, url, **kwargs):
        self.calls.append({"url": url, "json": kwargs.get("json"), "auth": client_self.auth})
        item = self.responses.pop(0) if self.responses else http_response({"key": "SCRUM-900"}, 201)
        if isinstance(item, Exception):
            raise item
        return item

    @property
    def fields(self) -> dict:
        return self.calls[-1]["json"]["fields"]


@pytest.fixture(autouse=True)
def configured(monkeypatch):
    monkeypatch.setattr(config, "JIRA_BASE_URL", "https://example.atlassian.net")
    monkeypatch.setattr(config, "JIRA_EMAIL", "bot@example.com")
    monkeypatch.setattr(config, "JIRA_API_TOKEN", "secret-token")
    monkeypatch.setattr(config, "JIRA_FEEDBACK_PROJECT", "SCRUM")
    monkeypatch.setattr(feedback_router, "limiter", FeedbackLimiter(5, 20))


@pytest.fixture
def jira(monkeypatch):
    stub = JiraStub()

    async def fake_post(client_self, url, **kwargs):
        return await stub.post(client_self, url, **kwargs)

    monkeypatch.setattr(httpx.AsyncClient, "post", fake_post)
    return stub


def post(client, **overrides):
    body = {**VALID, **overrides}
    body = {k: v for k, v in body.items() if v is not ...}
    return client.post("/api/feedback", json=body)


def test_creates_issue_and_returns_key_and_url(client, jira):
    response = post(client)
    assert response.status_code == 201
    assert response.json() == {
        "issue_key": "SCRUM-900",
        "issue_url": "https://example.atlassian.net/browse/SCRUM-900",
    }
    assert jira.calls[0]["url"] == "https://example.atlassian.net/rest/api/2/issue"


@pytest.mark.parametrize(
    ("feedback_type", "issue_type"), [("bug", "Bug"), ("new feature", "Task"), ("comment", "Task")]
)
def test_type_maps_to_issue_type_with_one_label_and_type_line(client, jira, feedback_type, issue_type):
    assert post(client, type=feedback_type).status_code == 201
    fields = jira.fields
    assert fields["issuetype"] == {"name": issue_type}
    assert fields["labels"] == ["in-app-feedback"]
    assert fields["project"] == {"key": "SCRUM"}
    assert fields["summary"] == "Map will not load"
    description = fields["description"]
    assert f"Type: {feedback_type}" in description
    assert description.index(VALID["comments"]) < description.index(f"Type: {feedback_type}")


def test_description_has_contact_and_breadcrumbs(client, jira):
    post(client)
    description = jira.fields["description"]
    assert "Contact: sailor@example.com" in description
    assert "App version: 0.9.2-2af202f" in description
    assert "Timezone: America/Los_Angeles" in description
    assert "User agent: Mozilla/5.0 (Test)" in description


def test_user_agent_is_truncated_to_200_characters(client, jira):
    assert post(client, user_agent="x" * 900).status_code == 201
    line = [ln for ln in jira.fields["description"].splitlines() if ln.startswith("User agent: ")][0]
    assert line == "User agent: " + "x" * 200


def test_jira_uses_service_account_credentials(client, jira):
    post(client)
    assert jira.calls[0]["auth"]._auth_header.startswith("Basic ")


@pytest.mark.parametrize(
    "overrides",
    [
        {"type": ...},
        {"type": "none"},
        {"type": ""},
        {"subject": ...},
        {"subject": "   "},
        {"subject": "x" * 51},
        {"comments": ...},
        {"comments": ""},
        {"comments": "<b></b>"},
        {"comments": "x" * 1001},
        {"contact_email": "not-an-email"},
        {"contact_email": "a@b.co" + "m" * 260},
    ],
)
def test_invalid_input_is_422_and_files_nothing(client, jira, overrides):
    response = post(client, **overrides)
    assert response.status_code == 422
    assert jira.calls == []


def test_422_does_not_echo_submitted_text(client, jira):
    response = post(client, subject="x" * 51, comments="private words")
    assert "private words" not in response.text


def test_boundary_lengths_are_accepted(client, jira):
    assert post(client, subject="s" * 50, comments="c" * 1000).status_code == 201


def test_email_is_optional(client, jira):
    assert post(client, contact_email=...).status_code == 201
    assert post(client, contact_email="").status_code == 201
    assert "Contact:" not in jira.fields["description"]


def test_html_and_control_characters_are_stripped(client, jira):
    post(client, subject="Hi <script>x</script>\nthere", comments="a<b>bold</b>\x00\x07 line\nnext")
    assert jira.fields["summary"] == "Hi x there"
    assert "<" not in jira.fields["description"].split("Type:")[0]
    assert "\x00" not in jira.fields["description"]
    assert "a" in jira.fields["description"] and "line\nnext" in jira.fields["description"]


def test_503_when_unconfigured(client, jira, monkeypatch):
    monkeypatch.setattr(config, "JIRA_API_TOKEN", "")
    response = post(client)
    assert response.status_code == 503
    assert response.json()["detail"]["code"] == "feedback_unavailable"
    assert jira.calls == []


def test_429_over_per_ip_limit_with_retry_after(client, jira):
    for _ in range(5):
        assert post(client).status_code == 201
    response = post(client)
    assert response.status_code == 429
    assert int(response.headers["Retry-After"]) > 0
    assert len(jira.calls) == 5


def test_429_over_global_limit(client, jira, monkeypatch):
    monkeypatch.setattr(feedback_router, "limiter", FeedbackLimiter(5, 2))
    assert post(client).status_code == 201
    assert post(client).status_code == 201
    assert post(client).status_code == 429


def test_invalid_requests_do_not_use_the_limit(client, jira):
    for _ in range(8):
        assert post(client, subject="").status_code == 422
    assert post(client).status_code == 201


def test_413_over_body_cap(client, jira, monkeypatch):
    monkeypatch.setattr(config, "FEEDBACK_MAX_BODY_BYTES", 500)
    response = post(client, comments="x" * 800)
    assert response.status_code == 413
    assert jira.calls == []


def test_502_on_jira_timeout_hides_details(client, jira):
    jira.queue(httpx.ReadTimeout("slow"))
    response = post(client)
    assert response.status_code == 502
    assert response.json()["detail"] == {"code": "feedback_failed"}


def test_502_on_jira_rejection_does_not_return_jira_body(client, jira):
    jira.queue(http_response({"errorMessages": ["internal secret detail"]}, 401))
    response = post(client)
    assert response.status_code == 502
    assert "secret detail" not in response.text


def test_bug_falls_back_to_task_when_project_rejects_the_type(client, jira):
    jira.queue(
        http_response({"errors": {"issuetype": "valid issue type is required"}}, 400),
        http_response({"key": "SCRUM-901"}, 201),
    )
    response = post(client, type="bug")
    assert response.status_code == 201
    assert [c["json"]["fields"]["issuetype"]["name"] for c in jira.calls] == ["Bug", "Task"]
    assert response.json()["issue_key"] == "SCRUM-901"


def test_other_400_does_not_retry(client, jira):
    jira.queue(http_response({"errors": {"summary": "bad"}}, 400))
    assert post(client, type="bug").status_code == 502
    assert len(jira.calls) == 1


def test_comments_and_email_are_not_logged(client, jira, caplog):
    jira.queue(http_response({}, 500))
    with caplog.at_level("DEBUG"):
        post(client, comments="very private comment", contact_email="private@example.com")
    assert "very private comment" not in caplog.text
    assert "private@example.com" not in caplog.text


def test_config_reports_feedback_enabled_without_credentials(client, monkeypatch):
    body = client.get("/api/config").json()
    assert body["feedback_enabled"] is True
    assert "secret-token" not in str(body)
    monkeypatch.setattr(config, "JIRA_BASE_URL", "")
    assert client.get("/api/config").json()["feedback_enabled"] is False


def test_limiter_window_expires():
    now = [0.0]
    limiter = FeedbackLimiter(1, 10, clock=lambda: now[0])
    assert limiter.try_acquire("a") is None
    assert limiter.try_acquire("a") == 3600
    assert limiter.try_acquire("b") is None
    now[0] = 3601.0
    assert limiter.try_acquire("a") is None


@pytest.mark.parametrize("body", [{}, {"key": "bad key"}, {"key": 7}])
def test_502_when_jira_response_has_no_usable_key(client, jira, body):
    jira.queue(http_response(body, 201))
    assert post(client).status_code == 502


def test_502_when_jira_response_is_not_json(client, jira):
    jira.queue(httpx.Response(201, text="<html>proxy</html>", request=httpx.Request("POST", "https://x")))
    assert post(client).status_code == 502


def test_400_with_a_non_json_body_does_not_retry(client, jira):
    jira.queue(httpx.Response(400, text="nope", request=httpx.Request("POST", "https://x")))
    assert post(client, type="bug").status_code == 502
    assert len(jira.calls) == 1


def test_non_string_fields_are_422(client, jira):
    assert post(client, subject=123).status_code == 422
    assert jira.calls == []


def test_limiter_drops_idle_ips_when_the_table_grows(monkeypatch):
    from backend.app.services import feedback_limiter

    monkeypatch.setattr(feedback_limiter, "_MAX_TRACKED_IPS", 2)
    now = [0.0]
    limiter = FeedbackLimiter(5, 100, clock=lambda: now[0])
    for ip in ("a", "b", "c"):
        limiter.try_acquire(ip)
    now[0] = 4000.0
    limiter.try_acquire("d")
    assert set(limiter._by_ip) == {"d"}


@pytest.mark.parametrize(("raw", "expected"), [("", 5), ("abc", 5), ("0", 5), ("-3", 5), ("9", 9)])
def test_feedback_cap_setting_falls_back_to_default(monkeypatch, raw, expected):
    monkeypatch.setenv("FEEDBACK_MAX_PER_HOUR", raw)
    assert config._positive_int("FEEDBACK_MAX_PER_HOUR", 5) == expected

"""scripts/jira_agent.py: Jira writes carry the calling bot's identity (SCRUM-310, SCRUM-313)."""

import importlib.util
import io
import json
from pathlib import Path

import httpx
import pytest

ROOT = Path(__file__).resolve().parents[2]
_SPEC = importlib.util.spec_from_file_location("jira_agent", ROOT / "scripts" / "jira_agent.py")
jira_agent = importlib.util.module_from_spec(_SPEC)
_SPEC.loader.exec_module(jira_agent)  # type: ignore[union-attr]

BASE = "https://example.atlassian.net"
CLOUD = "cloud-123"
TOKEN = "tok-agent-secret"
GATEWAY = f"https://api.atlassian.com/ex/jira/{CLOUD}"


def _agent(responder, cloud=CLOUD, token=TOKEN):
    """Return an agent whose requests are answered by `responder`, plus the recorded requests."""
    calls = []

    def handle(request):
        calls.append(request)
        return responder(request)

    agent = jira_agent.JiraAgent(token=token, base_url=BASE, cloud=cloud, transport=httpx.MockTransport(handle))
    return agent, calls


def _json(status, payload):
    def responder(request):
        return httpx.Response(status, json=payload)

    return responder


def _body(request):
    return json.loads(request.content)


def test_create_sends_the_fields_through_the_gateway_as_the_agent():
    agent, calls = _agent(_json(201, {"key": "SCRUM-311", "id": "1"}))

    result = agent.create(
        project="SCRUM",
        summary="Do the thing",
        description="Why it matters",
        points=3,
        labels=["agent-created"],
        parent="SCRUM-300",
    )

    assert result == {"key": "SCRUM-311", "url": f"{BASE}/browse/SCRUM-311"}
    assert len(calls) == 1
    request = calls[0]
    assert request.method == "POST"
    assert str(request.url) == f"{GATEWAY}/rest/api/2/issue"
    assert request.headers["Authorization"] == f"Bearer {TOKEN}"
    assert _body(request) == {
        "fields": {
            "project": {"key": "SCRUM"},
            "summary": "Do the thing",
            "issuetype": {"name": "Task"},
            "description": "Why it matters",
            "customfield_10016": 3,
            "labels": ["agent-created"],
            "parent": {"key": "SCRUM-300"},
        }
    }


def test_create_omits_the_optional_fields_when_they_are_not_given():
    agent, calls = _agent(_json(201, {"key": "SCRUM-311"}))

    agent.create(project="SCRUM", summary="Only a summary", issue_type="Epic")

    assert _body(calls[0]) == {
        "fields": {"project": {"key": "SCRUM"}, "summary": "Only a summary", "issuetype": {"name": "Epic"}}
    }


def test_comment_is_posted_as_the_agent():
    agent, calls = _agent(_json(201, {"id": "9"}))

    assert agent.comment("SCRUM-311", "Merged PR #1") == {"key": "SCRUM-311", "url": f"{BASE}/browse/SCRUM-311"}

    assert calls[0].method == "POST"
    assert str(calls[0].url) == f"{GATEWAY}/rest/api/2/issue/SCRUM-311/comment"
    assert _body(calls[0]) == {"body": "Merged PR #1"}


def test_transition_matches_the_name_then_sets_the_resolution_afterwards():
    def responder(request):
        if request.method == "GET":
            return httpx.Response(200, json={"transitions": [{"id": "31", "name": "Done", "to": {"name": "Done"}}]})
        return httpx.Response(204)

    agent, calls = _agent(responder)

    result = agent.transition("SCRUM-311", to="done", resolution="Done")

    assert result == {"key": "SCRUM-311", "status": "Done", "url": f"{BASE}/browse/SCRUM-311"}
    assert [(call.method, call.url.path) for call in calls] == [
        ("GET", f"/ex/jira/{CLOUD}/rest/api/2/issue/SCRUM-311/transitions"),
        ("POST", f"/ex/jira/{CLOUD}/rest/api/2/issue/SCRUM-311/transitions"),
        ("PUT", f"/ex/jira/{CLOUD}/rest/api/2/issue/SCRUM-311"),
    ]
    assert _body(calls[1]) == {"transition": {"id": "31"}}
    assert _body(calls[2]) == {"fields": {"resolution": {"name": "Done"}}}


def test_transition_accepts_an_id_and_skips_the_resolution():
    def responder(request):
        if request.method == "GET":
            return httpx.Response(
                200, json={"transitions": [{"id": "21", "name": "In Progress", "to": {"name": "In Progress"}}]}
            )
        return httpx.Response(204)

    agent, calls = _agent(responder)

    assert agent.transition("SCRUM-311", transition_id="21")["status"] == "In Progress"
    assert [call.method for call in calls] == ["GET", "POST"]


def test_unknown_transition_lists_the_available_names():
    agent, _ = _agent(_json(200, {"transitions": [{"id": "11", "name": "To Do", "to": {"name": "To Do"}}]}))

    with pytest.raises(jira_agent.AgentError, match="available: To Do"):
        agent.transition("SCRUM-311", to="QA")


def test_unknown_transition_id_is_reported():
    agent, _ = _agent(_json(200, {"transitions": [{"id": "11", "name": "To Do"}]}))

    with pytest.raises(jira_agent.AgentError, match="no transition with id 99"):
        agent.transition("SCRUM-311", transition_id="99")


def test_set_fields_writes_raw_values():
    agent, calls = _agent(_json(204, {}))

    agent.set_fields("SCRUM-311", {"customfield_10016": 1})

    assert calls[0].method == "PUT"
    assert _body(calls[0]) == {"fields": {"customfield_10016": 1}}


def test_link_puts_the_blocker_inward():
    agent, calls = _agent(_json(201, {"id": "7"}))

    result = agent.link("SCRUM-311", "SCRUM-312")

    assert result == {"type": "Blocks", "inward": "SCRUM-311", "outward": "SCRUM-312"}
    assert _body(calls[0]) == {
        "type": {"name": "Blocks"},
        "inwardIssue": {"key": "SCRUM-311"},
        "outwardIssue": {"key": "SCRUM-312"},
    }


def test_a_rejection_names_the_fields_but_never_the_body():
    agent, _ = _agent(_json(400, {"errorMessages": ["secret detail"], "errors": {"summary": "is required"}}))

    with pytest.raises(jira_agent.AgentError) as caught:
        agent.create(project="SCRUM", summary="")

    message = str(caught.value)
    assert "400" in message
    assert "summary" in message
    assert "secret detail" not in message
    assert "is required" not in message


def test_a_missing_token_names_the_variable(monkeypatch):
    monkeypatch.delenv(jira_agent.DEFAULT_KEY_VARIABLE, raising=False)

    with pytest.raises(jira_agent.AgentError, match=jira_agent.DEFAULT_KEY_VARIABLE):
        jira_agent.JiraAgent()


def test_the_default_key_variable_is_freebuff():
    assert jira_agent.DEFAULT_KEY_VARIABLE == "FREEBUFF_JIRA_KEY"
    assert jira_agent.build_parser().parse_args(["myself"]).key_variable == "FREEBUFF_JIRA_KEY"


def test_key_variable_selects_the_other_bot_token(monkeypatch):
    monkeypatch.setenv("FREEBUFF_JIRA_KEY", "tok-freebuff")
    monkeypatch.setenv("KIRO_JIRA_KEY", "tok-kiro")

    def responder(request):
        return httpx.Response(201, json={"key": "SCRUM-314"})

    calls = []

    def handle(request):
        calls.append(request)
        return responder(request)

    agent = jira_agent.JiraAgent(
        base_url=BASE, cloud=CLOUD, transport=httpx.MockTransport(handle), key_variable="KIRO_JIRA_KEY"
    )
    agent.create(project="SCRUM", summary="From Kiro")

    assert calls[0].headers["Authorization"] == "Bearer tok-kiro"


def test_a_missing_selected_variable_names_it(monkeypatch):
    monkeypatch.setenv("FREEBUFF_JIRA_KEY", "tok-freebuff")
    monkeypatch.delenv("KIRO_JIRA_KEY", raising=False)

    with pytest.raises(jira_agent.AgentError, match="KIRO_JIRA_KEY"):
        jira_agent.JiraAgent(key_variable="KIRO_JIRA_KEY")


def test_the_cloud_id_is_looked_up_once_when_it_is_not_configured():
    def responder(request):
        if request.url.host == "example.atlassian.net":
            return httpx.Response(200, json={"cloudId": "looked-up"})
        return httpx.Response(201, json={"key": "SCRUM-311"})

    agent, calls = _agent(responder, cloud=None)

    agent.create(project="SCRUM", summary="One")
    agent.create(project="SCRUM", summary="Two")

    assert str(calls[0].url) == f"{BASE}/_edge/tenant_info"
    assert str(calls[1].url).startswith("https://api.atlassian.com/ex/jira/looked-up/")
    assert len(calls) == 3


def test_a_network_failure_is_reported_without_the_token():
    def responder(request):
        raise httpx.ConnectError("boom")

    agent, _ = _agent(responder)

    with pytest.raises(jira_agent.AgentError, match="ConnectError") as caught:
        agent.create(project="SCRUM", summary="One")

    assert TOKEN not in str(caught.value)


def test_main_prints_the_issue_key_and_url(monkeypatch, capsys):
    class Stub:
        def create(self, **kwargs):
            self.kwargs = kwargs
            return {"key": "SCRUM-312", "url": f"{BASE}/browse/SCRUM-312"}

    stub = Stub()
    monkeypatch.setattr(jira_agent, "_agent_from_env", lambda key_variable: stub)
    monkeypatch.setattr(jira_agent.sys, "stdin", io.StringIO("Description from stdin"))

    assert jira_agent.main(["create", "--summary", "Hello", "--points", "2", "--description-file", "-"]) == 0

    assert stub.kwargs["description"] == "Description from stdin"
    assert stub.kwargs["points"] == 2
    assert capsys.readouterr().out.strip() == f"SCRUM-312 {BASE}/browse/SCRUM-312"


def test_main_reports_an_error_and_exits_non_zero(monkeypatch, capsys):
    class Stub:
        def comment(self, key, body):
            raise jira_agent.AgentError("Jira returned 403")

    monkeypatch.setattr(jira_agent, "_agent_from_env", lambda key_variable: Stub())

    assert jira_agent.main(["comment", "SCRUM-312", "--body", "hello"]) == 1
    captured = capsys.readouterr()
    assert captured.out == ""
    assert captured.err.strip() == "jira_agent: Jira returned 403"


def test_main_rejects_fields_that_are_not_a_json_object(monkeypatch, capsys):
    class Stub:
        def set_fields(self, key, fields):
            pytest.fail("no request expected")

    monkeypatch.setattr(jira_agent, "_agent_from_env", lambda key_variable: Stub())

    assert jira_agent.main(["set", "SCRUM-312", "--fields", "[1]"]) == 1
    assert "--fields must be a JSON object" in capsys.readouterr().err


def test_main_forwards_the_selected_key_variable(monkeypatch):
    seen = []

    class Stub:
        def myself(self):
            return {"displayName": "Kiro", "emailAddress": "kiro@serviceaccount.atlassian.com", "accountId": "1"}

    monkeypatch.setattr(jira_agent, "_agent_from_env", lambda key_variable: seen.append(key_variable) or Stub())

    assert jira_agent.main(["myself", "--key-variable", "KIRO_JIRA_KEY"]) == 0
    assert jira_agent.main(["myself"]) == 0
    assert seen == ["KIRO_JIRA_KEY", "FREEBUFF_JIRA_KEY"]


def test_text_file_that_cannot_be_read_is_reported(tmp_path):
    missing = tmp_path / "nope.txt"

    with pytest.raises(jira_agent.AgentError, match="--body"):
        jira_agent._read_text(None, str(missing), "--body")

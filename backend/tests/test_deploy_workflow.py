"""The Cloud Run deploy workflow must keep every runtime secret attached (SCRUM-190)."""

from pathlib import Path

WORKFLOW = Path(__file__).resolve().parents[2] / ".github" / "workflows" / "deploy-cloud-run.yml"


def _line_containing(text: str, needle: str) -> str:
    matches = [line for line in text.splitlines() if needle in line]
    assert len(matches) == 1, f"expected exactly one line with {needle!r}, found {len(matches)}"
    return matches[0]


def test_deploy_injects_every_runtime_secret():
    """A deploy that names only some secrets detaches the rest from the service."""
    secrets_line = _line_containing(WORKFLOW.read_text(encoding="utf-8"), "--set-secrets=")

    for secret in ("APP_PASSWORD", "CARTO_API_KEY", "JIRA_API_TOKEN"):
        assert f"{secret}={secret}:latest" in secrets_line


def test_deploy_passes_the_jira_settings_feedback_needs():
    env_line = _line_containing(WORKFLOW.read_text(encoding="utf-8"), "--set-env-vars=")

    assert "LITESTREAM_BUCKET=$LITESTREAM_BUCKET" in env_line
    assert "JIRA_BASE_URL=$JIRA_BASE_URL" in env_line
    assert "JIRA_EMAIL=$JIRA_EMAIL" in env_line


def test_jira_settings_are_defined_in_the_workflow_env():
    """The variables the deploy step interpolates have to exist, or the deploy sends empty values."""
    text = WORKFLOW.read_text(encoding="utf-8")

    assert "JIRA_BASE_URL: https://" in text
    assert "JIRA_EMAIL: " in text

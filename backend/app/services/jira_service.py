"""Create a Jira issue for in-app feedback (SCRUM-179). REST v2 keeps the description plain text."""

import logging
import re

import httpx

from backend.app import config
from backend.app.services.feedback_attachments import Attachment

logger = logging.getLogger(__name__)

ISSUE_TYPES = {"bug": "Bug", "new feature": "Task", "comment": "Task"}
FALLBACK_ISSUE_TYPE = "Task"


class JiraError(Exception):
    """Jira timed out, was unreachable or rejected the issue. Carries no response body."""


def build_description(
    comments: str,
    feedback_type: str,
    contact_email: str | None,
    version: str,
    timezone: str,
    user_agent: str,
) -> str:
    """Comments, the reported type, the optional contact, then the system breadcrumbs."""
    parts = [comments, f"Type: {feedback_type}"]
    if contact_email:
        parts.append(f"Contact: {contact_email}")
    parts.append(
        f"App version: {version or 'unknown'}\nTimezone: {timezone or 'unknown'}\nUser agent: {user_agent or 'unknown'}"
    )
    return "\n\n".join(parts)


def _issue_type_rejected(response: httpx.Response) -> bool:
    try:
        errors = response.json().get("errors", {})
    except ValueError, AttributeError:
        return False
    return isinstance(errors, dict) and "issuetype" in errors


async def _post(client: httpx.AsyncClient, summary: str, description: str, issue_type: str) -> httpx.Response:
    payload = {
        "fields": {
            "project": {"key": config.JIRA_FEEDBACK_PROJECT},
            "summary": summary,
            "description": description,
            "issuetype": {"name": issue_type},
            "labels": [config.FEEDBACK_LABEL],
        }
    }
    return await client.post(f"{config.JIRA_BASE_URL}/rest/api/2/issue", json=payload)


async def create_feedback_issue(summary: str, description: str, feedback_type: str) -> dict[str, str]:
    """File one issue and return `{issue_key, issue_url}`. Raises JiraError on any failure."""
    issue_type = ISSUE_TYPES[feedback_type]
    try:
        async with httpx.AsyncClient(
            auth=httpx.BasicAuth(config.JIRA_EMAIL, config.JIRA_API_TOKEN),
            timeout=config.JIRA_TIMEOUT_SECONDS,
            headers={"Accept": "application/json"},
        ) as client:
            response = await _post(client, summary, description, issue_type)
            # The project may not have a Bug type. Jira rejected the whole request, so retrying
            # once as a Task cannot create a duplicate.
            if response.status_code == 400 and issue_type != FALLBACK_ISSUE_TYPE and _issue_type_rejected(response):
                response = await _post(client, summary, description, FALLBACK_ISSUE_TYPE)
    except httpx.HTTPError as exc:
        logger.warning("Jira feedback request failed: %s", type(exc).__name__)
        raise JiraError("Jira request failed") from exc
    if response.status_code != 201:
        logger.warning("Jira rejected the feedback issue with status %s", response.status_code)
        raise JiraError(f"Jira returned {response.status_code}")
    try:
        key = str(response.json()["key"])
    except (ValueError, KeyError, TypeError) as exc:
        raise JiraError("Jira response had no issue key") from exc
    if not re.fullmatch(r"[A-Z][A-Z0-9_]*-\d+", key):
        raise JiraError("Jira returned an unexpected issue key")
    return {"issue_key": key, "issue_url": f"{config.JIRA_BASE_URL}/browse/{key}"}


def _client(timeout: float) -> httpx.AsyncClient:
    return httpx.AsyncClient(
        auth=httpx.BasicAuth(config.JIRA_EMAIL, config.JIRA_API_TOKEN),
        timeout=timeout,
        headers={"Accept": "application/json"},
    )


async def attach_files(issue_key: str, attachments: list[Attachment]) -> None:
    """Post every file to the issue in one multipart call. Raises JiraError on any failure."""
    files = [("file", (item.name, item.content, item.content_type)) for item in attachments]
    try:
        async with _client(config.JIRA_ATTACHMENT_TIMEOUT_SECONDS) as client:
            response = await client.post(
                f"{config.JIRA_BASE_URL}/rest/api/2/issue/{issue_key}/attachments",
                files=files,
                headers={"X-Atlassian-Token": "no-check"},
            )
    except httpx.HTTPError as exc:
        logger.warning("Jira attachment request failed: %s", type(exc).__name__)
        raise JiraError("Jira attachment request failed") from exc
    if response.status_code not in (200, 201):
        logger.warning("Jira rejected the attachments with status %s", response.status_code)
        raise JiraError(f"Jira returned {response.status_code}")


async def append_description_note(issue_key: str, description: str, note: str) -> None:
    """Add `note` to the issue description. Raises JiraError on any failure."""
    payload = {"fields": {"description": f"{description}\n\n{note}"}}
    try:
        async with _client(config.JIRA_TIMEOUT_SECONDS) as client:
            response = await client.put(f"{config.JIRA_BASE_URL}/rest/api/2/issue/{issue_key}", json=payload)
    except httpx.HTTPError as exc:
        logger.warning("Jira description update failed: %s", type(exc).__name__)
        raise JiraError("Jira description update failed") from exc
    if response.status_code not in (200, 204):
        logger.warning("Jira rejected the description update with status %s", response.status_code)
        raise JiraError(f"Jira returned {response.status_code}")

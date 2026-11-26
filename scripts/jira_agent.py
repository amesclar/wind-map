"""File and update Jira issues as the agent's own service account (SCRUM-310, SCRUM-313).

The service account cannot sign in to the Jira integration, and its scoped API token is only
accepted by the platform gateway (`https://api.atlassian.com/ex/jira/<cloudId>`), so this script is
the one write path for the agent. Reads may still use the connected integration.

    zsh -ic 'python scripts/jira_agent.py create --summary "..." --description-file - --points 1'

The token comes from the environment and never from the repository: `FREEBUFF_JIRA_KEY` by default, or
the variable named with `--key-variable` (SCRUM-313, for example `KIRO_JIRA_KEY`), so two bots write as
two different accounts. Because the key lives in the user's shell profile, a non-interactive agent
shell has to run this through `zsh -ic`, exactly like `scripts/rebuild-container.sh` (SCRUM-262).
"""

import argparse
import json
import os
import re
import sys
from pathlib import Path
from typing import Any

import httpx

DEFAULT_BASE_URL = "https://nehes.atlassian.net"
GATEWAY = "https://api.atlassian.com/ex/jira"
TIMEOUT_SECONDS = 10.0
DEFAULT_KEY_VARIABLE = "FREEBUFF_JIRA_KEY"
ESTIMATE_FIELD = "customfield_10016"
ISSUE_KEY = re.compile(r"[A-Z][A-Z0-9_]*-\d+")


class AgentError(Exception):
    """The request could not be made or Jira rejected it. Carries no response body."""


def cloud_id(base_url: str, transport: httpx.BaseTransport | None = None) -> str:
    """Return the site's cloud id, which addresses it on the platform gateway."""
    try:
        with httpx.Client(timeout=TIMEOUT_SECONDS, transport=transport) as client:
            response = client.get(f"{base_url}/_edge/tenant_info")
    except httpx.HTTPError as exc:
        raise AgentError(f"could not reach {base_url}: {type(exc).__name__}") from exc
    if response.status_code != 200:
        raise AgentError(f"could not resolve the cloud id (HTTP {response.status_code})")
    try:
        return str(response.json()["cloudId"])
    except (ValueError, KeyError, TypeError) as exc:
        raise AgentError("the tenant info had no cloud id") from exc


def _rejection(response: httpx.Response) -> str:
    """Name the rejected fields only: Jira's response body is never printed (SCRUM-179)."""
    try:
        errors = response.json().get("errors") or {}
    except ValueError, AttributeError:
        errors = {}
    fields = ", ".join(sorted(errors)) if isinstance(errors, dict) else ""
    return f"Jira returned {response.status_code}{f': {fields}' if fields else ''}"


def _issue(body: dict, base_url: str) -> dict[str, str]:
    """Return `{key, url}` for a response that names one issue."""
    key = str(body.get("key", ""))
    if not ISSUE_KEY.fullmatch(key):
        raise AgentError("Jira returned an unexpected issue key")
    return {"key": key, "url": f"{base_url}/browse/{key}"}


class JiraAgent:
    """Jira REST v2 through the gateway, authenticated as the agent service account."""

    def __init__(
        self,
        token: str | None = None,
        base_url: str = "",
        cloud: str | None = None,
        transport: httpx.BaseTransport | None = None,
        key_variable: str = DEFAULT_KEY_VARIABLE,
    ):
        self.key_variable = key_variable
        self._token = (token if token is not None else os.getenv(key_variable, "")).strip()
        if not self._token:
            raise AgentError(f"{key_variable} is not set")
        self.base_url = (base_url or os.getenv("JIRA_BASE_URL", "") or DEFAULT_BASE_URL).rstrip("/")
        self._cloud = cloud
        self._transport = transport

    def _gateway(self) -> str:
        if self._cloud is None:
            self._cloud = cloud_id(self.base_url, self._transport)
        return f"{GATEWAY}/{self._cloud}"

    def _send(self, method: str, path: str, payload: dict | None = None, ok: tuple[int, ...] = (200, 201)) -> dict:
        headers = {"Authorization": f"Bearer {self._token}", "Accept": "application/json"}
        try:
            with httpx.Client(
                base_url=self._gateway(), timeout=TIMEOUT_SECONDS, transport=self._transport, headers=headers
            ) as client:
                response = client.request(method, path, json=payload)
        except httpx.HTTPError as exc:
            raise AgentError(f"Jira request failed: {type(exc).__name__}") from exc
        if response.status_code not in ok:
            raise AgentError(_rejection(response))
        if not response.content:
            return {}
        try:
            return response.json()
        except ValueError as exc:
            raise AgentError("Jira returned a body that is not JSON") from exc

    def myself(self) -> dict:
        """Return the account the token belongs to, so attribution can be checked."""
        return self._send("GET", "/rest/api/2/myself")

    def create(
        self,
        project: str,
        summary: str,
        description: str = "",
        issue_type: str = "Task",
        points: int | None = None,
        labels: list[str] | None = None,
        parent: str | None = None,
    ) -> dict[str, str]:
        """File one issue as the agent account and return `{key, url}`."""
        fields: dict[str, Any] = {
            "project": {"key": project},
            "summary": summary,
            "issuetype": {"name": issue_type},
        }
        if description:
            fields["description"] = description
        if points is not None:
            fields[ESTIMATE_FIELD] = points
        if labels:
            fields["labels"] = labels
        if parent:
            fields["parent"] = {"key": parent}
        return _issue(self._send("POST", "/rest/api/2/issue", {"fields": fields}, ok=(201,)), self.base_url)

    def comment(self, key: str, body: str) -> dict[str, str]:
        """Add `body` to `key` as the agent account."""
        self._send("POST", f"/rest/api/2/issue/{key}/comment", {"body": body}, ok=(201,))
        return _issue({"key": key}, self.base_url)

    def transition(
        self, key: str, to: str | None = None, transition_id: str | None = None, resolution: str | None = None
    ) -> dict[str, str]:
        """Move `key` to another status, then set `resolution` when asked.

        The SCRUM transitions have no screen, so a resolution sent with the transition is rejected;
        it is written afterwards, which is what the integration does (SCRUM-142).
        """
        transitions = self._send("GET", f"/rest/api/2/issue/{key}/transitions").get("transitions") or []
        chosen = _match_transition(transitions, to, transition_id)
        self._send("POST", f"/rest/api/2/issue/{key}/transitions", {"transition": {"id": chosen["id"]}}, ok=(204,))
        if resolution:
            self.set_fields(key, {"resolution": {"name": resolution}})
        status = str((chosen.get("to") or {}).get("name") or chosen.get("name") or "")
        return {"key": key, "status": status, "url": f"{self.base_url}/browse/{key}"}

    def set_fields(self, key: str, fields: dict) -> dict[str, str]:
        """Write raw field values, e.g. an estimate or a resolution."""
        self._send("PUT", f"/rest/api/2/issue/{key}", {"fields": fields}, ok=(200, 204))
        return _issue({"key": key}, self.base_url)

    def link(self, inward: str, outward: str, link_type: str = "Blocks") -> dict[str, str]:
        """Link two issues; for `Blocks` the inward issue is the blocker."""
        payload = {
            "type": {"name": link_type},
            "inwardIssue": {"key": inward},
            "outwardIssue": {"key": outward},
        }
        self._send("POST", "/rest/api/2/issueLink", payload)
        return {"type": link_type, "inward": inward, "outward": outward}


def _match_transition(transitions: list, to: str | None, transition_id: str | None) -> dict:
    """Return the transition named or numbered in the arguments."""
    if transition_id:
        for transition in transitions:
            if str(transition.get("id")) == str(transition_id):
                return transition
        raise AgentError(f"no transition with id {transition_id}")
    wanted = (to or "").strip().lower()
    for transition in transitions:
        if str(transition.get("name", "")).strip().lower() == wanted:
            return transition
    available = ", ".join(sorted(str(transition.get("name")) for transition in transitions))
    raise AgentError(f"no transition named {to!r}; available: {available or 'none'}")


def _read_text(inline: str | None, path: str | None, flag: str) -> str:
    """Return the inline text or the contents of a file, where `-` means standard input."""
    if inline is not None:
        return inline
    if path is None:
        return ""
    if path == "-":
        return sys.stdin.read()
    try:
        return Path(path).read_text(encoding="utf-8")
    except OSError as exc:
        raise AgentError(f"{flag}: {exc.strerror or 'cannot read the file'}") from exc


def _json_object(text: str) -> dict:
    try:
        value = json.loads(text)
    except json.JSONDecodeError as exc:
        raise AgentError("--fields must be a JSON object") from exc
    if not isinstance(value, dict):
        raise AgentError("--fields must be a JSON object")
    return value


def _agent_from_env(key_variable: str = DEFAULT_KEY_VARIABLE) -> JiraAgent:
    return JiraAgent(key_variable=key_variable)


def _text_options(parser: argparse.ArgumentParser, name: str, help_text: str) -> None:
    """Add a `--<name>` / `--<name>-file` pair, where `-` reads standard input."""
    group = parser.add_mutually_exclusive_group()
    group.add_argument(f"--{name}", help=help_text)
    group.add_argument(f"--{name}-file", help=f"Read the {name} from this file, or from stdin with '-'.", default=None)


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="jira_agent", description="File and update Jira as the agent account.")
    commands = parser.add_subparsers(dest="command", required=True)
    common = argparse.ArgumentParser(add_help=False)
    common.add_argument(
        "--key-variable",
        default=DEFAULT_KEY_VARIABLE,
        help=f"Environment variable holding the token (default {DEFAULT_KEY_VARIABLE}).",
    )

    commands.add_parser("myself", parents=[common], help="Show the account the token belongs to.")

    create = commands.add_parser("create", parents=[common], help="File one issue.")
    create.add_argument("--project", default=os.getenv("JIRA_FEEDBACK_PROJECT", "SCRUM"))
    create.add_argument("--summary", required=True)
    create.add_argument("--type", dest="issue_type", default="Task")
    create.add_argument("--points", type=int)
    create.add_argument("--label", action="append", default=[])
    create.add_argument("--parent", help="Epic key, when the issue is a child.")
    _text_options(create, "description", "Issue description, as plain text.")

    comment = commands.add_parser("comment", parents=[common], help="Add a comment.")
    comment.add_argument("key")
    _text_options(comment, "body", "Comment text.")

    transition = commands.add_parser("transition", parents=[common], help="Move an issue to another status.")
    transition.add_argument("key")
    target = transition.add_mutually_exclusive_group(required=True)
    target.add_argument("--to", help="Transition name, e.g. Done.")
    target.add_argument("--id", dest="transition_id", help="Transition id.")
    transition.add_argument("--resolution", help="Resolution to set after the transition, e.g. Done.")

    field = commands.add_parser("set", parents=[common], help="Write raw field values.")
    field.add_argument("key")
    field.add_argument("--fields", required=True, help="JSON object, e.g. '{\"customfield_10016\": 1}'.")

    link = commands.add_parser("link", parents=[common], help="Link two issues.")
    link.add_argument("--inward", required=True, help="For Blocks, the blocker.")
    link.add_argument("--outward", required=True, help="For Blocks, the issue that is blocked.")
    link.add_argument("--type", dest="link_type", default="Blocks")

    return parser


def main(argv: list[str]) -> int:
    args = build_parser().parse_args(argv)
    try:
        agent = _agent_from_env(args.key_variable)
        if args.command == "myself":
            me = agent.myself()
            name = me.get("displayName") or me.get("emailAddress") or "unknown"
            print(f"{name} <{me.get('emailAddress', '')}> {me.get('accountId', '')}".strip())
        elif args.command == "create":
            result = agent.create(
                project=args.project,
                summary=args.summary,
                description=_read_text(args.description, args.description_file, "--description"),
                issue_type=args.issue_type,
                points=args.points,
                labels=args.label,
                parent=args.parent,
            )
            print(f"{result['key']} {result['url']}")
        elif args.command == "comment":
            result = agent.comment(args.key, _read_text(args.body, args.body_file, "--body"))
            print(f"{result['key']} {result['url']}")
        elif args.command == "transition":
            result = agent.transition(args.key, args.to, args.transition_id, args.resolution)
            print(f"{result['key']} -> {result['status']} {result['url']}")
        elif args.command == "set":
            result = agent.set_fields(args.key, _json_object(args.fields))
            print(f"{result['key']} {result['url']}")
        else:
            result = agent.link(args.inward, args.outward, args.link_type)
            print(f"{result['type']}: {result['inward']} -> {result['outward']}")
    except AgentError as exc:
        print(f"jira_agent: {exc}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))

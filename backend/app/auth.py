"""HTTP Basic authentication for the shared-password deployment (SCRUM-134).

The public Cloud Run service is protected by one shared password (`APP_PASSWORD`) instead of
per-user accounts. When the variable is unset or empty the middleware does nothing, so local
development, `docker run` and the test suite stay open, exactly as before.
"""

import base64
import binascii
import secrets
from collections.abc import Callable

from starlette.middleware.base import BaseHTTPMiddleware, RequestResponseEndpoint
from starlette.requests import Request
from starlette.responses import Response

from backend.app import config

# Not checked: one password is shared, so only the password is compared.
USERNAME = "wind"

# Monitoring must reach /api/health without credentials (SCRUM-104 decision).
OPEN_PATHS = frozenset({"/api/health"})

REALM = "wind-map"


def _configured_password() -> str:
    """The password in force for this request, read per request so tests can change it."""
    return config.APP_PASSWORD


def parse_basic_auth(header: str | None) -> str | None:
    """The password from an `Authorization: Basic` header, or None when it is absent or malformed."""
    if not header:
        return None
    scheme, _, encoded = header.partition(" ")
    if scheme.lower() != "basic" or not encoded:
        return None
    # Kept as two steps so each failure has its own handler: ruff's formatter would rewrite a
    # single parenthesised except tuple into invalid Python 2 syntax.
    try:
        # validate=True rejects stray characters instead of silently dropping them.
        raw = base64.b64decode(encoded, validate=True)
    except binascii.Error:
        return None
    try:
        decoded = raw.decode("utf-8")
    except UnicodeDecodeError:
        return None
    _, separator, password = decoded.partition(":")
    return password if separator else None


def password_matches(header: str | None, expected: str) -> bool:
    """True when the header carries  `expected`, compared in constant time."""
    supplied = parse_basic_auth(header)
    if supplied is None or not expected:
        return False
    return secrets.compare_digest(supplied.encode("utf-8"), expected.encode("utf-8"))


class BasicAuthMiddleware(BaseHTTPMiddleware):
    """Challenge every request except `open_paths` while a password is configured."""

    def __init__(
        self,
        app,
        password_provider: Callable[[], str] = _configured_password,
        open_paths: frozenset[str] = OPEN_PATHS,
    ):
        super().__init__(app)
        self._password_provider = password_provider
        self._open_paths = frozenset(open_paths)

    async def dispatch(self, request: Request, call_next: RequestResponseEndpoint) -> Response:
        expected = self._password_provider()
        if not expected or request.url.path in self._open_paths:
            return await call_next(request)
        # Neither the header nor the password is ever logged; the 401 alone is.
        if not password_matches(request.headers.get("authorization"), expected):
            return Response(
                content="Authentication required",
                status_code=401,
                headers={"WWW-Authenticate": f'Basic realm="{REALM}"'},
            )
        return await call_next(request)

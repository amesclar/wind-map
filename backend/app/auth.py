"""HTTP Basic authentication for the shared-password deployment (SCRUM-134).

The public Cloud Run service is protected by one shared password (`APP_PASSWORD`) instead of
per-user accounts. When the variable is unset or empty the middleware does nothing, so local
development, `docker run` and the test suite stay open, exactly as before.
"""

import base64
import binascii
import logging
import secrets
from collections.abc import Callable
from math import ceil
from time import monotonic

from starlette.middleware.base import BaseHTTPMiddleware, RequestResponseEndpoint
from starlette.requests import Request
from starlette.responses import Response

from backend.app import config
from backend.app.net import client_ip

logger = logging.getLogger(__name__)

# Not checked: one password is shared, so only the password is compared.
USERNAME = "wind"

# Failed attempts are slowed down (SCRUM-282): the comparison is constant-time and nothing is
# logged about the attempt itself, but a public URL could otherwise be guessed at whatever rate the
# network allows. The counter lives in this process, which is enough for the single-instance
# deployment; a second instance would simply keep its own count.
FAILURE_LIMIT = 5
COOLDOWN_SECONDS = 60

# client address -> (consecutive failures, monotonic time of the last one)
_FAILURES: dict[str, tuple[int, float]] = {}

# Monitoring must reach /api/health without credentials (SCRUM-104 decision).
OPEN_PATHS = frozenset({"/api/health"})

REALM = "wind-map"


def _configured_password() -> str:
    """The password in force for this request, read per request so tests can change it."""
    return config.APP_PASSWORD


def reset_failures() -> None:
    """Forget every recorded failure; the tests use it, production never needs it."""
    _FAILURES.clear()


def _retry_after(address: str, now: float) -> int | None:
    """Seconds to wait before another attempt, or None when the client may try now."""
    count, last = _FAILURES.get(address, (0, 0.0))
    if count < FAILURE_LIMIT:
        return None
    elapsed = now - last
    if elapsed >= COOLDOWN_SECONDS:
        return None
    return max(1, ceil(COOLDOWN_SECONDS - elapsed))


def _record_failure(address: str, now: float) -> None:
    count, _ = _FAILURES.get(address, (0, 0.0))
    _FAILURES[address] = (count + 1, now)


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

        address = client_ip(request)
        now = monotonic()
        wait = _retry_after(address, now)
        if wait is not None:
            # The count, never the header, the password or the attempted value.
            logger.warning("Basic Auth cooling down for %ds after %d failures", wait, FAILURE_LIMIT)
            return Response(
                content="Too many authentication attempts",
                status_code=429,
                headers={"WWW-Authenticate": f'Basic realm="{REALM}"', "Retry-After": str(wait)},
            )

        # Neither the header nor the password is ever logged; the 401 alone is.
        if not password_matches(request.headers.get("authorization"), expected):
            _record_failure(address, now)
            return Response(
                content="Authentication required",
                status_code=401,
                headers={"WWW-Authenticate": f'Basic realm="{REALM}"'},
            )
        _FAILURES.pop(address, None)
        return await call_next(request)

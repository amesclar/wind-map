"""The client address a request really came from (SCRUM-270).

Behind the Cloud Run proxy every request arrives from the same peer, so `request.client.host` is
one address for every browser and any per-IP limit becomes a single shared bucket. `X-Forwarded-For`
names the real client, but it is a client-supplied header: trusting it unconditionally would let
anyone pick their own bucket by sending a different value.
"""

import ipaddress

from starlette.requests import Request

from backend.app import config


def _valid(address: str) -> bool:
    """True when `address` is a literal IP, so a junk header cannot become a bucket key."""
    try:
        ipaddress.ip_address(address)
    except ValueError:
        return False
    return True


def client_ip(request: Request) -> str:
    """The address to key in-memory limits on.

    `X-Forwarded-For` is honoured only when the peer is a configured trusted proxy
    (`TRUSTED_PROXY_IPS`, empty by default), and only its first hop. A malformed header falls back
    to the peer address rather than raising or trusting the rest of the chain.
    """
    peer = request.client.host if request.client else ""
    if not peer:
        return "unknown"
    if peer not in config.TRUSTED_PROXY_IPS:
        return peer
    forwarded = request.headers.get("x-forwarded-for", "")
    first = forwarded.split(",")[0].strip()
    if not first or not _valid(first):
        return peer
    return first

"""Client address resolution behind a proxy (SCRUM-270)."""

import pytest
from starlette.requests import Request

from backend.app import config
from backend.app.net import client_ip


def make_request(peer: str, forwarded: str | None = None) -> Request:
    headers = [] if forwarded is None else [(b"x-forwarded-for", forwarded.encode())]
    return Request({"type": "http", "method": "GET", "path": "/", "client": (peer, 4321), "headers": headers})


def test_the_peer_is_used_when_it_is_not_a_trusted_proxy(monkeypatch):
    # Believing the header by default would let any caller choose its own rate-limit bucket.
    monkeypatch.setattr(config, "TRUSTED_PROXY_IPS", frozenset())

    assert client_ip(make_request("203.0.113.7", "198.51.100.1")) == "203.0.113.7"


def test_the_first_hop_is_used_when_the_peer_is_a_trusted_proxy(monkeypatch):
    monkeypatch.setattr(config, "TRUSTED_PROXY_IPS", frozenset({"10.8.0.2"}))

    request = make_request("10.8.0.2", "198.51.100.1, 10.8.0.2")

    assert client_ip(request) == "198.51.100.1"


def test_two_clients_behind_the_proxy_get_independent_addresses(monkeypatch):
    monkeypatch.setattr(config, "TRUSTED_PROXY_IPS", frozenset({"10.8.0.2"}))

    first = client_ip(make_request("10.8.0.2", "198.51.100.1"))
    second = client_ip(make_request("10.8.0.2", "198.51.100.2"))

    assert first != second


@pytest.mark.parametrize("forwarded", ["", "not-an-ip", ", 10.8.0.2"])
def test_a_malformed_header_falls_back_to_the_peer(monkeypatch, forwarded):
    monkeypatch.setattr(config, "TRUSTED_PROXY_IPS", frozenset({"10.8.0.2"}))

    assert client_ip(make_request("10.8.0.2", forwarded)) == "10.8.0.2"


def test_a_request_without_a_peer_is_unknown(monkeypatch):
    monkeypatch.setattr(config, "TRUSTED_PROXY_IPS", frozenset())

    request = Request({"type": "http", "method": "GET", "path": "/", "headers": []})

    assert client_ip(request) == "unknown"

"""In-memory hourly caps for POST /api/feedback (SCRUM-179).

The endpoint is an unauthenticated ticket proxy, so it has a cap per client IP and a global cap.
State lives in the process: a restart resets it, which is acceptable for one self-hosted container.
"""

import math
import time
from collections import deque

WINDOW_SECONDS = 3600.0
_MAX_TRACKED_IPS = 10_000


class FeedbackLimiter:
    def __init__(self, per_ip: int, global_limit: int, clock=time.monotonic):
        self.per_ip = per_ip
        self.global_limit = global_limit
        self._clock = clock
        self._by_ip: dict[str, deque[float]] = {}
        self._all: deque[float] = deque()

    def _prune(self, hits: deque[float], now: float) -> None:
        while hits and now - hits[0] >= WINDOW_SECONDS:
            hits.popleft()

    def try_acquire(self, ip: str) -> int | None:
        """Record one attempt and return None, or return the seconds to wait when over a cap."""
        now = self._clock()
        self._prune(self._all, now)
        if len(self._by_ip) > _MAX_TRACKED_IPS:
            for key in [k for k, v in self._by_ip.items() if not v or now - v[-1] >= WINDOW_SECONDS]:
                del self._by_ip[key]
        hits = self._by_ip.setdefault(ip, deque())
        self._prune(hits, now)
        for window, limit in ((hits, self.per_ip), (self._all, self.global_limit)):
            if len(window) >= limit:
                return max(1, math.ceil(WINDOW_SECONDS - (now - window[0])))
        hits.append(now)
        self._all.append(now)
        return None

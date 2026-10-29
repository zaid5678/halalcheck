"""A small in-memory, per-client rate limiter for the paid AI endpoint.

It protects the OpenRouter balance on a single server instance. It resets on restart and is not
shared between instances; a production deployment with several instances needs a shared store.
"""

import time
from collections import deque

from app.errors import AppError


class TooManyRequestsError(AppError):
    code = "too_many_requests"
    status_code = 429
    message = "You've reached the limit for ingredient scans. Please try again later."


class SlidingWindowRateLimiter:
    def __init__(self, limit: int, window_seconds: float = 3600) -> None:
        self.limit = limit
        self.window = window_seconds
        self._hits: dict[str, deque[float]] = {}

    def check(self, key: str) -> None:
        """Record a request for ``key``, raising if it is over the limit."""
        if self.limit <= 0:
            return
        now = time.monotonic()
        hits = self._hits.setdefault(key, deque())
        while hits and now - hits[0] > self.window:
            hits.popleft()
        if len(hits) >= self.limit:
            raise TooManyRequestsError()
        hits.append(now)
        # Drop idle clients so memory doesn't grow without bound.
        if len(self._hits) > 10_000:
            self._hits = {k: v for k, v in self._hits.items() if v and now - v[-1] <= self.window}

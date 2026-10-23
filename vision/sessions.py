"""Bounded, expiring references held only in memory."""

import secrets
import time
from collections import OrderedDict


class Sessions:
    def __init__(self, clock=time.monotonic):
        self.clock = clock
        self.items = OrderedDict()

    def expire(self):
        now = self.clock()
        for token, (last_used, _) in list(self.items.items()):
            if now - last_used > 600:
                del self.items[token]

    def add(self, reference):
        self.expire()
        while len(self.items) >= 4:
            self.items.popitem(last=False)
        token = secrets.token_urlsafe(24)
        self.items[token] = (self.clock(), reference)
        return token

    def get(self, token):
        self.expire()
        if token not in self.items:
            raise KeyError("Selection expired. Select the object again.")
        _, reference = self.items.pop(token)
        self.items[token] = (self.clock(), reference)
        return reference

    def clear(self, token):
        self.items.pop(token, None)

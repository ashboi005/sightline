"""One inference worker; one replaceable pending snapshot per connection."""

from __future__ import annotations

import asyncio
from collections import OrderedDict
from collections.abc import Callable
from typing import Any


class LatestInferenceScheduler:
    def __init__(self) -> None:
        self._pending: OrderedDict[object, tuple[Callable, asyncio.Future]] = OrderedDict()
        self._worker: asyncio.Task | None = None
        self._closed = False

    def submit(self, stream: object, operation: Callable[[], Any]) -> asyncio.Future:
        if self._closed:
            raise RuntimeError("inference scheduler is closed")
        previous = self._pending.get(stream)
        if previous and not previous[1].done():
            previous[1].set_result(None)
        # Updating an existing key preserves its waiting position.
        future = asyncio.get_running_loop().create_future()
        self._pending[stream] = (operation, future)
        if self._worker is None or self._worker.done():
            self._worker = asyncio.create_task(self._run())
        return future

    def discard(self, stream: object) -> None:
        job = self._pending.pop(stream, None)
        if job and not job[1].done():
            job[1].set_result(None)

    async def _run(self) -> None:
        while self._pending:
            _, (operation, future) = self._pending.popitem(last=False)
            if future.cancelled():
                continue
            try:
                result = await asyncio.to_thread(operation)
            except Exception as error:
                if not future.done():
                    future.set_exception(error)
            else:
                if not future.done():
                    future.set_result(result)

    async def close(self) -> None:
        self._closed = True
        for stream in list(self._pending):
            self.discard(stream)
        if self._worker is not None:
            await self._worker

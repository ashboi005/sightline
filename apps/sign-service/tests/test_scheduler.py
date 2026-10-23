import asyncio
import threading

from sign_service.scheduler import LatestInferenceScheduler


async def test_one_running_job_and_latest_pending_input_per_stream():
    scheduler = LatestInferenceScheduler()
    entered, release = threading.Event(), threading.Event()

    def blocked():
        entered.set()
        release.wait(3)
        return "first"

    first = scheduler.submit("a", blocked)
    try:
        assert await asyncio.to_thread(entered.wait, 2)
        dropped = scheduler.submit("a", lambda: "old")
        latest = scheduler.submit("a", lambda: "latest")
        other = scheduler.submit("b", lambda: "other")
        assert await dropped is None
        release.set()
        assert await first == "first"
        assert await latest == "latest"
        assert await other == "other"
    finally:
        release.set()
        await scheduler.close()


async def test_discard_resolves_pending_work_without_running_it():
    scheduler = LatestInferenceScheduler()
    pending = scheduler.submit("a", lambda: "must not run")
    scheduler.discard("a")
    assert await pending is None
    await scheduler.close()


async def test_refresh_preserves_another_streams_waiting_position():
    scheduler = LatestInferenceScheduler()
    entered, release = threading.Event(), threading.Event()
    order = []

    def running():
        entered.set()
        release.wait(2)
        return "a0"

    first = scheduler.submit("a", running)
    try:
        assert await asyncio.to_thread(entered.wait, 1)
        old_b = scheduler.submit("b", lambda: order.append("b-old"))
        next_a = scheduler.submit("a", lambda: order.append("a"))
        latest_b = scheduler.submit("b", lambda: order.append("b"))
        release.set()
        await asyncio.gather(first, old_b, next_a, latest_b)
        assert order == ["b", "a"]
    finally:
        release.set()
        await scheduler.close()

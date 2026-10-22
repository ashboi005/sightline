package com.sightline.mobile.stream

import java.util.concurrent.TimeUnit

data class ChannelInfo(
    val id: String,
    val name: String,
    val frameCount: Long,
    /** Epoch milliseconds, or null until the first frame arrives. */
    val lastFrameAt: Long?,
)

/** A bounded, latest-frame mailbox for each camera. Publishing never waits for a viewer. */
class FrameHub {
    private val lock = Any()
    private val registered = linkedMapOf<String, Channel>()

    fun register(id: String, name: String) {
        require(id.isNotBlank()) { "A camera ID is required" }
        synchronized(lock) {
            val existing = registered[id]
            if (existing == null) registered[id] = Channel(id, name)
            else existing.rename(name)
        }
    }

    /** Copies the buffer because capture libraries commonly reuse their frame buffers. */
    fun publish(id: String, jpeg: ByteArray) {
        if (jpeg.isEmpty()) return
        channel(id)?.publish(jpeg)
    }

    fun remove(id: String) {
        synchronized(lock) { registered.remove(id)?.close() }
    }

    fun clear() {
        synchronized(lock) {
            registered.values.forEach { it.close() }
            registered.clear()
        }
    }

    fun channels(): List<ChannelInfo> = synchronized(lock) {
        registered.values.map { it.info() }
    }

    internal fun channel(id: String): Channel? = synchronized(lock) { registered[id] }

    internal data class Frame(val sequence: Long, val jpeg: ByteArray)

    internal class Channel(private val id: String, private var name: String) {
        @Suppress("PLATFORM_CLASS_MAPPED_TO_KOTLIN") // Java monitor supports timed waits and notifyAll.
        private val monitor = Object()
        private var latest: Frame? = null
        private var count = 0L
        private var lastFrameAt: Long? = null

        @Volatile
        var active = true
            private set

        fun rename(name: String) = synchronized(monitor) { this.name = name }

        fun info(): ChannelInfo = synchronized(monitor) {
            ChannelInfo(id, name, count, lastFrameAt)
        }

        fun publish(jpeg: ByteArray) {
            synchronized(monitor) {
                if (!active) return
                latest = Frame(++count, jpeg.copyOf())
                lastFrameAt = System.currentTimeMillis()
                monitor.notifyAll()
            }
        }

        fun snapshot(): Frame? = synchronized(monitor) { latest }

        @Throws(InterruptedException::class)
        fun awaitFrame(after: Long, timeoutMillis: Long): Frame? = synchronized(monitor) {
            val deadline = System.nanoTime() + TimeUnit.MILLISECONDS.toNanos(timeoutMillis)
            while (active && (latest?.sequence ?: 0L) <= after) {
                val remaining = deadline - System.nanoTime()
                if (remaining <= 0L) return@synchronized null
                TimeUnit.NANOSECONDS.timedWait(monitor, remaining)
            }
            if (active) latest?.takeIf { it.sequence > after } else null
        }

        fun close() {
            synchronized(monitor) {
                active = false
                latest = null
                monitor.notifyAll()
            }
        }
    }
}

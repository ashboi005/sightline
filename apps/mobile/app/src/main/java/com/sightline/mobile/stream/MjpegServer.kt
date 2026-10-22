package com.sightline.mobile.stream

import java.io.BufferedInputStream
import java.io.BufferedOutputStream
import java.io.IOException
import java.io.InputStream
import java.net.InetSocketAddress
import java.net.ServerSocket
import java.net.Socket
import java.net.URLDecoder
import java.net.URLEncoder
import java.util.concurrent.ArrayBlockingQueue
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.Executors
import java.util.concurrent.RejectedExecutionException
import java.util.concurrent.Semaphore
import java.util.concurrent.ThreadFactory
import java.util.concurrent.ThreadPoolExecutor
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicInteger

/**
 * Small HTTP server for a trusted local network. It has no authentication or TLS.
 * Each connected viewer has at most one frame in flight; slow viewers skip old frames.
 */
class MjpegServer(private val hub: FrameHub, port: Int = 8080) {
    private val requestedPort = port
    private val lifecycleLock = Any()

    @Volatile
    private var boundPort = port

    @Volatile
    private var running: RunningServer? = null

    /** The actual listening port after start(), including when constructed with port = 0. */
    val port: Int get() = boundPort

    init {
        require(port in 0..65535) { "Port must be between 0 and 65535" }
    }

    /** Idempotent; binding failures are delivered to the caller. */
    @Throws(IOException::class)
    fun start() {
        synchronized(lifecycleLock) {
            if (running != null) return
            val listener = ServerSocket()
            try {
                listener.reuseAddress = true
                listener.bind(InetSocketAddress(requestedPort), MAX_CLIENTS)
                val server = RunningServer(listener)
                running = server
                boundPort = listener.localPort
                server.watchdog.scheduleWithFixedDelay(
                    { closeExpiredClients(server) }, 1, 1, TimeUnit.SECONDS,
                )
                server.acceptThread = Thread({ acceptClients(server) }, "mjpeg-accept").apply {
                    isDaemon = true
                    start()
                }
            } catch (failure: Exception) {
                running?.let { closeServer(it) }
                running = null
                closeQuietly(listener)
                throw failure
            }
        }
    }

    /** Closes active streams and incomplete requests, including blocked socket writes. */
    fun stop() {
        synchronized(lifecycleLock) {
            val server = running ?: return
            running = null
            closeServer(server)
        }
    }

    private fun closeServer(server: RunningServer) {
        server.active.set(false)
        closeQuietly(server.listener)
        server.clients.forEach { closeQuietly(it.socket) }
        server.workers.shutdownNow()
        server.watchdog.shutdownNow()
        server.acceptThread?.interrupt()
    }

    private fun acceptClients(server: RunningServer) {
        while (server.active.get()) {
            val socket = try {
                server.listener.accept()
            } catch (_: IOException) {
                break
            }
            if (!server.active.get() || !server.capacity.tryAcquire()) {
                closeQuietly(socket)
                continue
            }
            val client = Client(socket)
            server.clients.add(client)
            if (!server.active.get()) {
                releaseClient(server, client)
                continue
            }
            try {
                socket.soTimeout = REQUEST_TIMEOUT_MS
                socket.tcpNoDelay = true
                // Keep a stalled viewer's kernel buffer bounded as well as its application state.
                socket.sendBufferSize = 64 * 1024
                server.workers.execute {
                    try {
                        handleClient(server, client)
                    } finally {
                        releaseClient(server, client)
                    }
                }
            } catch (_: IOException) {
                releaseClient(server, client)
            } catch (_: RejectedExecutionException) {
                releaseClient(server, client)
            }
        }
    }

    private fun releaseClient(server: RunningServer, client: Client) {
        closeQuietly(client.socket)
        if (server.clients.remove(client)) server.capacity.release()
    }

    private fun closeExpiredClients(server: RunningServer) {
        val now = System.nanoTime()
        server.clients.forEach { client ->
            val requestExpired = !client.requestComplete &&
                now - client.connectedAt > TimeUnit.MILLISECONDS.toNanos(REQUEST_TIMEOUT_MS.toLong())
            val writingSince = client.writingSince
            val writeExpired = writingSince != 0L &&
                now - writingSince > TimeUnit.MILLISECONDS.toNanos(WRITE_TIMEOUT_MS.toLong())
            if (requestExpired || writeExpired || client.channel?.active == false) {
                closeQuietly(client.socket)
            }
        }
    }

    private fun handleClient(server: RunningServer, client: Client) {
        try {
            val output = BufferedOutputStream(client.socket.getOutputStream(), 16 * 1024)
            try {
                val request = readRequest(BufferedInputStream(client.socket.getInputStream()))
                client.requestComplete = true
                if (request.method != "GET") {
                    respond(client, output, 405, "Method Not Allowed", "Use GET\n", mapOf("Allow" to "GET"))
                    return
                }
                when (request.path) {
                    "/" -> respond(
                        client, output, 200, "OK", dashboard(),
                        mapOf(
                            "Content-Type" to "text/html; charset=utf-8",
                            "Content-Security-Policy" to "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'",
                        ),
                    )
                    "/health" -> respond(
                        client, output, 200, "OK", "{\"status\":\"ok\",\"cameras\":${hub.channels().size}}",
                        mapOf("Content-Type" to "application/json; charset=utf-8"),
                    )
                    else -> cameraRequest(server, client, output, request.path)
                }
            } catch (failure: RequestFailure) {
                respond(client, output, failure.status, failure.reason, "${failure.reason}\n")
            }
        } catch (_: IOException) {
            // A viewer disconnected or the watchdog/stop() closed its socket.
        } catch (_: InterruptedException) {
            Thread.currentThread().interrupt()
        }
    }

    private fun cameraRequest(server: RunningServer, client: Client, output: BufferedOutputStream, path: String) {
        val match = CAMERA_PATH.matchEntire(path)
        if (match == null) {
            respond(client, output, 404, "Not Found", "Not found\n")
            return
        }
        val id = try {
            URLDecoder.decode(match.groupValues[1], "UTF-8")
        } catch (_: IllegalArgumentException) {
            throw RequestFailure(400, "Bad Request")
        }
        val channel = hub.channel(id)
        if (channel == null || !channel.active) {
            respond(client, output, 404, "Not Found", "Camera not found\n")
            return
        }
        client.channel = channel
        if (match.groupValues[2] == "snapshot.jpg") {
            val frame = channel.snapshot()
            if (frame == null) {
                respond(client, output, 503, "Service Unavailable", "Waiting for a camera frame\n", mapOf("Retry-After" to "1"))
            } else {
                respond(client, output, 200, "OK", frame.jpeg, mapOf("Content-Type" to "image/jpeg"))
            }
            return
        }
        write(client) {
            output.write(
                ("HTTP/1.1 200 OK\r\n" +
                    "Content-Type: multipart/x-mixed-replace; boundary=$BOUNDARY\r\n" +
                    "Cache-Control: no-store\r\n" +
                    "X-Content-Type-Options: nosniff\r\n" +
                    "Connection: close\r\n\r\n").toByteArray(Charsets.US_ASCII),
            )
            output.flush()
        }
        var lastSequence = 0L
        while (server.active.get() && channel.active && !client.socket.isClosed) {
            val frame = channel.awaitFrame(lastSequence, 1_000) ?: continue
            write(client) {
                output.write(
                    ("--$BOUNDARY\r\nContent-Type: image/jpeg\r\n" +
                        "Content-Length: ${frame.jpeg.size}\r\n\r\n").toByteArray(Charsets.US_ASCII),
                )
                output.write(frame.jpeg)
                output.write(CRLF)
                output.flush()
            }
            lastSequence = frame.sequence
        }
        if (server.active.get() && !client.socket.isClosed) {
            write(client) {
                output.write("--$BOUNDARY--\r\n".toByteArray(Charsets.US_ASCII))
                output.flush()
            }
        }
    }

    private fun readRequest(input: InputStream): Request {
        val firstLine = readLine(input, MAX_REQUEST_LINE, 414)
        val parts = firstLine.split(' ')
        if (parts.size != 3 || parts[0].isBlank() ||
            parts[2] !in setOf("HTTP/1.0", "HTTP/1.1") ||
            !parts[1].startsWith('/') || parts[1].startsWith("//")
        ) throw RequestFailure(400, "Bad Request")
        var totalBytes = firstLine.length + 2
        var headerCount = 0
        while (true) {
            val line = readLine(input, MAX_HEADER_LINE, 431)
            totalBytes += line.length + 2
            if (totalBytes > MAX_HEADER_BYTES || ++headerCount > MAX_HEADERS) {
                throw RequestFailure(431, "Request Header Fields Too Large")
            }
            if (line.isEmpty()) break
            if (line.indexOf(':') <= 0 || line[0].isWhitespace()) throw RequestFailure(400, "Bad Request")
        }
        return Request(parts[0], parts[1].substringBefore('?'))
    }

    private fun readLine(input: InputStream, limit: Int, tooLongStatus: Int): String {
        val line = StringBuilder()
        while (true) {
            val next = input.read()
            if (next == -1) throw IOException("Request ended before its headers")
            if (next == '\r'.code) {
                if (input.read() != '\n'.code) throw RequestFailure(400, "Bad Request")
                return line.toString()
            }
            if (next < 0x20 || next == 0x7f) throw RequestFailure(400, "Bad Request")
            if (line.length >= limit) {
                throw RequestFailure(tooLongStatus, if (tooLongStatus == 414) "URI Too Long" else "Request Header Fields Too Large")
            }
            line.append(next.toChar())
        }
    }

    private fun respond(
        client: Client,
        output: BufferedOutputStream,
        status: Int,
        reason: String,
        body: String,
        headers: Map<String, String> = emptyMap(),
    ) = respond(client, output, status, reason, body.toByteArray(Charsets.UTF_8), headers)

    private fun respond(
        client: Client,
        output: BufferedOutputStream,
        status: Int,
        reason: String,
        body: ByteArray,
        headers: Map<String, String>,
    ) {
        write(client) {
            val responseHeaders = linkedMapOf(
                "Content-Type" to "text/plain; charset=utf-8",
                "Content-Length" to body.size.toString(),
                "Cache-Control" to "no-store",
                "X-Content-Type-Options" to "nosniff",
                "Connection" to "close",
            ) + headers
            val head = buildString {
                append("HTTP/1.1 $status $reason\r\n")
                responseHeaders.forEach { (key, value) -> append("$key: $value\r\n") }
                append("\r\n")
            }
            output.write(head.toByteArray(Charsets.US_ASCII))
            output.write(body)
            output.flush()
        }
    }

    private inline fun write(client: Client, action: () -> Unit) {
        client.writingSince = System.nanoTime()
        try {
            action()
        } finally {
            client.writingSince = 0L
        }
    }

    private fun dashboard(): String {
        val cameras = hub.channels()
        return buildString {
            append("""<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Sightline cameras</title><style>body{font:16px system-ui,sans-serif;background:#10151c;color:#eef3f9;margin:0;padding:24px}main{max-width:1100px;margin:auto}h1{margin-bottom:8px}p{color:#acbacb}section{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,320px),1fr));gap:20px}article{padding:16px;background:#1b2634;border-radius:12px}h2{font-size:19px;overflow-wrap:anywhere}img{display:block;width:100%;min-height:160px;object-fit:contain;background:#090d12;border-radius:6px}a{color:#8acbff;margin-right:16px}small{display:block;color:#acbacb;margin:12px 0}</style></head><body><main><h1>Sightline cameras</h1>""")
            append("<p>${cameras.size} camera(s) connected. Refresh this page after connecting or disconnecting a camera.</p>")
            if (cameras.isEmpty()) append("<p>Connect a USB camera and grant camera access on the phone to begin.</p>")
            append("<section>")
            cameras.forEach { camera ->
                val path = "/camera/${URLEncoder.encode(camera.id, "UTF-8").replace("+", "%20")}"
                val name = escapeHtml(camera.name)
                append("<article><h2>$name</h2><img src=\"$path/stream\" alt=\"$name live camera\">")
                append("<small>${camera.frameCount} frame(s) captured when this page loaded</small>")
                append("<a href=\"$path/stream\">Open stream</a><a href=\"$path/snapshot.jpg\">Snapshot</a></article>")
            }
            append("</section></main></body></html>")
        }
    }

    private fun escapeHtml(value: String): String = value
        .replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
        .replace("\"", "&quot;").replace("'", "&#39;")

    private data class Request(val method: String, val path: String)
    private class RequestFailure(val status: Int, val reason: String) : Exception(reason)

    private class Client(val socket: Socket) {
        val connectedAt = System.nanoTime()
        @Volatile var requestComplete = false
        @Volatile var writingSince = 0L
        @Volatile var channel: FrameHub.Channel? = null
    }

    private class RunningServer(val listener: ServerSocket) {
        val active = AtomicBoolean(true)
        val capacity = Semaphore(MAX_CLIENTS)
        val clients = ConcurrentHashMap.newKeySet<Client>()
        val workers = ThreadPoolExecutor(
            MAX_CLIENTS, MAX_CLIENTS, 0, TimeUnit.MILLISECONDS,
            ArrayBlockingQueue(MAX_CLIENTS), daemonThreads("mjpeg-client"),
        )
        val watchdog = Executors.newSingleThreadScheduledExecutor(daemonThreads("mjpeg-watchdog"))
        var acceptThread: Thread? = null
    }

    companion object {
        private const val MAX_CLIENTS = 12
        private const val REQUEST_TIMEOUT_MS = 5_000
        private const val WRITE_TIMEOUT_MS = 5_000
        private const val MAX_REQUEST_LINE = 4_096
        private const val MAX_HEADER_LINE = 4_096
        private const val MAX_HEADER_BYTES = 16_384
        private const val MAX_HEADERS = 100
        private const val BOUNDARY = "sightline-frame"
        private val CRLF = byteArrayOf(13, 10)
        private val CAMERA_PATH = Regex("^/camera/([^/]+)/(stream|snapshot\\.jpg)$")

        private fun daemonThreads(prefix: String): ThreadFactory {
            val nextId = AtomicInteger()
            return ThreadFactory { action ->
                Thread(action, "$prefix-${nextId.incrementAndGet()}").apply { isDaemon = true }
            }
        }

        private fun closeQuietly(closeable: java.io.Closeable) {
            try {
                closeable.close()
            } catch (_: IOException) {
                // Already closed or disconnected.
            }
        }
    }
}

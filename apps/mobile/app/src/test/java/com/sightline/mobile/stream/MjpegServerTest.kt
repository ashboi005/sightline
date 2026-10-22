package com.sightline.mobile.stream

import java.io.BufferedInputStream
import java.io.Closeable
import java.io.EOFException
import java.io.InputStream
import java.net.Socket
import java.net.SocketException
import java.net.InetSocketAddress
import org.junit.After
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

/** These tests use real loopback sockets and the production HTTP server. */
class MjpegServerTest {
    private lateinit var hub: FrameHub
    private lateinit var server: MjpegServer

    @Before
    fun startServer() {
        hub = FrameHub()
        server = MjpegServer(hub, 0)
        server.start()
    }

    @After
    fun stopServer() {
        server.stop()
    }

    @Test(timeout = 5_000)
    fun streamUsesMultipartHeadersAndExactJpegFraming() {
        hub.register("camera-1", "Desk camera")
        val jpeg = jpeg(1)
        hub.publish("camera-1", jpeg)

        request("/camera/camera-1/stream").use { response ->
            assertEquals(200, response.status)
            assertEquals("multipart/x-mixed-replace; boundary=sightline-frame", response.headers["content-type"])
            assertEquals("no-store", response.headers["cache-control"])
            assertArrayEquals(jpeg, response.readFrame())
        }
    }

    @Test(timeout = 5_000)
    fun eachViewerReceivesTheSamePublishedFrames() {
        hub.register("camera-1", "Desk camera")
        request("/camera/camera-1/stream").use { first ->
            request("/camera/camera-1/stream").use { second ->
                val frameOne = jpeg(1)
                hub.publish("camera-1", frameOne)
                assertArrayEquals(frameOne, first.readFrame())
                assertArrayEquals(frameOne, second.readFrame())

                val frameTwo = jpeg(2)
                hub.publish("camera-1", frameTwo)
                assertArrayEquals(frameTwo, first.readFrame())
                assertArrayEquals(frameTwo, second.readFrame())
            }
        }
    }

    @Test(timeout = 5_000)
    fun camerasHaveIndependentStreamAndSnapshotUrls() {
        hub.register("one", "Camera one")
        hub.register("two", "Camera two")
        hub.publish("one", jpeg(1))
        hub.publish("two", jpeg(2))

        request("/camera/one/stream").use { response ->
            assertArrayEquals(jpeg(1), response.readFrame())
        }
        request("/camera/two/snapshot.jpg").use { response ->
            assertEquals(200, response.status)
            assertEquals("image/jpeg", response.headers["content-type"])
            assertArrayEquals(jpeg(2), response.readBody())
        }
    }

    @Test(timeout = 5_000)
    fun snapshotUsesLatestCopiedFrame() {
        hub.register("camera-1", "Desk camera")
        hub.publish("camera-1", jpeg(1))
        val latest = jpeg(2)
        hub.publish("camera-1", latest)
        latest.fill(0)

        request("/camera/camera-1/snapshot.jpg").use { response ->
            assertEquals(200, response.status)
            assertArrayEquals(jpeg(2), response.readBody())
        }
        val info = hub.channels().single()
        assertEquals(2L, info.frameCount)
        assertNotNull(info.lastFrameAt)
    }

    @Test(timeout = 5_000)
    fun unknownCameraReturns404AndAnUnreadySnapshotReturns503() {
        request("/camera/missing/stream").use { assertEquals(404, it.status) }
        request("/camera/missing/snapshot.jpg").use { assertEquals(404, it.status) }
        hub.register("camera-1", "Desk camera")
        request("/camera/camera-1/snapshot.jpg").use {
            assertEquals(503, it.status)
            assertEquals("1", it.headers["retry-after"])
        }
    }

    @Test(timeout = 5_000)
    fun removingCameraReleasesAViewerWaitingForItsFirstFrame() {
        hub.register("camera-1", "Desk camera")
        request("/camera/camera-1/stream").use { response ->
            assertEquals(200, response.status)
            hub.remove("camera-1")
            response.assertConnectionClosed()
        }
        request("/camera/camera-1/stream").use { assertEquals(404, it.status) }
        assertTrue(hub.channels().isEmpty())
    }

    @Test(timeout = 5_000)
    fun clearingCamerasReleasesAllStreams() {
        hub.register("one", "One")
        hub.register("two", "Two")
        request("/camera/one/stream").use { first ->
            request("/camera/two/stream").use { second ->
                hub.clear()
                first.assertConnectionClosed()
                second.assertConnectionClosed()
            }
        }
    }

    @Test(timeout = 5_000)
    fun stoppingClosesActiveStreamsAndIncompleteRequests() {
        hub.register("camera-1", "Desk camera")
        request("/camera/camera-1/stream").use { response ->
            Socket("127.0.0.1", server.port).use { incomplete ->
                incomplete.soTimeout = 2_000
                incomplete.getOutputStream().write("GET / HTTP/1.1\r\n".toByteArray())
                server.stop()
                response.assertConnectionClosed()
                assertClosed(incomplete.getInputStream())
            }
        }
        server.stop()
    }

    @Test(timeout = 5_000)
    fun stoppedServerCanRestartAndStartIsIdempotent() {
        val originalPort = server.port
        assertTrue(originalPort > 0)
        server.start()
        assertEquals(originalPort, server.port)
        server.stop()
        server.start()
        request("/health").use {
            assertEquals(200, it.status)
            assertEquals("{\"status\":\"ok\",\"cameras\":0}", it.readBody().toString(Charsets.UTF_8))
        }
    }

    @Test(timeout = 5_000)
    fun dashboardEscapesCameraNamesAndEncodesCameraIds() {
        hub.register("usb/one + two", "<script>\"Desk\" & 'camera'</script>")
        request("/").use {
            val html = it.readBody().toString(Charsets.UTF_8)
            assertTrue(html.contains("&lt;script&gt;&quot;Desk&quot; &amp; &#39;camera&#39;&lt;/script&gt;"))
            assertFalse(html.contains("<script>"))
            assertTrue(html.contains("/camera/usb%2Fone%20%2B%20two/stream"))
        }
        hub.publish("usb/one + two", jpeg(1))
        request("/camera/usb%2Fone%20%2B%20two/snapshot.jpg").use {
            assertEquals(200, it.status)
            assertArrayEquals(jpeg(1), it.readBody())
        }
    }

    @Test(timeout = 5_000)
    fun oversizedRequestsAndUnsupportedMethodsAreRejected() {
        request("/", method = "POST").use {
            assertEquals(405, it.status)
            assertEquals("GET", it.headers["allow"])
        }
        request("/${"a".repeat(4_100)}").use { assertEquals(414, it.status) }
        request("/", extraHeaders = "X-Large: ${"a".repeat(4_100)}\r\n").use {
            assertEquals(431, it.status)
        }
        request("/camera/%invalid/stream").use { assertEquals(400, it.status) }
    }

    @Test(timeout = 5_000)
    fun activeConnectionsAreBounded() {
        hub.register("camera-1", "Desk camera")
        val viewers = mutableListOf<Response>()
        try {
            repeat(12) { viewers.add(request("/camera/camera-1/stream")) }
            Socket("127.0.0.1", server.port).use { extra ->
                extra.soTimeout = 2_000
                assertClosed(extra.getInputStream())
            }
        } finally {
            viewers.forEach { it.close() }
        }
    }

    @Test(timeout = 5_000)
    fun stalledViewerDoesNotBlockPublishingOrOtherViewers() {
        hub.register("camera-1", "Desk camera")
        val socket = Socket().apply {
            receiveBufferSize = 1_024
            soTimeout = 2_000
            connect(InetSocketAddress("127.0.0.1", server.port))
        }
        socket.getOutputStream().write("GET /camera/camera-1/stream HTTP/1.1\r\nHost: localhost\r\n\r\n".toByteArray())
        Response(socket).use { stalled ->
            val largeFrame = ByteArray(3 * 1_024 * 1_024) { 0x55.toByte() }
            hub.publish("camera-1", largeFrame)
            assertEquals(largeFrame.size, stalled.readFrameLength())
            // Leave the body unread so this viewer's socket write cannot finish.
            repeat(20) { hub.publish("camera-1", jpeg(it)) }

            request("/camera/camera-1/snapshot.jpg").use { healthy ->
                assertEquals(200, healthy.status)
                assertArrayEquals(jpeg(19), healthy.readBody())
            }
            assertEquals(21L, hub.channels().single().frameCount)
            server.stop()
        }
    }

    private fun request(path: String, method: String = "GET", extraHeaders: String = ""): Response {
        val socket = Socket("127.0.0.1", server.port)
        socket.soTimeout = 2_000
        try {
            val request = "$method $path HTTP/1.1\r\nHost: localhost\r\n${extraHeaders}Connection: close\r\n\r\n"
            socket.getOutputStream().write(request.toByteArray(Charsets.US_ASCII))
            socket.getOutputStream().flush()
            return Response(socket)
        } catch (failure: Exception) {
            socket.close()
            throw failure
        }
    }

    private class Response(private val socket: Socket) : Closeable {
        private val input = BufferedInputStream(socket.getInputStream())
        val status = readLine(input).split(' ')[1].toInt()
        val headers = readHeaders(input)

        fun readBody(): ByteArray = readExactly(input, headers.getValue("content-length").toInt())

        fun readFrame(): ByteArray {
            val jpeg = readExactly(input, readFrameLength())
            assertEquals("", readLine(input))
            return jpeg
        }

        fun readFrameLength(): Int {
            assertEquals("--sightline-frame", readLine(input))
            val partHeaders = readHeaders(input)
            assertEquals("image/jpeg", partHeaders["content-type"])
            return partHeaders.getValue("content-length").toInt()
        }

        fun assertConnectionClosed() = assertClosed(input)
        override fun close() = socket.close()
    }

    companion object {
        // Distinct payloads exercise byte-for-byte transport, without a camera or JPEG decoder.
        private fun jpeg(value: Int) = byteArrayOf(0xff.toByte(), 0xd8.toByte(), value.toByte(), 0xff.toByte(), 0xd9.toByte())

        private fun readLine(input: InputStream): String {
            val line = StringBuilder()
            while (true) {
                val next = input.read()
                if (next == -1) throw EOFException("Missing HTTP line")
                if (next == '\r'.code) {
                    assertEquals('\n'.code, input.read())
                    return line.toString()
                }
                line.append(next.toChar())
            }
        }

        private fun readHeaders(input: InputStream): Map<String, String> {
            val headers = linkedMapOf<String, String>()
            while (true) {
                val line = readLine(input)
                if (line.isEmpty()) return headers
                val separator = line.indexOf(':')
                headers[line.substring(0, separator).lowercase()] = line.substring(separator + 1).trim()
            }
        }

        private fun readExactly(input: InputStream, size: Int): ByteArray {
            val result = ByteArray(size)
            var offset = 0
            while (offset < result.size) {
                val count = input.read(result, offset, result.size - offset)
                if (count < 0) throw EOFException("Truncated HTTP body")
                offset += count
            }
            return result
        }

        private fun assertClosed(input: InputStream) {
            try {
                while (input.read() != -1) {
                    // Consume an optional closing multipart boundary before EOF.
                }
            } catch (_: SocketException) {
                // A reset is also a completed close; timeouts intentionally fail the test.
            }
        }
    }
}

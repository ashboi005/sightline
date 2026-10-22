package com.sightline.mobile.camera

import android.graphics.ImageFormat
import android.media.Image

internal data class Nv21Frame(val pixels: ByteArray, val width: Int, val height: Int)

/** Honors crop, row padding and chroma pixel strides instead of assuming packed planes. */
internal fun copyPhoneFrame(image: Image): Nv21Frame {
    require(image.format == ImageFormat.YUV_420_888) { "Expected a YUV camera frame." }
    val crop = image.cropRect
    val width = crop.width()
    val height = crop.height()
    require(width > 0 && height > 0 && width % 2 == 0 && height % 2 == 0 && crop.left % 2 == 0 && crop.top % 2 == 0) {
        "Camera returned an unsupported YUV crop."
    }
    val pixels = ByteArray(Math.toIntExact(width.toLong() * height * 3 / 2))
    image.planes.forEachIndexed { planeIndex, plane ->
        val chroma = planeIndex != 0
        val planeWidth = if (chroma) width / 2 else width
        val planeHeight = if (chroma) height / 2 else height
        val left = if (chroma) crop.left / 2 else crop.left
        val top = if (chroma) crop.top / 2 else crop.top
        val buffer = plane.buffer.duplicate()
        val start = buffer.position() + top * plane.rowStride + left * plane.pixelStride
        val outputStart = when (planeIndex) { 0 -> 0; 1 -> width * height + 1; else -> width * height }
        val outputStride = if (chroma) 2 else 1
        for (row in 0 until planeHeight) {
            val inputRow = start + row * plane.rowStride
            require(inputRow + (planeWidth - 1) * plane.pixelStride < buffer.limit()) { "Camera returned an incomplete YUV plane." }
            val outputRow = outputStart + row * planeWidth * outputStride
            if (plane.pixelStride == 1 && outputStride == 1) {
                buffer.position(inputRow)
                buffer.get(pixels, outputRow, planeWidth)
            } else for (column in 0 until planeWidth) {
                pixels[outputRow + column * outputStride] = buffer.get(inputRow + column * plane.pixelStride)
            }
        }
    }
    return Nv21Frame(pixels, width, height)
}

/** Rotate actual JPEG pixels; MJPEG browser clients need no EXIF or CSS transform support. */
internal fun Nv21Frame.rotated(degrees: Int): Nv21Frame {
    require(degrees in listOf(0, 90, 180, 270))
    if (degrees == 0) return this
    val outWidth = if (degrees == 180) width else height
    val outHeight = if (degrees == 180) height else width
    val output = ByteArray(pixels.size)
    fun rotatePlane(inputOffset: Int, outputOffset: Int, planeWidth: Int, planeHeight: Int, bytesPerPixel: Int) {
        val targetWidth = if (degrees == 180) planeWidth else planeHeight
        for (y in 0 until planeHeight) for (x in 0 until planeWidth) {
            val targetX = when (degrees) { 90 -> planeHeight - 1 - y; 180 -> planeWidth - 1 - x; else -> y }
            val targetY = when (degrees) { 90 -> x; 180 -> planeHeight - 1 - y; else -> planeWidth - 1 - x }
            val src = inputOffset + (y * planeWidth + x) * bytesPerPixel
            val dst = outputOffset + (targetY * targetWidth + targetX) * bytesPerPixel
            for (byte in 0 until bytesPerPixel) output[dst + byte] = pixels[src + byte]
        }
    }
    rotatePlane(0, 0, width, height, 1)
    rotatePlane(width * height, outWidth * outHeight, width / 2, height / 2, 2)
    return Nv21Frame(output, outWidth, outHeight)
}

package com.sightline.mobile.camera

enum class CameraKind { USB, PHONE }

/** Shared display model; IDs are stable URL-safe keys, independent of the capture backend. */
data class CameraSource(
    val id: String,
    val name: String,
    val detail: String,
    val status: String = "Ready",
    val streaming: Boolean = false,
    val kind: CameraKind = CameraKind.USB,
)

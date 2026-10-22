package com.sightline.mobile.camera

import android.graphics.ImageFormat
import android.hardware.camera2.CameraCharacteristics
import android.hardware.camera2.CameraManager
import android.os.Build
import android.util.Size
import java.util.Locale

internal data class PhoneCamera(
    val source: CameraSource,
    val deviceId: String,
    val physicalId: String?,
    val characteristics: CameraCharacteristics,
    val hardwareIds: Set<String>,
) {
    val sizes: List<Size> get() = characteristics.get(CameraCharacteristics.SCALER_STREAM_CONFIGURATION_MAP)
        ?.getOutputSizes(ImageFormat.YUV_420_888)?.toList().orEmpty()
}

/** Lists public cameras and readable physical lenses behind logical camera devices. */
internal class PhoneCameraCatalog(private val manager: CameraManager) {
    fun read(): List<PhoneCamera> {
        val publicIds = manager.cameraIdList.toSet()
        val result = mutableListOf<PhoneCamera>()
        val physicalIdsAdded = mutableSetOf<String>()
        for (id in publicIds.sorted()) {
            val characteristics = runCatching { manager.getCameraCharacteristics(id) }.getOrNull() ?: continue
            // External Camera2 IDs can alias USB devices already handled by the UVC backend.
            if (characteristics.get(CameraCharacteristics.LENS_FACING) == CameraCharacteristics.LENS_FACING_EXTERNAL) continue
            val physicalIds = if (Build.VERSION.SDK_INT >= 28) characteristics.physicalCameraIds else emptySet()
            val root = descriptor(id, null, characteristics, physicalIds.ifEmpty { setOf(id) })
            if (root.sizes.isNotEmpty()) result += root
            if (Build.VERSION.SDK_INT >= 28) for (physicalId in physicalIds.sorted()) {
                if (physicalId in publicIds || physicalId in physicalIdsAdded) continue
                val physical = runCatching { manager.getCameraCharacteristics(physicalId) }.getOrNull() ?: continue
                val lens = descriptor(id, physicalId, physical, setOf(physicalId))
                if (lens.sizes.isNotEmpty()) {
                    result += lens
                    physicalIdsAdded += physicalId
                }
            }
        }
        return result
    }

    fun selectionError(selected: List<PhoneCamera>): String? {
        for (i in selected.indices) for (j in i + 1 until selected.size) {
            if (selected[i].hardwareIds.intersect(selected[j].hardwareIds).isNotEmpty()) {
                return "${selected[i].source.name} and ${selected[j].source.name} use the same camera hardware. Select one of them."
            }
        }
        val groups = selected.groupBy { it.deviceId }
        if (groups.values.any { it.size > 2 }) return "Select at most two individual lenses from the same rear or front camera group."
        if (groups.size <= 1) return null
        if (Build.VERSION.SDK_INT < 30) return "This Android version cannot report supported simultaneous phone cameras. Select one phone camera; you can also select USB cameras."
        return if (manager.concurrentCameraIds.any { it.containsAll(groups.keys) }) null
        else "This phone does not report support for those phone cameras together. Select a front or rear camera individually, or combine one with USB cameras."
    }

    private fun descriptor(deviceId: String, physicalId: String?, characteristics: CameraCharacteristics, hardware: Set<String>): PhoneCamera {
        val facing = when (characteristics.get(CameraCharacteristics.LENS_FACING)) {
            CameraCharacteristics.LENS_FACING_FRONT -> "Front / selfie"
            CameraCharacteristics.LENS_FACING_BACK -> "Rear"
            else -> "Phone"
        }
        val focal = characteristics.get(CameraCharacteristics.LENS_INFO_AVAILABLE_FOCAL_LENGTHS)?.firstOrNull()
        val lensLabel = if (physicalId != null && focal != null) " lens · ${String.format(Locale.US, "%.1f", focal)} mm" else " camera"
        val id = "phone-${deviceId.hexKey()}" + (physicalId?.let { "-lens-${it.hexKey()}" } ?: "")
        val name = "$facing$lensLabel (${physicalId ?: deviceId})"
        val detail = if (physicalId != null) "Phone lens · shares camera group $deviceId" else "Built-in phone camera"
        return PhoneCamera(CameraSource(id, name, detail, kind = CameraKind.PHONE), deviceId, physicalId, characteristics, hardware)
    }
}

private fun String.hexKey(): String = toByteArray(Charsets.UTF_8).joinToString("") { "%02x".format(it.toInt() and 0xff) }

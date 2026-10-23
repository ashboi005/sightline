#include "app_shared.h"
#include <esp_heap_caps.h>
#include <esp_http_server.h>
#include <freertos/FreeRTOS.h>
#include <freertos/queue.h>
#include <freertos/semphr.h>
#include <freertos/task.h>
#include <fcntl.h>
#include <unistd.h>

namespace {
constexpr size_t kFrameSlots = 6;
constexpr size_t kFrameCapacity = 160 * 1024;
constexpr size_t kRecordingQueueDepth = 2;
constexpr size_t kSdWriteBufferSize = 8 * 1024;
constexpr uint8_t kDriverFrameBuffers = 2;
constexpr int kCapturePreviewCore = 1;
constexpr int kSdWriterCore = 0;
constexpr uint16_t kPreviewPort = 81;
constexpr uint8_t kJpegQuality = 12;
// Capture the OV3660's final MCU in full; hide its unused portrait edge.
constexpr uint16_t kPortraitJpegWidth = ((kCameraPortraitWidth + 15) / 16) * 16;

struct Frame {
  uint8_t* data = nullptr;
  size_t length = 0;
  uint32_t capturedAt = 0;
  uint32_t sequence = 0;
  uint8_t references = 0;
};

Frame sFrames[kFrameSlots];
Frame* sLatest = nullptr;
SemaphoreHandle_t sMutex = nullptr;
QueueHandle_t sRecordQueue = nullptr;
TaskHandle_t sCaptureTask = nullptr;
TaskHandle_t sWriterTask = nullptr;
uint8_t* sSdWriteBuffer = nullptr;  // Internal DMA memory; owned by the SD worker.
httpd_handle_t sPreviewServer = nullptr;
MediaStatus sStatus;
bool sPreviewEnabled = false;
bool sAcceptRecording = false;
uint32_t sPreviewGeneration = 0;
uint32_t sRecordingStartedAt = 0;
char sRecordingDirectory[96] = {};
struct JpegGeometry {
  uint16_t encodedWidth = 0;
  uint16_t height = 0;
  uint16_t outputWidth = 0;
};
JpegGeometry sGeometry;
bool sPortraitCapture = false;
uint16_t sSensorMaxWidth = 2048;
uint16_t sSensorMaxHeight = 1536;

class MediaLock {
 public:
  MediaLock() { xSemaphoreTake(sMutex, portMAX_DELAY); }
  ~MediaLock() { xSemaphoreGive(sMutex); }
  MediaLock(const MediaLock&) = delete;
  MediaLock& operator=(const MediaLock&) = delete;
};

void releaseFrame(Frame* frame) {
  if (frame) {
    MediaLock lock;
    configASSERT(frame->references > 0);
    --frame->references;
  }
}

Frame* reserveFrame() {
  MediaLock lock;
  for (Frame& frame : sFrames) {
    if (frame.references == 0) {
      frame.references = 1;  // The producer owns the slot until publication.
      return &frame;
    }
  }
  if (sAcceptRecording) ++sStatus.recordingDropped;
  return nullptr;
}

void failRecording(MediaError error) {
  MediaLock lock;
  if (sStatus.recording) {
    if (sStatus.error == MediaError::None) sStatus.error = error;
    sAcceptRecording = false;
    sStatus.stopping = true;
  }
}

void publishFrame(Frame* frame) {
  MediaLock lock;
  frame->sequence = ++sStatus.capturedFrames;
  if (sPreviewEnabled) {
    if (sLatest) --sLatest->references;
    sLatest = frame;
    ++frame->references;
  }
  // Enqueue and stop share the mutex. I/O and blocking queue operations never
  // run in this lock. A frame captured before this session must not enter it.
  if (sAcceptRecording && static_cast<int32_t>(frame->capturedAt - sRecordingStartedAt) >= 0) {
    ++frame->references;
    if (xQueueSend(sRecordQueue, &frame, 0) != pdTRUE) {
      --frame->references;
      ++sStatus.recordingDropped;
    }
  }
  --frame->references;  // Release the producer's reference.
}

struct JpegDiagnostics {
  uint16_t width = 0;
  uint16_t height = 0;
  uint8_t sofMarker = 0;
  uint8_t components = 0;
  uint8_t sampling[3] = {};
  const char* reason = "Invalid JPEG header";
};

bool prepareCameraJpeg(camera_fb_t& frame, JpegDiagnostics* diagnostics = nullptr) {
  // fb->width/height still describe the SDK buffer preset after set_res_raw.
  // Read the baseline JPEG's own SOF header and check the selected orientation.
  uint8_t* data = frame.buf;
  if (diagnostics) *diagnostics = JpegDiagnostics();
  if (!data || frame.len < 4 || data[0] != 0xff || data[1] != 0xd8) return false;
  size_t offset = 2;
  while (offset < frame.len) {
    if (data[offset++] != 0xff) return false;
    while (offset < frame.len && data[offset] == 0xff) ++offset;
    if (offset == frame.len) return false;
    const uint8_t marker = data[offset++];
    if (marker == 0xda || marker == 0xd9 || marker == 0 || marker == 0xd8) return false;
    if (marker == 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
    if (frame.len - offset < 2) return false;
    const size_t length = (static_cast<size_t>(data[offset]) << 8) | data[offset + 1];
    if (length < 2 || length > frame.len - offset) return false;
    if (marker >= 0xc0 && marker <= 0xcf && marker != 0xc4 && marker != 0xc8 && marker != 0xcc) {
      if (diagnostics) diagnostics->sofMarker = marker;
      if (length >= 8 && diagnostics) {
        diagnostics->height = (data[offset + 3] << 8) | data[offset + 4];
        diagnostics->width = (data[offset + 5] << 8) | data[offset + 6];
        diagnostics->components = data[offset + 7];
        for (uint8_t i = 0; i < diagnostics->components && i < 3; ++i) {
          if (length >= 8 + 3 * (i + 1)) diagnostics->sampling[i] = data[offset + 9 + 3 * i];
        }
      }
      if (marker != 0xc0) {
        if (diagnostics) diagnostics->reason = "Unsupported JPEG SOF marker";
        return false;
      }
      if (length < 8 || data[offset + 2] != 8) return false;
      const uint8_t components = data[offset + 7];
      if ((components != 1 && components != 3) || length != 8 + 3 * components) return false;
      const uint16_t height = (data[offset + 3] << 8) | data[offset + 4];
      const uint16_t width = (data[offset + 5] << 8) | data[offset + 6];
      if (width == 0 || height == 0 || (sPortraitCapture ? width >= height : width <= height) ||
          width > sSensorMaxWidth || height > sSensorMaxHeight) {
        if (diagnostics) diagnostics->reason = "Unexpected encoded dimensions";
        return false;
      }
      uint8_t maxHorizontal = 1, maxVertical = 1, blocks = 0;
      for (uint8_t i = 0; i < components; ++i) {
        const uint8_t sampling = data[offset + 9 + 3 * i];
        const uint8_t horizontal = sampling >> 4;
        const uint8_t vertical = sampling & 0x0f;
        if (horizontal == 0 || horizontal > 4 || vertical == 0 || vertical > 4) {
          if (diagnostics) diagnostics->reason = "Invalid JPEG sampling factors";
          return false;
        }
        if (horizontal > maxHorizontal) maxHorizontal = horizontal;
        if (vertical > maxVertical) maxVertical = vertical;
        blocks += horizontal * vertical;
        if (blocks > 10) {
          if (diagnostics) diagnostics->reason = "Invalid JPEG sampling factors";
          return false;
        }
      }
      if (width % (8 * maxHorizontal) != 0 || height % (8 * maxVertical) != 0) {
        if (diagnostics) diagnostics->reason = "Unaligned sensor JPEG dimensions";
        return false;
      }
      // Use an aligned native frame as-is. The OV3660's known 608 x 800
      // interleaved 4:2:2 profile can hide eight edge pixels without changing
      // its MCU row length; other sizes and formats retain their own header.
      uint16_t outputWidth = width;
      if (sPortraitCapture && width == kPortraitJpegWidth && height == kCameraPortraitHeight && components == 3 &&
          data[offset + 9] == 0x21 && data[offset + 12] == 0x11 && data[offset + 15] == 0x11 &&
          (width + 15) / 16 == (kCameraPortraitWidth + 15) / 16) outputWidth = kCameraPortraitWidth;
      if (sGeometry.encodedWidth != 0 && (width != sGeometry.encodedWidth ||
          height != sGeometry.height || outputWidth != sGeometry.outputWidth)) {
        if (diagnostics) diagnostics->reason = "JPEG geometry changed after startup";
        return false;
      }
      if (outputWidth != width) {
        data[offset + 5] = outputWidth >> 8;
        data[offset + 6] = outputWidth & 0xff;
      }
      if (sGeometry.encodedWidth == 0) {
        sGeometry.encodedWidth = width;
        sGeometry.height = height;
        sGeometry.outputWidth = outputWidth;
      }
      if (diagnostics) diagnostics->reason = nullptr;
      return true;
    }
    offset += length;
  }
  return false;
}

void logOv2640Registers(sensor_t* sensor) {
  if (sensor->id.PID != OV2640_PID || !sensor->get_reg) return;
  // get_reg encodes the bank in bit 8: 00xx = DSP, 01xx = sensor.
  const uint16_t registers[] = {0x0051, 0x0052, 0x0053, 0x0054, 0x0055, 0x0057,
      0x005a, 0x005b, 0x005c, 0x00c0, 0x00c1, 0x00d3, 0x00da, 0x00e0, 0x0112, 0x0111};
  Serial.println("OV2640 register readback (00xx DSP, 01xx sensor):");
  for (size_t i = 0; i < sizeof(registers) / sizeof(registers[0]); ++i) {
    const int value = sensor->get_reg(sensor, registers[i], 0xff);
    Serial.printf("%04x=%02x%s", static_cast<unsigned>(registers[i]),
                  static_cast<unsigned>(value), (i + 1) % 8 == 0 ? "\n" : " ");
  }
}

bool configureCameraSensor() {
  sGeometry = JpegGeometry();
  sensor_t* sensor = esp_camera_sensor_get();
  if (!sensor) {
    Serial.println("Camera driver did not expose a sensor");
    return false;
  }
  Serial.printf("Camera sensor PID: 0x%04x\n", static_cast<unsigned>(sensor->id.PID));
  if (!sensor->set_quality) {
    Serial.println("Camera driver does not support JPEG quality configuration");
    return false;
  }
  int result = -1;
  switch (sensor->id.PID) {
    case OV2640_PID:
      Serial.println("Configuring OV2640 normal landscape capture (800 x 600)");
      sPortraitCapture = false;
      sSensorMaxWidth = 1600;
      sSensorMaxHeight = 1200;
      // Use the SDK's standard SVGA readout and full landscape field of view.
      if (!sensor->set_framesize) {
        Serial.println("OV2640 driver does not support standard frame sizes");
        return false;
      }
      result = sensor->set_framesize(sensor, FRAMESIZE_SVGA);
      // set_window internally reapplies JPEG mode but ignores that call's
      // return value. Check it explicitly before trusting captured frames.
      if (result == 0 && (!sensor->set_pixformat || sensor->set_pixformat(sensor, PIXFORMAT_JPEG) != 0)) {
        Serial.println("OV2640 JPEG mode reset failed");
        logOv2640Registers(sensor);
        return false;
      }
      break;
    case OV3660_PID:
      Serial.println("Configuring OV3660 native portrait capture");
      sPortraitCapture = true;
      sSensorMaxWidth = 2048;
      sSensorMaxHeight = 1536;
      if (!sensor->set_res_raw) {
        Serial.println("OV3660 driver does not support a custom JPEG window");
        return false;
      }
      // OV3660 takes actual start/end coordinates, including its 16/6-pixel
      // border on each side. Centre a 1168 x 1536 active window in 2048 x 1536.
      // Use the SDK's square/portrait line timings, scaling without binning:
      // half-height binning would leave only 768 rows for an 800-row output.
      // Encode 608 x 800 with full MCU columns, then hide eight edge pixels.
      result = sensor->set_res_raw(sensor, 440, 0, 1639, 1547, 16, 6, 2044, 1564,
                                   kPortraitJpegWidth, kCameraPortraitHeight, true, false);
      break;
    default:
      Serial.println("Camera capture is configured for OV2640 and OV3660 sensors");
      return false;
  }
  if (result != 0 || sensor->set_quality(sensor, kJpegQuality) != 0) {
    Serial.println("Unable to configure the camera sensor");
    logOv2640Registers(sensor);
    return false;
  }
  // The driver started before sensor reconfiguration. Its queued XGA frames
  // can also be landscape; discard the initial buffers before size discovery.
  // Then require two matching frames before freezing the native dimensions.
  constexpr uint8_t attempts = 6;
  uint8_t discardedFrames = 0;
  uint8_t matchingFrames = 0;
  JpegGeometry previous;
  for (uint8_t attempt = 0; attempt < attempts; ++attempt) {
    sGeometry = JpegGeometry();  // Size discovery is allowed only during startup.
    const uint32_t startedAt = millis();
    camera_fb_t* frame = esp_camera_fb_get();
    const uint32_t elapsed = millis() - startedAt;
    if (discardedFrames < kDriverFrameBuffers && frame) {
      ++discardedFrames;
      esp_camera_fb_return(frame);
      Serial.printf("Camera warm-up %u/%u: discarded initial framebuffer\n",
                    static_cast<unsigned>(attempt + 1), static_cast<unsigned>(attempts));
      continue;
    }
    JpegDiagnostics diagnostics;
    const bool valid = frame && frame->format == PIXFORMAT_JPEG && prepareCameraJpeg(*frame, &diagnostics);
    if (!frame) {
      Serial.printf("Camera warm-up %u/%u: no framebuffer after %lu ms\n",
                    static_cast<unsigned>(attempt + 1), static_cast<unsigned>(attempts), static_cast<unsigned long>(elapsed));
    } else if (frame->format != PIXFORMAT_JPEG) {
      Serial.printf("Camera warm-up %u/%u: non-JPEG format %d, %u bytes, %lu ms\n",
                    static_cast<unsigned>(attempt + 1), static_cast<unsigned>(attempts), static_cast<int>(frame->format),
                    static_cast<unsigned>(frame->len), static_cast<unsigned long>(elapsed));
    } else if (!valid) {
      Serial.printf("Camera warm-up %u/%u: %s; SOF 0x%02x, %u x %u, components %u, sampling %02x/%02x/%02x, %u bytes, %lu ms\n",
          static_cast<unsigned>(attempt + 1), static_cast<unsigned>(attempts), diagnostics.reason,
          static_cast<unsigned>(diagnostics.sofMarker), diagnostics.width, diagnostics.height,
          static_cast<unsigned>(diagnostics.components), static_cast<unsigned>(diagnostics.sampling[0]),
          static_cast<unsigned>(diagnostics.sampling[1]), static_cast<unsigned>(diagnostics.sampling[2]),
          static_cast<unsigned>(frame->len), static_cast<unsigned long>(elapsed));
    }
    if (frame) esp_camera_fb_return(frame);
    if (valid) {
      if (sGeometry.encodedWidth == previous.encodedWidth && sGeometry.height == previous.height &&
          sGeometry.outputWidth == previous.outputWidth) ++matchingFrames;
      else matchingFrames = 1;
      previous = sGeometry;
      if (matchingFrames < 2) {
        Serial.printf("Camera warm-up %u/%u: candidate %u x %u, waiting for a matching frame\n",
            static_cast<unsigned>(attempt + 1), static_cast<unsigned>(attempts), diagnostics.width, diagnostics.height);
        continue;
      }
      {
        MediaLock lock;
        sStatus.width = sGeometry.outputWidth;
        sStatus.height = sGeometry.height;
      }
      Serial.printf("Camera JPEG confirmed: sensor %u x %u, output %u x %u\n",
          diagnostics.width, diagnostics.height, sGeometry.outputWidth, sGeometry.height);
      return true;
    } else matchingFrames = 0;
  }
  Serial.println("Camera did not produce stable aligned JPEGs in the requested orientation");
  logOv2640Registers(sensor);
  return false;
}

void captureTask(void*) {
  ulTaskNotifyTake(pdTRUE, portMAX_DELAY);
  uint32_t consecutiveErrors = 0;
  TickType_t lastWake = xTaskGetTickCount();
  const TickType_t interval = pdMS_TO_TICKS(kRecordingFrameIntervalMs);
  for (;;) {
    bool needed;
    {
      MediaLock lock;
      needed = sAcceptRecording || (sPreviewEnabled && sStatus.previewClient);
      if (!needed && sLatest) {
        --sLatest->references;
        sLatest = nullptr;
      }
    }
    if (!needed) {
      vTaskDelay(pdMS_TO_TICKS(20));
      lastWake = xTaskGetTickCount();
      continue;
    }

    Frame* frame = reserveFrame();
    if (frame) {
      camera_fb_t* fb = esp_camera_fb_get();
      const bool oversized = fb && fb->format == PIXFORMAT_JPEG && fb->len > kFrameCapacity;
      if (!fb || fb->format != PIXFORMAT_JPEG || oversized || !prepareCameraJpeg(*fb)) {
        if (fb) esp_camera_fb_return(fb);
        releaseFrame(frame);
        {
          MediaLock lock;
          if (oversized) ++sStatus.oversizedFrames;
          else ++sStatus.captureErrors;
          if (sAcceptRecording) ++sStatus.recordingDropped;
        }
        if (++consecutiveErrors >= 3) failRecording(MediaError::CameraCapture);
      } else {
        consecutiveErrors = 0;
        frame->length = fb->len;
        frame->capturedAt = millis();
        memcpy(frame->data, fb->buf, frame->length);
        esp_camera_fb_return(fb);  // No further access to the driver buffer.
        publishFrame(frame);
      }
    }
    const TickType_t now = xTaskGetTickCount();
    if (now - lastWake >= interval) {
      lastWake = now;
      vTaskDelay(1);  // No catch-up bursts after a slow camera operation.
    } else {
      vTaskDelayUntil(&lastWake, interval);
    }
  }
}

int openRecordingFile(const char* path) {
  char absolutePath[160];
  const int length = snprintf(absolutePath, sizeof(absolutePath), "/sdcard%s", path);
  if (length <= 0 || static_cast<size_t>(length) >= sizeof(absolutePath)) return -1;
  return ::open(absolutePath, O_WRONLY | O_CREAT | O_EXCL, 0666);
}

bool writeRecordingFrame(const Frame& frame, int index, uint32_t number,
                         uint32_t startedAt, const char* directory) {
  char path[128];
  snprintf(path, sizeof(path), "%s/%06lu.jpg", directory,
           static_cast<unsigned long>(number));
  // Bypass stdio buffering: its buffer can be in PSRAM even when the source
  // is DMA-capable. The SD driver can send several sectors per DMA transfer
  // only when the pointer passed through FatFS is in aligned internal RAM.
  const int file = openRecordingFile(path);
  if (file < 0) {
    failRecording(MediaError::StorageWrite);
    return false;
  }
  bool complete = true;
  for (size_t offset = 0; offset < frame.length; ) {
    const size_t remaining = frame.length - offset;
    const size_t count = remaining < kSdWriteBufferSize ? remaining : kSdWriteBufferSize;
    memcpy(sSdWriteBuffer, frame.data + offset, count);
    if (::write(file, sSdWriteBuffer, count) != static_cast<ssize_t>(count)) {
      complete = false;
      break;
    }
    offset += count;
    if (offset < frame.length) vTaskDelay(1);
  }
  const int closeResult = ::close(file);
  if (!complete || closeResult != 0) {
    SD_MMC.remove(path);
    failRecording(MediaError::StorageWrite);
    return false;
  }
  char line[96];
  const int length = snprintf(line, sizeof(line), "%06lu.jpg,%lu,%u\n",
      static_cast<unsigned long>(number),
      static_cast<unsigned long>(frame.capturedAt - startedAt),
      static_cast<unsigned>(frame.length));
  if (length <= 0 || static_cast<size_t>(length) >= sizeof(line) ||
      ::write(index, line, length) != static_cast<ssize_t>(length)) {
    failRecording(MediaError::MetadataWrite);
    return false;
  }
  return true;
}

void writerTask(void*) {
  ulTaskNotifyTake(pdTRUE, portMAX_DELAY);
  int index = -1;
  bool sessionOpen = false;
  char directory[sizeof(sRecordingDirectory)] = {};
  uint32_t startedAt = 0;
  uint32_t nextFrame = 1;
  uint32_t lastFlushAt = 0;
  for (;;) {
    bool active;
    {
      MediaLock lock;
      active = sStatus.recording;
      if (active && !sessionOpen) {
        memcpy(directory, sRecordingDirectory, sizeof(directory));
        startedAt = sRecordingStartedAt;
      }
    }
    if (!active) {
      vTaskDelay(pdMS_TO_TICKS(20));
      continue;
    }
    if (!sessionOpen) {
      char path[128];
      snprintf(path, sizeof(path), "%s/frames.csv", directory);
      index = openRecordingFile(path);
      const char header[] = "file,elapsed_ms,bytes\n";
      if (index < 0 || ::write(index, header, sizeof(header) - 1) != static_cast<ssize_t>(sizeof(header) - 1)) {
        failRecording(MediaError::MetadataWrite);
      }
      sessionOpen = true;
      nextFrame = 1;
      lastFlushAt = millis();
    }

    Frame* frame = nullptr;
    if (xQueueReceive(sRecordQueue, &frame, pdMS_TO_TICKS(20)) == pdTRUE) {
      bool healthy;
      {
        MediaLock lock;
        healthy = sStatus.error == MediaError::None;
      }
      const uint32_t writeStart = millis();
      if (healthy && writeRecordingFrame(*frame, index, nextFrame, startedAt, directory)) {
        ++nextFrame;
        MediaLock lock;
        ++sStatus.recordedFrames;
        const uint32_t elapsed = millis() - writeStart;
        if (elapsed > sStatus.maxWriteMs) sStatus.maxWriteMs = elapsed;
      } else {
        MediaLock lock;
        ++sStatus.recordingDropped;
      }
      releaseFrame(frame);
    }
    if (index >= 0 && millis() - lastFlushAt >= 1000) {
      if (::fsync(index) != 0) failRecording(MediaError::MetadataWrite);
      lastFlushAt = millis();
    }
    bool finished;
    {
      MediaLock lock;
      finished = !sAcceptRecording && uxQueueMessagesWaiting(sRecordQueue) == 0;
    }
    if (finished) {
      if (index >= 0) {
        if (::close(index) != 0) failRecording(MediaError::MetadataWrite);
        index = -1;
      }
      sessionOpen = false;
      MediaLock lock;
      sStatus.recording = false;  // Completion is visible only after storage closes.
      sStatus.stopping = false;
    }
  }
}

esp_err_t previewHandler(httpd_req_t* request) {
  uint32_t generation = 0;
  {
    MediaLock lock;
    if (sPreviewEnabled && !sStatus.previewClient) {
      sStatus.previewClient = true;
      generation = sPreviewGeneration;
    }
  }
  if (generation == 0) {
    httpd_resp_set_status(request, "503 Service Unavailable");
    return httpd_resp_send(request, "Preview unavailable", HTTPD_RESP_USE_STRLEN);
  }

  httpd_resp_set_type(request, "multipart/x-mixed-replace;boundary=frame");
  httpd_resp_set_hdr(request, "Cache-Control", "no-store");
  esp_err_t result = ESP_OK;
  uint32_t lastSequence = 0;
  uint32_t lastFrameAt = millis();
  for (;;) {
    Frame* frame = nullptr;
    bool enabled;
    {
      MediaLock lock;
      enabled = sPreviewEnabled && generation == sPreviewGeneration;
      if (enabled && sLatest && sLatest->sequence != lastSequence) {
        frame = sLatest;
        ++frame->references;
      }
    }
    if (!enabled || WiFi.status() != WL_CONNECTED) {
      releaseFrame(frame);
      break;
    }
    if (!frame) {
      if (millis() - lastFrameAt > 3000) {
        Serial.println("Preview stopped: no camera frame for 3 seconds");
        result = ESP_FAIL;
        break;
      }
      vTaskDelay(pdMS_TO_TICKS(5));
      continue;
    }
    lastSequence = frame->sequence;
    lastFrameAt = millis();
    char header[100];
    const int length = snprintf(header, sizeof(header),
        "--frame\r\nContent-Type: image/jpeg\r\nContent-Length: %u\r\n\r\n",
        static_cast<unsigned>(frame->length));
    result = httpd_resp_send_chunk(request, header, length);
    for (size_t offset = 0; result == ESP_OK && offset < frame->length; ) {
      const size_t remaining = frame->length - offset;
      const size_t count = remaining < 4096 ? remaining : 4096;
      result = httpd_resp_send_chunk(request, reinterpret_cast<const char*>(frame->data + offset), count);
      offset += count;
    }
    if (result == ESP_OK) result = httpd_resp_send_chunk(request, "\r\n", 2);
    releaseFrame(frame);
    if (result != ESP_OK) {
      Serial.printf("Preview stopped: socket send failed (0x%x)\n", result);
      break;
    }
    {
      MediaLock lock;
      ++sStatus.previewFrames;
    }
  }
  {
    MediaLock lock;
    sStatus.previewClient = false;
  }
  return result == ESP_OK ? httpd_resp_send_chunk(request, nullptr, 0) : result;
}

void releasePipelineResources() {
  // Only used before either worker is notified to start.
  if (sCaptureTask) vTaskDelete(sCaptureTask);
  if (sWriterTask) vTaskDelete(sWriterTask);
  sCaptureTask = nullptr;
  sWriterTask = nullptr;
  if (sRecordQueue) vQueueDelete(sRecordQueue);
  if (sMutex) vSemaphoreDelete(sMutex);
  sRecordQueue = nullptr;
  sMutex = nullptr;
  heap_caps_free(sSdWriteBuffer);
  sSdWriteBuffer = nullptr;
  for (Frame& frame : sFrames) {
    heap_caps_free(frame.data);
    frame = Frame();
  }
}
}  // namespace

bool initCamera() {
  if (cameraReady) return true;
  if (!psramFound()) {
    Serial.println("Camera requires working PSRAM for concurrent recording and preview");
    return false;
  }
  sMutex = xSemaphoreCreateMutex();
  sRecordQueue = xQueueCreate(kRecordingQueueDepth, sizeof(Frame*));
  for (Frame& frame : sFrames) {
    frame.data = static_cast<uint8_t*>(heap_caps_malloc(kFrameCapacity, MALLOC_CAP_SPIRAM | MALLOC_CAP_8BIT));
    if (!frame.data || !sMutex || !sRecordQueue) {
      Serial.println("Unable to allocate bounded camera buffers");
      releasePipelineResources();
      return false;
    }
  }
  sSdWriteBuffer = static_cast<uint8_t*>(heap_caps_malloc(
      kSdWriteBufferSize, MALLOC_CAP_INTERNAL | MALLOC_CAP_DMA | MALLOC_CAP_8BIT));
  if (!sSdWriteBuffer) {
    Serial.println("Unable to allocate the SD DMA write buffer");
    releasePipelineResources();
    return false;
  }

  camera_config_t config = {};
  config.ledc_channel = LEDC_CHANNEL_0;
  config.ledc_timer = LEDC_TIMER_0;
  config.pin_d0 = Y2_GPIO_NUM;
  config.pin_d1 = Y3_GPIO_NUM;
  config.pin_d2 = Y4_GPIO_NUM;
  config.pin_d3 = Y5_GPIO_NUM;
  config.pin_d4 = Y6_GPIO_NUM;
  config.pin_d5 = Y7_GPIO_NUM;
  config.pin_d6 = Y8_GPIO_NUM;
  config.pin_d7 = Y9_GPIO_NUM;
  config.pin_xclk = XCLK_GPIO_NUM;
  config.pin_pclk = PCLK_GPIO_NUM;
  config.pin_vsync = VSYNC_GPIO_NUM;
  config.pin_href = HREF_GPIO_NUM;
  config.pin_sccb_sda = SIOD_GPIO_NUM;
  config.pin_sccb_scl = SIOC_GPIO_NUM;
  config.pin_pwdn = PWDN_GPIO_NUM;
  config.pin_reset = RESET_GPIO_NUM;
  config.xclk_freq_hz = 20000000;
  config.pixel_format = PIXFORMAT_JPEG;
  config.frame_size = kCameraBufferFrameSize;
  config.jpeg_quality = kJpegQuality;
  config.fb_count = kDriverFrameBuffers;
  config.fb_location = CAMERA_FB_IN_PSRAM;
  config.grab_mode = CAMERA_GRAB_LATEST;

  const esp_err_t error = esp_camera_init(&config);
  if (error != ESP_OK) {
    Serial.printf("Camera init failed: 0x%x\n", error);
    releasePipelineResources();
    return false;
  }
  if (!configureCameraSensor()) {
    esp_camera_deinit();
    releasePipelineResources();
    return false;
  }
  if (xTaskCreatePinnedToCore(captureTask, "camera-capture", 4096, nullptr, 2, &sCaptureTask, kCapturePreviewCore) != pdPASS ||
      xTaskCreatePinnedToCore(writerTask, "sd-writer", 6144, nullptr, 1, &sWriterTask, kSdWriterCore) != pdPASS) {
    releasePipelineResources();
    esp_camera_deinit();
    Serial.println("Unable to start media workers");
    return false;
  }
  cameraReady = true;
  xTaskNotifyGive(sCaptureTask);
  xTaskNotifyGive(sWriterTask);
  Serial.printf("Camera ready: %u x %u JPEG, target 20 FPS, bounded PSRAM pipeline\n",
                sGeometry.outputWidth, sGeometry.height);
  Serial.println("Media workers: capture/preview core 1, SD writer core 0 with 8 KiB DMA staging");
  return true;
}

bool startPreviewServer() {
  if (sPreviewServer) return true;
  if (!cameraReady) return false;
  httpd_config_t config = HTTPD_DEFAULT_CONFIG();
  config.core_id = kCapturePreviewCore;
  config.server_port = kPreviewPort;
  config.ctrl_port = 32769;
  config.stack_size = 6144;
  config.max_open_sockets = 2;
  config.backlog_conn = 2;
  config.recv_wait_timeout = 1;
  // Bound a stalled socket, rather than cutting a JPEG off during successful
  // writes. Slow viewers hold one slot and skip old frames; SD keeps running.
  config.send_wait_timeout = 5;
  if (httpd_start(&sPreviewServer, &config) != ESP_OK) {
    sPreviewServer = nullptr;
    return false;
  }
  httpd_uri_t uri = {};
  uri.uri = "/stream";
  uri.method = HTTP_GET;
  uri.handler = previewHandler;
  if (httpd_register_uri_handler(sPreviewServer, &uri) != ESP_OK) {
    httpd_stop(sPreviewServer);
    sPreviewServer = nullptr;
    return false;
  }
  return true;
}

void setPreviewEnabled(bool enabled) {
  if (!sMutex) return;
  MediaLock lock;
  if (sPreviewEnabled != enabled) {
    sPreviewEnabled = enabled;
    ++sPreviewGeneration;
    if (sPreviewGeneration == 0) ++sPreviewGeneration;
  }
}

bool beginMediaRecording(const String& directory) {
  if (!kSdRecordingEnabled) return false;
  if (!cameraReady || directory.length() == 0 || directory.length() >= sizeof(sRecordingDirectory)) return false;
  MediaLock lock;
  if (sStatus.recording) return false;
  directory.toCharArray(sRecordingDirectory, sizeof(sRecordingDirectory));
  sRecordingStartedAt = millis();
  sStatus.recordedFrames = 0;
  sStatus.recordingDropped = 0;
  sStatus.maxWriteMs = 0;
  sStatus.error = MediaError::None;
  sStatus.recording = true;
  sStatus.stopping = false;
  sAcceptRecording = true;
  return true;
}

void endMediaRecording() {
  if (!sMutex) return;
  MediaLock lock;
  sAcceptRecording = false;
  sStatus.stopping = sStatus.recording;
}

MediaStatus mediaStatus() {
  if (!sMutex) return MediaStatus();
  MediaLock lock;
  return sStatus;
}

const char* mediaErrorMessage(MediaError error) {
  switch (error) {
    case MediaError::CameraCapture: return "Camera repeatedly returned missing, invalid or oversized JPEGs";
    case MediaError::StorageWrite: return "SD card could not write a complete JPEG; check space and card health";
    case MediaError::MetadataWrite: return "SD card could not write recording timestamps";
    default: return "";
  }
}

void handleStream() {
  if (!streamAvailable()) {
    server.send(503, "text/plain", "Preview requires a working camera and connected Wi-Fi");
    return;
  }
  const String location = "http://" + WiFi.localIP().toString() + ":" + String(kPreviewPort) + "/stream";
  server.sendHeader("Location", location);
  server.sendHeader("Cache-Control", "no-store");
  server.send(307, "text/plain", "");
}

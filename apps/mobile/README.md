# Sightline — Android app

Turns built-in phone cameras and attached UVC USB webcams into separate MJPEG streams. Open the phone's address in a computer browser to see the camera feeds. Everything runs on the phone; the Sightline web app, backend, database, and Bun dependencies are not needed.

**The flow:** phone camera and/or USB webcams → Android phone → Wi-Fi → computer browser. Each selected camera gets its own link; USB webcams connect through an OTG adapter or powered hub.

**Start with one camera at 640 × 480. Then add a second.** The app allows up to five camera selections. Simultaneous phone cameras must be supported by Android; USB capacity depends on the phone, cameras, hub, bandwidth and heat. An APK build does not prove compatibility with your particular hardware.

## 1. What you need

- An Android phone running Android 8.0 or newer. No USB hardware is needed to stream its built-in camera.
- For USB capture: USB host / OTG support, a UVC webcam, and an OTG adapter or powered hub. A camera with a USB port is not necessarily a UVC webcam; DSLRs may need a UVC capture adapter.
- For multiple USB cameras: a powered USB-C OTG hub. A charging-only splitter will not work. USB-C does not guarantee USB 3 speed or simultaneous charging and OTG.
- Your phone and computer on the same trusted Wi-Fi, or your computer connected to the phone's hotspot. Guest Wi-Fi may block communication between devices.

## 2. Install the APK (quickest route)

Build the APK using [the steps below](#5-build-from-terminal). Gradle writes it to `app/build/outputs/apk/debug/app-debug.apk`. Generated APKs are excluded from Git. The original development Mac also has a convenience copy at `artifacts/sightline-usb-debug.apk`; rebuilding does not update that copy automatically.

1. Transfer the APK to the phone, using your usual file-sharing method or cloud drive. You only need to transfer the APK, not the project folder.
2. On your phone, open its Files app and tap the APK.
3. If Android says installation is blocked, choose **Settings** in that prompt and enable **Allow from this source** for the app opening the APK. Return and tap **Install**. You can turn that permission off again afterwards.
4. Open **Sightline** from the app launcher (previously named Sightline USB). Version **0.2.0** adds built-in phone cameras and a shorter interface. It keeps the 640 × 480 default and 20 FPS target. Install over earlier versions built on this Mac; stop streams before updating. The package ID is unchanged.

This is an installable debug APK, not a Play Store release. If Android reports an existing package with a conflicting signature, uninstall the older Sightline app and install this one. This app does not store recordings.

## 3. Connect cameras and stream

1. Connect your phone and computer to the same Wi-Fi. Alternatively, enable the phone's hotspot and connect the computer to it.
2. For phone capture, no cable is needed. For USB capture, power the hub, connect one webcam and attach the hub to the phone.
3. Open Sightline. Enable your phone's OTG toggle only if you are using a USB camera and it needs that setting.
4. Tap **Choose cameras**. Under **Phone cameras**, pick **Front / selfie** or **Rear**; under **USB cameras**, pick a webcam. Tap **Done**. Use **Refresh** if a camera is missing; allow Camera access if requested. Identical cameras have different IDs in their labels.
5. Keep **640 × 480** selected under **Stream quality** and tap **Start streaming**. Both quality options target up to 20 FPS.
6. Allow **Camera** access. This permission is also required for USB webcams. On Android 17+, also allow **Local network** access. Notification access lets Android show the persistent streaming notification.
7. If you selected USB devices, Android asks for access to each one. Tap **Allow**; prompts appear one at a time. Phone cameras do not need USB permission.
8. Wait for the camera's status to say **Streaming**. This appears only after its first frame is published.
9. Under **Watch in browser**, copy or share the displayed address. It looks like `http://192.168.1.42:8080` but **use your phone's actual address**.
10. Type that address into your computer's browser address bar, including `http://` and `:8080`. Do not substitute `localhost`; on your computer, that means the computer itself.
11. The page shows each camera and links to its individual MJPEG stream and snapshot. Open separate stream links in different browser tabs/windows if desired.
12. Tap **Stop streaming**, choose another camera (phone or USB), and start again. If Android rejects two phone cameras together, select one or use one phone camera plus USB. Add cameras gradually and lower quality if feeds stall.
13. Stop from the app or its Android notification when finished. Do not unplug a shared hub unless you intend to disconnect every attached camera.

The service is designed to continue when the screen locks or you switch apps. Some phones apply aggressive battery restrictions; see troubleshooting. Capture does not restart automatically after a reboot or process kill. Reopening the app requires tapping Start again.

The main screen shows selection, status, quality and viewing actions. The **Help** information button beside Sightline opens setup, privacy and compatibility tips. The sun/moon button switches themes and saves your choice. Copying a link shows **Link copied**. Camera and quality settings are locked while streaming.

### Built-in lens and simultaneous-camera support

- Public front/rear cameras and readable physical lenses exposed by Android are listed. Manufacturer-private lenses and depth-only sensors without YUV output cannot be streamed by this app.
- Selecting a logical camera and one of its own lenses together is rejected because they share hardware. Up to two exposed physical lenses from one logical group can use a shared Camera2 session, at a common supported size.
- On Android 11+, separate phone camera devices must appear in Android's advertised concurrent-camera sets; the actual output configurations are checked too. On Android 8–10, use one phone camera device at a time. USB cameras remain independently selectable.
- Phone frames rotate with the device. A 640 × 480 capture becomes 480 × 640 when upright in portrait. Front-camera streams are unmirrored so writing remains readable.
- A phone-camera failure does not stop a working USB camera, and vice versa. The service stops automatically when every selected backend has exhausted its cameras.

**Privacy:** The server uses plain HTTP without a login. Anyone on the network who can reach the phone's address can view the feeds. Use a trusted LAN; do not forward its port to the internet. The app does not record video, access your microphone, or upload camera frames.

## 4. Run from Android Studio on this Mac

Android Studio is already installed in `/Applications/Android Studio.app`. The installed Quail 2 (2026.1.2 Patch 1) supports Android Gradle Plugin up to 9.3.1, while this app uses 9.4.1. Update Android Studio to a version that supports AGP 9.4.1 before syncing, running from the IDE, or rendering Compose previews. The terminal build below works with the existing tooling.

1. Launch Android Studio.
2. From the welcome screen choose **Open**. If another project is open, choose **File → Open**.
3. Select **`/Users/zoro/Desktop/Codex-projects/sight-mobile/apps/mobile`**. Open this Android folder, not the whole monorepo and not the nested `app` folder.
4. Let Android Studio finish Gradle sync. Trust this project if prompted, since it is the project created for you here.
5. If SDK components are missing, open **Tools → SDK Manager**. Install Android API 37 (37.0), **Android SDK Build-Tools 36.0.0**, **Android SDK Platform-Tools**, and **Android SDK Command-line Tools (latest)**. Accept the Android SDK terms when prompted.
6. The tools used for this build live at `~/Desktop/Codex-projects/android-tooling/`. A generated, ignored `local.properties` may already point to that SDK. On another machine, let Android Studio generate its own SDK path.
7. In **Android Studio → Settings → Build, Execution, Deployment → Build Tools → Gradle**, use the embedded JDK / JetBrains Runtime (Java 21 works; AGP requires at least Java 17). Keep Gradle set to use the project wrapper.
8. On the phone, open **Settings → About phone** and tap **Build number** seven times. Enter the phone PIN if asked. Some brands put Build number under **Software information**.
9. Open **Settings → System → Developer options** (or search Settings for Developer options) and turn on **USB debugging**.
10. Connect the phone to the Mac with a data-capable cable. Unlock it and accept **Allow USB debugging**. The computer must appear trusted on the phone before Android Studio can use it.
11. In Android Studio's device selector at the top, select your phone, select the **app** run configuration, and click the green **Run ▶** button.
12. Android Studio builds, installs and opens Sightline. After installation, disconnect the Mac cable and connect the hub/cameras. The installed app works independently of Android Studio.

**For development with the hub attached:** On Android 11+, enable **Wireless debugging** in Developer options. In Android Studio choose **Pair Devices Using Wi-Fi**, then use the phone's **Pair device with QR code** or pairing-code option. Both must be on the same Wi-Fi. Once paired, select that wireless device and the phone's USB port stays available for cameras. Wireless debugging is optional; it is not needed to use the installed APK.

An emulator can exercise the screen, but it does not verify USB hub/webcam capture. Use a real phone for camera validation.

## 5. Build from Terminal

Open Terminal and paste:

```bash
cd /Users/zoro/Desktop/Codex-projects/sight-mobile/apps/mobile
./scripts/android.sh :app:assembleDebug
```

When it says **BUILD SUCCESSFUL**, the installable APK is:

```text
/Users/zoro/Desktop/Codex-projects/sight-mobile/apps/mobile/app/build/outputs/apk/debug/app-debug.apk
```

With an authorized phone connected by USB or wireless debugging:

```bash
./scripts/android.sh :app:installDebug
```

Then open Sightline on the phone. To run the automated checks:

```bash
./scripts/android.sh :app:testDebugUnitTest :app:lintDebug
```

From the monorepo root, `bun run mobile:apk`, `bun run mobile:install`, and `bun run mobile:check` are equivalent shortcuts. There is no need to run `bun install` for the Android app. On Windows/Linux, install Android Studio and use the included `gradlew.bat` / `./gradlew` directly after setting the SDK path.

## 6. Stream endpoints

| Path | Purpose |
| --- | --- |
| `/` | Browser dashboard with all registered cameras |
| `/camera/CAMERA_ID/stream` | Continuous MJPEG for one phone or USB camera |
| `/camera/CAMERA_ID/snapshot.jpg` | Most recent JPEG; returns 503 until a frame exists |
| `/health` | Server status and registered camera count |

Copy actual URLs from the app/dashboard. Device IDs can change when a camera is unplugged. A stream URL is not a permanent hardware identity. The server supports up to 12 simultaneous HTTP connections; each live browser image consumes a connection. If you open many dashboards, close unused tabs.

The camera engine prefers MJPEG USB input. The library converts it to NV21, and Android encodes JPEGs for HTTP at up to 20 fps. It currently does not pass compressed USB JPEG packets directly through, so CPU use and heat can limit five-camera operation. The camera input uses the lowest supported frame rate at or above the 20 FPS target when available (for example, 30 FPS input). If the camera only supports slower rates at the selected resolution, it uses its fastest available rate and displays that limit. Actual output also depends on encoding speed, USB bandwidth and network conditions. No audio or synchronized capture is included.

## 7. Troubleshooting

| What you see | What to do |
| --- | --- |
| No phone cameras detected | Tap Refresh and grant Camera access. Check Android's camera privacy switch and administrator restrictions. Some lenses are private to the manufacturer's camera app. |
| No USB cameras detected | Confirm UVC and OTG support, enable any phone OTG toggle, power the hub, use a data cable, then Refresh. Try one camera directly through an OTG adapter. |
| Front and rear cannot start together | Use a combination Android reports as supported. Try one phone camera, or one phone camera plus USB. A phone may support only one built-in camera at a time. |
| Phone camera is in use or unavailable | Close other camera apps, check the camera privacy switch, stop streaming and retry. |
| Camera permission denied | Android Settings → Apps → Sightline → Permissions → allow Camera and, on Android 17+, Local network. Reopen and start. |
| USB permission denied | Stop, then Start and allow the device prompt. If an old prompt remains, answer it first. |
| First camera works; second stalls | Use external hub power, 640 × 480, and fewer cameras. Check the phone's USB speed and camera MJPEG modes. A software change cannot add USB bandwidth. |
| No frames for 10 or 15 seconds | USB streams time out after 10 seconds; phone groups after 15. Check power, camera privacy and compatibility, then stop and retry at 640 × 480. |
| Browser cannot connect | Confirm correct IP and port, same LAN, Local network permission, and that streaming is started. Guest networks/client isolation/VPNs/firewalls may block it. Try a phone hotspot. |
| Browser page opens but a feed is frozen | Check the phone's streaming status, refresh the page after a camera restart, and close extra viewing tabs. Stalled network clients are disconnected after about five seconds. |
| Stream stops when screen locks | Check Android Settings → Apps → Sightline → Battery; allow background operation/unrestricted battery usage if your phone offers it. Keep the foreground notification active. |
| App installation fails | Use Android 8+, allow installation from the file-opening app, check free storage, and remove an older differently signed copy if necessary. |
| Gradle sync/download fails | Check internet access, retry sync, and confirm SDK/JDK settings above. Corporate proxies/VPNs may block Maven, Google or Gradle downloads. |
| Phone overheats | Reduce resolution, camera count, or viewing load; stop streaming and let it cool. Keep the phone ventilated. |

If troubleshooting is needed, provide the exact phone model, Android version, hub/camera models, the app's camera status text, and Android Studio's **Logcat** output filtered to `com.sightline.mobile` or `SightlineUSB`. Do not share recordings or unrelated logs containing personal data.

## Implementation and references

Kotlin 2.4.21, Compose BOM 2026.09.00, AGP 9.4.1, Gradle 9.6.0, compile/target API 37, UVCAndroid 1.0.13. Versions were checked against official package metadata on October 22, 2026.

- [Android USB host guide](https://developer.android.com/develop/connectivity/usb/host)
- [Camera2 multi-camera guide](https://developer.android.com/media/camera/camera2/multi-camera)
- [Concurrent camera requirements](https://developer.android.com/reference/android/hardware/camera2/CameraManager#getConcurrentCameraIds())
- [Camera frame orientation](https://developer.android.com/reference/android/hardware/camera2/CaptureRequest#JPEG_ORIENTATION)
- [Compose setup](https://developer.android.com/develop/ui/compose/setup-compose-dependencies-and-compiler)
- [Foreground service requirements](https://developer.android.com/develop/background-work/services/fgs/service-types)
- [Android local network permission](https://developer.android.com/privacy-and-security/local-network-permission)
- [UVCAndroid source and license](https://github.com/shiyinghan/UVCAndroid)
- [Build and validation record](VALIDATION.md)

`camera/` owns discovery, Camera2 phone capture, USB capture and shared coordination. Phone YUV frames are copied with crop/stride handling, rotated and JPEG-encoded off the control thread with a bounded queue. `stream/` owns the pure Kotlin HTTP server, `CaptureService` owns streaming lifetime, and `ui/` owns the Compose controls. The Android project is independent of the Bun workspace dependency graph.

### Open source components

This app includes UVCAndroid and its native USB/JPEG dependencies. Their license texts and attribution are packaged in the APK under `assets/licenses/` and available in [`app/src/main/assets/licenses/`](app/src/main/assets/licenses/). The UVC dependency is unmodified; its corresponding source is available from [UVCAndroid 1.0.13](https://github.com/shiyinghan/UVCAndroid/tree/1.0.13). This software is based in part on the work of the Independent JPEG Group.

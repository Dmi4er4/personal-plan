# Android development build

The Android client is an Expo SDK 57 development build with a native Jetpack Glance widget. It requires Node.js 24, pnpm 10.15.0, JDK 17, Android SDK platform/build-tools 36, and an Android 7 (API 24) or newer device. Set `JAVA_HOME`, `ANDROID_HOME`, and `ANDROID_SDK_ROOT`; prepend the Node 24, Java, and Android platform-tools directories to `PATH`.

Install workspace dependencies with `pnpm install`. Configure the relay at build time with `EXPO_PUBLIC_RELAY_URL=https://relay.example` (plain HTTP is accepted only for `localhost` or `127.0.0.1`; on the emulator use `adb reverse tcp:8787 tcp:8787` and `http://127.0.0.1:8787`). Generate native files and run the development build:

```bash
pnpm --dir apps/android exec expo prebuild --clean --platform android
pnpm --dir apps/android android
```

Generated `apps/android/android/` and `apps/android/ios/` are ignored. The checked-in source of truth is `app.config.ts` plus `modules/plan-widget/`.

Build and manually install the debug APK:

```bash
bash scripts/qualify-android.sh
adb install -r apps/android/android/app/build/outputs/apk/debug/app-debug.apk
```

Open the launcher widget picker, choose “Компактная лента личного плана”, place it on the home screen, and resize it horizontally and vertically. The widget remains scrollable at short heights. Its snapshot and durable checkbox-command files are held in app-private internal storage; they are not uploaded and are removed with application data.

On first launch choose `Сканировать QR`, `Ввести фразу`, or `Создать новое хранилище`. Camera permission is requested only after choosing QR. Phrase restore uses the relay compiled into the build; QR may contain its own validated relay URL. Keep the shown 24-word phrase offline: losing every configured device and the phrase makes the plan unrecoverable.

Background work is registered as `personal-plan-sync-v1` through WorkManager with a requested minimum interval of 15 minutes. It is best effort and can be delayed by battery or vendor rules. Inspect it with:

```bash
adb shell dumpsys jobscheduler | grep -A 40 -m 1 -E "JOB #.*com.personalplan.app"
```

In a debug build, `BackgroundTask.triggerTaskWorkerForTestingAsync()` can trigger the worker. Android force-stop pauses background work until the application is opened again; durable widget commands remain queued.

Limitations are intentional: there are no notifications, no exact background schedule guarantee, and no Google Play/store distribution workflow.

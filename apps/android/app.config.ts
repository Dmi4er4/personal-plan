import type { ExpoConfig } from "expo/config";

const config: ExpoConfig = {
  name: "Планы",
  slug: "personal-plan",
  version: "1.0.8",
  orientation: "portrait",
  scheme: "personalplan",
  userInterfaceStyle: "automatic",
  icon: "./assets/icon.png",
  android: {
    package: "com.personalplan.app",
    versionCode: 9,
    adaptiveIcon: { foregroundImage: "./assets/adaptive-icon.png", backgroundColor: "#ffffff" },
    intentFilters: [
      {
        action: "VIEW",
        category: ["BROWSABLE", "DEFAULT"],
        data: [
          { scheme: "personalplan", host: "list" },
          { scheme: "personalplan", host: "text" },
          { scheme: "personalplan" },
        ],
      },
    ],
  },
  plugins: [
    "./plugins/with-on-new-intent.js",
    ["expo-build-properties", { android: { minSdkVersion: 24, compileSdkVersion: 36, targetSdkVersion: 36 } }],
    ["expo-secure-store", { configureAndroidBackup: true }],
    ["expo-camera", { cameraPermission: "Разрешите камеру, чтобы отсканировать QR-код хранилища", recordAudioAndroid: false }],
  ],
  experiments: { autolinkingModuleResolution: true },
  extra: { relayUrl: process.env.EXPO_PUBLIC_RELAY_URL ?? "http://127.0.0.1:8787" },
};

export default config;

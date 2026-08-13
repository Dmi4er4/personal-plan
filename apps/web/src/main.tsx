import { createRoot } from "react-dom/client";
import { registerSW } from "virtual:pwa-register";

import { App } from "./app/App.js";
import { IndexedDbPlanStore } from "./storage/indexeddb.js";
import { applyPendingLocalDataReset, requestLocalDataReset, requestServerDataRestore } from "./storage/reset-local-data.js";
import { IndexedDbSyncStateStore } from "./storage/sync-indexeddb.js";
import { HttpRelayTransport } from "./sync/http-relay-transport.js";
import { schedulePwaUpdates } from "./sync/pwa-updates.js";

const rootElement = document.querySelector("#root");
if (rootElement === null) {
  throw new Error("Application root element was not found");
}
const appRootElement = rootElement;

async function start(): Promise<void> {
  await applyPendingLocalDataReset();
  const relayUrl = window.location.origin;
  createRoot(appRootElement).render(
    <App
      onResetLocalData={requestLocalDataReset}
      onRestoreServerData={requestServerDataRestore}
      store={new IndexedDbPlanStore("personal-plan")}
      sync={{ defaultRelayUrl: relayUrl, stateStore: new IndexedDbSyncStateStore(), transport: new HttpRelayTransport(relayUrl), transportForRelay: (url) => new HttpRelayTransport(url) }}
    />,
  );
}

void start().catch(() => {
  appRootElement.textContent = "Не удалось очистить локальные данные. Полностью закройте приложение и откройте снова.";
});

registerSW({
  immediate: true,
  onRegisteredSW: (_serviceWorkerUrl, registration) => {
    if (registration !== undefined) schedulePwaUpdates(registration);
  },
});

declare global {
  interface Window {
    __PLAN_PWA_READY__?: boolean;
  }
}

if (
  import.meta.env.PROD &&
  new URLSearchParams(window.location.search).has("e2e") &&
  "serviceWorker" in navigator
) {
  void navigator.serviceWorker.ready.then(() => {
    window.__PLAN_PWA_READY__ = true;
  });
}

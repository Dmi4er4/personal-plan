import Constants from "expo-constants";
import { useCallback, useEffect, useMemo, useState } from "react";
import { AppState, BackHandler, Pressable, StatusBar, Text, View } from "react-native";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { snapshotPlan } from "@personal-plan/core";
import { AndroidPlanProvider, useAndroidPlan } from "./app/AndroidPlanProvider";
import { discardLocalPlanForServerRestore } from "./app/restore-from-server";
import { ExpoCryptoProvider } from "./crypto/expo-crypto-provider";
import { useDeepLinkTab, type AppTab } from "./navigation/deep-link";
import { SecureVaultStore, type StoredVaultConfig } from "./storage/secure-vault";
import { SqlitePlanStore } from "./storage/sqlite-plan-store";
import { SqliteSyncStateStore } from "./storage/sqlite-sync-store";
import { AndroidHttpRelayTransport } from "./sync/http-relay-transport";
import { PairingScreen } from "./ui/PairingScreen";
import { HistoryScreen } from "./ui/HistoryScreen";
import { SettingsScreen } from "./ui/SettingsScreen";
import { reduceMainLayer, shouldHandleMainBack, type MainLayer } from "./ui/main-layer";
import { styles } from "./ui/styles";
import { TextPlanScreen } from "./ui/TextPlanScreen";
import { TimelineScreen } from "./ui/TimelineScreen";
import { base64UrlEncode, deriveVaultMaterial } from "@personal-plan/sync";

const vaultStore = new SecureVaultStore();
const relayUrl = String(Constants.expoConfig?.extra?.relayUrl ?? "http://127.0.0.1:8787");

function Main() {
  const plan = useAndroidPlan();
  const [tab, setTab] = useState<AppTab>("list");
  const [layer, setLayer] = useState<MainLayer>("none");
  const taskById = useMemo(() => new Map(
    layer === "history" ? snapshotPlan(plan.doc).records.map((task) => [task.id, task] as const) : [],
  ), [layer, plan.doc, plan.projected]);
  const openTab = useCallback((nextTab: AppTab) => {
    setLayer((current) => reduceMainLayer(current, "tab"));
    setTab(nextTab);
  }, []);
  useDeepLinkTab(openTab);

  useEffect(() => {
    const subscription = BackHandler.addEventListener("hardwareBackPress", () => {
      if (!shouldHandleMainBack(layer)) return false;
      setLayer((current) => reduceMainLayer(current, "back"));
      return true;
    });
    return () => subscription.remove();
  }, [layer]);

  useEffect(() => {
    const subscription = AppState.addEventListener("change", (state) => {
      if (state !== "active") {
        setLayer((current) => reduceMainLayer(current, "background"));
      }
    });
    return () => subscription.remove();
  }, []);

  if (layer === "settings") {
    return <SettingsScreen
      onClose={() => setLayer((current) => reduceMainLayer(current, "close"))}
      relayUrl={plan.relayUrl}
      rootSecret={plan.rootSecret}
    />;
  }
  if (layer === "history") {
    return <HistoryScreen
      doc={plan.doc}
      history={plan.projected.history}
      onClose={() => setLayer((current) => reduceMainLayer(current, "close"))}
      snapshot={taskById}
      today={plan.today}
    />;
  }

  return <View style={styles.page}>
    {plan.syncError !== null ? <Text accessibilityRole="alert" style={styles.error}>{plan.syncError}</Text> : null}
    <View style={styles.header}>
      <View style={styles.headerTabs}>
        <Pressable accessibilityRole="tab" accessibilityState={{ selected: tab === "list" }} style={[styles.tab, tab === "list" ? styles.tabActive : undefined]} onPress={() => openTab("list")}>
          <Text style={styles.tabText}>Список</Text>
        </Pressable>
        <Pressable accessibilityRole="tab" accessibilityState={{ selected: tab === "text" }} style={[styles.tab, tab === "text" ? styles.tabActive : undefined]} onPress={() => openTab("text")}>
          <Text style={styles.tabText}>Текст</Text>
        </Pressable>
      </View>
      <View style={styles.menuWrap}>
        <Pressable accessibilityLabel="Меню" accessibilityRole="button" accessibilityState={{ expanded: layer === "menu" }} onPress={() => setLayer((current) => reduceMainLayer(current, "toggle-menu"))} style={styles.menuButton}>
          <Text style={styles.menuButtonText}>⋮</Text>
        </Pressable>
      </View>
    </View>
    {layer === "menu" ? (
      <View accessibilityViewIsModal style={styles.menuLayer}>
        <Pressable
          accessibilityLabel="Закрыть меню"
          accessibilityRole="button"
          onPress={() => setLayer((current) => reduceMainLayer(current, "close"))}
          style={styles.menuBackdrop}
        />
        <View accessibilityRole="menu" style={styles.menuPanel}>
          <Pressable
            accessibilityRole="menuitem"
            onPress={() => setLayer((current) => reduceMainLayer(current, "open-history"))}
            style={styles.menuItem}
          >
            <Text style={styles.menuItemText}>История</Text>
          </Pressable>
          <Pressable
            accessibilityRole="menuitem"
            onPress={() => setLayer((current) => reduceMainLayer(current, "open-settings"))}
            style={styles.menuItem}
          >
            <Text style={styles.menuItemText}>Настройки</Text>
          </Pressable>
        </View>
      </View>
    ) : null}
    {tab === "list" ? <TimelineScreen doc={plan.doc} projected={plan.projected} today={plan.today} /> : <TextPlanScreen />}
  </View>;
}

export default function App() {
  const [config, setConfig] = useState<StoredVaultConfig | null | undefined>(undefined);
  const [planGeneration, setPlanGeneration] = useState(0);
  const planStore = useMemo(() => new SqlitePlanStore(), []);
  const syncStore = useMemo(() => new SqliteSyncStateStore(), []);
  useEffect(() => { void vaultStore.load().then(setConfig); }, []);
  const disconnectVault = async () => {
    await planStore.reset();
    await vaultStore.clear();
    setConfig(null);
  };
  const restoreFromServer = async () => {
    await discardLocalPlanForServerRestore(planStore, () => {
      setPlanGeneration((value) => value + 1);
    });
  };
  const configure = async (value: StoredVaultConfig, create: boolean) => {
    const provider = new ExpoCryptoProvider();
    let material;
    try {
      material = await deriveVaultMaterial(provider, value.rootSecret);
    } catch {
      throw new Error("Не удалось подготовить ключи хранилища");
    }
    if (!create) {
      try {
        await planStore.reset();
      } catch {
        throw new Error("Не удалось очистить локальные данные перед восстановлением");
      }
    }
    if (create) {
      const transport = new AndroidHttpRelayTransport(value.relayUrl);
      try {
        await transport.createVault(material.vaultId, base64UrlEncode(await provider.sha256(material.authToken)));
      } catch (reason) {
        const message = reason instanceof Error ? reason.message : "";
        if (message.includes("relay_http_409")) {
          throw new Error("Не удалось создать хранилище: на сервере уже есть другое хранилище", { cause: reason });
        }
        throw new Error("Не удалось создать хранилище на сервере — проверьте сеть", { cause: reason });
      }
    }
    try {
      await vaultStore.save(value);
    } catch {
      throw new Error("Не удалось сохранить ключи в защищённое хранилище телефона");
    }
    setConfig(value);
  };
  return <><StatusBar backgroundColor="#f7f7fb" barStyle="dark-content" /><GestureHandlerRootView style={styles.safe}><SafeAreaProvider><SafeAreaView style={styles.safe}>{config === undefined ? <Text>Проверка хранилища…</Text> : config === null ? <PairingScreen defaultRelayUrl={relayUrl} onConfigure={configure} /> : <AndroidPlanProvider config={config} key={planGeneration} onDisconnect={disconnectVault} onRestoreFromServer={restoreFromServer} planStore={planStore} syncStore={syncStore}><Main /></AndroidPlanProvider>}</SafeAreaView></SafeAreaProvider></GestureHandlerRootView></>;
}

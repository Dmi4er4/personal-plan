import Constants from "expo-constants";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Pressable, Text, View } from "react-native";
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
import { SettingsScreen } from "./ui/SettingsScreen";
import { styles } from "./ui/styles";
import { TextPlanScreen } from "./ui/TextPlanScreen";
import { TimelineScreen } from "./ui/TimelineScreen";
import { base64UrlEncode, deriveVaultMaterial } from "@personal-plan/sync";

const vaultStore = new SecureVaultStore();
const relayUrl = String(Constants.expoConfig?.extra?.relayUrl ?? "http://127.0.0.1:8787");

function Main() {
  const plan = useAndroidPlan();
  const [tab, setTab] = useState<AppTab>("list");
  const [menuOpen, setMenuOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const taskById = useMemo(() => new Map(snapshotPlan(plan.doc).records.map((task) => [task.id, task])), [plan.doc, plan.projected]);
  const openTab = useCallback((nextTab: AppTab) => {
    setMenuOpen(false);
    setSettingsOpen(false);
    setTab(nextTab);
  }, []);
  useDeepLinkTab(openTab);

  if (settingsOpen) {
    return <SettingsScreen
      doc={plan.doc}
      history={plan.projected.history}
      onClose={() => setSettingsOpen(false)}
      relayUrl={plan.relayUrl}
      rootSecret={plan.rootSecret}
      snapshot={taskById}
      today={plan.today}
    />;
  }

  return <View style={styles.page}>
    {plan.syncError !== null ? <Text accessibilityRole="alert" style={styles.error}>{plan.syncError}</Text> : null}
    <View style={styles.header}>
      <View style={styles.headerTabs}>
        <Pressable accessibilityRole="tab" accessibilityState={{ selected: tab === "list" }} style={[styles.tab, tab === "list" ? styles.tabActive : undefined]} onPress={() => setTab("list")}>
          <Text style={styles.tabText}>Список</Text>
        </Pressable>
        <Pressable accessibilityRole="tab" accessibilityState={{ selected: tab === "text" }} style={[styles.tab, tab === "text" ? styles.tabActive : undefined]} onPress={() => setTab("text")}>
          <Text style={styles.tabText}>Текст</Text>
        </Pressable>
      </View>
      <View style={styles.menuWrap}>
        <Pressable accessibilityLabel="Меню" accessibilityRole="button" onPress={() => setMenuOpen((open) => !open)} style={styles.menuButton}>
          <Text style={styles.menuButtonText}>⋮</Text>
        </Pressable>
        {menuOpen ? (
          <View accessibilityRole="menu" style={styles.menuPanel}>
            <Pressable
              accessibilityRole="menuitem"
              onPress={() => {
                setMenuOpen(false);
                setSettingsOpen(true);
              }}
              style={styles.menuItem}
            >
              <Text style={styles.menuItemText}>Настройки</Text>
            </Pressable>
          </View>
        ) : null}
      </View>
    </View>
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
  return <GestureHandlerRootView style={styles.safe}><SafeAreaProvider><SafeAreaView style={styles.safe}>{config === undefined ? <Text>Проверка хранилища…</Text> : config === null ? <PairingScreen defaultRelayUrl={relayUrl} onConfigure={configure} /> : <AndroidPlanProvider config={config} key={planGeneration} onDisconnect={disconnectVault} onRestoreFromServer={restoreFromServer} planStore={planStore} syncStore={syncStore}><Main /></AndroidPlanProvider>}</SafeAreaView></SafeAreaProvider></GestureHandlerRootView>;
}

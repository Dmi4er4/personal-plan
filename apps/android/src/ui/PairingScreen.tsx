import { createPairingQr, generateRootSecret, parsePairingQr, phraseToRootSecret, rootSecretToPhrase, base64UrlDecode } from "@personal-plan/sync";
import { CameraView, useCameraPermissions, type BarcodeScanningResult } from "expo-camera";
import { useRef, useState } from "react";
import { Pressable, ScrollView, Text, TextInput } from "react-native";
import { ExpoCryptoProvider } from "../crypto/expo-crypto-provider";
import type { StoredVaultConfig } from "../storage/secure-vault";
import { formatPhraseValidationError, formatVaultSetupError } from "./pairing-errors";
import { RecoveryCards } from "./RecoveryCards";
import { styles } from "./styles";

export interface PairingScreenProps { defaultRelayUrl: string; onConfigure(config: StoredVaultConfig, create: boolean): Promise<void> }

export function PairingScreen({ defaultRelayUrl, onConfigure }: PairingScreenProps) {
  const [mode, setMode] = useState<"choose" | "phrase" | "scan" | "show">("choose");
  const [phrase, setPhrase] = useState("");
  const [shown, setShown] = useState("");
  const [qr, setQr] = useState("");
  const [pendingRoot, setPendingRoot] = useState<Uint8Array | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [permission, requestPermission] = useCameraPermissions();
  const scanPending = useRef(false);

  const configure = async (rootSecret: Uint8Array, relayUrl: string, create: boolean) => {
    await onConfigure({ rootSecret, relayUrl }, create);
  };

  const restorePhrase = async () => {
    setError(null);
    let rootSecret: Uint8Array;
    try {
      rootSecret = phraseToRootSecret(phrase);
    } catch (reason) {
      setError(formatPhraseValidationError(reason));
      return;
    }
    try {
      await configure(rootSecret, defaultRelayUrl, false);
    } catch (reason) {
      setError(formatVaultSetupError(reason));
    }
  };

  const scan = async ({ data }: BarcodeScanningResult) => {
    if (scanPending.current) {
      return;
    }
    scanPending.current = true;
    setError(null);
    let parsed;
    try {
      parsed = parsePairingQr(data);
    } catch {
      scanPending.current = false;
      setError("Неверный QR-код хранилища");
      return;
    }
    try {
      setMode("choose");
      await configure(base64UrlDecode(parsed.rootSecret), parsed.relayUrl, false);
    } catch (reason) {
      scanPending.current = false;
      setError(formatVaultSetupError(reason));
    }
  };

  const create = async () => {
    try {
      setError(null);
      const root = await generateRootSecret(new ExpoCryptoProvider());
      setPendingRoot(root);
      setShown(rootSecretToPhrase(root));
      setQr(createPairingQr(defaultRelayUrl, root));
      setMode("show");
    } catch (reason) {
      setError(formatVaultSetupError(reason));
    }
  };

  const confirmCreate = async () => {
    if (pendingRoot === null) return;
    try {
      setError(null);
      await configure(pendingRoot, defaultRelayUrl, true);
      setPendingRoot(null);
    } catch (reason) {
      setError(formatVaultSetupError(reason));
    }
  };

  if (mode === "scan") {
    return <ScrollView style={styles.page}>
      {permission?.granted ? <CameraView style={{ height: 420 }} barcodeScannerSettings={{ barcodeTypes: ["qr"] }} onBarcodeScanned={(result) => { void scan(result); }} /> : <Pressable style={styles.button} onPress={() => { void requestPermission(); }}><Text style={styles.buttonText}>Разрешить камеру</Text></Pressable>}
      <Pressable onPress={() => { scanPending.current = false; setMode("choose"); }} style={styles.secondaryButton}><Text style={styles.secondaryButtonText}>Назад</Text></Pressable>
      {error ? <Text style={styles.error}>{error}</Text> : null}
    </ScrollView>;
  }

  if (mode === "phrase") {
    return <ScrollView style={styles.page}>
      <Text style={styles.settingsWarning}>24 английских слова через пробел. Можно вставить из буфера.</Text>
      <TextInput
        accessibilityLabel="24 слова"
        autoCapitalize="none"
        autoComplete="off"
        autoCorrect={false}
        multiline
        placeholder="abandon ability able ..."
        spellCheck={false}
        style={styles.input}
        value={phrase}
        onChangeText={setPhrase}
      />
      <Pressable style={styles.button} onPress={() => { void restorePhrase(); }}><Text style={styles.buttonText}>Восстановить</Text></Pressable>
      <Pressable onPress={() => setMode("choose")} style={styles.secondaryButton}><Text style={styles.secondaryButtonText}>Назад</Text></Pressable>
      {error ? <Text style={styles.error}>{error}</Text> : null}
    </ScrollView>;
  }

  if (mode === "show") {
    return <ScrollView style={styles.page}>
      <Text>Сохраните фразу. Она показывается только сейчас:</Text>
      <RecoveryCards phrase={shown} qr={qr} />
      <Pressable style={styles.button} onPress={() => { void confirmCreate(); }}><Text style={styles.buttonText}>Я сохранил фразу</Text></Pressable>
      {error ? <Text style={styles.error}>{error}</Text> : null}
    </ScrollView>;
  }

  return <ScrollView style={styles.page}>
    <Text style={styles.primary}>Подключить личный план</Text>
    <Pressable style={styles.button} onPress={() => setMode("scan")}><Text style={styles.buttonText}>Сканировать QR</Text></Pressable>
    <Pressable style={styles.secondaryButton} onPress={() => setMode("phrase")}><Text style={styles.secondaryButtonText}>Ввести фразу</Text></Pressable>
    <Pressable style={styles.secondaryButton} onPress={() => { void create(); }}><Text style={styles.secondaryButtonText}>Создать новое хранилище</Text></Pressable>
    {error ? <Text style={styles.error}>{error}</Text> : null}
  </ScrollView>;
}

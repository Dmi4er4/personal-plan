import * as Clipboard from "expo-clipboard";
import { useState } from "react";
import { Pressable, Text, View } from "react-native";
import QRCode from "react-native-qrcode-svg";
import { styles } from "./styles";

export function RecoveryCards({ phrase, qr }: { phrase: string; qr: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async (): Promise<void> => {
    await Clipboard.setStringAsync(phrase);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return <View style={styles.recoveryCards}>
    <Text style={styles.settingsWarning}>Любой, кто получит эту фразу, получит полный доступ к плану.</Text>
    <View style={styles.recoveryPhraseCard}>
      <View style={styles.recoveryCardHeader}>
        <Text style={styles.recoveryCardLabel}>Фраза</Text>
        <Pressable
          accessibilityLabel={copied ? "Скопировано" : "Копировать фразу"}
          accessibilityRole="button"
          onPress={() => { void copy(); }}
          style={styles.recoveryCopyButton}
        >
          <Text style={styles.recoveryCopyIcon}>{copied ? "✓" : "⧉"}</Text>
        </Pressable>
      </View>
      <Text accessibilityLabel="Фраза восстановления" selectable style={styles.settingsPhrase}>{phrase}</Text>
    </View>
    <View accessibilityLabel="QR-код хранилища" style={styles.recoveryQrCard}>
      <Text style={styles.recoveryCardLabel}>QR</Text>
      <QRCode value={qr} size={168} />
    </View>
  </View>;
}

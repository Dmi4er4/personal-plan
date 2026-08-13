import type { WidgetBridge } from "./contracts";

export async function writeSnapshotAndRefresh(
  bridge: WidgetBridge,
  snapshotJson: string,
): Promise<void> {
  if (bridge.writeSnapshotAndRefresh !== undefined) {
    await bridge.writeSnapshotAndRefresh(snapshotJson);
    return;
  }
  await bridge.writeSnapshot(snapshotJson);
  await bridge.requestRefresh();
}

export interface PlanWidgetModuleApi {
  writeSnapshot(snapshotJson: string): Promise<void>;
  writeSnapshotAndRefresh(snapshotJson: string): Promise<void>;
  readCommands(): Promise<string[]>;
  acknowledgeCommands(commandIds: string[]): Promise<void>;
  requestRefresh(): Promise<void>;
}

import type { CompletionCommand, CreateTaskCommand } from "@personal-plan/core";
export interface WidgetTask { id: string; title: string; note: string | null; completed: boolean; depth: 0 | 1 }
export interface WidgetSection { key: string; primaryLabel: string; secondaryLabel: string | null; farSection?: boolean; muchLaterDivider?: boolean; tasks: WidgetTask[] }
export interface WidgetSnapshot { version: 1; generatedAt: string; syncState: "synced" | "pending" | "offline" | "error"; sections: WidgetSection[] }
export interface WidgetCompletionCommand extends CompletionCommand { version: 1; kind?: "completion" }
export interface WidgetCreateTaskCommand extends CreateTaskCommand { version: 1; kind: "create" }
export type WidgetCommand = WidgetCompletionCommand | WidgetCreateTaskCommand;
export interface WidgetBridge {
  writeSnapshot(snapshotJson: string): Promise<void>;
  /** Native builds use one bridge hop for the durable write + redraw. */
  writeSnapshotAndRefresh?(snapshotJson: string): Promise<void>;
  readCommands(): Promise<string[]>;
  acknowledgeCommands(commandIds: string[]): Promise<void>;
  requestRefresh(): Promise<void>;
}

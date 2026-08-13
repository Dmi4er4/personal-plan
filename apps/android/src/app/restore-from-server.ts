import type { SqlitePlanStore } from "../storage/sqlite-plan-store";

export async function discardLocalPlanForServerRestore(
  planStore: Pick<SqlitePlanStore, "reset">,
  remountPlan: () => void,
): Promise<void> {
  await planStore.reset();
  remountPlan();
}

import { openDatabaseAsync, type SQLiteDatabase } from "expo-sqlite";

export const PERSONAL_PLAN_DB_NAME = "personal-plan.db";

let dbPromise: Promise<SQLiteDatabase> | null = null;

export function openPersonalPlanDatabase(): Promise<SQLiteDatabase> {
  if (dbPromise === null) {
    dbPromise = openDatabaseAsync(PERSONAL_PLAN_DB_NAME);
  }
  return dbPromise;
}

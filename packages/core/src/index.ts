import * as Y from "yjs";

export {
  addTask,
  applyWidgetCompletionCommand,
  editTask,
  moveTask,
  promoteSubtask,
  pruneAppliedWidgetCommands,
  reparentTask,
  removeTask,
  restoreTask,
  setTaskCompleted,
} from "./model/commands.js";
export {
  PlanInvariantError,
  snapshotPlan,
} from "./model/schema.js";
export { InvalidLocalDateError, addDays, compareLocalDate } from "./time/local-date.js";
export {
  effectiveBucket,
  isEffectivelyCompleted,
  projectPlan,
} from "./time/project.js";
export { pruneExpiredHistory } from "./time/prune.js";
export { formatSectionHeading, parseSectionHeading } from "./text/headings.js";
export { parseLegacyNote } from "./text/legacy.js";
export { parsePlanText } from "./text/parse.js";
export {
  applyReconcilePreview,
  buildReconcilePreview,
  StaleReconcilePreviewError,
} from "./text/reconcile.js";
export { serializePlan } from "./text/serialize.js";
export type {
  Bucket,
  CompletionCommand,
  LocalDate,
  NewTaskInput,
  RemovalMeta,
  TaskSnapshot,
} from "./model/types.js";
export type {
  PlanDiagnostic,
  PlanDiagnosticCode,
  PlanSnapshot,
} from "./model/schema.js";
export type { ProjectedPlan, ProjectedSection } from "./time/project.js";
export type {
  DiagnosticCode,
  HeadingDiagnostic,
  LegacyCounts,
  ParseDiagnostic,
  ParsedPlan,
  ParsedSection,
  ParsedTask,
} from "./text/types.js";
export type {
  ApplyReconcileOptions,
  ReconcileContainerSignature,
  ReconcileChange,
  ReconcilePreview,
} from "./text/reconcile.js";
export type { SectionHeadingParseResult } from "./text/headings.js";

export function createPlanDoc(): Y.Doc {
  const doc = new Y.Doc();
  doc.getMap("tasks");
  return doc;
}

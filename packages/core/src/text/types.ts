import type { Bucket } from "../model/types.js";

export type DiagnosticCode =
  | "content_before_section"
  | "invalid_date_heading"
  | "unrecognized_heading"
  | "invalid_indentation"
  | "nested_too_deep"
  | "orphan_subtask"
  | "duplicate_far_section"
  | "legacy_near_section_overflow";

export interface ParseDiagnostic {
  line: number;
  code: DiagnosticCode;
  severity: "error" | "warning";
  message: string;
}

export type HeadingDiagnostic = Omit<ParseDiagnostic, "line"> & {
  code: "invalid_date_heading" | "unrecognized_heading";
};

export interface ParsedTask {
  line: number;
  title: string;
  note: string | null;
  completed: boolean;
  depth: 0 | 1;
}

export interface ParsedSection {
  bucket: Bucket;
  heading: string;
  tasks: ParsedTask[];
}

export interface LegacyCounts {
  completedTasks: number;
  farSections: number;
  nearSections: number;
  tasks: number;
}

export interface ParsedPlan {
  legacyCounts: LegacyCounts | null;
  mode: "canonical" | "legacy";
  source: string;
  sections: ParsedSection[];
  diagnostics: ParseDiagnostic[];
}

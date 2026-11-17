export interface TaskSource {
  repository: string;
  path: string;
  commit: string;
  url: string;
  file_sha256: string;
  instance_id: number | string;
  changes: string[];
  excluded_example_instance_ids?: number[];
  dataset?: string;
  split?: string;
  row_index?: number;
  identifier?: string;
  reference_path?: string;
  reference_file_sha256?: string;
  license?: string;
  license_url?: string;
  attribution?: string;
}
interface TaskBase {
  task_id: string;
  version: string;
  title: string;
  language: string;
  source: TaskSource;
  description: string;
  participant_instruction: string;
  final_instruction: string;
}
export interface BlocksworldTask extends TaskBase {
  kind: "blocksworld";
  actions: { name: string; label: string; rule: string }[];
  rules: string[];
  initial_state: string[];
  initial_stacks: string[][];
  goal_state: string[];
  original: { rules: string; initial_state: string; goal_state: string };
}
export type ReferenceCell = string | number | boolean | null;
export type TravelReference = string | Record<string, ReferenceCell>[];
export interface TravelPlannerTask extends TaskBase {
  kind: "travelplanner";
  query: string;
  trip_details: { label: string; value: string }[];
  reference_notice: string;
  reference_information: Record<string, TravelReference>;
  original: { query: string; fields: Record<string, unknown> };
}
export interface IdeaCriterion {
  name: string;
  label: string;
  detail: string;
}
export interface LiveIdeaTask extends TaskBase {
  kind: "liveidea";
  /** Shown to the participant and the AI exactly as written, in English, in both UI languages. */
  keyword: string;
  criteria: IdeaCriterion[];
  word_limit: { target: number; max: number };
  original: { idea_prompt: string };
}
export type Task = BlocksworldTask | TravelPlannerTask | LiveIdeaTask;
export interface TaskOption {
  task_id: string;
  kind: Task["kind"];
  title: string;
  summary: string;
  /** Set for keyword variants of one task kind; the setup screen offers them as a second choice. */
  keyword?: string;
  /** Still served by task link (?task=…) and kept for old sessions, but not offered in the task menu. */
  hidden?: boolean;
}
export interface TaskCatalog {
  default_task_id: string;
  tasks: TaskOption[];
}

import blocksworldData from "./blocksworld-instance-2.json";
import travelPlannerData from "./travelplanner-validation-row-0.json";
import liveIdeaData from "./liveideabench-kixlab.json";
import type {
  BlocksworldTask,
  LiveIdeaTask,
  TravelPlannerTask,
  Task,
  TaskCatalog,
} from "./types";

// One task per keyword, so the keyword is fixed in config_id like any other task content.
const { task_id_prefix, keywords, ...liveIdeaCommon } = liveIdeaData;
const liveIdeaTasks: LiveIdeaTask[] = keywords.map(({ slug, keyword }) => ({
  ...liveIdeaCommon,
  task_id: `${task_id_prefix}-${slug}`,
  kind: "liveidea",
  keyword,
  source: { ...liveIdeaCommon.source, instance_id: keyword },
}));

export const tasks: readonly Task[] = [
  ...liveIdeaTasks,
  { ...travelPlannerData, kind: "travelplanner" } satisfies TravelPlannerTask,
  // Retired from the task menu; kept so task links, old sessions and the automated suite still resolve it.
  { ...blocksworldData, kind: "blocksworld" } satisfies BlocksworldTask,
];
const hiddenKinds: readonly Task["kind"][] = ["blocksworld"];
export const defaultTask = tasks[0];
const summaries: Record<Task["kind"], string> = {
  liveidea: "LiveIdeaBench · write one research idea from a keyword.",
  travelplanner:
    "TravelPlanner · prepare a 3-day itinerary using supplied travel data.",
  blocksworld: "PlanBench · move blocks to a goal state.",
};
export const taskCatalog: TaskCatalog = {
  default_task_id: defaultTask.task_id,
  tasks: tasks.map((task) => ({
    task_id: task.task_id,
    kind: task.kind,
    title: task.title,
    summary: summaries[task.kind],
    ...(task.kind === "liveidea" ? { keyword: task.keyword } : {}),
    ...(hiddenKinds.includes(task.kind) ? { hidden: true } : {}),
  })),
};
// A dedicated context builder keeps source metadata and future researcher-only fields out of model instructions.
export function taskContext(task: Task) {
  const common = {
    task_id: task.task_id,
    kind: task.kind,
    description: task.description,
    participant_instruction: task.participant_instruction,
    final_instruction: task.final_instruction,
  };
  if (task.kind === "blocksworld")
    return {
      ...common,
      actions: task.actions,
      rules: task.rules,
      initial_state: task.initial_state,
      goal_state: task.goal_state,
    };
  if (task.kind === "liveidea")
    return {
      ...common,
      keyword: task.keyword,
      criteria: task.criteria,
      word_limit: task.word_limit,
    };
  return {
    ...common,
    query: task.query,
    trip_details: task.trip_details,
    reference_notice: task.reference_notice,
    reference_information: task.reference_information,
  };
}

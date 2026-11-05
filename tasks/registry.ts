import blocksworldData from "./blocksworld-instance-2.json";
import travelPlannerData from "./travelplanner-validation-row-0.json";
import type {
  BlocksworldTask,
  TravelPlannerTask,
  Task,
  TaskCatalog,
} from "./types";
export const tasks: readonly Task[] = [
  { ...blocksworldData, kind: "blocksworld" } satisfies BlocksworldTask,
  { ...travelPlannerData, kind: "travelplanner" } satisfies TravelPlannerTask,
];
export const defaultTask = tasks[0];
export const taskCatalog: TaskCatalog = {
  default_task_id: defaultTask.task_id,
  tasks: tasks.map((task) => ({
    task_id: task.task_id,
    kind: task.kind,
    title: task.title,
    summary:
      task.kind === "blocksworld"
        ? "PlanBench · move blocks to a goal state."
        : "TravelPlanner · prepare a 3-day itinerary using supplied travel data.",
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
  return {
    ...common,
    query: task.query,
    trip_details: task.trip_details,
    reference_notice: task.reference_notice,
    reference_information: task.reference_information,
  };
}

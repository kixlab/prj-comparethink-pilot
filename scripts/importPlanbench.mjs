// Usage: node scripts/importPlanbench.mjs /path/to/official.json SOURCE_COMMIT
// The raw dataset (including solutions) must stay outside this repository.
import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
const [path, commit] = process.argv.slice(2);
if (!path || !/^[a-f0-9]{40}$/.test(commit ?? ""))
  throw new Error(
    "Provide the official JSON and its 40-character source commit.",
  );
const raw = readFileSync(path);
const data = JSON.parse(raw);
const instance = data.instances.find((x) => x.instance_id === 2);
const statements = instance.query.split("[STATEMENT]");
if (statements.length !== 3 || instance.example_instance_ids.join() !== "1")
  throw new Error("Unexpected source structure; review extraction.");
const rules = statements[0].trim();
const target = statements.at(-1).split("My plan is as follows:")[0].trim();
const initial = target.match(/As initial conditions I have that, (.*)\./)?.[1];
const goal = target.match(/My goal is to have that (.*)\./)?.[1];
if (
  !initial ||
  !goal ||
  !initial.includes("the red block is on top of the blue block") ||
  goal !== "the orange block is on top of the red block"
)
  throw new Error("Target changed; review the task presentation.");
const task = {
  task_id: "planbench-blocksworld-task1-instance2",
  version: "1.2.0",
  kind: "blocksworld",
  participant_instruction:
    "Read the action rules, initial state, and goal. You may chat with the AI freely while working on the action sequence. Submit your final plan yourself when you are finished.",
  title: "Blocksworld planning task",
  language: "en",
  source: {
    repository: "https://github.com/karthikv792/LLMs-Planning",
    path: "plan-bench/prompts/blocksworld/task_1_plan_generation.json",
    commit,
    url: `https://github.com/karthikv792/LLMs-Planning/blob/${commit}/plan-bench/prompts/blocksworld/task_1_plan_generation.json`,
    file_sha256: createHash("sha256").update(raw).digest("hex"),
    instance_id: 2,
    excluded_example_instance_ids: [1],
    changes: [
      "Selected instance_id 2; removed the separate example statement and worked solution.",
      "Omitted ground_truth_plan entirely.",
      "Presented in English with rules and target conditions organized into labeled sections; block identities, legal actions, initial state and goal are unchanged.",
      "Added action notation labels and explicit final submission instructions; no optimality requirement or feedback.",
    ],
  },
  description:
    "Write a sequence of actions that moves the red, blue, yellow, and orange blocks from the initial state to the goal state. You may chat with the AI while working on the task.",
  actions: [
    {
      name: "pick-up",
      label: "Pick up a block",
      rule: "You can pick up a block only if your hand is empty, the block is on the table, and the block is clear.",
    },
    {
      name: "unstack",
      label: "Unstack a block",
      rule: "You can unstack a block only if your hand is empty, the block is directly on top of another block, and the block being removed is clear.",
    },
    {
      name: "put-down",
      label: "Put down a block",
      rule: "You can put down only a block you are holding. Placing it on the table makes your hand empty.",
    },
    {
      name: "stack",
      label: "Stack a block",
      rule: "You can stack a block only if you are holding it and the other block is clear. Your hand then becomes empty, and the block underneath is no longer clear.",
    },
  ],
  rules: [
    "You can pick up or unstack only one block at a time.",
    "A block is clear if no other block is on top of it and it is not being held.",
    "Picking up or unstacking a block makes you hold it. You can put down or stack only a block you are holding.",
  ],
  initial_state: [
    "The red block is on top of the blue block.",
    "The yellow block is on top of the orange block.",
    "The blue block and the orange block are on the table.",
    "The red block and the yellow block are clear.",
    "Your hand is empty.",
  ],
  initial_stacks: [
    ["blue", "red"],
    ["orange", "yellow"],
  ],
  goal_state: ["The orange block must be on top of the red block."],
  final_instruction:
    "Write and submit your final plan as an ordered sequence of actions. You may use natural language or the action names (pick-up, unstack, put-down, stack). AI responses are not submitted automatically.",
  original: { rules, initial_state: initial, goal_state: goal },
};
const serialized = JSON.stringify(task, null, 2) + "\n";
if (/"ground_truth_plan"\s*:|\[PLAN\]|\[PLAN END\]/.test(serialized))
  throw new Error("Unsafe extraction.");
writeFileSync(
  new URL("../tasks/blocksworld-instance-2.json", import.meta.url),
  serialized,
);
console.log(`Extracted ${task.task_id}; examples and solutions excluded.`);

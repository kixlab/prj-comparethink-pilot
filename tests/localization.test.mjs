import { test } from "node:test";
import assert from "node:assert/strict";
import { loadTsBundle } from "../scripts/loadTsBundle.mjs";
const { tasks, taskContext } = await loadTsBundle("tasks/registry.ts", "node");
const { localizeTask } = await loadTsBundle("tasks/localization.ts", "node");
const { translate } = await loadTsBundle("src/pilot/translations.ts", "node");
const { instructionsForTask } = await loadTsBundle(
  "src/pilot/types.ts",
  "node",
);
const { makeConfiguration } = await loadTsBundle(
  "server/pilotPlugin.ts",
  "node",
);

test("Korean tasks retain benchmark identities, originals and all reference values without changing the English source", () => {
  for (const original of tasks) {
    const before = JSON.stringify(original),
      korean = localizeTask(original, "ko");
    assert.equal(korean.task_id, original.task_id);
    assert.equal(korean.language, "ko");
    assert.notEqual(korean.description, original.description);
    assert.notEqual(
      korean.participant_instruction,
      original.participant_instruction,
    );
    assert.notEqual(korean.final_instruction, original.final_instruction);
    assert.deepEqual(korean.original, original.original);
    assert.equal(korean.source.commit, original.source.commit);
    assert.equal(korean.source.file_sha256, original.source.file_sha256);
    assert.match(
      korean.source.changes.at(-1),
      /Korean presentation translation v1/,
    );
    if (original.kind === "blocksworld") {
      assert.deepEqual(korean.initial_stacks, original.initial_stacks);
      assert.deepEqual(
        korean.actions.map((a) => a.name),
        original.actions.map((a) => a.name),
      );
      assert.ok(
        korean.actions.every((a, i) => a.rule !== original.actions[i].rule),
      );
      assert.match(korean.goal_state[0], /주황.*빨강/);
    } else {
      assert.deepEqual(
        korean.reference_information,
        original.reference_information,
      );
      assert.match(korean.query, /2022년 3월 13일부터 15일.*1,400달러/);
      assert.deepEqual(
        korean.trip_details.map((d) => d.value),
        [
          "Washington",
          "Myrtle Beach",
          "2022-03-13, 2022-03-14, 2022-03-15",
          "3일",
          "1",
          "$1,400",
        ],
      );
    }
    assert.equal(JSON.stringify(original), before);
    assert.equal(localizeTask(original, "en"), original);
  }
});

test("locale fixes task, model context and the exact saved instructions together while translation never rewrites raw text", () => {
  const original = tasks[0],
    korean = localizeTask(original, "ko");
  const env = { OPENAI_MODEL: "test-model" };
  const englishConfig = makeConfiguration(env, "test", "test", original);
  const koreanConfig = makeConfiguration(env, "test", "test", korean);
  assert.notEqual(koreanConfig.config_id, englishConfig.config_id);
  assert.equal(koreanConfig.model, englishConfig.model);
  assert.deepEqual(koreanConfig.generation, englishConfig.generation);
  assert.match(koreanConfig.system_prompt, /주황 블록이 빨강 블록 위/);
  assert.doesNotMatch(
    koreanConfig.system_prompt,
    /ground_truth_plan|file_sha256|Korean presentation/,
  );
  assert.deepEqual(taskContext(korean).initial_state, korean.initial_state);
  const instructions = instructionsForTask(korean);
  assert.equal(instructions.task, korean.participant_instruction);
  assert.match(
    instructions.think_aloud,
    /입력할 때, AI를 기다릴 때, 응답을 읽을 때/,
  );
  assert.match(
    instructions.audio_notice,
    /음성과 전사문은 대화 AI에 전달하지 않습니다/,
  );
  assert.equal(
    instructionsForTask(original).task,
    original.participant_instruction,
  );
  assert.equal(
    translate("ko", "Play waiting audio, exchange {number}", { number: 2 }),
    "대화 2 응답 대기 음성 재생",
  );
  assert.equal(
    translate("en", "Play waiting audio, exchange {number}", { number: 2 }),
    "Play waiting audio, exchange 2",
  );
  assert.equal(
    translate("ko", "Unknown diagnostic: raw error"),
    "Unknown diagnostic: raw error",
  );
});

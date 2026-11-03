# CompareThink Pilot

인간–AI 채팅과 연속 think-aloud 음성을 수집하는 웹 기반 연구 파일럿입니다. PlanBench Blocksworld 문제 하나를 제공합니다. 원자료와 시간상의 경계를 보존하며, 프롬프트/메시지를 연구상의 move나 node로 정의하지 않습니다. 전사, 자동 node/link 분석, 학습 및 정답 채점은 포함하지 않습니다.

## 실행

Node.js 20 이상, npm, 마이크 녹음과 IndexedDB를 지원하는 최신 브라우저가 필요합니다. Chrome에서 자동 검증했습니다.

```bash
npm install
cp .env.example .env.local
# .env.local에 OPENAI_API_KEY와 연구에 사용할 OPENAI_MODEL 설정
npm run dev
```

`http://localhost:5173`을 엽니다. API 키는 서버의 `.env.local`에만 저장하며 Git에 포함하지 않습니다. `VITE_` 접두사로 키를 설정하지 마세요. 서버는 `/api/config`와 `/api/chat`을 제공합니다. 음성 업로드/전사 API는 없습니다.

```bash
npm run typecheck
npm test
npm run test:browser  # 설치된 Google Chrome 사용; 실제 API 호출 없음
npm run build
npm run preview      # http://localhost:4173, API 미들웨어 포함
```

`dist/`만 정적 호스팅하면 모델 API가 동작하지 않습니다. `preview`는 파일럿 로컬 확인용입니다. 원격 참가자 접속은 HTTPS와 Node API 서버를 유지하는 역방향 프록시가 필요합니다. localhost 이외의 일반 HTTP 주소에서는 브라우저가 마이크를 허용하지 않습니다. 프록시에서는 스트림 버퍼링을 끄고 `PILOT_PUBLIC_ORIGIN=https://실제호스트`를 서버에 지정합니다. 기본 실행은 `127.0.0.1`에만 바인딩합니다.

## 참가자 진행

화면은 영어로 표시됩니다. 장식적인 소개 화면 없이 마이크 확인 폼부터 시작하며, 과제 수행 화면은 과제와 채팅 패널로 나뉩니다. 앱 버전은 `0.2.1`, 영어 과제 표현 버전은 `1.1.0`입니다.

1. 익명 참가자 ID 확인 → 마이크 테스트 녹음 → 재생하여 본인 목소리 확인.
2. 과제 규칙, 초기/목표 상태, think-aloud 및 수집 안내 확인.
3. **과제 시작**을 누르면 새 마이크 스트림으로 녹음이 시작됩니다. 녹음 시작 이벤트를 확인한 뒤 과제 수행 화면을 엽니다.
4. AI와 자유롭게 채팅합니다. 입력/대기/응답 읽기 내내 같은 MediaRecorder가 계속 녹음합니다. 강제 턴 수, 시간 제한, 특정 탐색을 유도하는 질문은 없습니다.
5. **최종 계획 작성**에서 계획을 직접 작성하고 **최종 계획 제출 및 종료**를 누릅니다. AI 응답은 자동 제출되지 않습니다. 제출 없이 끝내면 불완전 수집으로 남습니다.
6. ZIP 다운로드 및 이벤트 시점의 녹음 재생. 같은 브라우저의 저장된 세션에서 다시 다운로드할 수 있습니다.

마이크 테스트 음성은 세션에 저장하지 않습니다. 테스트 확인 여부 및 테스트 중 오류 메타데이터만 세션 시작 후 기록합니다. 마이크가 끊기면 새 메시지 전송을 멈추고 재연결을 제공합니다. 재연결은 새 녹음 segment를 추가하며 앞선 음성/이벤트를 덮어쓰지 않습니다. 다른 탭과의 동시 수집은 Web Locks 지원 브라우저에서 차단합니다.

## 과제 출처와 교체

- 공식 [PlanBench](https://github.com/karthikv792/LLMs-Planning/tree/main/plan-bench).
- 원본 경로: `plan-bench/prompts/blocksworld/task_1_plan_generation.json`.
- 원본 파일 커밋: `9bd247838ec314f048f6a37a147201e74d64572d`.
- 선택: **instance_id 2**. 이 항목 안의 **example_instance_ids [1]**은 별개의 예제입니다.
- 원본 query에서 행동 규칙과 **마지막 `[STATEMENT]`의 대상 문제만** 추출합니다. 앞선 예제 상태·예제 풀이 및 `ground_truth_plan` 필드는 포함하지 않습니다. 원본 전체 파일은 런타임/번들/저장소에 넣지 않습니다.
- 참가자 화면과 과제는 영어로 제공합니다. 원본 규칙·초기 상태·목표를 항목별로 정리하고 행동 이름과 제출 안내를 덧붙였습니다. 블록/규칙/목표는 유지합니다. 원문 발췌, 파일 SHA-256, 커밋, 변경 목록은 `task.json`에 남습니다.

문제 데이터는 [`tasks/blocksworld-instance-2.json`](tasks/blocksworld-instance-2.json)에 있으며 UI 코드와 분리되어 있습니다. 다른 문제로 바꾸려면 새 안전한 task JSON을 만들고 `server/pilotPlugin.ts`와 `src/pilot/types.ts`의 import를 함께 교체하세요. 현재 블록 그림은 JSON의 `initial_stacks`로 렌더링하며, 데이터 교체 시 번역/규칙/그림이 일치하는지 확인하세요. `task_id`/`version`을 새로 지정하고 출처를 갱신합니다.

추출 재현:

```bash
# 정답이 포함된 원본은 레포 밖에만 저장
curl -L 'https://raw.githubusercontent.com/karthikv792/LLMs-Planning/9bd247838ec314f048f6a37a147201e74d64572d/plan-bench/prompts/blocksworld/task_1_plan_generation.json' -o /tmp/planbench.json
node scripts/importPlanbench.mjs /tmp/planbench.json 9bd247838ec314f048f6a37a147201e74d64572d
```

추출기는 원본 구조와 대상 조건을 확인하고 예제와 풀이를 제외합니다. 다른 instance를 사용할 때는 추출기와 참가자에게 제시하는 문구를 함께 변경해야 합니다. 참가자 UI에는 정답이 있는 원본 파일로의 직접 링크를 제공하지 않습니다. 출처 URL은 연구용 내보내기 메타데이터에 보존됩니다.

## 모델 설정과 데이터 경계

`server/pilotPlugin.ts`의 `makeConfiguration`에서 모델 설정과 시스템 프롬프트를 구성합니다.

| 서버 환경변수              | 기본값         | 설명                                                     |
| -------------------------- | -------------- | -------------------------------------------------------- |
| `OPENAI_API_KEY`           | 없음           | 서버 전용 키. 없으면 과제 시작을 막고 안내               |
| `OPENAI_MODEL`             | `gpt-4.1-mini` | 연구에서 고정할 모델. 가능하면 명시적 모델 snapshot 지정 |
| `OPENAI_MAX_OUTPUT_TOKENS` | `4096`         | 요청별 출력 한도                                         |
| `OPENAI_TEMPERATURE`       | 미지정         | 선택 모델에서 지원할 때만 지정                           |
| `OPENAI_REASONING_EFFORT`  | 미지정         | 선택 모델에서 지원할 때만 지정                           |
| `PILOT_PUBLIC_ORIGIN`      | 없음           | HTTPS 역방향 프록시에서 사용하는 정확한 외부 origin      |

설정 변경 뒤 서버를 재시작하세요. 모델명, 생성 설정, 시스템 프롬프트 전문, 과제 및 앱 버전을 세션에 복사합니다. 이 내용의 SHA-256 `config_id`를 각 요청에서 확인하므로 서버 설정이 바뀐 진행 중 세션은 HTTP 409로 실패하며 조용히 다른 모델로 전환되지 않습니다. 앱 버전은 package version과 Git commit을 기록합니다. 미커밋 소스는 `-dirty`로 표시합니다.

브라우저 → 서버 요청은 `session_id`, `request_id`, `config_id`, `messages[{role,content}]`만 허용합니다. 서버는 자체 task 데이터로 만든 지시문과 채팅 원문만 모델로 전달합니다. 음성 Blob, 초안 수정 이력, think-aloud, 이벤트, 최종 제출 초안은 전송하지 않습니다. API 키 역시 클라이언트 설정에 포함하지 않습니다. 실패하거나 중단된 AI의 **수신된 텍스트**는 채팅에 보존되며, 후속 요청의 채팅 이력에도 포함됩니다. 새로 보내는 메시지는 별도의 요청 ID를 갖습니다.

[공식 OpenAI 스트리밍 문서](https://developers.openai.com/api/docs/guides/streaming-responses)에 따라 Responses API SSE를 서버에서 읽고 텍스트 delta, 완료, 실패를 브라우저로 중계합니다. `store:false`를 명시합니다. 완료 이벤트 없는 연결 종료, HTTP 오류, 제한으로 인한 incomplete 응답, 명시적 응답 중단을 구분해서 기록하며, 이미 받은 텍스트는 삭제하지 않습니다. 서버 요청 시간 한도는 180초입니다.

## 시간축과 입력 기록 빈도

모든 원본 이벤트에는 다음 필드가 있습니다.

```json
{
  "event_id": "UUID",
  "session_id": "UUID",
  "sequence": 1,
  "t_ms": 12.345,
  "type": "draft_changed",
  "payload": {
    "field": "prompt",
    "draft_id": "UUID",
    "text": "현재 입력 전체",
    "input_type": "insertText",
    "is_composing": false,
    "selection_start": 7,
    "selection_end": 7
  }
}
```

- `sequence`: 세션 내 1부터 증가하는 순서. 같은 시각이어도 이 순서로 재생할 수 있습니다.
- `t_ms = performance.now() - session.clock.start_performance_ms`. 단조 증가하는 공통 시간축입니다. 세션 생성 시각은 UTC와 `performance.timeOrigin`으로 함께 남습니다. 과제 시작/녹음 시작은 별도 이벤트이며 둘 사이의 차이를 보존합니다.
- **입력 빈도: 텍스트가 바뀌는 모든 DOM input/React onChange마다 전체 문자열을 즉시 이벤트로 기록합니다. debounce, throttle, 키 단위 수집은 없습니다.** 붙여넣기/삭제/IME 변경도 포함합니다. 각 변경은 IndexedDB 기록 큐에 즉시 추가합니다. 조합 이벤트와 선택 범위, inputType을 보존합니다. 전송으로 비워진 입력은 `draft_reset`으로 기록합니다.
- IME 조합 중의 Enter, native `isComposing`, keyCode 229에서는 전송하지 않습니다. Shift+Enter는 줄바꿈입니다.
- `prompt_sent`에 원문, 메시지·요청·초안 ID를 함께 남깁니다. `ai_request_started`는 사용자 메시지 ID와 대화 이력 메시지 ID를 연결합니다.
- `ai_text_received`는 각 수신 delta 원문을 보존합니다. `ai_first_display`는 첫 텍스트를 React 뷰에 제공한 시점이며, 실제 화면 프레임 관찰은 `ai_paint_observed`로 따로 기록합니다. 하드웨어 수준의 화면 표시 시각을 보장하지 않습니다.
- 녹음에는 `MediaRecorder.start()` 직전 `start_call_t_ms`, `start` 이벤트 관찰 시각 `started_t_ms`, 중단 시각, 실제 MIME, 오디오 track 설정을 보존합니다. **음성 위치(초) ≈ `(event.t_ms - segment.started_t_ms) / 1000`**. 마이크/브라우저 지연으로 인한 오차가 있으며 샘플 수준 정렬이나 단어 타임스탬프가 아닙니다.
- `start(1000)`으로 약 1초마다 원본 Blob을 저장합니다. echoCancellation/noiseSuppression/autoGainControl은 false로 요청하고 실제 track 설정도 기록합니다. 브라우저 사정으로 전달 간격이 길어질 수 있습니다. `received_t_ms`는 Blob 전달 시각이며 음성 경계가 아닙니다. `recorder_timecode_ms`를 변환 없이 따로 보존합니다.
- `audio/manifest.json`의 segment/chunk 순서와 시간 대응 정보를 사용하세요. **청크는 단독으로 재생 가능하다고 가정하면 안 됩니다.** 같은 segment 내 청크를 index 순으로 연결한 파일도 함께 제공합니다. 재연결된 segment 사이의 누락을 이어붙여 숨기지 않습니다.

## 수집 이벤트

| 종류          | 이벤트                                                                                                                                                                                                                    |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 세션/과제     | `session_created`, `microphone_test_confirmed`, `task_started`, `task_ended`, `session_ended`                                                                                                                             |
| 초안          | `draft_changed`, `draft_reset`, `composition_started`, `composition_ended`                                                                                                                                                |
| 대화          | `prompt_sent`, `ai_request_started`, `ai_provider_response`, `ai_text_received`, `ai_first_display`, `ai_paint_observed`, `ai_completed`, `ai_stop_requested`, `ai_interrupted`, `ai_failed`                              |
| 음성          | `recording_started`, `audio_chunk_received`, `recording_stopped`, `recording_error`, `recording_muted`, `recording_unmuted`, `recording_restart_requested`                                                                |
| 장애/관찰     | `storage_error`, `storage_recovered`, `network_offline`, `network_online`, `collection_gap_started`, `collection_gap_ended`, `collector_heartbeat`, `collector_suspension`, `collector_interrupted`, `visibility_changed` |
| 제출/내보내기 | `final_submitted`, `export_requested`, `export_error`                                                                                                                                                                     |

이벤트/텍스트 구간은 관찰 단위이며 move/node가 아닙니다. 추후 연구자가 시간 범위, event ID, message ID를 참조해서 여러 기준의 분절과 link를 별도로 정의할 수 있습니다.

## 점진 저장·복구·내보내기

IndexedDB `comparethink-pilot-v1`에 `sessions`, `events`, `audio` store를 사용합니다. 이벤트와 오디오 청크는 **add-only**로 저장하고, 함께 저장하는 세션 메타데이터만 최신 snapshot으로 갱신합니다. 쓰기는 직렬 트랜잭션이며 원본 이벤트/청크를 덮어쓰지 않습니다. 메시지는 원본 이벤트로부터 재구성합니다.

저장 실패 시 실패한 쓰기와 이후 원자료를 현재 탭 메모리에 유지하고, 새 전송을 차단하며, 저장 재시도와 현재 기록 다운로드를 제공합니다. 재시도는 실패 지점부터 이어집니다. 탭이 살아 있는 동안 메모리 사본으로도 ZIP을 만들 수 있습니다. 저장 실패 상태에서 탭/브라우저를 닫으면 아직 디스크에 쓰지 못한 자료는 복구할 수 없습니다. UI의 저장 오류/대기 상태와 내보낸 `pending_writes`를 확인하세요.

마이크 중단·mute, 저장 실패, 네트워크 offline 및 6초 넘는 이벤트 루프 정지 의심 구간은 `gaps`와 오류 이벤트로 남깁니다. 복구 후에도 그 사실은 지우지 않으며 `collection_status: incomplete`를 유지합니다. 2초 heartbeat는 브라우저 중단의 관찰 보조 자료이며 모든 OS 수준 손실을 감지하지는 못합니다. 녹음 byte가 없으면 정상 수집으로 분류하지 않습니다.

페이지 종료는 `pagehide`에서 best-effort로 기록합니다. 강제 종료는 최종 청크나 마지막 미완료 트랜잭션을 잃을 수 있습니다. 저장된 미종료 세션은 내보낼 때 interrupted/incomplete로 표시하고 종료 시각을 만들어내지 않습니다. 새 페이지에서 기존 세션을 같은 시계로 이어서 수집하지 않습니다. 새 수집은 항상 새 UUID입니다.

ZIP 구성:

```text
session.json          # 익명 ID, 설정, 과제·모델·앱 버전, 안내 전문, 시계, 상태, 오류/구간
 task.json            # 실제 제시한 안전한 과제 + 출처·변경 사항·원문 발췌
 events.jsonl         # sequence 순 원본 이벤트
 messages.json        # 사용자/AI 원문, message/request ID, 시각, 응답 상태
 final_answer.txt     # 명시적으로 제출한 원문. 미제출이면 빈 파일
 audio/manifest.json  # 실제 MIME, segment/chunk ID·순서·시간, 누락 구간 및 정렬 한계
 audio/segment-001.webm (또는 mp4/ogg/bin) # 원본 청크를 순서대로 연결, 재인코딩 없음
 audio/chunks/...     # 원본 MediaRecorder Blob 각각
```

다운로드는 저장된 데이터를 삭제하지 않습니다. 브라우저 다운로드 취소/차단 여부를 웹 앱이 항상 확인할 수는 없으므로 완료 후 언제든 **ZIP 다시 받기**를 사용할 수 있습니다. 브라우저 저장소는 서버 백업이 아닙니다. 기록은 해당 origin/브라우저 프로필에 남으므로 연구 종료 후 ZIP을 확보하세요.

## 코드 구조와 검증

- `src/pilot/App.tsx`, `style.css`: 마이크 테스트, 안내, 과제, 채팅, 제출, 재다운로드, 이벤트 시점 재생.
- `src/pilot/engine.ts`: 세션 시계, 입력/AI/음성 생명주기와 원본 이벤트.
- `src/pilot/storage.ts`: IndexedDB 및 재시도 가능한 append 기록 큐.
- `src/pilot/export.ts`: 이벤트 기반 메시지 재구성과 원본 ZIP.
- `src/pilot/stream.ts`: 서버/클라이언트 공유 SSE 파서.
- `server/pilotPlugin.ts`: 서버 모델 설정, 허용 필드 검증, Responses API 중계.
- `tasks/`: 예제/정답이 제거된 과제 데이터.

`npm test`는 과제 분리, 요청 allowlist, 설정 고정, UTF-8 스트리밍, ZIP 보존, IndexedDB 장애/재시도, 연속 녹음 생명주기를 검사합니다. `npm run test:browser`는 실제 Chrome의 MediaStream/MediaRecorder/IndexedDB/다운로드를 사용합니다. getUserMedia 장치 경계에 Web Audio로 만든 알려진 합성 신호를 주입하고 외부 모델은 제어된 SSE fixture로 대체합니다. 실제 OS 마이크 권한/장치 캡처를 통과한 검증은 아닙니다. 녹음된 Opus를 실제로 디코딩해 입력·대기·응답 중 음성 신호를 확인하고, 시점 이동, 한글 IME, 부분 응답 실패, 사용자 중단, 마이크 재연결, 저장 오류, 미종료 복구를 검증합니다. 실제 사람의 발화 및 실제 모델 API 연결 확인은 파일럿 시작 전 실제 장치에서 별도로 수행하세요.

OS가 가상 장치 캡처를 지원하는 환경에서는 `PILOT_TEST_AUDIO=native npm run test:browser`로 Chromium의 파일 기반 가상 마이크(getUserMedia 실제 경로)를 사용할 수도 있습니다. 이 macOS 자동화 환경에서는 해당 장치 요청이 대기하여 기본 Web Audio fixture로 검증했습니다. Chrome이 설치되어 있지 않으면 `npx playwright install chromium` 후 `PILOT_TEST_BROWSER=chromium npm run test:browser`를 사용하세요.

현재 저장소에는 CompareThink 파일럿의 소스·테스트·문서만 유지합니다. 이전 SimEval/Excalidraw/Audra 코드, 드라이버, 테스트, 문서와 자극 파일은 로컬 백업을 검증한 뒤 정리했습니다. 정리 전 커밋은 `f3b5fff`이며, Git에 기록되지 않았던 수정도 별도의 로컬 작업 트리 백업에 포함했습니다. 로컬 백업은 저장소에 포함하지 않습니다. 기존 `exports/`와 `runs/` 실험 결과는 원래 위치에도 보존합니다.

구체적인 실행 결과와 장치 수준 확인 범위는 [검증 기록](docs/comparethink-verification.md)에 정리했습니다.

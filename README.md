# CompareThink Pilot

인간–AI 채팅과 연속 think-aloud 음성을 수집하는 웹 기반 연구 파일럿입니다. PlanBench Blocksworld와 공식 TravelPlanner 문제를 하나씩 제공하며 세션 시작 전에 선택할 수 있습니다. 원자료와 시간상의 경계를 보존하며, 프롬프트/메시지를 연구상의 move나 node로 정의하지 않습니다. 종료 후 로컬 Whisper 또는 별도 STT API로 전사하여 리뷰할 수 있습니다. 실시간 전사, 자동 node/link 분석, 학습 및 정답 채점은 포함하지 않습니다.

## 실행

Node.js 20 이상, npm, 마이크 녹음과 IndexedDB를 지원하는 최신 브라우저가 필요합니다. Chrome에서 자동 검증했습니다.

```bash
npm install
cp .env.example .env.local
# .env.local에 OPENAI_API_KEY와 연구에 사용할 OPENAI_MODEL 설정
npm run dev
```

`http://localhost:5173`을 엽니다. API 키는 서버의 `.env.local`에만 저장하며 Git에 포함하지 않습니다. `VITE_` 접두사로 키를 설정하지 마세요. 서버는 `/api/tasks`, `/api/config`, `/api/chat`을 제공합니다. 종료 후 전사에는 별도의 `/api/stt/config`, `/api/stt/transcribe`를 사용하며 대화 모델과 연결을 분리합니다.

```bash
npm run typecheck
npm test
npm run test:browser  # 설치된 Google Chrome 사용; 실제 API 호출 없음
npm run build
npm run preview      # http://localhost:4173, API 미들웨어 포함
```

`dist/`만 정적 호스팅하면 모델 API가 동작하지 않습니다. `preview`는 파일럿 로컬 확인용입니다. 원격 참가자 접속은 HTTPS와 Node API 서버를 유지하는 역방향 프록시가 필요합니다. localhost 이외의 일반 HTTP 주소에서는 브라우저가 마이크를 허용하지 않습니다. 프록시에서는 스트림 버퍼링을 끄고 `PILOT_PUBLIC_ORIGIN=https://실제호스트`를 서버에 지정합니다. 기본 실행은 `127.0.0.1`에만 바인딩합니다.

## 참가자 진행

화면은 영어로 표시됩니다. **Session setup → Task**에서 과제를 선택하고 마이크를 확인합니다. 과제 수행 화면은 과제와 채팅 패널로 나뉩니다. 앱 버전은 `0.4.0`, Blocksworld 과제 표현 버전은 `1.2.0`, TravelPlanner 과제 버전은 `1.0.0`입니다.

1. 과제 선택 → 익명 참가자 ID 확인 → 마이크 테스트 녹음 → 재생하여 본인 목소리 확인.
2. 선택한 과제의 안내와 think-aloud·수집 안내 확인. Blocksworld는 초기/목표 상태와 행동 규칙, TravelPlanner는 여행 요청과 제공된 여행 자료를 확인합니다.
3. **과제 시작**을 누르면 새 마이크 스트림으로 녹음이 시작됩니다. 녹음 시작 이벤트를 확인한 뒤 과제 수행 화면을 엽니다.
4. AI와 자유롭게 채팅합니다. 입력/대기/응답 읽기 내내 같은 MediaRecorder가 계속 녹음합니다. 강제 턴 수, 시간 제한, 특정 탐색을 유도하는 질문은 없습니다.
5. **최종 계획 작성**에서 계획을 직접 작성하고 **최종 계획 제출 및 종료**를 누릅니다. AI 응답은 자동 제출되지 않습니다. 제출 없이 끝내면 불완전 수집으로 남습니다.
6. ZIP 다운로드 및 이벤트 시점의 녹음 재생. 같은 브라우저의 저장된 세션에서 다시 다운로드할 수 있습니다.

마이크 테스트 음성은 세션에 저장하지 않습니다. 테스트 확인 여부 및 테스트 중 오류 메타데이터만 세션 시작 후 기록합니다. 마이크가 끊기면 새 메시지 전송을 멈추고 재연결을 제공합니다. 재연결은 새 녹음 segment를 추가하며 앞선 음성/이벤트를 덮어쓰지 않습니다. 다른 탭과의 동시 수집은 Web Locks 지원 브라우저에서 차단합니다.

## 과제 선택·출처·교체

기본값은 Blocksworld입니다. 시작 화면의 **Task** 드롭다운에서 두 버전을 선택하거나 다음 링크로 과제를 미리 지정할 수 있습니다. 포트는 실제 서버 포트로 바꾸세요.

- `http://localhost:5173/?task=blocksworld`
- `http://localhost:5173/?task=travelplanner`

정확한 `task_id`도 `?task=` 값으로 사용할 수 있습니다. 시작한 세션의 과제는 고정됩니다. 다른 과제로 바꾸려면 현재 세션을 종료하고 새 세션을 시작하세요. 이전 세션을 재다운로드할 때는 저장된 과제와 자료를 그대로 사용합니다.

### PlanBench Blocksworld

- 공식 [PlanBench](https://github.com/karthikv792/LLMs-Planning/tree/main/plan-bench).
- 원본 경로: `plan-bench/prompts/blocksworld/task_1_plan_generation.json`.
- 원본 파일 커밋: `9bd247838ec314f048f6a37a147201e74d64572d`.
- 선택: **instance_id 2**. 이 항목 안의 **example_instance_ids [1]**은 별개의 예제입니다.
- 원본 query에서 행동 규칙과 **마지막 `[STATEMENT]`의 대상 문제만** 추출합니다. 앞선 예제 상태·예제 풀이 및 `ground_truth_plan` 필드는 포함하지 않습니다. 원본 전체 파일은 런타임/번들/저장소에 넣지 않습니다.
- 참가자 화면과 과제는 영어로 제공합니다. 원본 규칙·초기 상태·목표를 항목별로 정리하고 행동 이름과 제출 안내를 덧붙였습니다. 블록/규칙/목표는 유지합니다. 원문 발췌, 파일 SHA-256, 커밋, 변경 목록은 `task.json`에 남습니다.

Blocksworld 데이터는 [`tasks/blocksworld-instance-2.json`](tasks/blocksworld-instance-2.json)에 있으며 블록 그림은 `initial_stacks`로 렌더링합니다. 문제를 바꾸면 규칙·문구·그림이 일치하는지 확인하세요.

추출 재현:

```bash
# 정답이 포함된 원본은 레포 밖에만 저장
curl -L 'https://raw.githubusercontent.com/karthikv792/LLMs-Planning/9bd247838ec314f048f6a37a147201e74d64572d/plan-bench/prompts/blocksworld/task_1_plan_generation.json' -o /tmp/planbench.json
node scripts/importPlanbench.mjs /tmp/planbench.json 9bd247838ec314f048f6a37a147201e74d64572d
```

추출기는 원본 구조와 대상 조건을 확인하고 예제와 풀이를 제외합니다. 다른 instance를 사용할 때는 추출기와 참가자에게 제시하는 문구를 함께 변경해야 합니다. 참가자 UI에는 정답이 있는 원본 파일로의 직접 링크를 제공하지 않습니다. 출처 URL은 연구용 내보내기 메타데이터에 보존됩니다.

### TravelPlanner

[공식 저장소](https://github.com/OSU-NLP-Group/TravelPlanner)와 [공식 데이터셋](https://huggingface.co/datasets/osunlp/TravelPlanner)의 **sole-planning** 자료를 이용한 인간–AI 협업 과제입니다. 원본 도구 환경이나 자동 벤치마크 채점을 실행하는 구성은 아닙니다.

- 데이터셋: `osunlp/TravelPlanner`, 고정 커밋 `8736504ecfc31b7f8b7e40122873c337e83fff7c`.
- 문제: `validation.csv`의 **row 0 (0부터 세는 행 번호)**. Washington → Myrtle Beach, 2022-03-13~15, 3일, 1명, 예산 $1,400.
- 자료: 동일 행의 `validation_ref_info.jsonl`. 관광지 20개, 식당 28개, 숙소 19개, 왕복 항공편·자가운전·택시의 총 9개 자료 섹션을 모두 제공합니다. 표의 원본 열 이름과 값은 유지하며 행을 선별하거나 자르지 않습니다.
- 참가자와 AI가 같은 요청·자료를 받습니다. 날짜와 가격은 원본 벤치마크의 고정 값이며 실제 예약·현재 여행 정보가 아닙니다.
- 최종 결과는 참가자가 직접 작성한 일자별 여행 일정입니다. 예제 일정, `annotated_plan`, 참조 정답, 평가 피드백은 전달하지 않습니다.
- `task.json`과 `session.json`에 원본 query, 자료 전체, 출처·라이선스·변경 사항·각 소스 파일 SHA-256을 보존합니다.
- 데이터 출처: Xie et al., _TravelPlanner: A Benchmark for Real-World Planning with Language Agents_, ICML 2024. 공식 데이터셋의 라이선스는 **CC BY 4.0**입니다. 저자·출처·라이선스 링크와 변경 내역을 과제 메타데이터와 UI의 출처 설명에도 포함합니다.

재추출은 Python 3 표준 라이브러리만 사용합니다. 원본 전체 데이터는 `/tmp` 등 레포 밖에 저장하세요.

```bash
curl -L 'https://huggingface.co/datasets/osunlp/TravelPlanner/resolve/8736504ecfc31b7f8b7e40122873c337e83fff7c/validation.csv' -o /tmp/travelplanner-validation.csv
curl -L 'https://huggingface.co/datasets/osunlp/TravelPlanner/resolve/8736504ecfc31b7f8b7e40122873c337e83fff7c/validation_ref_info.jsonl' -o /tmp/travelplanner-validation-ref.jsonl
python3 scripts/importTravelPlanner.py /tmp/travelplanner-validation.csv /tmp/travelplanner-validation-ref.jsonl 8736504ecfc31b7f8b7e40122873c337e83fff7c 0
```

### 과제 추가 또는 교체

공통 형식과 과제별 필드는 `tasks/types.ts`, 과제 목록과 기본값은 `tasks/registry.ts`에 있습니다. 새 과제 JSON을 만들고 registry에 등록하면 `/api/tasks` 목록과 선택 UI에 반영됩니다. `task_id`와 `version`을 새로 지정하고 출처·변경 내역을 기록하세요. 같은 종류의 문제 교체는 UI 수정 없이 가능하며, 새 종류의 과제는 전용 패널과 `taskContext()` 분기를 추가합니다.

`taskContext()`는 참가자에게 제시한 과제 내용만 모델 지시문으로 구성하는 허용 목록입니다. 소스 메타데이터나 향후 연구자용 필드를 임의로 모델에 넘기지 마세요. `src/pilot/types.ts`의 `instructionsForTask()`는 선택된 과제에 맞는 안내를 만들며, 생성된 세션은 그 전문과 과제 스냅샷을 보관합니다.

## 모델 설정과 데이터 경계

`server/pilotPlugin.ts`의 `makeConfiguration`에서 모델 설정과 시스템 프롬프트를 구성합니다.

| 서버 환경변수              | 기본값                      | 설명                                                        |
| -------------------------- | --------------------------- | ----------------------------------------------------------- |
| `OPENAI_API_KEY`           | 없음                        | 서버 전용 OpenAI 또는 Bedrock API 키. 없으면 과제 시작 차단 |
| `OPENAI_BASE_URL`          | `https://api.openai.com/v1` | OpenAI 또는 Bedrock의 지역별 Responses API 주소             |
| `OPENAI_PROJECT`           | 미지정                      | 선택 프로젝트. `OpenAI-Project` 헤더로 전송                 |
| `OPENAI_MODEL`             | `gpt-4.1-mini`              | 연구에서 고정할 모델. 가능하면 명시적 모델 snapshot 지정    |
| `OPENAI_MAX_OUTPUT_TOKENS` | `4096`                      | 요청별 출력 한도                                            |
| `OPENAI_TEMPERATURE`       | 미지정                      | 선택 모델에서 지원할 때만 지정                              |
| `OPENAI_REASONING_EFFORT`  | 미지정                      | 선택 모델에서 지원할 때만 지정                              |
| `PILOT_PUBLIC_ORIGIN`      | 없음                        | HTTPS 역방향 프록시에서 사용하는 정확한 외부 origin         |

설정 변경 뒤 서버를 재시작하세요. 공급자, API base URL, 프로젝트, 모델명, 생성 설정, 시스템 프롬프트 전문, 과제 및 앱 버전을 세션에 복사합니다. 과제별로 이 내용의 SHA-256 `config_id`를 만들고 각 요청에서 확인하므로 서버 설정이 바뀐 진행 중 세션은 HTTP 409로 실패하며 조용히 다른 모델로 전환되지 않습니다. 앱 버전은 package version과 Git commit을 기록합니다. 미커밋 소스는 `-dirty`로 표시합니다.

### Amazon Bedrock Mantle 연결

Bedrock의 OpenAI 호환 Responses API를 지원합니다. [AWS Responses API 문서](https://docs.aws.amazon.com/bedrock/latest/userguide/inference-responses-api.html)와 [프로젝트 설정](https://docs.aws.amazon.com/bedrock/latest/userguide/cost-mgmt-projects.html)에 따라 `.env.local`에 키·주소·모델·프로젝트를 설정합니다. 변수 이름은 `OPENAI_`지만 Bedrock 주소를 사용하면 요청은 AWS로 전송됩니다. Python SDK를 추가로 설치할 필요는 없습니다.

```dotenv
OPENAI_API_KEY=<Bedrock API key>
OPENAI_BASE_URL=https://bedrock-mantle.us-east-1.api.aws/openai/v1
OPENAI_PROJECT=<Bedrock project ID>
OPENAI_MODEL=openai.gpt-6.1-sol
OPENAI_MAX_OUTPUT_TOKENS=4096
```

연결·수집 기능을 테스트할 때는 아래처럼 저가 모델로 설정할 수 있습니다. Mantle us-east-1의 같은 `/openai/v1` 주소를 사용합니다.

```dotenv
OPENAI_MODEL=openai.gpt-6-luna
OPENAI_REASONING_EFFORT=low
```

위 모델/주소 조합은 전달받은 연결 예시입니다. 실제 모델 접근 권한과 프로젝트는 해당 AWS 계정에서 확인해야 합니다. 모델에 따라 Mantle의 base URL 경로가 `/v1` 또는 `/openai/v1`이므로 모델 카드의 연결 예시와 일치시킵니다. `OPENAI_PROJECT`는 선택 사항이며 설정하면 모든 요청의 `OpenAI-Project` 헤더에 넣습니다. 설정 후 dev/preview 서버를 재시작하고 새 세션으로 테스트하세요. `AWS Access Key ID`와 `Secret Access Key`를 사용하는 SigV4 인증은 이 연결 경로에 구현되어 있지 않습니다.

키는 서버에서만 읽고 세션·내보내기에 포함하지 않습니다. 알려진 키 형식이 공급자와 맞지 않으면 준비 상태를 false로 두고 API 요청을 차단합니다. base URL과 프로젝트도 `config_id`에 포함하므로 진행 중 세션에서 연결 대상을 바꿀 수 없습니다. Bedrock 연결의 `provider`는 `bedrock-responses`로 남습니다. 스트리밍과 부분 응답 보존, 원본 이벤트와 음성 매핑은 동일하며, 연구 음성·미전송 초안은 AWS에도 전송하지 않습니다. 별도의 대화 저장을 만들지 않도록 기존 `store:false`를 유지합니다.

과제 목록은 `GET /api/tasks`, 선택한 과제의 설정은 `GET /api/config?task_id=...`로 읽습니다. 생략 시 기본 과제를 반환하며 알 수 없는 ID는 404입니다. 서버는 첫 채팅 요청에서 세션 ID에 설정 ID를 연결하고, 이후 다른 과제·모델 설정을 사용하면 409로 거절합니다. 이 바인딩은 서버 실행 중 메모리에 유지되며, 클라이언트도 세션 생성 시 설정을 고정합니다.

브라우저 → 서버 요청은 `session_id`, `request_id`, `config_id`, `messages[{role,content}]`만 허용합니다. 서버는 자체 task 데이터로 만든 지시문과 채팅 원문만 모델로 전달합니다. 음성 Blob, 초안 수정 이력, think-aloud, 이벤트, 최종 제출 초안은 전송하지 않습니다. API 키 역시 클라이언트 설정에 포함하지 않습니다. 실패하거나 중단된 AI의 **수신된 텍스트**는 채팅에 보존되며, 후속 요청의 채팅 이력에도 포함됩니다. 새로 보내는 메시지는 별도의 요청 ID를 갖습니다.

[공식 OpenAI 스트리밍 문서](https://developers.openai.com/api/docs/guides/streaming-responses)에 따라 Responses API SSE를 서버에서 읽고 텍스트 delta, 완료, 실패를 브라우저로 중계합니다. `store:false`를 명시합니다. 완료 이벤트 없는 연결 종료, HTTP 오류, 제한으로 인한 incomplete 응답, 명시적 응답 중단을 구분해서 기록하며, 이미 받은 텍스트는 삭제하지 않습니다. 서버 요청 시간 한도는 180초입니다.

## 종료 후 STT: 로컬 시각화 테스트 → 실험용 API

**참가자 브라우저에는 Whisper를 설치하지 않습니다.** 리뷰의 **Generate transcript**를 누르면 저장된 녹음의 복사본을 앱 서버로 보내 전사합니다. 현재 로컬 설정은 Alt의 기존 `large-v3-turbo-q5_0` 모델을 읽는 방식입니다. 원본 녹음과 캡처 이벤트는 수정하지 않습니다. API 모드는 같은 리뷰/저장 형식을 사용하므로 서버 설정만 바꿔 사용할 수 있습니다.

### 로컬 테스트

Python 3, macOS/Xcode 명령행 빌드 도구, FFmpeg가 필요합니다. 실행기와 CMake는 `.local/stt/`에만 설치하며 이 폴더는 Git에서 제외합니다. 기존 Alt 앱·모델·녹음 이력은 변경하지 않고 모델을 다시 다운로드하지도 않습니다.

```bash
bash scripts/setupLocalStt.sh
```

설치 스크립트는 CMake `3.31.6`과 whisper.cpp `v1.9.5`의 커밋 `d1be6fde11ac6e0407606b4e42fe72d34add8037`을 사용합니다. 현재 빌드가 보고하는 버전 문자열은 `1.9.5-dev`이며 결과에 원형 기록합니다. macOS에서는 Metal/Accelerate를 사용하며 Alt의 별도 Core ML 인코더는 이 실행기에 연결하지 않습니다.

`.env.local`:

```dotenv
STT_PROVIDER=local-whisper
STT_LANGUAGE=auto
STT_WHISPER_MODEL="/absolute/path/to/alt/models/whisper-cpp/ggml-large-v3-turbo-q5_0.bin"
# 비우면 이 checkout의 .local/stt/whisper.cpp/build/bin/whisper-cli를 사용
STT_WHISPER_BIN=
# PATH에 없을 때 지정
STT_FFMPEG_BIN=/usr/local/bin/ffmpeg
```

서버를 재시작한 뒤 Complete 또는 Saved sessions → Review recording에서 **Generate transcript**를 누릅니다. 한국어를 명시하려면 `STT_LANGUAGE=ko`, 영어는 `en`, 녹음별 자동 감지는 `auto`입니다. 전사는 번역하지 않으며 협업 AI에 전사 내용이나 음성을 보내지 않습니다. 첫 실행은 모델 로드/컴파일 때문에 더 오래 걸릴 수 있습니다.

### 실험용 API로 전환

현재 API 어댑터는 HTTPS **OpenAI-compatible `/audio/transcriptions`**의 multipart 파일 업로드와 `segments[{start,end,text}]` 응답을 지원합니다. 예를 들어 [OpenAI 파일 전사 API](https://developers.openai.com/api/docs/guides/speech-to-text)의 구간 시각을 제공하는 모델을 사용할 수 있습니다. 실제 실험에 사용할 공급자·모델의 접근 권한과 응답 형식을 확인하고 설정합니다.

```dotenv
STT_PROVIDER=api
STT_API_BASE_URL=https://api.openai.com/v1
STT_API_KEY=<전사용_API_키>
STT_API_MODEL=gpt-4o-transcribe-diarize
STT_API_RESPONSE_FORMAT=diarized_json
STT_LANGUAGE=auto
```

이 예시는 설정 방법이며 유료 STT 호출을 자동 실행하지 않습니다. **대화용 Bedrock 키(`OPENAI_API_KEY`)와 STT 키(`STT_API_KEY`)는 별개이며 서로 대체하지 않습니다.** API 모드에서는 리뷰에 전사 서비스로 음성이 전송된다는 안내와 대상 origin을 표시합니다. 배포 서버에는 Node/FFmpeg와 STT API 설정만 있으면 되고 로컬 Whisper 모델은 필요하지 않습니다. 서버 설정을 바꾸면 리뷰를 새로고침하고 새 전사 시도를 시작하세요. 진행 중 요청의 설정은 바꾸지 않습니다.

- `diarized_json`: 구간의 시작/끝·텍스트·선택적인 speaker 값을 읽습니다. `chunking_strategy=auto`를 보냅니다.
- `verbose_json`: 구간 시각을 요청하며 `timestamp_granularities[]=segment`를 보냅니다. Whisper-compatible 서비스에도 사용할 수 있습니다. OpenAI의 기존 `whisper-1`은 현재 문서상 2027-02-26 종료 예정이므로 신규 실험의 기본값으로 고정하지 않습니다.
- `json`: 시각 없는 텍스트도 보존하되 임의로 발화 시각을 만들지 않습니다. 구간별 재생을 원하면 시간 정보를 반환하는 모델/형식을 선택합니다.
- AWS Transcribe 등 요청·응답 규격이 다른 서비스는 `server/sttPlugin.ts`의 처리 함수를 공통 `TranscriptionResult`로 변환하는 어댑터가 추가로 필요합니다. Bedrock 채팅 엔드포인트 자체를 STT API로 사용하는 구성은 아닙니다.

### 처리·저장·리뷰 형식

- STT는 과제 종료 후 사용자가 요청할 때 실행합니다. 요청에는 녹음과 ID/시각/체크섬만 포함하며 과제 정답·대화·입력 초안은 전사 서비스에 전달하지 않습니다. STT 서버가 외부 API로 보내는 내용은 변환된 오디오·모델·언어/출력 설정뿐입니다.
- 녹음 segment마다 원본 청크를 순서대로 연결해 SHA-256을 확인합니다. FFmpeg로 **별도 사본만** 16 kHz/mono/16-bit PCM으로 변환합니다. 로컬 Whisper는 전체 segment를 처리하고 API 모드는 최대 5분 단위 WAV로 보내 25 MB 파일 제한보다 작게 유지합니다. API 분할 경계에서 문맥이 끊길 수 있으며 프롬프트/턴 경계로 녹음을 자르는 방식은 아닙니다.
- 구간의 `audio_start_ms/audio_end_ms`는 원본 segment 내 추정 시각입니다. `start_t_ms/end_t_ms = segment.started_t_ms + audio_*_ms`로 공통 세션 시간축에 연결합니다. 전사 구간은 연구상의 move/node가 아니며 단어/샘플 수준 정렬을 보장하지 않습니다. 추정 종료 시각이 실제 파일 끝을 약간 넘을 수도 있습니다.
- `TranscriptionRecord`는 `entry_id`, `attempt_id`, 세션/segment ID, 처리 UTC 시각, 상태, 전사 설정, 원본 MIME/크기/해시, 구간·원본 STT 출력·오류를 보존합니다. 로컬 모델 SHA-256/실행기 버전도 기록합니다. 시작과 결과는 각각 **add-only** 레코드이며, 재시도는 새 attempt ID입니다. 실패해도 이전 완료본을 기본 표시로 유지합니다.
- IndexedDB 이름 `comparethink-pilot-v1`은 유지하고 DB version 2에서 `transcriptions` store만 추가합니다. 기존 sessions/events/audio를 지우거나 재작성하지 않습니다. 전사 실패가 원본 세션의 collection_status를 바꾸지는 않습니다. 전사 상태는 별도로 표시합니다.
- 전사 저장 실패 시 탭 메모리에 보존하고 **Retry saving transcript**와 ZIP 내보내기를 제공합니다. ZIP에 `unsaved_entry_ids`/읽기 오류도 표시합니다. 탭을 닫으면 미저장 전사는 잃을 수 있습니다. 진행 중 전사 없이 다시 열린 시작 레코드는 미완료로 표시하며 자동 API 재요청은 하지 않습니다.
- 녹음 1개 업로드 한도는 64 MiB, 변환된 길이는 최대 2시간, 요청 시간 한도는 15분입니다. 현재 STT worker는 한 번에 한 요청을 처리하며 바쁠 때는 429와 재시도 안내를 반환합니다. 완료된 API 조각 이후 실패하면 부분 텍스트와 시각을 반환·저장합니다. 처리용 서버 임시 파일은 완료/실패/취소 후 삭제합니다.
- 전사 텍스트를 누르면 녹음·세션 타임라인·대화 위치가 함께 이동합니다. 자동 전사와 추정 시각은 원음을 들으며 검토하세요.

전사 시도가 있는 ZIP에는 다음 파일이 추가됩니다.

| 파일                  | 내용                                                                                                             |
| --------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `transcriptions.json` | 시작/성공/실패/부분/중단의 전체 시도, 모델/처리 설정, 원본 체크섬, STT 출력, 표시한 attempt ID, 미저장/읽기 상태 |
| `transcript.txt`      | 기본 표시 전사본과 세션 기준 구간 시각. 시각 없는 텍스트는 Untimed로 구분                                        |
| `transcript.vtt`      | 같은 세션 시계의 자막 구간. 녹음 누락 간격을 압축하지 않음                                                       |

## 수집 범위와 음성 시간 매핑

**전송한 프롬프트, AI 응답, 명시적으로 제출한 최종 답안만 텍스트로 수집합니다.** 미전송 초안, 수정·삭제·붙여넣기 이력, 커서/선택 범위, 한글 조합 이벤트는 저장하지 않습니다. 입력창의 값은 현재 화면의 React state에만 유지합니다. 한글 IME 조합 중 Enter 전송 방지와 Shift+Enter 줄바꿈은 유지합니다. 새 세션의 `collection_policy.version: submitted-chat-v1`, `draft_capture: false`로 이 정책을 식별합니다. 이전 버전에서 이미 수집한 원본 이벤트는 삭제하거나 다시 쓰지 않으므로, 예전 세션을 내보내면 기존 초안 이력도 그대로 남습니다.

모든 원본 이벤트에는 다음 필드가 있습니다.

```json
{
  "event_id": "UUID",
  "session_id": "UUID",
  "sequence": 12,
  "t_ms": 12345.678,
  "type": "prompt_sent",
  "payload": {
    "message_id": "USER_MESSAGE_UUID",
    "request_id": "REQUEST_UUID",
    "text": "전송한 프롬프트 원문"
  }
}
```

- `sequence`는 세션 내 1부터 증가하는 순서입니다. 같은 시각이어도 순서를 구분합니다.
- `t_ms = performance.now() - session.clock.start_performance_ms`. 세션 생성 기준의 공통 단조 시간축이며 UTC anchor도 보존합니다. 세션 생성·과제 시작·녹음 시작은 각각 구분합니다.
- 각 요청의 사용자 메시지와 AI 메시지는 `request_id`로 연결하고 `message_id`로 개별 원문을 식별합니다. `ai_request_started`는 사용자 메시지 ID와 대화 이력 메시지 ID도 보존합니다.

| 이벤트                                          | 관찰한 시점                                                                       |
| ----------------------------------------------- | --------------------------------------------------------------------------------- |
| `prompt_sent`                                   | 참가자가 전송을 확정한 시점. 입력을 시작한 시점이 아님                            |
| `ai_request_started`                            | 클라이언트에서 요청 준비. 로컬 저장 완료를 기다리기 전                            |
| `ai_request_dispatched`                         | 로컬 저장 확인 후 브라우저가 서버로 `fetch`를 호출하는 시점                       |
| `ai_response_headers_received`                  | 서버의 HTTP 응답 헤더를 브라우저가 받은 시점. HTTP 상태도 기록                    |
| `ai_first_text_received`                        | 첫 비어 있지 않은 텍스트 delta 수신. 대응하는 `ai_text_received` 이벤트 ID도 기록 |
| `ai_first_display`                              | 첫 텍스트를 React 화면에 제공하는 시점                                            |
| `ai_paint_observed`                             | React commit 이후 requestAnimationFrame 관찰. 화면 표시의 근사 관찰               |
| `ai_completed` / `ai_interrupted` / `ai_failed` | 클라이언트가 응답 완료·중단·실패를 관찰한 시점                                    |

`ai_text_received`는 이후 스트리밍 조각도 각각 내용과 시각을 남깁니다. `messages.json`에는 요청 전송, HTTP 헤더 수신, 첫 텍스트 수신·표시, 프레임 관찰, 종료 시각을 함께 정리합니다. **모델이 입력을 실제로 받은 시각이나 내부적으로 생성을 시작한 시각은 관찰할 수 없습니다.** 첫 텍스트 수신을 생성 시작이라고 부르지 않습니다. 대기 구간에는 네트워크·서버 대기·모델 추론 등이 포함될 수 있고, 서버와 브라우저 시계가 동기화되었다고 가정하지 않습니다.

음성은 입력·대기·응답 읽기 중에도 계속 녹음하며, 위 경계 때문에 파일을 자르지 않습니다.

- MediaRecorder `start()` 직전 `start_call_t_ms`, `start` 이벤트의 `started_t_ms`, 중단 시각, 실제 MIME과 track 설정을 보존합니다. **음성 위치(초) ≈ `(event.t_ms - segment.started_t_ms) / 1000`**입니다. 하드웨어·브라우저 지연 때문에 샘플 수준 정렬이나 단어 타임스탬프가 아닙니다.
- `start(1000)`으로 약 1초마다 원본 Blob을 저장합니다. 브라우저 사정으로 간격이 길어질 수 있습니다. `received_t_ms`는 Blob 전달 시각이며 음성 경계가 아닙니다. `recorder_timecode_ms`도 원형 보존합니다. echoCancellation/noiseSuppression/autoGainControl은 false로 요청하고 실제 설정도 기록합니다.
- `audio/manifest.json`은 녹음 파일과 원본 청크의 순서·시간 정보를 담습니다. 청크는 단독 재생 가능하다고 가정하지 마세요. segment 내 index 순서로 연결한 파일도 함께 제공합니다.
- **`audio/timeline.json`은 주요 이벤트별 `event_id`, `request_id`, `message_id`, `turn_index`, 세션 시각, 대응 녹음 파일과 재생 위치(초)를 제공합니다.** `turn_index`는 요청 식별을 위한 순번이며 연구상의 move/node 정의가 아닙니다.
- `mapping_status`는 `mapped`(음성 바이트가 있는 segment에 위치 계산 가능), `uncertain`(미종료 segment/수집 정지 의심), `gap`(녹음 중단·mute), `outside_recording`(녹음 범위 밖), `unavailable`(해당 segment에 음성 바이트 없음)입니다. 매핑 불가 시 파일·위치는 `null`입니다. `mapped`도 실제 발화나 무손실 녹음을 보장하지 않습니다. 누락 구간을 이어붙여 숨기지 않습니다.
- 종료 후 **Session review**에서 사람·AI 메시지 원문과 최종 제출을 읽고, 마이크 파형·프롬프트 표시·AI 대기/응답 구간을 같은 세션 시간축으로 확인합니다. 메시지의 재생 버튼이나 타임라인을 선택하면 대응 segment로 전환하고 재생 위치·해당 대화를 함께 강조합니다. 오디오 플레이어에서 이동해도 대화 표시가 따라갑니다.
- 파형은 원본 녹음을 브라우저 안에서 디코딩해 표시하며 읽기 쉽도록 segment별 진폭을 조정합니다. 실제 발화 전사나 발화 구간 검출이 아닙니다. 파형을 디코딩할 수 없어도 원본 다운로드는 유지합니다. 녹음 gap/수집 정지 의심은 타임라인에 표시하고 연결해 숨기지 않습니다.
- 타임라인은 1×/2×/4× 확대와 가로 스크롤을 지원합니다. 세션 시각과 개별 녹음 파일의 재생 위치를 구분하며, 요청별 세부 시각과 전체 이벤트 시각표는 필요할 때 확인할 수 있습니다. 저장된 세션의 **Review recording**에서도 같은 화면을 제공합니다.

## 수집 이벤트

| 종류          | 이벤트                                                                                                                                                                                                                                                                          |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 세션/과제     | `session_created`, `microphone_test_confirmed`, `task_started`, `task_ended`, `session_ended`                                                                                                                                                                                   |
| 대화          | `prompt_sent`, `ai_request_started`, `ai_request_dispatched`, `ai_response_headers_received`, `ai_first_text_received`, `ai_provider_response`, `ai_text_received`, `ai_first_display`, `ai_paint_observed`, `ai_completed`, `ai_stop_requested`, `ai_interrupted`, `ai_failed` |
| 음성          | `recording_started`, `audio_chunk_received`, `recording_stopped`, `recording_error`, `recording_muted`, `recording_unmuted`, `recording_restart_requested`                                                                                                                      |
| 장애/관찰     | `storage_error`, `storage_recovered`, `network_offline`, `network_online`, `collection_gap_started`, `collection_gap_ended`, `collector_heartbeat`, `collector_suspension`, `collector_interrupted`, `visibility_changed`                                                       |
| 제출/내보내기 | `final_submitted`, `export_requested`, `export_error`                                                                                                                                                                                                                           |

이벤트/텍스트 구간은 관찰 단위이며 move/node가 아닙니다. 추후 연구자가 시간 범위, event ID, message ID를 참조해서 여러 기준의 분절과 link를 별도로 정의할 수 있습니다.

## 점진 저장·복구·내보내기

IndexedDB `comparethink-pilot-v1`(DB version 2)에 `sessions`, `events`, `audio`, `transcriptions` store를 사용합니다. 이벤트와 오디오 청크는 **add-only**로 저장하고, 함께 저장하는 세션 메타데이터만 최신 snapshot으로 갱신합니다. 쓰기는 직렬 트랜잭션이며 원본 이벤트/청크를 덮어쓰지 않습니다. 메시지는 원본 이벤트로부터 재구성합니다.

저장 실패 시 실패한 쓰기와 이후 원자료를 현재 탭 메모리에 유지하고, 새 전송을 차단하며, 저장 재시도와 현재 기록 다운로드를 제공합니다. 재시도는 실패 지점부터 이어집니다. 탭이 살아 있는 동안 메모리 사본으로도 ZIP을 만들 수 있습니다. 저장 실패 상태에서 탭/브라우저를 닫으면 아직 디스크에 쓰지 못한 자료는 복구할 수 없습니다. UI의 저장 오류/대기 상태와 내보낸 `pending_writes`를 확인하세요.

마이크 중단·mute, 저장 실패, 네트워크 offline 및 6초 넘는 이벤트 루프 정지 의심 구간은 `gaps`와 오류 이벤트로 남깁니다. 복구 후에도 그 사실은 지우지 않으며 `collection_status: incomplete`를 유지합니다. 2초 heartbeat는 브라우저 중단의 관찰 보조 자료이며 모든 OS 수준 손실을 감지하지는 못합니다. 녹음 byte가 없으면 정상 수집으로 분류하지 않습니다.

페이지 종료는 `pagehide`에서 best-effort로 기록합니다. 강제 종료는 최종 청크나 마지막 미완료 트랜잭션을 잃을 수 있습니다. 저장된 미종료 세션은 내보낼 때 interrupted/incomplete로 표시하고 종료 시각을 만들어내지 않습니다. 새 페이지에서 기존 세션을 같은 시계로 이어서 수집하지 않습니다. 새 수집은 항상 새 UUID입니다.

ZIP 구성:

```text
session.json          # 익명 ID, 설정, 과제·모델·앱 버전, 안내 전문, 시계, 상태, 오류/구간
 task.json            # 실제 제시한 안전한 과제 + 출처·변경 사항·원문 발췌
 events.jsonl         # sequence 순 원본 이벤트
 messages.json        # 사용자/AI 원문, message/request ID, 요청/수신/표시/종료 시각, 응답 상태
 final_answer.txt     # 명시적으로 제출한 원문. 미제출이면 빈 파일
 audio/manifest.json  # 실제 MIME, segment/chunk ID·순서·시간, 누락 구간 및 정렬 한계
 audio/timeline.json  # 요청별 주요 이벤트 → 녹음 파일·재생 위치(초), 매핑 상태 및 시점 정의
 audio/segment-001.webm (또는 mp4/ogg/bin) # 원본 청크를 순서대로 연결, 재인코딩 없음
 audio/chunks/...     # 원본 MediaRecorder Blob 각각
```

다운로드는 저장된 데이터를 삭제하지 않습니다. 브라우저 다운로드 취소/차단 여부를 웹 앱이 항상 확인할 수는 없으므로 완료 후 언제든 **ZIP 다시 받기**를 사용할 수 있습니다. 브라우저 저장소는 서버 백업이 아닙니다. 기록은 해당 origin/브라우저 프로필에 남으므로 연구 종료 후 ZIP을 확보하세요.

## 코드 구조와 검증

- `src/pilot/App.tsx`, `style.css`: 마이크 테스트, 안내, 과제, 채팅, 제출, 재다운로드.
- `src/pilot/SessionReview.tsx`: 종료/저장 세션의 대화 원문, 실제 녹음 파형, 공통 타임라인, 재생 위치와 대화 연동.
- `src/pilot/engine.ts`: 세션 시계, 전송/AI/음성 생명주기와 원본 이벤트.
- `src/pilot/storage.ts`: IndexedDB 및 재시도 가능한 append 기록 큐.
- `src/pilot/export.ts`: 이벤트 기반 메시지 재구성과 원본 ZIP.
- `src/pilot/timing.ts`: 요청별 시점 정의와 녹음 segment·재생 위치 대응.
- `src/pilot/stream.ts`: 서버/클라이언트 공유 SSE 파서.
- `server/pilotPlugin.ts`: 서버 대화 모델 설정, 허용 필드 검증, Responses API 중계.
- `server/sttPlugin.ts`, `src/pilot/transcriptionTypes.ts`, `TranscriptionPanel.tsx`: 종료 후 전사 provider, 공통 형식, 전사 리뷰와 버전 보존.
- `scripts/setupLocalStt.sh`: checkout 내부의 로컬 Whisper 실행기 설치. 기존 모델은 별도 경로로 참조.
- `tasks/types.ts`, `registry.ts`: 과제 형식, 목록, 기본값, 모델에 제공하는 과제 내용.
- `tasks/*.json`: 예제/정답이 제거된 과제와 출처·참고 자료.
- `src/pilot/TravelTaskPanel.tsx`: 여행 요청·조건 및 원본 여행 자료 표.
- `scripts/importPlanbench.mjs`, `scripts/importTravelPlanner.py`: 공식 원본에서 안전한 과제 추출.

`npm test`는 과제 분리, 요청 allowlist, 설정 고정, UTF-8 스트리밍, ZIP 보존, IndexedDB 장애/재시도, 연속 녹음 생명주기를 검사합니다. `npm run test:browser`는 실제 Chrome의 MediaStream/MediaRecorder/IndexedDB/다운로드를 사용합니다. getUserMedia 장치 경계에 Web Audio로 만든 알려진 합성 신호를 주입하고 외부 모델은 제어된 SSE fixture로 대체합니다. 실제 OS 마이크 권한/장치 캡처를 통과한 검증은 아닙니다. 녹음된 Opus를 실제로 디코딩해 입력·대기·응답 중 음성 신호를 확인하고, 요청별 시점/음성 매핑, 초안 미수집, 한글 IME, 부분 응답 실패, 사용자 중단, 마이크 재연결, 저장 오류, 미종료 복구를 검증합니다. 두 과제의 선택·직접 링크·세션 내 과제 교체 차단·TravelPlanner 자료의 참가자/AI 일치·과제별 내보내기도 검사합니다. 실제 사람의 발화 및 실제 모델 API 연결 확인은 파일럿 시작 전 실제 장치에서 별도로 수행하세요.

OS가 가상 장치 캡처를 지원하는 환경에서는 `PILOT_TEST_AUDIO=native npm run test:browser`로 Chromium의 파일 기반 가상 마이크(getUserMedia 실제 경로)를 사용할 수도 있습니다. 이 macOS 자동화 환경에서는 해당 장치 요청이 대기하여 기본 Web Audio fixture로 검증했습니다. Chrome이 설치되어 있지 않으면 `npx playwright install chromium` 후 `PILOT_TEST_BROWSER=chromium npm run test:browser`를 사용하세요.

현재 저장소에는 CompareThink 파일럿의 소스·테스트·문서만 유지합니다. 이전 SimEval/Excalidraw/Audra 코드, 드라이버, 테스트, 문서와 자극 파일은 로컬 백업을 검증한 뒤 정리했습니다. 정리 전 커밋은 `f3b5fff`이며, Git에 기록되지 않았던 수정도 별도의 로컬 작업 트리 백업에 포함했습니다. 로컬 백업은 저장소에 포함하지 않습니다. 기존 `exports/`와 `runs/` 실험 결과는 원래 위치에도 보존합니다.

구체적인 실행 결과와 장치 수준 확인 범위는 [검증 기록](docs/comparethink-verification.md)에 정리했습니다.

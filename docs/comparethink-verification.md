# CompareThink 파일럿 검증 기록

검증일: 2026-11-03 (Asia/Seoul). 작업 브랜치: `feat/comparethink-blocksworld-pilot`.

## 통과한 검사

- `npm run build`: TypeScript 검사와 Vite 번들 생성 성공.
- `npm run format:check`: 새 소스·테스트·README 포맷 검사 성공.
- `npm test`: 핵심 테스트 7개 통과. 과제/예제 분리, 설정 고정, 음성 전송 차단, UTF-8 SSE, 원본 ZIP, IndexedDB 재시도, 연속 녹음과 중복 재연결을 검사함.
- `npm run test:browser`: 실제 Google Chrome에서 7개 통과. OS 장치 경계는 Web Audio 합성 신호, 외부 모델 전송은 SSE fixture로 대체함.
- 저장 오류 경로를 보강한 뒤 해당 브라우저 검사를 추가 실행하여, 미저장 자료가 포함된 메모리 ZIP 생성과 재시도 후 원본 보존도 확인함.

브라우저에서 확인한 항목:

| 항목                   | 확인 방법 및 결과                                                                             |
| ---------------------- | --------------------------------------------------------------------------------------------- |
| 입력·대기·응답 중 녹음 | 실제 MediaRecorder가 만든 WebM/Opus를 브라우저에서 디코딩하여 각 구간의 비영 신호와 길이 확인 |
| 이벤트와 음성 대응     | 프롬프트 전송/AI 첫 표시의 세션 시각을 segment 기준 재생 위치로 변환하고 음성 seek 확인       |
| 원자료와 제출          | 초안 수정·최종 전송·AI 텍스트·직접 제출한 최종 계획이 ZIP에 남는 것 확인                      |
| 한글 입력              | composition 중 Enter/keyCode 229로 메시지가 전송되지 않음                                     |
| AI 실패/중단           | HTTP 실패, 일부 텍스트 수신 후 실패, 사용자 중단의 텍스트·상태 보존                           |
| 마이크 중단/재연결     | 실제 브라우저 audio track 종료 이벤트를 주입하여 오류·gap·새 segment 및 기존 음성 보존 확인   |
| 저장 오류              | 쓰기 실패 주입 후 메모리 ZIP, 재시도, 기존 event ID/순서 보존 확인                            |
| 미종료 복구            | 페이지 재로드 후 이미 저장된 원자료를 incomplete로 재다운로드                                 |
| AI 데이터 경계         | 서버의 실제 upstream 요청을 검사해 과제 지시문·채팅만 포함하고 음성·초안 이력이 없는 것 확인  |
| 설정 고정              | 다른 config_id는 HTTP 409, 연구용 음성 필드는 HTTP 400으로 거절                               |
| 마이크 권한 실패       | 오류를 표시하고 과제 시작 전 단계에서 진행 차단                                               |
| 화면                   | 데스크톱과 390px 모바일 화면 확인, 가로 넘침 없음                                             |

## 실제 모델 연결

서버의 기존 `.env.local`을 사용해 **gpt-5.5로 연결 확인용 프롬프트 한 건**을 실제 Chrome에서 전송함. API 키 값은 클라이언트나 검증 로그에 노출하지 않았음.

- 응답 완료 이벤트 수신 및 텍스트 표시 성공.
- 직접 작성한 점검용 최종 제출 후 ZIP 다운로드 성공.
- 해당 세션 `collection_status: complete`, 이벤트 30개, AI 실패 0개.
- 확인 시각: 2026-11-03 14:57 KST.
- 이 연결 점검도 마이크 입력은 합성 신호였으며 실제 참가자 자료가 아님.

## 남아 있는 장치 수준 확인

이 macOS 자동화 환경에서는 Chromium의 파일 기반 가상 마이크 `getUserMedia` 요청이 대기함. Chrome과 별도 테스트 Chromium에서 같은 현상을 관찰했으며, 기본 자동 테스트는 Web Audio로 만든 실제 MediaStream을 사용함. 앱의 운영 코드에는 이 테스트용 대체 경로가 들어 있지 않음.

따라서 **실제 마이크 OS 권한, 실제 사람 발화의 청취 품질, 해당 연구 장치의 입력 지연**은 이 자동 검증으로 확인되지 않았음. 연구 시작 전 실제 장치에서 짧게 녹음·채팅·제출·재생하여 확인해야 함. 이벤트-음성 정렬은 브라우저 이벤트 기준이며 샘플/단어 단위의 정확도를 보장하지 않음.

현재 내보내기 형식과 상세 복구 동작은 [README](../README.md)를 참조.

## 영어 UI 및 단순화 (앱 0.2.1)

장식적인 소개·로고·카드형 스타일을 제거하고 기본 폼, 단계 표시, 과제·채팅 패널로 변경했습니다. 참가자 UI·안내문·오류 메시지와 과제는 영어로 표시합니다. 과제 ID·원본 출처·논리적 조건은 유지하며 표현 버전은 `1.1.0`, 언어는 `en`으로 기록합니다. 빌드·핵심 테스트 및 영어 레이블로 갱신한 Chrome 수집·복구 검사를 수행했습니다. 한글 IME와 원문 보존 테스트 입력은 계속 한국어도 사용합니다.

## 두 과제 선택 (2026-11-04, 앱 0.3.0)

Blocksworld와 공식 TravelPlanner validation row 0을 시작 전 선택할 수 있습니다. TravelPlanner의 원본 query와 9개 여행 자료 섹션을 참가자와 AI에게 동일하게 제공합니다. 데이터셋 커밋 `8736504ecfc31b7f8b7e40122873c337e83fff7c`의 CSV/JSONL로부터 재추출한 결과가 저장된 JSON과 완전히 일치함을 확인했습니다. 전체 소스는 레포 밖에 보관하고 선택된 안전한 과제만 추가했습니다.

- `npm run build`, `npm run format:check`: 통과.
- `npm test`: 10개 통과. 두 과제의 출처·정답 제외·서로 다른 설정 ID·전체 여행 자료의 모델 전달·선택한 안내/과제 스냅샷 내보내기 포함.
- `npm run test:browser`: 실제 Chrome에서 9개 통과. 기존 녹음·채팅·저장·복구 7개와 여행 자료 표/제출/재다운로드, 선택·직접 링크·서버 과제 교체 차단 2개를 검사했습니다.
- 데스크톱 TravelPlanner 화면과 모바일 과제 선택 화면을 확인했습니다. 표는 수평 스크롤로 모든 열·행을 볼 수 있습니다.
- 브라우저 검증의 마이크는 기존과 같은 합성 MediaStream이고 모델 전송은 제어된 SSE fixture입니다. 이번 변경에서 실제 모델 API 호출을 새로 실행하지 않았습니다.

새 세션은 선택한 `task_id`, `kind`, `version`, 해당 과제에 맞는 안내문, 원본 query/자료, `config_id`를 보존합니다. 세션이 시작된 뒤 선택 UI는 표시하지 않으며 서버도 첫 채팅에 바인딩된 설정과 다른 요청을 거절합니다. TravelPlanner는 공식 sole-planning 자료를 이용한 인간–AI 실험용 변형이며 원본 도구 환경·자동 채점·리더보드 평가를 실행하지 않습니다.

## 전송 단위 수집과 음성 매핑 (2026-11-04)

새 세션은 입력 변경·커서·IME 이벤트를 수집하지 않고, 전송한 프롬프트·AI 스트림 원문·명시적으로 제출한 최종 답안을 보존합니다. 세션의 `collection_policy`에 `submitted-chat-v1`, `draft_capture: false`를 기록하고 참가자 안내를 갱신했습니다. 기존 세션의 원본 초안 로그는 삭제하지 않습니다.

프롬프트 전송, 요청 준비, 실제 클라이언트 fetch 호출, HTTP 헤더 수신, 첫 텍스트 수신, 화면 제공/프레임 관찰, 완료·중단·실패를 구분합니다. 각 요청의 message/request ID와 공통 세션 시계를 사용합니다. 모델 내부 생성 시작은 측정하지 않으며 첫 텍스트 수신과 혼동하지 않습니다.

- `audio/timeline.json`: 이벤트별 녹음 segment·파일·재생 위치(초), 요청 순번, 매핑 상태, 시점 정의를 내보냅니다. 녹음 gap/음성 없음/범위 밖은 위치를 null로 표시하고, 미종료나 collector 정지 의심은 uncertain으로 구분합니다.
- `messages.json`: 요청 전송·헤더 수신·첫 텍스트 수신·화면 제공·프레임 관찰 시각을 추가했습니다.
- Recording review: 세션 시각과 녹음 재생 위치를 함께 표시하며, 이벤트를 선택하면 대응 segment로 전환합니다.
- `npm run build`: 통과. `npm test`: 11개 통과. `npm run test:browser`: 9개 통과. 재연결 후 이벤트 클릭으로 segment 1↔2 자동 전환을 확인하는 추가 assertion을 넣고 해당 브라우저 검사도 재실행해 통과했습니다.
- 입력/삭제/IME 조작 및 미제출 최종 답안은 로그에 남지 않고, 전송·제출 원문만 보존되는 것을 확인했습니다. 합성 마이크의 실제 Opus 디코딩과 이벤트 seek, ZIP의 요청별 매핑, 저장 실패/복구·미종료 데이터 보존도 검사했습니다.
- 마이크는 Web Audio 합성 MediaStream, 외부 모델은 SSE fixture를 사용했습니다. 실제 사람 발화의 지연이나 샘플 수준 동기화 정확도를 측정한 검사는 아닙니다.

## Bedrock Responses 연결 (2026-11-05)

서버의 고정 OpenAI 주소를 `OPENAI_BASE_URL`로 설정하고, `OPENAI_PROJECT`를 `OpenAI-Project` 헤더로 전송하도록 변경했습니다. 제공된 Mantle us-east-1 `/openai/v1` 주소와 모델 `openai.gpt-6.1-sol`, 프로젝트는 gitignored `.env.local`에 반영했습니다. 키 값은 변경하지 않았으며 기존 OpenAI 형식 키가 남아 있어 `api_ready: false`로 확인했습니다. 올바른 Bedrock 키를 로컬 파일에 넣고 서버를 재시작해야 합니다. 실제 AWS 모델 요청은 실행하지 않았습니다.

- 공급자·API base URL·프로젝트를 세션 설정과 `config_id`에 포함합니다. 키는 설정/내보내기에 포함하지 않습니다. 알려진 공급자/키 형식 불일치는 외부 요청 전에 차단합니다.
- `npm run build`, `npm run format:check`, `git diff --check`: 통과. `npm test`: 13개 통과.
- 새 서버 테스트는 외부 전송만 mock으로 대체해, 실제 미들웨어의 Bedrock `/responses` URL·Bearer 인증·프로젝트 헤더·`store:false`·스트리밍 중계와 키 불일치 시 외부 호출이 없는 것을 검사합니다. endpoint/project/model 변경에 따른 config ID 변경과 키 미포함도 확인합니다.
- 이번 변경은 새 실제 AWS 연결 검증이나 추가 브라우저 세션 검증이 아닙니다. 기존 브라우저 수집·음성 매핑 검사 결과는 앞 절에 기록했습니다.

## 테스트용 저가 모델 적용 및 실제 Bedrock 연결 (2026-11-05)

사용자가 로컬 키를 교체한 뒤 `OPENAI_MODEL=openai.gpt-6-luna`, `OPENAI_REASONING_EFFORT=low`로 변경했습니다. 기존 키·프로젝트·Mantle us-east-1 `/openai/v1` 주소와 출력 토큰 한도는 유지했습니다. 모델 목록 조회에서 Luna가 존재함을 확인했고, 앱의 `makeConfiguration`·`providerPayload`로 만든 실제 서버 요청과 공유 SSE 파서를 사용하여 짧은 연결 검사 한 건을 실행했습니다.

- HTTP 200, 공급자 모델 `openai.gpt-6-luna`, `response.completed` 수신. 응답은 `OK`.
- 사용량: 입력 529 tokens, 출력 5 tokens (reasoning 0), 총 534 tokens. `store:false`, `stream:true`, 기존 project 헤더 사용.
- 실제 외부 모델 연결 검사이며 새 브라우저/마이크 세션 검사는 아닙니다. 키 값은 출력하거나 연구 자료에 포함하지 않았습니다.
- 모델이나 설정이 바뀌었으므로 dev/preview 서버를 재시작하고 새 세션을 사용해야 합니다.

## Complete 화면의 대화·음성 리뷰 (2026-11-05)

작은 이벤트 버튼 목록 대신 `SessionReview`를 추가했습니다. 데스크톱에서는 사람·AI 대화 원문/최종 제출과 녹음 플레이어/공통 타임라인을 두 패널로 표시하고, 좁은 화면에서는 녹음 패널을 위에 배치합니다. 완료 상태와 다운로드는 상단으로 정리하고 저장 세션 목록과 전체 이벤트 시각표는 접을 수 있게 했습니다.

- 마이크 파형은 원본 segment 청크를 브라우저의 AudioContext로 디코딩한 진폭입니다. segment마다 표시 진폭만 정규화하며 원본 녹음·내보내기를 바꾸지 않습니다. 디코딩 실패는 파형 없음으로 표시하고 다운로드를 유지합니다.
- Mic/Human/AI 행은 같은 세션 시계를 사용합니다. 프롬프트/최종 제출 표시, AI 대기 구간, 첫 텍스트 수신부터 종료까지의 응답 구간, 녹음 누락·수집 정지 의심 구간을 구분합니다. 대기 구간을 모델 내부 생성 시간으로 해석하지 않습니다.
- 메시지 재생 버튼과 타임라인을 선택하면 해당 segment·재생 위치·대화를 함께 이동합니다. native 오디오 재생/seek도 공통 시계와 대화 강조에 반영됩니다. 1×/2×/4× 확대 및 가로 스크롤, 화면 폭 변경 후 현재 위치 따라가기를 확인했습니다. 관찰한 최종 제출 시각이 실제 재생 가능한 파일 끝보다 약간 늦어도 선택한 답안이 숨지 않게 합니다.
- `npm run build`, 핵심 테스트 13개, 포맷 검사 통과. 기존 브라우저 9개 시나리오 전체가 통과했고, 새 복수 대화 리뷰 시나리오를 추가해 연속 녹음/재연결 검사와 함께 실행했습니다. 이후 반응형·최종 제출 표시를 보강하고 새 시나리오를 재실행해 통과했습니다.
- 실제 Chrome에서 사람/AI 메시지·최종 제출 원문, 파형 생성, 대화→음성 및 음성→대화 이동, segment 전환, 재다운로드 후 리뷰, 390px 가로 넘침 없음, 선택한 답안의 패널 내 가시성과 확대 타임라인의 재생선/최종 제출 마커 가시성을 검사했습니다. 데스크톱·모바일 및 타임라인 영역 캡처도 확인했습니다.
- 음성은 기존 Web Audio 합성 마이크, 외부 모델은 SSE fixture를 사용했습니다. 이번 UI 변경에서 실제 API 요청이나 새 연구 자료 수집을 실행하지 않았습니다. 원본 수집 정책과 ZIP 형식은 유지했습니다.

## 종료 후 STT provider 분리 (2026-11-05, 앱 0.4.0)

시각화 테스트는 `local-whisper`, 추후 실험은 별도의 `api` provider로 설정할 수 있게 했습니다. API 어댑터는 OpenAI-compatible `/audio/transcriptions`의 timed segment 응답을 공통 `TranscriptionResult`로 변환하며, 대화용 Bedrock 연결·키와 분리합니다. 현재 `.env.local`은 로컬 모드이며 외부 STT API는 활성화하거나 실제 호출하지 않았습니다.

### 실제 로컬 확인

- Alt가 설치한 `ggml-large-v3-turbo-q5_0.bin`을 읽기 전용으로 재사용했습니다. 모델을 새로 다운로드하거나 Alt 앱/데이터/모델 파일을 변경하지 않았습니다.
- `.local/stt/`에 CMake 3.31.6 및 whisper.cpp v1.9.5 소스(커밋 `d1be6fde11ac6e0407606b4e42fe72d34add8037`)의 Metal 실행기를 설치·빌드했습니다. 현재 실행기가 보고하는 버전은 `whisper.cpp version: 1.9.5-dev`입니다.
- 사용 모델 SHA-256: `394221709cd5ad1f40c46e6031ca61bce88931e6e088c188294c6d5a55ffa7e2`. 별도의 Alt Core ML 인코더는 연결하지 않았습니다.
- macOS Yuna로 생성한 한국어 합성 음성(약 6.57초)을 실제 FFmpeg/Whisper 경로에서 전사했습니다. 두 문장과 `ko`, 구간별 추정 시작/끝을 확인했습니다. 합성 발화는 ‘지금은 녹음과 전사 화면을 테스트하고 있습니다. 첫날에는 비행기를 타고 이동할 계획입니다.’입니다.
- 실제 앱 서버의 Chrome에서도 같은 합성 음성을 getUserMedia 장치 경계에 주입해 실제 MediaRecorder로 녹음하고, 종료 → Generate transcript → 실제 로컬 Whisper → 구간 클릭 재생 → ZIP 내보내기를 확인했습니다. 협업 AI API 호출은 0회, page error는 0개였습니다. 실물 마이크/자연 발화 정확도나 샘플 수준 정렬을 검증한 것은 아닙니다.
- 이 실제 연결 점검의 PNG/ZIP은 `/tmp/comparethink-real-stt-review.png`, `/tmp/comparethink-real-stt-review.zip`에만 저장했습니다. 원래 참가자 연구 자료가 아닙니다.

### 저장·실패·호환성 확인

- `npm test`: 21개 통과. 기존 13개와 v1→v2 데이터 보존, 독립 STT 설정/키, 로컬/API 시간 변환, API 오디오-only payload/5분 조각 offset/부분 실패/임시 파일 정리, 로컬 모델 원형 보존/체크섬, 설정 변경·오디오 체크섬 거부, 전사 포함 ZIP 및 STT store 읽기 실패 중 원본 ZIP 보존을 검사했습니다.
- `npm run test:browser`: Chrome에서 11개 통과. 기존 수집·리뷰·실패·복구 시나리오와 새 STT 생성/음성 seek/오류 재시도/취소/저장 실패 메모리 ZIP/복구/새로고침/대화 AI 미전달을 검사했습니다. 마지막 읽기 오류 보강 뒤 STT 브라우저 시나리오도 재실행했습니다.
- `npm run build`, `npm run format:check`, `git diff --check`: 통과.
- 자동 브라우저 검사의 마이크는 기존 합성 MediaStream이고 STT/채팅 외부 처리는 fixture입니다. 별도로 위의 실제 로컬 Whisper 전체 경로를 확인했으며, 유료 STT 공급자의 실제 키·권한·품질·요금 검증은 수행하지 않았습니다.
- DB 이름은 유지하고 version 2에서 add-only `transcriptions` store만 추가했습니다. 시작/결과·실패는 새 entry ID, 재시도는 새 attempt ID이며 원본 events/audio와 완료본을 덮어쓰지 않습니다. STT 저장·읽기 실패는 원본 녹음 ZIP을 막지 않습니다.
- 전사 사용 시 `transcriptions.json`, `transcript.txt`, 세션 기준 `transcript.vtt`가 추가됩니다. 시각을 반환하지 않는 API 응답에는 임의의 발화 경계를 만들지 않습니다. 원자료의 collection_status와 후처리 전사 상태는 별개입니다.

## 이벤트 기준 가상 음성 구간 (2026-11-05)

- 첫 프롬프트 전, 프롬프트 전송→첫 표시, 첫 표시→응답 종료, 응답 종료→다음 프롬프트/최종 제출 구간을 원본 이벤트에서 계산합니다. 첫 표시 없는 실패는 대기→실패로 끝내고 표시 중 구간은 생성하지 않습니다. 종료를 관찰하지 못한 경우 다음 경계/마지막 관찰에서 censored로 표시합니다.
- 다음 Exchange의 Previous interval은 기존 구간 ID를 참조합니다. 원자료를 덮어쓰거나 같은 구간을 중복 생성하지 않습니다. 앞뒤 최대 2초 맥락과 기준 경계를 구분하고, 과제 범위로 제한합니다. 원본 음성은 물리적으로 분할하지 않으며 STT/협업 AI를 호출하지 않습니다.
- 녹음 중단/mute/바이트 없는 범위는 unavailable로 보존합니다. 재생은 각 녹음 부분 끝에서 정지하며 다음 부분은 별도로 선택합니다. collector 정지 의심/미종료 녹음은 uncertain 표시입니다. 정렬·정지 정확도는 브라우저 시간 기반이며 샘플 수준이 아닙니다.
- ZIP의 `audio/review_windows.json`에 원본 경계 event ID, 요청 연결, 구간별 상태·시각, 원본 녹음 파일과 재생 범위, 누락, 기본 맥락 범위를 추가했습니다. DB 버전·원본 events/audio·STT 기록 형식은 유지합니다. 구간은 연구 move/node나 전사 발화 정의가 아닙니다.
- 단위 검사: `npm test` 27개 통과. 새 6개에서 정상 구간 분할·직전 구간 참조·맥락 제한, 표시 전/후 실패, 중단·미관찰 종료, 프롬프트 없는 제출·길이 0, gap/mute/바이트 없음/uncertain, ZIP의 경계·원본 이벤트·음성 보존을 확인했습니다.
- Chrome에서 선택한 구간 끝 자동 정지(기준 재생 끝과 차이 150ms 미만), 맥락 선택, 정규/재생 범위 표시, 새로고침 후 동일 구간 내보내기, 실패 시 표시 구간 비활성화, 녹음 중단 후 Part 1 끝 정지 및 Part 2 명시적 선택을 확인했습니다. 데스크톱/390px 화면 이미지는 `test-results/audio-window-desktop.png`, `test-results/audio-window-mobile.png`입니다.
- 전체 `npm run test:browser` 11개, `npm run build`, `npm run format:check`, `git diff --check`도 통과했습니다.
- 자동 검사의 음성은 기존 합성 MediaStream을 실제 MediaRecorder로 수집한 것이며 채팅/STT 외부 응답은 fixture입니다. 이 변경에서 실제 모델/STT API 호출이나 전사 정확도 평가는 하지 않았습니다.

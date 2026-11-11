import { koTaskText } from "../../tasks/localization";

export type Language = "en" | "ko";
const ko: Record<string, string> = {
  "Task start observed by the client after the recorder starts.":
    "녹음 시작 후 클라이언트에서 관찰한 과제 시작 시각입니다.",
  "Participant submits a chat message. This is not the start of typing.":
    "참가자가 메시지를 전송한 시각입니다. 입력을 시작한 시각과 다릅니다.",
  "Client constructs the request before waiting for local persistence.":
    "로컬 저장을 기다리기 전에 클라이언트가 요청을 준비한 시각입니다.",
  "Client calls fetch to the app server. Model receipt and internal generation start are not observed.":
    "클라이언트가 앱 서버에 요청한 시각입니다. 모델의 실제 수신과 내부 생성 시작은 관찰하지 못합니다.",
  "Client receives HTTP headers from the app server; this does not imply text is available.":
    "앱 서버의 HTTP 헤더를 수신한 시각입니다. 텍스트 수신을 의미하지는 않습니다.",
  "Client observes the first non-empty streamed text delta.":
    "내용이 있는 첫 스트리밍 텍스트 조각을 클라이언트에서 수신한 시각입니다.",
  "First text is made available to the React view.":
    "첫 텍스트를 화면 뷰에 전달한 시각입니다.",
  "requestAnimationFrame after React commit; approximate display observation, not hardware paint timing.":
    "화면 갱신 후 프레임 콜백에서 관찰한 근사 시각입니다. 하드웨어의 실제 표시 시각은 아닙니다.",
  "Client receives the provider completion event through the app server.":
    "앱 서버를 통해 응답 완료 이벤트를 수신한 시각입니다.",
  "Participant or session end requests interruption.":
    "참가자 또는 세션 종료로 응답 중단을 요청한 시각입니다.",
  "Client observes interruption; received text is retained.":
    "응답 중단을 관찰한 시각입니다. 수신한 텍스트는 보존합니다.",
  "Client observes a request or stream failure; received text is retained.":
    "요청 또는 스트리밍 실패를 관찰한 시각입니다. 수신한 텍스트는 보존합니다.",
  "Participant explicitly submits the final plan.":
    "참가자가 최종 계획을 명시적으로 제출한 시각입니다.",
  "Client ends the task and requests recorder stop.":
    "클라이언트가 과제를 종료하고 녹음 중지를 요청한 시각입니다.",
  "No recording position is available for this event ({status}).":
    "이 이벤트에 대응하는 녹음 위치가 없습니다 ({status}).",
  "{label}: session {session} → recording {position} s.":
    "{label}: 세션 {session} → 녹음 {position}초.",
  " Capture continuity is uncertain.": " 녹음의 연속성이 불확실합니다.",
  started: "시작됨",
  completed: "완료",
  partial: "부분 결과",
  failed: "실패",
  interrupted: "중단",
  ...koTaskText,
  Language: "언어",
  "Planning study": "계획 과제 연구",
  "Study progress": "실험 진행 단계",
  Setup: "준비",
  Instructions: "안내",
  Task: "과제",
  Complete: "완료",
  "Session setup": "세션 준비",
  "Participant ID": "참가자 ID",
  "Do not enter your name or contact details.":
    "이름이나 연락처는 입력하지 마세요.",
  Admin: "관리자",
  "Open admin": "관리 화면 열기",
  "Back to participant setup": "참가자 준비 화면으로 돌아가기",
  "No saved sessions on this browser.": "이 브라우저에 저장된 세션이 없습니다.",
  "Saved sessions": "저장된 세션",
  "Saved sessions (": "저장된 세션 (",
  "You can download saved sessions again. Unfinished sessions are exported as incomplete.":
    "저장된 세션을 다시 내려받을 수 있습니다. 종료되지 않은 세션은 수집 미완료로 내보냅니다.",
  "Download ZIP again": "ZIP 다시 받기",
  "Review recording": "기록 검토",
  "Interrupted or unfinished": "중단 또는 미종료",
  "Incomplete collection": "수집 미완료",
  "Select a task": "과제를 선택하세요",
  "Loading tasks…": "과제 불러오는 중…",
  "Microphone check": "마이크 확인",
  "Record a short sample, then play it back to check that your voice is audible.":
    "짧게 녹음한 뒤 재생하여 목소리가 잘 들리는지 확인하세요.",
  "Test recording in progress": "테스트 녹음 중",
  "Test recording ready": "테스트 녹음 완료",
  "Microphone not tested": "마이크 확인 전",
  "Speak a sentence or two.": "한두 문장을 말해 주세요.",
  "The test recording is not included in the study data.":
    "테스트 녹음은 연구 자료에 포함되지 않습니다.",
  "Stop test recording": "테스트 녹음 중지",
  "Test microphone again": "마이크 다시 테스트",
  "Start microphone test": "마이크 테스트 시작",
  "Microphone test playback": "마이크 테스트 녹음 재생",
  "I played the recording and could hear my voice.":
    "녹음을 재생했고 제 목소리가 들리는 것을 확인했습니다.",
  "Continue to instructions": "안내로 이동",
  "Check microphone again": "마이크 다시 확인",
  "Preparing recording…": "녹음 준비 중…",
  "Start task": "과제 시작",
  "Task and chat": "과제와 대화",
  "Think-aloud instructions": "생각 말하기 안내",
  "Submit your final plan": "최종 계획 제출",
  "While working on the task, say what you are thinking as naturally as possible. Keep speaking while typing, waiting for the AI, and reading its responses. There is no required number of messages or speaking order.":
    "과제를 수행하면서 떠오르는 생각을 가능한 한 자연스럽게 말해 주세요. 입력할 때, AI를 기다릴 때, 응답을 읽을 때에도 생각을 말해 주세요. 정해진 메시지 수나 발화 순서는 없습니다.",
  "Microphone audio, sent chat messages, AI responses, and your submitted final plan are collected from task start until the session ends. Unsent text and edit history are not collected. Research audio and transcripts are not sent to the chat AI. After the task, recordings can be transcribed using the configured local or external transcription service. The microphone test recording is not included in the session data.":
    "과제 시작부터 세션 종료까지 마이크 음성, 전송한 메시지, AI 응답, 제출한 최종 계획을 수집합니다. 전송하지 않은 글과 수정 이력은 수집하지 않습니다. 연구용 음성과 전사문은 대화 AI에 전달하지 않습니다. 과제 종료 후 설정된 로컬 또는 외부 음성 인식 서비스로 녹음을 전사할 수 있습니다. 마이크 테스트 녹음은 세션 자료에 포함되지 않습니다.",
  "The AI service is not configured. Please contact the researcher.":
    "AI 서비스가 설정되지 않았습니다. 연구자에게 문의해 주세요.",
  "Initial state": "초기 상태",
  "Initial block arrangement": "블록의 초기 배치",
  Table: "테이블",
  "Goal state": "목표 상태",
  "Action rules": "행동 규칙",
  Red: "빨강",
  Blue: "파랑",
  Yellow: "노랑",
  Orange: "주황",
  "Task source and original wording": "과제 출처와 원문 (영어)",
  "PlanBench · task_1_plan_generation · instance":
    "PlanBench · task_1_plan_generation · 문제",
  ". The rules and target problem are shown below. The separate example and reference solution are excluded.":
    ". 아래는 규칙과 대상 문제의 원문입니다. 별도의 예제와 정답은 제외했습니다.",
  Responding: "응답 중",
  Completed: "완료",
  "Interrupted · received text retained": "중단 · 수신한 내용 보존",
  "Failed · received text retained": "실패 · 수신한 내용 보존",
  Sent: "전송됨",
  You: "참가자",
  Human: "참가자",
  AI: "AI",
  "Waiting for a response": "응답 대기 중",
  "No text was received.": "수신한 내용이 없습니다.",
  Recording: "녹음 중",
  "Recording stopped": "녹음 중단",
  "Participant: ": "참가자: ",
  "Task: ": "과제: ",
  "Storage error · retained in memory": "저장 오류 · 메모리에 보존 중",
  "Saving…": "저장 중…",
  "Saved locally": "브라우저에 저장됨",
  "New messages are disabled because local storage failed. Keep this tab open and retry saving or download the current record.":
    "브라우저 저장 실패로 새 메시지를 보낼 수 없습니다. 이 탭을 유지하고 저장을 재시도하거나 현재 기록을 내려받으세요.",
  "Retry saving": "저장 재시도",
  "Download current record": "현재 기록 내려받기",
  "Recording stopped. The missing interval will remain in the study record.":
    "녹음이 중단되었습니다. 누락 구간은 연구 기록에 남습니다.",
  "Reconnect microphone": "마이크 다시 연결",
  Chat: "대화",
  "Chat history": "대화 기록",
  "No messages yet.": "아직 메시지가 없습니다.",
  "You may chat with the AI freely.": "AI와 자유롭게 대화할 수 있습니다.",
  "Message to AI": "AI에게 보낼 메시지",
  "Type a message…": "메시지를 입력하세요…",
  "Enter to send · Shift+Enter for a new line":
    "Enter로 전송 · Shift+Enter로 줄바꿈",
  "Stop response": "응답 중단",
  Send: "전송",
  "Submit your final plan separately from the chat.":
    "최종 계획은 대화와 별도로 제출하세요.",
  "Close final plan": "최종 계획 닫기",
  "Write final plan": "최종 계획 작성",
  "Final plan": "최종 계획",
  "Enter your day-by-day itinerary.": "날짜별 여행 일정을 입력하세요.",
  "Enter the actions in order.": "행동을 순서대로 입력하세요.",
  "Submit final plan and end session": "최종 계획 제출 및 세션 종료",
  "End session without submitting": "제출 없이 세션 종료",
  "Session ended": "세션 종료",
  "Review your conversation and think-aloud recording below.":
    "아래에서 대화와 생각 말하기 녹음을 검토할 수 있습니다.",
  "The session ended without a final plan submission.":
    "최종 계획을 제출하지 않고 세션을 종료했습니다.",
  "Download session ZIP": "세션 ZIP 내려받기",
  "Prepare a new session": "새 세션 준비",
  "Some data has not been saved and remains in this tab. Keep the tab open and retry saving or download the session ZIP.":
    "일부 자료가 저장되지 않고 이 탭에 남아 있습니다. 탭을 유지하고 저장을 재시도하거나 세션 ZIP을 내려받으세요.",
  "Incomplete collection · errors or gaps recorded":
    "수집 미완료 · 오류 또는 누락 기록됨",
  "Human prompts:": "참가자 프롬프트:",
  " · AI responses:": " · AI 응답:",
  " · Recordings: ": " · 녹음 파일: ",
  "CompareThink research study": "CompareThink 연구",
  "Research data collection": "연구 자료 수집",
  "Session review": "세션 검토",
  " · Participant ": " · 참가자 ",
  "Exchanges: ": "대화 횟수: ",
  "Conversation log": "대화 기록",
  Conversation: "대화",
  "Human prompts and AI responses": "참가자 프롬프트와 AI 응답",
  "Include up to 2 s before and after each window":
    "각 구간 앞뒤 최대 2초 포함",
  "Review intervals use event timestamps. They do not define research moves or speech boundaries.":
    "검토 구간은 이벤트 시각을 기준으로 합니다. 연구의 move나 발화 경계를 정의하지 않습니다.",
  "Play before-first-prompt audio": "첫 프롬프트 전 음성 재생",
  "No chat messages were sent.": "전송한 대화 메시지가 없습니다.",
  "Exchange ": "대화 ",
  "Final submission": "최종 제출",
  "Play final submission": "최종 제출 시점 재생",
  "No final plan was submitted.": "제출한 최종 계획이 없습니다.",
  "No response text was received.": "수신한 응답 내용이 없습니다.",
  "No first response recorded": "첫 응답 시각 없음",
  " · End time unknown": " · 종료 시각 미확인",
  "Recording and timeline": "녹음과 타임라인",
  "Microphone timeline": "마이크 타임라인",
  "Continuous think-aloud recording": "연속 생각 말하기 녹음",
  "Session ": "세션 ",
  "Recording ": "녹음 ",
  "No recording at this time": "이 시각의 녹음 없음",
  "Recording segment": "녹음 파일 선택",
  "Session recording playback": "세션 녹음 재생",
  "No audio bytes are available for this recording.":
    "이 녹음에 저장된 음성 데이터가 없습니다.",
  "Session position": "세션 재생 위치",
  "Seek session recording": "세션 녹음 위치 이동",
  "Selected audio window": "선택한 음성 구간",
  "Event boundaries": "이벤트 경계",
  "Playback range": "재생 범위",
  "An ending was not observed. This interval stops at the next recorded boundary.":
    "종료를 관찰하지 못했습니다. 다음 기록 경계에서 구간을 끝냅니다.",
  "This range contains unrecorded or muted time. Each recorded part stops separately; gaps are not joined.":
    "이 범위에는 녹음 누락 또는 음소거 시간이 있습니다. 각 녹음 부분 끝에서 멈추며 누락 구간을 이어 붙이지 않습니다.",
  "No recorded audio is available in this range.":
    "이 범위에 재생 가능한 녹음이 없습니다.",
  "Recording continuity or its ending is uncertain. Times are approximate.":
    "녹음의 연속성 또는 종료 시각이 불확실합니다. 시각은 근사치입니다.",
  "Part ": "부분 ",
  "Replay window": "구간 다시 재생",
  "Stop window playback": "구간 재생 중지",
  "All times from session start": "모든 시각은 세션 시작 기준",
  Zoom: "확대",
  "Timeline zoom": "타임라인 확대",
  Mic: "마이크",
  Waiting: "응답 대기",
  "Response ": "응답 ",
  "Recorded audio": "녹음된 음성",
  "AI waiting": "AI 응답 대기",
  "AI response": "AI 응답",
  "Window boundary · dashed edges: playback context":
    "실선: 이벤트 경계 · 점선: 재생 맥락",
  "Gap / uncertain": "누락 / 불확실",
  "Select a message, numbered marker, or waveform to listen from that time. Waiting includes network and model processing; internal generation start is not observed. Audio alignment is approximate. Waveform amplitude is scaled for readability.":
    "메시지, 번호 표시, 파형을 선택하면 해당 시점부터 들을 수 있습니다. 대기에는 네트워크와 모델 처리가 포함되며 내부 생성 시작은 관찰할 수 없습니다. 음성 정렬은 근사치이고, 파형 진폭은 보기 편하도록 조정됩니다.",
  " timing": " 시각",
  "All event timings (": "전체 이벤트 시각 (",
  "Session time": "세션 시각",
  Event: "이벤트",
  "Recording position": "녹음 위치",
  "Before first prompt": "첫 프롬프트 전",
  "Previous interval": "직전 구간",
  "Response appearing": "응답 표시 중",
  "After response": "응답 후",
  "Not recorded": "기록 없음",
  "Ending was not observed": "종료 미관찰",
  " · unfinished": " · 미완료",
  "No first-display interval was recorded": "첫 응답 표시 구간이 없습니다",
  "No bounded interval is available": "재생할 구간이 없습니다",
  Stopped: "정지",
  Finished: "재생 완료",
  "No recorded audio": "녹음 없음",
  Loading: "불러오는 중",
  Playing: "재생 중",
  Paused: "일시 정지",
  "Playback failed": "재생 실패",
  Unfinished: "미완료",
  Interrupted: "중단",
  Failed: "실패",
  "Task started": "과제 시작",
  "Prompt sent": "프롬프트 전송",
  "AI request prepared": "AI 요청 준비",
  "AI request sent": "AI 요청 전송",
  "AI response headers received": "AI 응답 헤더 수신",
  "AI first text received": "AI 첫 텍스트 수신",
  "AI first response": "AI 첫 응답 표시",
  "AI display frame observed": "AI 표시 프레임 관찰",
  "AI response completed": "AI 응답 완료",
  "AI stop requested": "AI 응답 중단 요청",
  "AI response interrupted": "AI 응답 중단",
  "AI response failed": "AI 응답 실패",
  "Task ended": "과제 종료",
  "Think-aloud transcript": "생각 말하기 전사문",
  "Cancel transcription": "전사 취소",
  "Transcribe again": "다시 전사",
  "Transcribe remaining recordings": "남은 녹음 전사",
  "Generate transcript": "전사문 생성",
  " · Language:": " · 음성 언어:",
  "auto-detect": "자동 감지",
  "Local Whisper": "로컬 Whisper",
  "Transcription is not configured on the server. The original recording is available above.":
    "서버에 전사 기능이 설정되지 않았습니다. 위에서 원본 녹음을 재생할 수 있습니다.",
  "Audio and transcripts are never included in the chat AI request.":
    "음성과 전사문은 대화 AI 요청에 포함되지 않습니다.",
  "Generate transcribes the recording on the app server without an external STT API.":
    "외부 STT API 없이 앱 서버에서 녹음을 전사합니다.",
  "A previous attempt ended without a result. Generate again to retry.":
    "이전 시도에서 결과를 받지 못했습니다. 다시 생성하여 재시도하세요.",
  "Some transcript entries could not be saved or loaded. Keep this tab open; the session ZIP includes the transcript entries currently available here.":
    "일부 전사 기록을 저장하거나 불러오지 못했습니다. 이 탭을 유지하세요. 현재 사용 가능한 전사 기록은 세션 ZIP에 포함됩니다.",
  "Retry saving transcript": "전사문 저장 재시도",
  "No transcript yet. Generate one from the saved recording.":
    "아직 전사문이 없습니다. 저장된 녹음에서 전사문을 생성하세요.",
  "Machine-generated text · Estimated timings · Verify against the recording. Click a time to listen.":
    "자동 전사 · 추정 시각 · 녹음과 대조해 확인하세요. 시각을 누르면 재생됩니다.",
  "No speech timestamps were returned for this text.":
    "이 텍스트에는 발화 시각이 제공되지 않았습니다.",
  "No speech was recognized in this recording.":
    "이 녹음에서 인식한 발화가 없습니다.",
  "Transcription history (": "전사 이력 (",
  "Every attempt is retained in the session ZIP. Retries do not replace earlier results.":
    "모든 시도는 세션 ZIP에 보존됩니다. 재시도해도 이전 결과를 덮어쓰지 않습니다.",
  " · Partial": " · 부분 결과",
  "No options were supplied for this section.":
    "이 항목에 제공된 선택지가 없습니다.",
  "Travel request": "여행 요청",
  "Travel data": "여행 자료",
  "Open a section to view its options. Tables scroll horizontally.":
    "항목을 열면 선택지를 볼 수 있습니다. 표는 가로로 스크롤할 수 있습니다.",
  "Provided travel data": "제공된 여행 자료",
  "Final itinerary": "최종 여행 일정",
  "Task source and adaptation": "과제 출처와 변경 사항",
  "TravelPlanner · ": "TravelPlanner · ",
  " · row ": " · 행 ",
  "(zero-based). The original request and all supplied travel options are retained. No reference itinerary is included.":
    "(0부터 시작). 원본 여행 요청과 모든 선택지를 보존하며 정답 일정은 포함하지 않습니다. 한국어 버전의 요청은 번역문이며 원문은 내보낸 과제 파일에 보존됩니다.",
  "This task uses the official sole-planning data in a human–AI chat study. It does not run the original tool environment or automatic benchmark evaluation.":
    "공식 sole-planning 자료를 인간–AI 대화 연구에 사용합니다. 원래 도구 환경이나 자동 벤치마크 평가는 실행하지 않습니다.",
  "Dataset: ": "데이터셋: ",
  ". License: ": ". 라이선스: ",
  "Could not load the available tasks.": "과제 목록을 불러오지 못했습니다.",
  "This access link is missing or invalid. Please open the link provided by the researcher.":
    "접속 링크가 없거나 올바르지 않습니다. 연구자가 보낸 링크로 다시 접속해 주세요.",
  "Unknown task in the URL. Select a task below.":
    "URL의 과제를 찾을 수 없습니다. 아래에서 과제를 선택하세요.",
  "Could not load the selected task.": "선택한 과제를 불러오지 못했습니다.",
  "Use a browser with recording support over HTTPS or localhost.":
    "HTTPS 또는 localhost에서 녹음을 지원하는 브라우저를 사용하세요.",
  "The test recording is empty. Please try again.":
    "테스트 녹음이 비어 있습니다. 다시 시도하세요.",
  "An error occurred during the microphone test.":
    "마이크 테스트 중 오류가 발생했습니다.",
  "Use 1–64 letters, numbers, underscores, or hyphens for the participant ID.":
    "참가자 ID는 영문, 숫자, 밑줄, 하이픈으로 1~64자 이내로 입력하세요.",
  "A session is running in another tab. End that session before starting a new one.":
    "다른 탭에서 세션이 진행 중입니다. 해당 세션을 끝낸 뒤 새 세션을 시작하세요.",
  "Storage error: {error}": "저장 오류: {error}",
  "Microphone unavailable: {error}": "마이크 사용 불가: {error}",
  "Could not prepare the download: {error}. You can retry from Saved sessions.":
    "다운로드를 준비하지 못했습니다: {error}. 다시 내려받거나 관리 화면에서 재시도할 수 있습니다.",
  "No recording is available at this session time. Recording gaps are not joined together.":
    "이 세션 시각에 녹음이 없습니다. 누락 구간은 이어 붙이지 않습니다.",
  "No timestamp was recorded for this message.":
    "이 메시지의 시각이 기록되지 않았습니다.",
  "This recording could not be played by the browser. The original audio remains in the session ZIP.":
    "브라우저에서 이 녹음을 재생할 수 없습니다. 원본 음성은 세션 ZIP에 보존됩니다.",
  "Transcribing recording {number} of {total}…":
    "녹음 {number}/{total} 전사 중…",
  "Generate sends recording audio to the transcription service ({origin}).":
    "전사문 생성 시 녹음 음성을 전사 서비스({origin})에 전송합니다.",
  "The transcript remains in this tab. Retry saving before closing it.":
    "전사문이 이 탭에 남아 있습니다. 탭을 닫기 전에 저장을 재시도하세요.",
  "Transcription stopped after a partial result. Earlier text is retained.":
    "부분 결과를 받은 뒤 전사가 중단되었습니다. 이전 텍스트는 보존됩니다.",
  "Transcription cancelled. Existing recordings and earlier results are retained.":
    "전사를 취소했습니다. 기존 녹음과 이전 결과는 보존됩니다.",
  "Audio windows for exchange {number}": "대화 {number}의 음성 구간",
  "Play previous audio, exchange {number}": "대화 {number} 직전 음성 재생",
  "Play waiting audio, exchange {number}": "대화 {number} 응답 대기 음성 재생",
  "Play response audio, exchange {number}":
    "대화 {number} 응답 표시 중 음성 재생",
  "Play after-response audio, exchange {number}":
    "대화 {number} 응답 후 음성 재생",
  "Play Human message {number}": "참가자 메시지 {number} 시점 재생",
  "Play AI response {number}": "AI 응답 {number} 시점 재생",
  "First response {time}": "첫 응답 {time}",
  " · End {time}": " · 종료 {time}",
  "Play recorded part {number}": "녹음 부분 {number} 재생",
  "Waveform for recording {number}": "녹음 {number} 파형",
  "Jump to human message {number}": "참가자 메시지 {number}로 이동",
  "Jump to final answer": "최종 제출로 이동",
  "Jump to AI waiting {number}": "AI 응답 대기 {number}로 이동",
  "Jump to AI response {number}": "AI 응답 {number}로 이동",
  "Exchange {number} timing": "대화 {number} 시각",
  "Play transcript at {time}": "전사 시각 {time} 재생",
  "{title} table": "{title} 표",
  "Waveform unavailable": "파형 표시 불가",
  "Loading waveform…": "파형 불러오는 중…",
  Gap: "누락",
  Uncertain: "불확실",
};

export function translate(
  language: Language,
  key: string,
  values: Record<string, string | number> = {},
): string {
  const template = language === "ko" ? (ko[key] ?? key) : key;
  return template.replace(/\{(\w+)\}/g, (match, name) =>
    String(values[name] ?? match),
  );
}

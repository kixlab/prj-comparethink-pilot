# KIXLAB 서버 배포 (원격 파일럿)

`npm start`(`vite preview`)로 빌드된 앱과 `/api/*` 미들웨어를 한 프로세스로 띄우고, 랩 HTTPS 프록시가 그 포트로 연결하는 구성입니다. DB 연동 전 단계이므로 **세션 데이터는 아직 참가자 브라우저(IndexedDB)에만 저장**됩니다. 마지막 절을 참고하세요.

## 0. 랩 관리자에게 요청할 것

- **서브도메인 루트**로 연결 (예: `https://comparethink.kixlab.org/` → `서버:PORT`).
  앱이 `/api/chat`처럼 절대경로를 쓰므로 `internal.kixlab.org/comparethink/` 같은 하위 경로로는 동작하지 않습니다.
- HTTPS 인증서 (마이크는 HTTPS에서만 허용됨)
- 프록시 설정
  - 채팅 스트림(SSE) 버퍼링 끄기
  - 요청 본문 한도 **64 MiB 이상** (STT 녹음 업로드)
  - 읽기 타임아웃 **900초 이상** (STT 요청 한도 15분)
  - `Host` 헤더를 그대로 전달

nginx 예시:

```nginx
server {
  server_name comparethink.kixlab.org;
  client_max_body_size 70m;
  location / {
    proxy_pass http://127.0.0.1:4173;   # 프록시가 다른 머신이면 서버IP:PORT
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_http_version 1.1;
    proxy_buffering off;
    proxy_read_timeout 900s;
    proxy_send_timeout 900s;
  }
}
```

프록시가 **같은 머신**에서 돈다면 `PILOT_HOST=127.0.0.1`(권장), **다른 머신**에서 포워딩한다면 `PILOT_HOST=0.0.0.0`으로 둡니다. Vite는 등록되지 않은 도메인 Host 헤더는 403으로 막지만 **IP 주소 Host는 허용**합니다. 따라서 `0.0.0.0`으로 열면 `http://서버IP:PORT`로 `/api/chat`에 직접 접근할 수 있습니다. 이 경우 방화벽으로 그 포트를 프록시 머신 IP에만 열어 달라고 요청하세요.

## 1. 서버 환경 확인

```bash
ssh <user>@<kixlab-server>
sudo -n true && echo "sudo OK" || echo "sudo 없음"
node -v            # 20 이상 필요
ffmpeg -version    # STT API 모드에서도 필요
ss -ltnp | grep :4173   # 사용할 포트가 비어 있는지
```

## 2. Node.js와 ffmpeg 설치 (필요할 때만)

sudo가 없으면 홈 디렉터리에 설치합니다.

```bash
# Node (nvm)
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash
source ~/.bashrc && nvm install 22

# ffmpeg: sudo 있으면
sudo apt-get install -y ffmpeg
# sudo 없으면 정적 빌드를 받아서 경로를 .env.local의 STT_FFMPEG_BIN에 지정
mkdir -p ~/opt && cd ~/opt
curl -LO https://johnvansickle.com/ffmpeg/releases/ffmpeg-release-amd64-static.tar.xz
tar xf ffmpeg-release-amd64-static.tar.xz   # → ~/opt/ffmpeg-*-amd64-static/ffmpeg
```

## 3. 코드 받기와 설정

```bash
git clone <repo-url> ~/comparethink-pilot && cd ~/comparethink-pilot
git checkout <배포할 브랜치 또는 태그>
npm ci
cp .env.example .env.local && chmod 600 .env.local
```

`.env.local`에서 바꿀 값:

```dotenv
OPENAI_API_KEY=...                 # 또는 Bedrock 키 + OPENAI_BASE_URL
OPENAI_MODEL=<고정할 모델 스냅샷>

STT_PROVIDER=api
STT_LANGUAGE=auto                  # 한국어 세션 위주면 ko
STT_API_BASE_URL=https://api.openai.com/v1
STT_API_KEY=...                    # OpenAI 키 (Bedrock 키 재사용 금지)
STT_API_MODEL=whisper-1
STT_API_RESPONSE_FORMAT=verbose_json   # whisper-1은 diarized_json 미지원
STT_FFMPEG_BIN=                    # PATH에 없을 때만 절대경로

PILOT_PUBLIC_ORIGIN=https://comparethink.kixlab.org   # 끝 슬래시 없이
PILOT_HOST=127.0.0.1
PILOT_PORT=4173
PILOT_ACCESS_TOKENS=<openssl rand -hex 16 결과>   # 쉼표로 여러 개 가능
```

### 참가자 접속 링크

`PILOT_ACCESS_TOKENS`를 지정하면 모든 `/api/*` 요청에 키가 필요합니다. 페이지 자체는 열리지만 키가 없으면 과제를 불러오지 않고 "접속 링크가 없거나 올바르지 않습니다"를 표시합니다.

```text
https://<도메인>/?key=<토큰>&lang=ko            # 한국어
https://<도메인>/?key=<토큰>&lang=en&task=travelplanner
```

- 앱이 키를 그 탭에만 보관하고 주소창에서 지웁니다. 화면 공유 중에도 키가 보이지 않고, 같은 탭에서는 새로고침해도 유지됩니다. 새 탭에서는 링크로 다시 들어와야 합니다.
- 연구자도 관리 화면(`admin`)과 전사를 쓰려면 키가 있는 링크로 접속해야 합니다.
- 토큰은 여러 개 둘 수 있습니다(예: 연구자용 1개 + 참가자 회차별). 링크가 유출되면 해당 토큰만 지우고 `pm2 restart comparethink` 하면 바로 막힙니다. 진행 중인 세션이 있으면 끝난 뒤에 하세요.
- 토큰은 세션 기록에 남지 않습니다.

## 4. 빌드와 실행

```bash
npm run build
npm start          # 동작 확인 후 Ctrl+C
```

계속 띄워 두려면 pm2를 씁니다(sudo 불필요).

```bash
npm i -g pm2
pm2 start npm --name comparethink -- start
pm2 save
pm2 logs comparethink
```

재부팅 후 자동 실행: sudo가 있으면 `pm2 startup` 안내를 따르고, 없으면 `crontab -e`에 `@reboot bash -lc 'pm2 resurrect'`를 추가합니다.

업데이트:

```bash
git pull && npm ci && npm run build && pm2 restart comparethink
```

`.env.local`을 바꾼 뒤에도 `pm2 restart`가 필요합니다. 세션 중에는 재시작하지 마세요(진행 중인 채팅 스트림이 끊깁니다).

## 5. 확인

```bash
# 서버 안에서
curl -s localhost:4173/api/config | grep -o '"api_ready":[a-z]*'      # true
curl -s localhost:4173/api/stt/config | grep -o '"ready":[a-z]*'      # true
```

다른 컴퓨터의 Chrome에서 `https://<도메인>/`을 열고 다음을 확인합니다.

1. 마이크 권한 요청 → 테스트 녹음 재생
2. 짧은 세션 진행 → AI 응답이 스트리밍으로 조금씩 표시되는지 (한 번에 표시되면 프록시 버퍼링이 켜진 상태)
3. 종료 후 전사 실행 → 구간 시각이 표시되는지
4. ZIP 다운로드

## 6. 서버 저장 (MongoDB Atlas + 디스크)

`MONGODB_URI`를 지정하면 브라우저가 세션을 서버로 자동 업로드합니다. 브라우저(IndexedDB) 저장은 그대로 유지되고, 서버 사본은 백업 겸 연구자 수집 경로입니다.

| 데이터                             | 저장 위치                                                                          |
| ---------------------------------- | ---------------------------------------------------------------------------------- |
| 세션 메타데이터, 이벤트, 전사 기록 | Atlas `MONGODB_DB` (`sessions`, `events`, `transcriptions`, `audio_chunks` 컬렉션) |
| 녹음 원본 조각                     | 서버 디스크 `PILOT_DATA_DIR/audio/<session_id>/<chunk_id>.bin`                     |

```dotenv
MONGODB_URI=mongodb+srv://<user>:<password>@<cluster>/
MONGODB_DB=comparethink                 # 개발용 PC는 comparethink_dev 처럼 다른 이름
PILOT_DATA_DIR=/ssd/jaeyoung/comparethink-data
PILOT_ADMIN_TOKENS=<openssl rand -hex 16 결과>   # 연구자 전용
```

- 연결 확인: `npm run db:check`. "IP is probably not allowed"가 나오면 Atlas **Network Access**에 그 컴퓨터의 IP(`curl -s ifconfig.me`)를 추가합니다.
- 업로드 시점: 세션 중 10초마다, 종료 직후, 그리고 페이지를 열 때 그 브라우저에 남은 이전 세션까지. 끊기면 다음 시도에서 이어서 올리고, 같은 기록을 두 번 저장하지 않습니다.
- 종료 화면의 **서버 백업** 줄이 "모든 데이터가 서버에 저장되었습니다"가 될 때까지 참가자가 탭을 닫지 않게 안내하세요.
- **연구자 조회**: `?key=<관리자 키>`로 접속 → 참가자 ID에 `admin` → **서버에 저장된 세션**에서 기록 검토와 ZIP 받기. 참가자 키로는 업로드만 되고 조회는 403으로 막힙니다.
- **백업**: 무료 Atlas(M0)는 자동 백업이 없습니다. 실험 기간에는 주기적으로 관리 화면에서 ZIP을 받아 두거나 `PILOT_DATA_DIR` 폴더를 복사해 두세요.

## 7. 주의사항

- **외부에 열 때는 반드시 `PILOT_ACCESS_TOKENS`를 지정하세요.** 비워 두면 주소를 아는 누구나 서버 키로 모델을 호출할 수 있습니다. 키가 있어도 요청 횟수 제한은 없으니 파일럿 기간이 아닐 때는 `pm2 stop comparethink`으로 내려 두고, OpenAI 대시보드에서 사용량 한도도 설정해 두세요.
- `MONGODB_URI`를 비우면 서버 저장이 꺼지고 예전처럼 브라우저에만 남습니다. 이 경우 참가자가 ZIP을 받아 전달해야 합니다.

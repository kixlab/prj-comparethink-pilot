#!/usr/bin/env bash
set -eu

# Install only the runner/build tools in this checkout. The existing Alt model is read-only.
STT_PROJECT_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
STT_TOOLS_ROOT="$STT_PROJECT_ROOT/.local/stt"
STT_WHISPER_COMMIT=d1be6fde11ac6e0407606b4e42fe72d34add8037
mkdir -p "$STT_TOOLS_ROOT"
if [ ! -x "$STT_TOOLS_ROOT/tools/bin/cmake" ]; then
  python3 -m venv "$STT_TOOLS_ROOT/tools"
  "$STT_TOOLS_ROOT/tools/bin/python" -m pip install --disable-pip-version-check 'cmake==3.31.6'
fi
if [ ! -d "$STT_TOOLS_ROOT/whisper.cpp" ]; then
  curl --fail --location "https://codeload.github.com/ggml-org/whisper.cpp/tar.gz/$STT_WHISPER_COMMIT" -o "$STT_TOOLS_ROOT/whisper-source.tar.gz"
  mkdir -p "$STT_TOOLS_ROOT/whisper.cpp"
  tar -xzf "$STT_TOOLS_ROOT/whisper-source.tar.gz" -C "$STT_TOOLS_ROOT/whisper.cpp" --strip-components=1
fi
"$STT_TOOLS_ROOT/tools/bin/cmake" -S "$STT_TOOLS_ROOT/whisper.cpp" -B "$STT_TOOLS_ROOT/whisper.cpp/build" -DCMAKE_BUILD_TYPE=Release -DWHISPER_BUILD_TESTS=OFF -DWHISPER_BUILD_SERVER=OFF -DWHISPER_COREML=OFF
"$STT_TOOLS_ROOT/tools/bin/cmake" --build "$STT_TOOLS_ROOT/whisper.cpp/build" --config Release --target whisper-cli -j 4
echo 'Local Whisper runner is ready in .local/stt/whisper.cpp/build/bin/whisper-cli'

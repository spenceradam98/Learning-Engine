#!/bin/bash
# Builds llama.cpp and downloads a model, for an Intel Mac on macOS 11.
# Usage:  bash scripts/setup_llama.sh          (7B model, ~4.7 GB download)
#         bash scripts/setup_llama.sh 3b       (faster 3B model, ~2 GB)
set -e

LLAMA_DIR="${LLAMA_DIR:-$HOME/llama.cpp}"
ENGINE_DIR="$(cd "$(dirname "$0")/.." && pwd)"
MODELS_DIR="$ENGINE_DIR/models"

if [ "$1" = "3b" ]; then
  MODEL_FILE="Qwen2.5-3B-Instruct-Q4_K_M.gguf"
  MODEL_URL="https://huggingface.co/bartowski/Qwen2.5-3B-Instruct-GGUF/resolve/main/$MODEL_FILE"
else
  MODEL_FILE="Qwen2.5-7B-Instruct-Q4_K_M.gguf"
  MODEL_URL="https://huggingface.co/bartowski/Qwen2.5-7B-Instruct-GGUF/resolve/main/$MODEL_FILE"
fi

echo "==> 1/4 Checking Apple's command line tools"
if ! xcode-select -p >/dev/null 2>&1; then
  echo "Apple's command line tools are missing. Run this, finish the installer, then re-run this script:"
  echo "    xcode-select --install"
  exit 1
fi

echo "==> 2/4 Checking for cmake"
CMAKE="$(command -v cmake || true)"
if [ -z "$CMAKE" ]; then
  echo "Installing cmake for your user with pip (Homebrew no longer supports macOS 11)..."
  python3 -m pip install --user --upgrade pip
  python3 -m pip install --user cmake
  CMAKE="$(python3 -m site --user-base)/bin/cmake"
fi
"$CMAKE" --version | head -1

echo "==> 3/4 Building llama-server in $LLAMA_DIR (takes 5-15 minutes)"
if [ ! -d "$LLAMA_DIR" ]; then
  git clone --depth 1 https://github.com/ggml-org/llama.cpp "$LLAMA_DIR"
fi
# Metal is off: the 2014 MacBook's Intel GPU is slower than its CPU for this.
"$CMAKE" -S "$LLAMA_DIR" -B "$LLAMA_DIR/build" -DCMAKE_BUILD_TYPE=Release \
  -DGGML_METAL=OFF -DLLAMA_CURL=OFF
"$CMAKE" --build "$LLAMA_DIR/build" --config Release -j "$(sysctl -n hw.physicalcpu)" --target llama-server
echo "Built: $LLAMA_DIR/build/bin/llama-server"

echo "==> 4/4 Downloading $MODEL_FILE into $MODELS_DIR"
mkdir -p "$MODELS_DIR"
# -C - resumes if the download was interrupted.
curl -L -C - --fail -o "$MODELS_DIR/$MODEL_FILE" "$MODEL_URL"

echo
echo "All set. Start the model with:"
echo "    bash scripts/start_llm.sh $1"

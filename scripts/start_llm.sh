#!/bin/bash
# Starts the local model on http://localhost:8080. Leave this window open.
# Usage:  bash scripts/start_llm.sh        (7B)
#         bash scripts/start_llm.sh 3b     (3B, faster)
LLAMA_DIR="${LLAMA_DIR:-$HOME/llama.cpp}"
ENGINE_DIR="$(cd "$(dirname "$0")/.." && pwd)"
if [ "$1" = "3b" ]; then
  MODEL="$ENGINE_DIR/models/Qwen2.5-3B-Instruct-Q4_K_M.gguf"
else
  MODEL="$ENGINE_DIR/models/Qwen2.5-7B-Instruct-Q4_K_M.gguf"
fi
MODEL="${LLAMA_MODEL:-$MODEL}"
SERVER="$LLAMA_DIR/build/bin/llama-server"

[ -x "$SERVER" ] || { echo "llama-server not found at $SERVER. Run: bash scripts/setup_llama.sh"; exit 1; }
[ -f "$MODEL" ] || { echo "Model not found at $MODEL. Run: bash scripts/setup_llama.sh $1"; exit 1; }

echo "Starting $(basename "$MODEL") on http://localhost:8080 (Ctrl+C to stop)"
exec "$SERVER" -m "$MODEL" --host 127.0.0.1 --port 8080 -c 4096 -t "$(sysctl -n hw.physicalcpu)"

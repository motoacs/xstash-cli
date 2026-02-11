#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT_DIR="${1:-$ROOT_DIR/dist}"
BIN_NAME="${BIN_NAME:-xstash}"
ENTRYPOINT="${ENTRYPOINT:-$ROOT_DIR/src/index.ts}"

if ! command -v deno >/dev/null 2>&1; then
  echo "error: deno is not installed or not in PATH" >&2
  exit 1
fi

mkdir -p "$OUT_DIR"

TARGETS=(
  "x86_64-unknown-linux-gnu"
  "x86_64-apple-darwin"
  "aarch64-apple-darwin"
  "x86_64-pc-windows-msvc"
)

echo "Building single-file binaries into: $OUT_DIR"
echo "Entrypoint: $ENTRYPOINT"

for target in "${TARGETS[@]}"; do
  ext=""
  if [[ "$target" == *windows* ]]; then
    ext=".exe"
  fi

  output_path="$OUT_DIR/${BIN_NAME}-${target}${ext}"
  echo "-> $target"

  deno compile \
    --allow-all \
    --target "$target" \
    --output "$output_path" \
    "$ENTRYPOINT"
done

echo "Done."

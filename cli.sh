#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Ensure output directory exists
mkdir -p "${ROOT}/out"

# Build the CLI binary
(cd "${ROOT}" && cargo build -q -p chain-lens-core --release 2>&1) || {
  printf '{"ok":false,"error":{"code":"BUILD_ERROR","message":"Failed to build chain-lens-core"}}\n'
  exit 1
}

BIN="${ROOT}/target/release/chain-lens-core"

if [ "${1:-}" = "--block" ]; then
  # Block mode
  shift
  if [ $# -lt 3 ]; then
    printf '{"ok":false,"error":{"code":"INVALID_ARGS","message":"Usage: cli.sh --block <blk.dat> <rev.dat> <xor.dat>"}}\n'
    exit 1
  fi

  BLK_FILE="$1"
  REV_FILE="$2"
  XOR_FILE="$3"

  for f in "$BLK_FILE" "$REV_FILE" "$XOR_FILE"; do
    if [ ! -f "$f" ]; then
      printf '{"ok":false,"error":{"code":"FILE_NOT_FOUND","message":"File not found: %s"}}\n' "$f"
      exit 1
    fi
  done

  # Run block mode — does NOT print to stdout, only writes out/<block_hash>.json
  if ! "${BIN}" --block "${BLK_FILE}" "${REV_FILE}" "${XOR_FILE}"; then
    exit 1
  fi
  exit 0
fi

# Single-transaction mode
if [ $# -lt 1 ]; then
  printf '{"ok":false,"error":{"code":"INVALID_ARGS","message":"Usage: cli.sh <fixture.json> or cli.sh --block <blk.dat> <rev.dat> <xor.dat>"}}\n'
  exit 1
fi

FIXTURE="$1"

if [ ! -f "$FIXTURE" ]; then
  printf '{"ok":false,"error":{"code":"FILE_NOT_FOUND","message":"Fixture file not found: %s"}}\n' "$FIXTURE"
  exit 1
fi

# Run in single-tx mode — prints JSON to stdout AND writes out/<txid>.json
if ! OUTPUT=$("${BIN}" "${FIXTURE}" 2>&1); then
  # On parse error, the binary already printed the error JSON to stderr+stdout
  echo "$OUTPUT"
  exit 1
fi

echo "$OUTPUT"
exit 0

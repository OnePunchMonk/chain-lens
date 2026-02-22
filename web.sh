#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

PORT="${PORT:-3000}"
export PORT

cd "${ROOT}"
exec cargo run -q -p chain-lens-server

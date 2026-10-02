#!/usr/bin/env bash
set -euo pipefail
APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if ! command -v node >/dev/null 2>&1; then
  echo "请安装 Node.js 18+ 后重试。"
  exit 1
fi
node "$APP_DIR/scripts/launch.cjs" "${1:-8000}"

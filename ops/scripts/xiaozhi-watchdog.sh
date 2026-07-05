#!/usr/bin/env bash
set -euo pipefail

XIAOZHI_SERVICE="${XIAOZHI_SERVICE:-stackchan-xiaozhi-client.service}"
NEWS_URL="${NEWS_URL:-http://127.0.0.1:8788/healthz}"
WINDOW="${WINDOW:-3 minutes ago}"

if ! curl -fsS --max-time 5 "$NEWS_URL" >/dev/null; then
  logger -t stackchan-xiaozhi-watchdog "cloud news health check failed; restarting ${XIAOZHI_SERVICE}"
  systemctl restart "$XIAOZHI_SERVICE"
  exit 0
fi

if journalctl -u "$XIAOZHI_SERVICE" --since "$WINDOW" --no-pager | grep -q "小智连接已关闭 (代码: 1006"; then
  logger -t stackchan-xiaozhi-watchdog "xiaozhi websocket closed with 1006; restarting ${XIAOZHI_SERVICE}"
  systemctl restart "$XIAOZHI_SERVICE"
fi

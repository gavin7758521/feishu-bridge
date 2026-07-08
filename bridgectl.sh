#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
SERVICE="${FEISHU_BRIDGE_SERVICE:-feishu-bridge}"
LEGACY_SERVICE="${FEISHU_BRIDGE_LEGACY_SERVICE:-}"
ROOT="${FEISHU_BRIDGE_ROOT:-$SCRIPT_DIR}"
ENV_FILE="${FEISHU_BRIDGE_ENV_FILE:-$ROOT/.env}"

usage() {
    cat <<'EOF'
Usage:
  bridgectl.sh status
  bridgectl.sh logs
  bridgectl.sh restart
  bridgectl.sh stop
  bridgectl.sh mode echo
  bridgectl.sh mode codex
  bridgectl.sh mode command

Notes:
  status  Shows service state, bridge mode, and recent logs.
  logs    Follows live systemd logs.
  mode    Updates FEISHU_BRIDGE_MODE in .env and restarts the service.
EOF
}

require_env_file() {
    if [[ ! -f "$ENV_FILE" ]]; then
        echo "Missing $ENV_FILE" >&2
        exit 1
    fi
}

current_mode() {
    require_env_file
    grep -E '^(FEISHU_BRIDGE_MODE|CODEX_BRIDGE_MODE)=' "$ENV_FILE" | tail -n 1 | cut -d= -f2- || true
}

set_mode() {
    local mode="$1"
    if [[ "$mode" != "echo" && "$mode" != "codex" && "$mode" != "command" ]]; then
        echo "Mode must be 'echo', 'codex', or 'command'." >&2
        exit 1
    fi

    require_env_file
    if grep -qE '^FEISHU_BRIDGE_MODE=' "$ENV_FILE"; then
        sed -i "s/^FEISHU_BRIDGE_MODE=.*/FEISHU_BRIDGE_MODE=$mode/" "$ENV_FILE"
    else
        printf '\nFEISHU_BRIDGE_MODE=%s\n' "$mode" >> "$ENV_FILE"
    fi

    sudo systemctl restart "$SERVICE"
    echo "FEISHU_BRIDGE_MODE=$mode"
    sudo systemctl --no-pager --full status "$SERVICE" | sed -n '1,18p'
}

case "${1:-}" in
    status)
        echo "Bridge root: $ROOT"
        echo "Service: $SERVICE"
        echo "Mode: $(current_mode)"
        echo
        sudo systemctl --no-pager --full status "$SERVICE" | sed -n '1,24p'
        if [[ -n "$LEGACY_SERVICE" && "$SERVICE" != "$LEGACY_SERVICE" ]] && systemctl is-active --quiet "$LEGACY_SERVICE"; then
            echo
            echo "Legacy service still running:"
            sudo systemctl --no-pager --full status "$LEGACY_SERVICE" | sed -n '1,10p'
        fi
        echo
        echo "Recent logs:"
        sudo journalctl -u "$SERVICE" -n 30 --no-pager
        ;;
    logs)
        sudo journalctl -u "$SERVICE" -f
        ;;
    restart)
        sudo systemctl restart "$SERVICE"
        sudo systemctl --no-pager --full status "$SERVICE" | sed -n '1,24p'
        ;;
    stop)
        sudo systemctl stop "$SERVICE"
        sudo systemctl --no-pager --full status "$SERVICE" | sed -n '1,24p'
        ;;
    mode)
        set_mode "${2:-}"
        ;;
    -h|--help|help|"")
        usage
        ;;
    *)
        usage >&2
        exit 1
        ;;
esac

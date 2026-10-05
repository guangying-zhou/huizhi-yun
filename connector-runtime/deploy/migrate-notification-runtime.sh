#!/usr/bin/env bash
set -euo pipefail

SOURCE_SERVICE="${HZY_NOTIFICATION_RUNTIME_SERVICE_NAME:-hzy-notification-runtime}"
TARGET_SERVICE="${HZY_CONNECTOR_RUNTIME_SERVICE_NAME:-hzy-connector-runtime}"
SOURCE_ENV="${HZY_NOTIFICATION_RUNTIME_ENV_FILE:-/opt/hzy/notification-runtime/.env}"
TARGET_ENV="${HZY_CONNECTOR_RUNTIME_ENV_FILE:-/opt/hzy/connector-runtime/.env}"
TARGET_BINARY="${HZY_CONNECTOR_RUNTIME_BINARY:-/usr/local/bin/hzy-connector-runtime}"

[[ "$(id -u)" -eq 0 ]] || { echo "Please run through sudo." >&2; exit 1; }
[[ -r "$SOURCE_ENV" ]] || { echo "Notification Runtime environment is not readable: $SOURCE_ENV" >&2; exit 1; }
[[ -r "$TARGET_ENV" ]] || { echo "Connector Runtime environment is not readable: $TARGET_ENV" >&2; exit 1; }
[[ -x "$TARGET_BINARY" ]] || { echo "Connector Runtime binary is not installed: $TARGET_BINARY" >&2; exit 1; }

source_store="$(bash -c 'set -a; source "$1"; printf "%s" "${HZY_NOTIFICATION_RUNTIME_STORE:-sqlite}"' bash "$SOURCE_ENV")"
source_db="$(bash -c 'set -a; source "$1"; printf "%s" "${HZY_NOTIFICATION_RUNTIME_SQLITE_PATH:-/opt/hzy/notification-runtime/data/delivery.db}"' bash "$SOURCE_ENV")"
target_store="$(bash -c 'set -a; source "$1"; printf "%s" "${HZY_CONNECTOR_RUNTIME_STORE:-sqlite}"' bash "$TARGET_ENV")"
target_db="$(bash -c 'set -a; source "$1"; printf "%s" "${HZY_CONNECTOR_RUNTIME_SQLITE_PATH:-/opt/hzy/connector-runtime/data/operations.db}"' bash "$TARGET_ENV")"
target_port="$(bash -c 'set -a; source "$1"; printf "%s" "${HZY_CONNECTOR_RUNTIME_PORT:-18082}"' bash "$TARGET_ENV")"

[[ "$source_store" == "sqlite" ]] || { echo "MySQL ledger migration requires a controlled database migration; automatic cutover was not attempted." >&2; exit 1; }
[[ "$target_store" == "sqlite" ]] || { echo "Target Connector Runtime is not configured for SQLite." >&2; exit 1; }
[[ -f "$source_db" ]] || { echo "Notification Runtime SQLite ledger is missing: $source_db" >&2; exit 1; }
[[ "$source_db" != "$target_db" ]] || { echo "Source and target SQLite paths must be different." >&2; exit 1; }

backup_dir="$(dirname "$target_db")/migration-backup-$(date -u +%Y%m%dT%H%M%SZ)"
probe_dir="$(mktemp -d)"
migration_succeeded=0
old_timer_active=0

rollback() {
  local status="$?"
  if [[ "$migration_succeeded" -eq 0 ]]; then
    systemctl stop "$TARGET_SERVICE.service" >/dev/null 2>&1 || true
    if [[ -f "$backup_dir/operations.db" ]]; then
      install -m 0600 "$backup_dir/operations.db" "$target_db"
      [[ -f "$backup_dir/operations.db-wal" ]] && install -m 0600 "$backup_dir/operations.db-wal" "$target_db-wal"
      [[ -f "$backup_dir/operations.db-shm" ]] && install -m 0600 "$backup_dir/operations.db-shm" "$target_db-shm"
    fi
    systemctl start "$SOURCE_SERVICE.service" >/dev/null 2>&1 || true
    if [[ "$old_timer_active" -eq 1 ]]; then
      systemctl start "$SOURCE_SERVICE-update.timer" >/dev/null 2>&1 || true
    fi
    echo "Connector cutover failed; Notification Runtime was restored." >&2
  fi
	rm -rf "$probe_dir"
  exit "$status"
}
trap rollback EXIT

if systemctl is-active --quiet "$SOURCE_SERVICE-update.timer"; then old_timer_active=1; fi
systemctl stop "$SOURCE_SERVICE-update.timer" >/dev/null 2>&1 || true
systemctl stop "$SOURCE_SERVICE.service"
systemctl stop "$TARGET_SERVICE.service" >/dev/null 2>&1 || true

install -d -m 0700 "$backup_dir"
if [[ -f "$target_db" ]]; then install -m 0600 "$target_db" "$backup_dir/operations.db"; fi
if [[ -f "$target_db-wal" ]]; then install -m 0600 "$target_db-wal" "$backup_dir/operations.db-wal"; fi
if [[ -f "$target_db-shm" ]]; then install -m 0600 "$target_db-shm" "$backup_dir/operations.db-shm"; fi

rm -f "$target_db" "$target_db-wal" "$target_db-shm"
install -d -m 0700 "$(dirname "$target_db")"
install -m 0600 "$source_db" "$target_db"
if [[ -f "$source_db-wal" ]]; then install -m 0600 "$source_db-wal" "$target_db-wal"; fi
if [[ -f "$source_db-shm" ]]; then install -m 0600 "$source_db-shm" "$target_db-shm"; fi
target_user="$(systemctl show -p User --value "$TARGET_SERVICE.service")"
target_group="$(systemctl show -p Group --value "$TARGET_SERVICE.service")"
chown "$target_user:$target_group" "$target_db" "$target_db-wal" "$target_db-shm" 2>/dev/null || chown "$target_user:$target_group" "$target_db"

set -a
source "$TARGET_ENV"
set +a
"$TARGET_BINARY" -check-store
systemctl start "$TARGET_SERVICE.service"

for _ in $(seq 1 20); do
  if curl -fsS "http://127.0.0.1:$target_port/runtime/health" > "$probe_dir/health.json" \
	&& curl -fsS "http://127.0.0.1:$target_port/runtime/capabilities" > "$probe_dir/capabilities.json"; then
    break
  fi
  sleep 1
done
grep -q '"runtimeProduct":"hzy-connector-runtime"' "$probe_dir/health.json"
grep -q '"arbitraryHttpProxy":false' "$probe_dir/capabilities.json"
grep -q '"requiredScope":"connector-runtime:notifications:send"' "$probe_dir/capabilities.json"
rm -rf "$probe_dir"

systemctl disable "$SOURCE_SERVICE-update.timer" >/dev/null 2>&1 || true
migration_succeeded=1
trap - EXIT
echo "Connector Runtime ledger cutover completed."
echo "The old service remains installed but stopped; now enable the Connector notification channel in Console."

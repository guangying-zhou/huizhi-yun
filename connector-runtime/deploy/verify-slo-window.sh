#!/usr/bin/env bash
set -euo pipefail

SERVICE_NAME="${HZY_CONNECTOR_RUNTIME_SERVICE_NAME:-hzy-connector-runtime}"
SINCE="${HZY_CONNECTOR_RUNTIME_SLO_SINCE:-1 hour ago}"
MIN_SNAPSHOTS="${HZY_CONNECTOR_RUNTIME_SLO_MIN_SNAPSHOTS:-4}"
MIN_WINDOW_SECONDS="${HZY_CONNECTOR_RUNTIME_SLO_MIN_WINDOW_SECONDS:-900}"
MAX_RESTARTS="${HZY_CONNECTOR_RUNTIME_SLO_MAX_RESTARTS:-0}"
INPUT_FILE="${HZY_CONNECTOR_RUNTIME_SLO_INPUT_FILE:-}"
RESTARTS_OVERRIDE="${HZY_CONNECTOR_RUNTIME_SLO_RESTARTS:-}"

fail() { echo "[connector-runtime-slo] FAIL: $*" >&2; exit 1; }

for value_name in MIN_SNAPSHOTS MIN_WINDOW_SECONDS MAX_RESTARTS; do
  value="${!value_name}"
  [[ "$value" =~ ^[0-9]+$ ]] || fail "$value_name must be a non-negative integer"
done
[[ "$MIN_SNAPSHOTS" -ge 2 ]] || fail "MIN_SNAPSHOTS must be at least 2"

command -v python3 >/dev/null 2>&1 || fail "python3 is required"
tmp_file="$(mktemp)"
trap 'rm -f "$tmp_file"' EXIT

if [[ -n "$INPUT_FILE" ]]; then
  [[ -r "$INPUT_FILE" ]] || fail "SLO input file is not readable"
  cp "$INPUT_FILE" "$tmp_file"
else
  command -v journalctl >/dev/null 2>&1 || fail "journalctl is required"
  journalctl -u "$SERVICE_NAME.service" --since "$SINCE" --no-pager -o cat > "$tmp_file"
fi

if [[ -n "$RESTARTS_OVERRIDE" ]]; then
  restarts="$RESTARTS_OVERRIDE"
else
  command -v systemctl >/dev/null 2>&1 || fail "systemctl is required"
  restarts="$(systemctl show "$SERVICE_NAME.service" --property NRestarts --value)"
fi
[[ "$restarts" =~ ^[0-9]+$ ]] || fail "service restart count is unavailable"
[[ "$restarts" -le "$MAX_RESTARTS" ]] \
  || fail "service restart count $restarts exceeds allowed maximum $MAX_RESTARTS"

python3 - "$tmp_file" "$MIN_SNAPSHOTS" "$MIN_WINDOW_SECONDS" "$restarts" <<'PY'
import datetime as dt
import json
import re
import sys

path, minimum_count_raw, minimum_window_raw, restarts_raw = sys.argv[1:]
minimum_count = int(minimum_count_raw)
minimum_window = int(minimum_window_raw)

allowed_top_level = {
    "event", "product", "version", "runtimeId", "tenant", "deployment",
    "collectedAt", "available", "databaseBytes", "deliveries", "peopleJobs",
}
required_top_level = {
    "event", "product", "version", "runtimeId", "tenant", "deployment",
    "collectedAt", "available", "databaseBytes",
}
forbidden_key_fragments = {
    "recipient", "touser", "subject", "message", "url", "token", "secret",
    "providerresult", "idempotencykey", "authorization", "credential",
}

def fail(message):
    raise SystemExit(f"[connector-runtime-slo] FAIL: {message}")

def normalized_key(value):
    return re.sub(r"[^a-z0-9]", "", value.lower())

def parse_time(value):
    if not isinstance(value, str) or not value:
        fail("snapshot collectedAt is missing")
    match = re.fullmatch(r"(.+?)(?:\.(\d+))?(Z|[+-]\d{2}:\d{2})", value)
    if not match:
        fail("snapshot collectedAt is not ISO-8601")
    base, fraction, zone = match.groups()
    if fraction:
        fraction = (fraction + "000000")[:6]
        value = f"{base}.{fraction}{zone}"
    try:
        return dt.datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        fail("snapshot collectedAt is not ISO-8601")

def validate_counts(name, value):
    if value is None:
        return {}
    if not isinstance(value, dict):
        fail(f"{name} must be a status-count object")
    result = {}
    for key, count in value.items():
        normalized = normalized_key(str(key))
        if any(fragment in normalized for fragment in forbidden_key_fragments):
            fail(f"{name} contains a forbidden key")
        if not re.fullmatch(r"[a-z][a-z0-9_]*", str(key)):
            fail(f"{name} contains an invalid status key")
        if isinstance(count, bool) or not isinstance(count, int) or count < 0:
            fail(f"{name} contains an invalid count")
        result[str(key)] = count
    return result

snapshots = []
with open(path, encoding="utf-8", errors="replace") as source:
    for line in source:
        marker = "slo_snapshot "
        position = line.find(marker)
        if position < 0:
            continue
        payload = line[position + len(marker):].strip()
        try:
            snapshot = json.loads(payload)
        except json.JSONDecodeError:
            fail("journal contains a malformed SLO snapshot")
        if not isinstance(snapshot, dict):
            fail("SLO snapshot is not an object")
        unknown = set(snapshot) - allowed_top_level
        missing = required_top_level - set(snapshot)
        if unknown:
            fail("snapshot contains fields outside the redacted schema")
        if missing:
            fail("snapshot is missing required fields")
        for key in snapshot:
            normalized = normalized_key(key)
            if any(fragment in normalized for fragment in forbidden_key_fragments):
                fail("snapshot contains a forbidden field")
        if snapshot.get("event") != "connector_runtime_slo_snapshot":
            fail("snapshot event is invalid")
        if snapshot.get("product") != "hzy-connector-runtime":
            fail("snapshot product is invalid")
        if not re.fullmatch(r"[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?", str(snapshot.get("version", ""))):
            fail("snapshot version is not exact semantic version")
        if snapshot.get("available") is not True:
            fail("observation window contains an unavailable snapshot")
        database_bytes = snapshot.get("databaseBytes")
        if isinstance(database_bytes, bool) or not isinstance(database_bytes, int) or database_bytes < 0:
            fail("snapshot databaseBytes is invalid")
        snapshot["_time"] = parse_time(snapshot.get("collectedAt"))
        snapshot["_deliveries"] = validate_counts("deliveries", snapshot.get("deliveries"))
        snapshot["_peopleJobs"] = validate_counts("peopleJobs", snapshot.get("peopleJobs"))
        snapshots.append(snapshot)

if len(snapshots) < minimum_count:
    fail(f"only {len(snapshots)} snapshots found; require at least {minimum_count}")

snapshots.sort(key=lambda item: item["_time"])
window_seconds = int((snapshots[-1]["_time"] - snapshots[0]["_time"]).total_seconds())
if window_seconds < minimum_window:
    fail(f"observation window is {window_seconds}s; require at least {minimum_window}s")

binding_fields = ("product", "runtimeId", "tenant", "deployment")
binding = tuple(snapshots[0].get(field) for field in binding_fields)
if not all(binding):
    fail("snapshot binding is incomplete")
for snapshot in snapshots[1:]:
    if tuple(snapshot.get(field) for field in binding_fields) != binding:
        fail("runtime binding drift detected in observation window")

def total(snapshot, key):
    return sum(snapshot[key].values())

for previous, current in zip(snapshots, snapshots[1:]):
    if total(current, "_deliveries") < total(previous, "_deliveries"):
        fail("delivery ledger total decreased in observation window")
    if total(current, "_peopleJobs") < total(previous, "_peopleJobs"):
        fail("People job total decreased in observation window")

first = snapshots[0]
last = snapshots[-1]
summary = {
    "event": "connector_runtime_slo_window_verified",
    "version": {"first": first["version"], "last": last["version"]},
    "runtimeId": last["runtimeId"],
    "tenant": last["tenant"],
    "deployment": last["deployment"],
    "snapshotCount": len(snapshots),
    "windowSeconds": window_seconds,
    "firstCollectedAt": first["collectedAt"],
    "lastCollectedAt": last["collectedAt"],
    "databaseBytes": {"first": first["databaseBytes"], "last": last["databaseBytes"]},
    "deliveryTotal": {"first": total(first, "_deliveries"), "last": total(last, "_deliveries")},
    "peopleJobTotal": {"first": total(first, "_peopleJobs"), "last": total(last, "_peopleJobs")},
    "serviceRestarts": int(restarts_raw),
}
print("[connector-runtime-slo] PASS " + json.dumps(summary, separators=(",", ":"), ensure_ascii=True))
PY

package runtimeapp

import (
	"encoding/json"
	"strings"
	"testing"
	"time"

	"github.com/huizhi-yun/notification-runtime/internal/config"
	"github.com/huizhi-yun/notification-runtime/internal/diagnostics"
)

func TestConnectorHeartbeatRequestTimeoutUsesConsoleTimeout(t *testing.T) {
	cfg := config.Config{Console: config.ConsoleConfig{Timeout: 45 * time.Second}}
	if got := connectorHeartbeatRequestTimeout(cfg); got != 45*time.Second {
		t.Fatalf("connector heartbeat timeout = %s, want 45s", got)
	}
}

func TestConnectorHeartbeatRequestTimeoutFallsBackToThirtySeconds(t *testing.T) {
	if got := connectorHeartbeatRequestTimeout(config.Config{}); got != 30*time.Second {
		t.Fatalf("connector heartbeat timeout = %s, want 30s", got)
	}
}

func TestConnectorSLOSnapshotContainsOnlyAggregateMetrics(t *testing.T) {
	encoded, err := encodeConnectorSLOSnapshot(config.Config{
		RuntimeID:  "connector-runtime",
		Tenant:     "C000001",
		Deployment: "C000001-console",
	}, diagnostics.Snapshot{
		CollectedAt:   "2026-07-15T12:00:00Z",
		DatabaseBytes: 4096,
		Deliveries:    map[string]int{"succeeded": 12, "partial_unknown": 1},
		PeopleJobs:    map[string]int{"success": 2, "failed": 1},
	}, true)
	if err != nil {
		t.Fatalf("encodeConnectorSLOSnapshot: %v", err)
	}
	var decoded connectorSLOSnapshot
	if err := json.Unmarshal([]byte(encoded), &decoded); err != nil {
		t.Fatalf("unmarshal snapshot: %v", err)
	}
	if decoded.Event != "connector_runtime_slo_snapshot" || !decoded.Available || decoded.DatabaseBytes != 4096 {
		t.Fatalf("snapshot = %#v", decoded)
	}
	if decoded.Deliveries["succeeded"] != 12 || decoded.PeopleJobs["failed"] != 1 {
		t.Fatalf("aggregate counts = deliveries %#v jobs %#v", decoded.Deliveries, decoded.PeopleJobs)
	}
	for _, forbidden := range []string{"recipient", "touser", "subject", "message", "url", "token", "secret", "providerResult", "idempotencyKey"} {
		if strings.Contains(strings.ToLower(encoded), strings.ToLower(forbidden)) {
			t.Fatalf("snapshot contains forbidden field %q: %s", forbidden, encoded)
		}
	}
}

func TestUnavailableConnectorSLOSnapshotOmitsOperationMetrics(t *testing.T) {
	encoded, err := encodeConnectorSLOSnapshot(config.Config{RuntimeID: "connector-runtime"}, diagnostics.Snapshot{
		CollectedAt:   "2026-07-15T12:00:00Z",
		DatabaseBytes: 4096,
		Deliveries:    map[string]int{"succeeded": 12},
		PeopleJobs:    map[string]int{"success": 2},
	}, false)
	if err != nil {
		t.Fatalf("encodeConnectorSLOSnapshot: %v", err)
	}
	if strings.Contains(encoded, "databaseBytes") || strings.Contains(encoded, "deliveries") || strings.Contains(encoded, "peopleJobs") {
		t.Fatalf("unavailable snapshot must omit stale metrics: %s", encoded)
	}
}

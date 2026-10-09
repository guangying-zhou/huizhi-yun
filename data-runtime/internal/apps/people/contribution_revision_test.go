package people

import (
	"testing"

	"github.com/huizhi-yun/data-runtime/internal/integrationoperation"
)

func TestContributionRevisionDisposition(t *testing.T) {
	tests := []struct {
		name     string
		incoming uint64
		hash     string
		applied  uint64
		oldHash  string
		exists   bool
		want     contributionRevisionDecision
	}{
		{name: "new scope accepts even empty collection snapshot", incoming: 1, hash: "empty", want: contributionRevisionApply},
		{name: "newer revision replaces scope", incoming: 2, hash: "new", applied: 1, oldHash: "old", exists: true, want: contributionRevisionApply},
		{name: "B then A skips stale A", incoming: 1, hash: "old", applied: 2, oldHash: "new", exists: true, want: contributionRevisionStale},
		{name: "same revision and hash is idempotent", incoming: 2, hash: "same", applied: 2, oldHash: "same", exists: true, want: contributionRevisionSame},
		{name: "same revision different hash conflicts", incoming: 2, hash: "tampered", applied: 2, oldHash: "same", exists: true, want: contributionRevisionMismatch},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := contributionRevisionDisposition(tt.incoming, tt.hash, tt.applied, tt.oldHash, tt.exists); got != tt.want {
				t.Fatalf("got %q, want %q", got, tt.want)
			}
		})
	}
}

func TestContributionSnapshotContentHashRejectsForgedDeclaration(t *testing.T) {
	content := map[string]any{
		"cycle_code":        "CYCLE-1",
		"project_code":      "PROJECT-1",
		"period_start":      "2026-07-01",
		"period_end":        "2026-07-31",
		"source_app":        "aims",
		"source_biz_type":   "time_entries",
		"sync_mode":         "replace_scope",
		"snapshot_complete": true,
		"items":             []any{},
	}
	want, err := integrationoperation.ValidateAndDigestCommand(content)
	if err != nil {
		t.Fatal(err)
	}
	command := make(map[string]any, len(content)+4)
	for key, value := range content {
		command[key] = value
	}
	command["source_revision"] = float64(1)
	command["snapshot_hash"] = "forged"
	command[integrationoperation.TrustedTenantCodeKey] = "tenant-1"
	command["current_user"] = "operator-1"

	got, err := contributionSnapshotContentHash(command)
	if err != nil {
		t.Fatal(err)
	}
	if got != want {
		t.Fatalf("content hash = %q, want %q", got, want)
	}
	if got == command["snapshot_hash"] {
		t.Fatal("recomputed content hash must not trust the declared snapshot hash")
	}
}

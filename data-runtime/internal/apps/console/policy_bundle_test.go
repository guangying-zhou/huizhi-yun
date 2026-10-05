package console

import (
	"context"
	"crypto/sha256"
	"database/sql/driver"
	"encoding/hex"
	"encoding/json"
	"strings"
	"testing"
	"time"

	"github.com/DATA-DOG/go-sqlmock"
)

func policyFixture(t *testing.T, now time.Time) (string, string, string) {
	t.Helper()
	scope := "tenant-1:deployment-1:test"
	digest := sha256.Sum256([]byte(scope))
	key := "policy/v1/" + hex.EncodeToString(digest[:]) + ".json"
	body, _ := json.Marshal(map[string]any{"scope": scope, "syncedAt": now.UnixMilli(), "value": map[string]any{"tenantCode": "tenant-1", "deploymentCode": "deployment-1", "bundleVersion": "1", "bundleHash": "signed-hash", "signature": "verified-signature", "cachedAt": now.UTC().Format(time.RFC3339Nano)}})
	raw, _ := json.Marshal(map[string]any{"body": string(body), "mac": strings.Repeat("a", 64)})
	hash := sha256.Sum256(raw)
	return key, string(raw), hex.EncodeToString(hash[:])
}

func TestPolicySnapshotValidation(t *testing.T) {
	now := time.Now().Truncate(time.Millisecond)
	key, raw, _ := policyFixture(t, now)
	if _, err := validatePolicySnapshot("tenant-1", "deployment-1", key, raw, "", now); err != nil {
		t.Fatal(err)
	}
	for _, c := range []struct {
		tenant, deployment, key, raw, etag string
		now                                time.Time
	}{
		{"other", "deployment-1", key, raw, "", now},
		{"tenant-1", "other", key, raw, "", now},
		{"tenant-1", "deployment-1", "arbitrary-table", raw, "", now},
		{"tenant-1", "deployment-1", key, raw, "not-etag", now},
		{"tenant-1", "deployment-1", key, raw, "", now.Add(-time.Millisecond)},
		{"tenant-1", "deployment-1", key, raw, "", now.Add(5 * time.Minute)},
		{"tenant-1", "deployment-1", key, "{}", "", now},
	} {
		if _, err := validatePolicySnapshot(c.tenant, c.deployment, c.key, c.raw, c.etag, c.now); err == nil {
			t.Fatal("invalid record accepted")
		}
	}
}

func TestPolicySnapshotCASReplayAndLostRace(t *testing.T) {
	for _, c := range []struct {
		name, expected, current string
		stored                  bool
	}{
		{"insert", "", "same", true}, {"replayed insert", "", "same", true},
		{"update", strings.Repeat("b", 64), "same", true},
		{"lost race", strings.Repeat("b", 64), "newer", false},
	} {
		t.Run(c.name, func(t *testing.T) {
			database, mock, _ := sqlmock.New()
			defer database.Close()
			adapter := &Adapter{db: database, tenant: "tenant-1"}
			key, raw, etag := policyFixture(t, time.Now().Add(-time.Second).Truncate(time.Millisecond))
			if c.expected == "" {
				mock.ExpectExec("INSERT INTO policy_bundle_snapshots").WillReturnResult(sqlmock.NewResult(1, 1))
			} else {
				args := []driver.Value{raw, etag, sqlmock.AnyArg(), "1", "signed-hash", "tenant-1", "deployment-1", key, c.expected, sqlmock.AnyArg()}
				mock.ExpectExec("UPDATE policy_bundle_snapshots.*AND etag=\\? AND synced_at_ms<\\?").WithArgs(args...).WillReturnResult(sqlmock.NewResult(0, 0))
			}
			current := etag
			if c.current == "newer" {
				current = strings.Repeat("c", 64)
			}
			mock.ExpectQuery("SELECT envelope,etag FROM policy_bundle_snapshots WHERE tenant_code=\\? AND deployment_code=\\? AND object_key=\\?").WithArgs("tenant-1", "deployment-1", key).WillReturnRows(sqlmock.NewRows([]string{"envelope", "etag"}).AddRow(raw, current))
			result, err := adapter.WritePolicyBundle(context.Background(), "tenant-1", "deployment-1", map[string]any{"key": key, "body": raw, "expectedEtag": c.expected}, strings.Repeat("d", 64))
			if err != nil || result["stored"] != c.stored {
				t.Fatalf("result=%v err=%v", result, err)
			}
			if err := mock.ExpectationsWereMet(); err != nil {
				t.Fatal(err)
			}
		})
	}
}

func TestPolicyReadMissingAndTenantIsolation(t *testing.T) {
	database, mock, _ := sqlmock.New()
	defer database.Close()
	adapter := &Adapter{db: database, tenant: "tenant-1"}
	key, _, _ := policyFixture(t, time.Now())
	if _, err := adapter.ReadPolicyBundle(context.Background(), "wrong", "deployment-1", key); err == nil {
		t.Fatal("wrong tenant accepted")
	}
	mock.ExpectQuery("SELECT envelope,etag").WithArgs("tenant-1", "deployment-1", key).WillReturnRows(sqlmock.NewRows([]string{"envelope", "etag"}))
	result, err := adapter.ReadPolicyBundle(context.Background(), "tenant-1", "deployment-1", key)
	if result != nil || err != nil {
		t.Fatalf("result=%v err=%v", result, err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

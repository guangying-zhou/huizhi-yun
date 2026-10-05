package aims

import (
	"context"
	"errors"
	"os"
	"sync"
	"testing"

	"github.com/google/uuid"
	"github.com/huizhi-yun/data-runtime/internal/integrationoperation"
)

func TestMySQLProductCostFreezeConcurrentRetry(t *testing.T) {
	db := handoffMySQLDatabase(t)
	migration, err := os.ReadFile("../../../../aims/docs/migration_v5.0_integration_operation_outbox.sql")
	if err != nil {
		t.Fatal(err)
	}
	executeHandoffSQLScript(t, db, string(migration))
	ctx := context.Background()
	id := uuid.NewString()
	trusted := integrationoperation.TrustedContext{TenantCode: "TENANT", DeploymentCode: "AIMS", SourceApp: "aims", ServiceClientID: "aims.runtime"}
	command := map[string]any{"actorUid": "U1", "projectCode": "PRJ1", "periodMonth": "2026-09", "expectedRevision": float64(2), "evidenceRef": "review", "shares": []any{map[string]any{"productCode": "P1", "basisPoints": float64(5000)}}}
	run := func(c map[string]any, commit bool) error {
		tx, e := db.BeginTx(ctx, nil)
		if e != nil {
			return e
		}
		defer tx.Rollback()
		_, e = freezeProductCostRules(ctx, tx, trusted, id, "U1", "PRJ1", c)
		if e != nil {
			return e
		}
		if commit {
			return tx.Commit()
		}
		return tx.Rollback()
	}
	var wg sync.WaitGroup
	results := make(chan error, 2)
	for i := 0; i < 2; i++ {
		wg.Add(1)
		go func() { defer wg.Done(); results <- run(command, true) }()
	}
	wg.Wait()
	close(results)
	for err := range results {
		if err != nil {
			t.Fatal(err)
		}
	}
	var count int
	if err := db.QueryRow("SELECT COUNT(*) FROM integration_operation").Scan(&count); err != nil || count != 1 {
		t.Fatalf("count %d: %v", count, err)
	}
	changed := map[string]any{}
	for k, v := range command {
		changed[k] = v
	}
	changed["evidenceRef"] = "changed"
	if err := run(changed, true); !errors.Is(err, errProductCostFreezeConflict) {
		t.Fatalf("conflict: %v", err)
	}
	// A retry must preserve terminal status rather than restart delivery.
	if _, err := db.Exec("UPDATE integration_operation SET status='succeeded' WHERE operation_id=?", id); err != nil {
		t.Fatal(err)
	}
	if err := run(command, true); err != nil {
		t.Fatal(err)
	}
	var status string
	if err := db.QueryRow("SELECT status FROM integration_operation WHERE operation_id=?", id).Scan(&status); err != nil || status != "succeeded" {
		t.Fatalf("status %s: %v", status, err)
	}
	id = uuid.NewString()
	if err := run(command, false); err != nil {
		t.Fatal(err)
	}
	if err := db.QueryRow("SELECT COUNT(*) FROM integration_operation").Scan(&count); err != nil || count != 1 {
		t.Fatalf("rollback count %d: %v", count, err)
	}
}

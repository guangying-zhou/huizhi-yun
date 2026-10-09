package aims

import (
	"context"
	"errors"
	"testing"

	"github.com/google/uuid"
)

func TestMySQLProductCostReferencesIncludeArchivedWorkspace(t *testing.T) {
	db := handoffMySQLDatabase(t)
	migrateHandoffProductCenter(t, db)
	for _, row := range []struct{ code, status string }{{"P1", "active"}, {"P2", "archived"}} {
		if _, err := db.Exec("INSERT INTO product_workspaces(product_code,biz_id,status,created_by,updated_by,created_at,updated_at) VALUES(?,?,?,'pm','pm',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))", row.code, uuid.NewString(), row.status); err != nil {
			t.Fatal(err)
		}
	}
	for _, code := range []string{"P2", "p2", "UNKNOWN"} {
		tx, err := db.Begin()
		if err != nil {
			t.Fatal(err)
		}
		command := map[string]any{"actorUid": "U1", "projectCode": "PRJ1", "periodMonth": "2026-09", "expectedRevision": float64(2), "evidenceRef": "review", "shares": []any{map[string]any{"productCode": "P1", "basisPoints": 5000}, map[string]any{"productCode": code, "basisPoints": 3000}}}
		err = validateProductCostReferences(context.Background(), tx, command)
		if code == "P2" {
			if err != nil {
				t.Fatal(err)
			}
		} else if !errors.Is(err, errProductCostReferenceMissing) {
			t.Fatalf("%s: %v", code, err)
		}
		if err := tx.Rollback(); err != nil {
			t.Fatal(err)
		}
	}
}

package productcenter

import (
	"context"
	"database/sql"
	"strings"
	"testing"
)

func TestMySQLCrossDependencyFingerprintChanges(t *testing.T) {
	db := mysqlTestDatabase(t)
	migrateProductCenter(t, db)
	workspaceFixture(t, db, "P-FP-A")
	workspaceFixture(t, db, "P-FP-B")
	a, b := planningFixture(t, db, "P-FP-A"), planningFixture(t, db, "P-FP-B")
	read := func() string {
		t.Helper()
		tx, e := db.BeginTx(context.Background(), nil)
		if e != nil {
			t.Fatal(e)
		}
		defer tx.Rollback()
		value, e := crossDependencyFingerprint(context.Background(), tx, "P-FP-A", a)
		if e != nil {
			t.Fatal(e)
		}
		if len(value) != 74 || !strings.HasPrefix(value, "sha256-v1:") {
			t.Fatalf("fingerprint %q", value)
		}
		return value
	}
	empty := read()
	if _, e := db.Exec(`INSERT INTO product_cross_dependencies(biz_id,product_code,planning_item_id,predecessor_product_code,predecessor_id,reason,created_by,updated_by,created_at,updated_at) VALUES(UUID(),'P-FP-A',?,'P-FP-B',?,'共享能力','pm','pm',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))`, a, b); e != nil {
		t.Fatal(e)
	}
	ctx := context.Background()
	permit := workspacePermit(t, db, "P-FP-A", "pm", "edit")
	permit.Resource = "product_priorities"
	var frozen string
	_, e := executeSnapshotCommand(ctx, db, CommandIdentity{ProductCode: "P-FP-A", ActorUID: "pm", Action: "product_roadmaps:commit", IdempotencyKey: "snapshot-concurrency"}, map[string]string{"reason": "snapshot test"}, func(ctx context.Context, tx *sql.Tx) error {
		return AuthorizeWorkspaceTransaction(ctx, tx, "P-FP-A", "pm", "product_priorities", "edit", permit)
	}, func(ctx context.Context, tx *sql.Tx) (any, error) {
		var err error
		frozen, err = crossDependencyFingerprint(ctx, tx, "P-FP-A", a)
		if err != nil {
			return nil, err
		}
		// A second connection commits a predecessor change between validation
		// and snapshot capture. Both reads in this command must agree.
		if _, err = db.ExecContext(ctx, `UPDATE product_planning_items SET revision=revision+1 WHERE id=?`, b); err != nil {
			return nil, err
		}
		after, err := crossDependencyFingerprint(ctx, tx, "P-FP-A", a)
		if err != nil {
			return nil, err
		}
		if after != frozen {
			t.Fatal("snapshot mixed predecessor revisions")
		}
		return map[string]string{"fingerprint": after}, nil
	})
	if e != nil {
		t.Fatal(e)
	}
	if read() == frozen {
		t.Fatal("fresh read failed to detect concurrent change")
	}
	before := read()
	if before == empty || read() != before {
		t.Fatal("fingerprint missing edge or unstable")
	}
	if _, e := db.Exec(`UPDATE product_planning_items SET revision=revision+1 WHERE id=?`, b); e != nil {
		t.Fatal(e)
	}
	revised := read()
	if revised == before {
		t.Fatal("predecessor revision ignored")
	}
	if _, e := db.Exec(`UPDATE product_planning_items SET lifecycle='delivered' WHERE id=?`, b); e != nil {
		t.Fatal(e)
	}
	if read() == revised {
		t.Fatal("predecessor state ignored")
	}
	if _, e := db.Exec(`DELETE FROM product_cross_dependencies WHERE planning_item_id=?`, a); e != nil {
		t.Fatal(e)
	}
	if read() != empty {
		t.Fatal("empty graph fingerprint changed")
	}
}

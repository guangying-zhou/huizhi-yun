package productcenter

import (
	"context"
	"os"
	"testing"
)

func TestMySQLCrossDependencyMigration(t *testing.T) {
	db := mysqlTestDatabase(t)
	migrateProductCenter(t, db)
	workspaceFixture(t, db, "P-CROSS-A")
	workspaceFixture(t, db, "P-CROSS-B")
	a := planningFixture(t, db, "P-CROSS-A")
	b := planningFixture(t, db, "P-CROSS-B")
	script, err := os.ReadFile("../../../../../aims/docs/migration_v5.27_cross_product_dependencies.sql")
	if err != nil {
		t.Fatal(err)
	}
	executeSQLScript(t, db, string(script))
	insert := `INSERT INTO product_cross_dependencies(biz_id,product_code,planning_item_id,predecessor_product_code,predecessor_id,reason,created_by,updated_by,created_at,updated_at) VALUES(UUID(),?,?,?,?,'依赖能力交付','pm','pm',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))`
	if _, err = db.Exec(insert, "P-CROSS-A", a, "P-CROSS-B", b); err != nil {
		t.Fatal(err)
	}
	for _, args := range [][]any{{"P-CROSS-A", a, "P-CROSS-B", b}, {"P-CROSS-A", a, "P-CROSS-A", a}, {"P-CROSS-B", a, "P-CROSS-A", b}} {
		if _, err = db.Exec(insert, args...); err == nil {
			t.Fatal("invalid or duplicate edge accepted")
		}
	}
	if _, err = db.Exec(`INSERT INTO product_dependency_graph_lock(id) VALUES(2)`); err == nil {
		t.Fatal("multiple graph locks accepted")
	}
	if _, err = db.Exec(`UPDATE product_dependency_graph_lock SET revision=5 WHERE id=1`); err != nil {
		t.Fatal(err)
	}
	executeSQLScript(t, db, string(script))
	var count, revision int
	if err = db.QueryRow(`SELECT COUNT(*) FROM product_cross_dependencies`).Scan(&count); err != nil || count != 1 {
		t.Fatalf("edge lost %d %v", count, err)
	}
	if err = db.QueryRow(`SELECT revision FROM product_dependency_graph_lock WHERE id=1`).Scan(&revision); err != nil || revision != 5 {
		t.Fatalf("lock reset %d %v", revision, err)
	}

	sourcePermit := workspacePermit(t, db, "P-CROSS-A", "pm", "edit")
	sourcePermit.Resource = "product_priorities"
	targetPermit := workspacePermit(t, db, "P-CROSS-B", "pm", "view")
	targetPermit.Resource = "product_priorities"
	for _, denied := range []bool{false, true} {
		tx, e := db.BeginTx(context.Background(), nil)
		if e != nil {
			t.Fatal(e)
		}
		p := targetPermit
		if denied {
			p.Resource = "product_features"
		}
		e = authorizeCrossDependencyTransaction(context.Background(), tx, "P-CROSS-A", "P-CROSS-B", "pm", sourcePermit, p)
		tx.Rollback()
		if denied {
			requireProductRule(t, e, "product_authorization_invalid")
		} else if e != nil {
			t.Fatal(e)
		}
	}
	tx, err := db.BeginTx(context.Background(), nil)
	if err != nil {
		t.Fatal(err)
	}
	locked, err := lockProductDependencyGraph(context.Background(), tx)
	if err != nil || locked != 5 {
		t.Fatalf("graph lock %d %v", locked, err)
	}
	graph, err := loadUnifiedDependencyGraph(context.Background(), tx)
	if err != nil {
		t.Fatal(err)
	}
	if err = ValidateDependencies(graph); err != nil {
		t.Fatal(err)
	}
	tx.Rollback()
	c := planningFixture(t, db, "P-CROSS-A")
	if _, err = db.Exec(`INSERT INTO product_planning_dependencies(product_code,planning_item_id,predecessor_id,created_by,created_at) VALUES('P-CROSS-A',?,?,'pm',UTC_TIMESTAMP(3))`, c, a); err != nil {
		t.Fatal(err)
	}
	if _, err = db.Exec(insert, "P-CROSS-B", b, "P-CROSS-A", c); err != nil {
		t.Fatal(err)
	}
	tx, err = db.BeginTx(context.Background(), nil)
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback()
	if _, err = lockProductDependencyGraph(context.Background(), tx); err != nil {
		t.Fatal(err)
	}
	graph, err = loadUnifiedDependencyGraph(context.Background(), tx)
	if err != nil {
		t.Fatal(err)
	}
	requireProductRule(t, ValidateDependencies(graph), "planning_dependency_cycle")
}

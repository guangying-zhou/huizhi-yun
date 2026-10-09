package productcenter

import (
	"os"
	"testing"
)

func TestMySQLRoadmapCommitmentMigration(t *testing.T) {
	db := mysqlTestDatabase(t)
	migrateProductCenter(t, db)
	workspaceFixture(t, db, "P-COMMIT")
	script, err := os.ReadFile("../../../../../aims/docs/migration_v5.26_roadmap_commitments.sql")
	if err != nil {
		t.Fatal(err)
	}
	executeSQLScript(t, db, string(script))
	item := planningFixture(t, db, "P-COMMIT")
	r, err := db.Exec(`INSERT INTO product_planning_cycles(biz_id,product_code,title,starts_on,ends_on,goal_summary,model_snapshot,created_by,updated_by,created_at,updated_at) VALUES(UUID(),'P-COMMIT','周期','2026-01-01','2026-12-31','目标',JSON_OBJECT(),'pm','pm',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))`)
	if err != nil {
		t.Fatal(err)
	}
	cycle, _ := r.LastInsertId()
	insert := `INSERT INTO product_roadmap_commitments(biz_id,product_code,planning_item_id,cycle_id,item_revision,scope_revision,evidence_revision,cycle_revision,queue_revision,starts_on,ends_on,item_snapshot,decision_snapshot,model_snapshot,reason,created_by,created_at) VALUES(UUID(),?,?,?,1,1,1,1,1,'2026-10-01',?,JSON_OBJECT('title','原范围'),JSON_OBJECT('rank',1),?,'确认安排','pm',UTC_TIMESTAMP(3))`
	if _, err = db.Exec(insert, "P-COMMIT", item, cycle, "2027-03-31", `{"version":"v1"}`); err != nil {
		t.Fatal(err)
	}
	for _, sql := range []string{`UPDATE product_roadmap_commitments SET reason='改写'`, `DELETE FROM product_roadmap_commitments`} {
		if _, err = db.Exec(sql); err == nil {
			t.Fatal("history mutated")
		}
	}
	for _, args := range [][]any{{"P-COMMIT", item, cycle, "2026-09-30", `{}`}, {"P-COMMIT", item, cycle, "2027-03-31", `[]`}, {"P-OTHER", item, cycle, "2027-03-31", `{}`}} {
		if _, err = db.Exec(insert, args...); err == nil {
			t.Fatal("invalid baseline accepted")
		}
	}
	executeSQLScript(t, db, string(script))
	var count int
	if err = db.QueryRow(`SELECT COUNT(*) FROM product_roadmap_commitments WHERE JSON_UNQUOTE(JSON_EXTRACT(item_snapshot,'$.title'))='原范围' AND reason='确认安排'`).Scan(&count); err != nil || count != 1 {
		t.Fatalf("snapshot %d %v", count, err)
	}
	crossScript, err := os.ReadFile("../../../../../aims/docs/migration_v5.28_roadmap_cross_dependency_snapshots.sql")
	if err != nil {
		t.Fatal(err)
	}
	executeSQLScript(t, db, string(crossScript))
	workspaceFixture(t, db, "P-PREDECESSOR")
	var commitmentID int64
	if err = db.QueryRow(`SELECT id FROM product_roadmap_commitments`).Scan(&commitmentID); err != nil {
		t.Fatal(err)
	}
	crossInsert := `INSERT INTO product_roadmap_cross_dependency_snapshots(commitment_id,dependency_biz_id,dependency_revision,predecessor_product_code,predecessor_biz_id,predecessor_revision,snapshot,created_at) VALUES(?,'00000000-0000-4000-8000-000000000028',1,?,'00000000-0000-4000-8000-000000000029',?, ?, UTC_TIMESTAMP(3))`
	for _, args := range [][]any{{commitmentID, "P-PREDECESSOR", 0, `{}`}, {commitmentID, "P-PREDECESSOR", 1, `[]`}, {commitmentID, "MISSING", 1, `{}`}, {commitmentID + 1, "P-PREDECESSOR", 1, `{}`}} {
		if _, err = db.Exec(crossInsert, args...); err == nil {
			t.Fatal("invalid predecessor snapshot accepted")
		}
	}
	if _, err = db.Exec(crossInsert, commitmentID, "P-PREDECESSOR", 1, `{"title":"原前置范围"}`); err != nil {
		t.Fatal(err)
	}
	if _, err = db.Exec(crossInsert, commitmentID, "P-PREDECESSOR", 1, `{}`); err == nil {
		t.Fatal("duplicate predecessor snapshot accepted")
	}
	for _, statement := range []string{`UPDATE product_roadmap_cross_dependency_snapshots SET snapshot=JSON_OBJECT()`, `DELETE FROM product_roadmap_cross_dependency_snapshots`} {
		if _, err = db.Exec(statement); err == nil {
			t.Fatal("predecessor history mutated")
		}
	}
	executeSQLScript(t, db, string(crossScript))
	if err = db.QueryRow(`SELECT COUNT(*) FROM product_roadmap_cross_dependency_snapshots WHERE JSON_UNQUOTE(JSON_EXTRACT(snapshot,'$.title'))='原前置范围'`).Scan(&count); err != nil || count != 1 {
		t.Fatalf("predecessor history %d %v", count, err)
	}

}

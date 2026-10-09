package productcenter

import (
	"os"
	"testing"
)

func TestMySQLObjectiveCycleMappingMigration(t *testing.T) {
	db := mysqlTestDatabase(t)
	migrateProductCenter(t, db)
	for _, file := range []string{"migration_v5.22_product_objectives.sql", "migration_v5.24_objective_cycle_mappings.sql"} {
		script, err := os.ReadFile("../../../../../aims/docs/" + file)
		if err != nil {
			t.Fatal(err)
		}
		executeSQLScript(t, db, string(script))
	}
	workspaceFixture(t, db, "P-MAP")
	workspaceFixture(t, db, "P-OTHER-MAP")
	goal, err := db.Exec(`INSERT INTO product_objectives(biz_id,product_code,title,starts_on,ends_on,owner_uid,metric_name,metric_unit,measurement_definition,direction,baseline_value,target_value,created_by,updated_by,created_at,updated_at) VALUES(UUID(),'P-MAP','目标','2026-09-01','2026-12-31','pm','失败率','%','失败次数/总数','decrease',5,2,'pm','pm',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))`)
	if err != nil {
		t.Fatal(err)
	}
	goalID, err := goal.LastInsertId()
	if err != nil {
		t.Fatal(err)
	}
	cycleSQL := `INSERT INTO product_planning_cycles(biz_id,product_code,title,starts_on,ends_on,goal_summary,model_snapshot,created_by,updated_by,created_at,updated_at) VALUES(UUID(),?,'季度规划','2026-09-01','2026-12-31','原周期摘要',JSON_OBJECT(),'pm','pm',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))`
	cycle, err := db.Exec(cycleSQL, "P-MAP")
	if err != nil {
		t.Fatal(err)
	}
	cycleID, err := cycle.LastInsertId()
	if err != nil {
		t.Fatal(err)
	}
	foreign, err := db.Exec(cycleSQL, "P-OTHER-MAP")
	if err != nil {
		t.Fatal(err)
	}
	foreignID, err := foreign.LastInsertId()
	if err != nil {
		t.Fatal(err)
	}
	insert := `INSERT INTO product_objective_cycles(biz_id,product_code,objective_id,cycle_id,objective_revision,cycle_revision,objective_snapshot,cycle_snapshot,mapping_note,created_by,created_at) VALUES(UUID(),'P-MAP',?,?,1,1,JSON_OBJECT('target','2'),JSON_OBJECT('goal_summary','原周期摘要'),'对应季度目标','pm',UTC_TIMESTAMP(3))`
	if _, err = db.Exec(insert, goalID, foreignID); err == nil {
		t.Fatal("cross-product mapping accepted")
	}
	row, err := db.Exec(insert, goalID, cycleID)
	if err != nil {
		t.Fatal(err)
	}
	mappingID, err := row.LastInsertId()
	if err != nil {
		t.Fatal(err)
	}
	if _, err = db.Exec(insert, goalID, cycleID); err == nil {
		t.Fatal("duplicate active mapping accepted")
	}
	if _, err = db.Exec(`UPDATE product_objective_cycles SET cycle_snapshot=JSON_OBJECT('goal_summary','changed') WHERE id=?`, mappingID); err == nil {
		t.Fatal("snapshot rewritten")
	}
	if _, err = db.Exec(`UPDATE product_objective_cycles SET revoked_at=UTC_TIMESTAMP(3) WHERE id=?`, mappingID); err == nil {
		t.Fatal("revocation without reason accepted")
	}
	if _, err = db.Exec(`UPDATE product_objective_cycles SET revoked_at=UTC_TIMESTAMP(3),revoked_by='pm',revocation_reason='调整映射' WHERE id=?`, mappingID); err != nil {
		t.Fatal(err)
	}
	if _, err = db.Exec(`UPDATE product_objective_cycles SET revoked_at=NULL,revoked_by=NULL,revocation_reason=NULL WHERE id=?`, mappingID); err == nil {
		t.Fatal("revocation rewritten")
	}
	if _, err = db.Exec(insert, goalID, cycleID); err != nil {
		t.Fatal(err)
	}
	if _, err = db.Exec(`DELETE FROM product_objective_cycles WHERE id=?`, mappingID); err == nil {
		t.Fatal("mapping history deleted")
	}
	script, err := os.ReadFile("../../../../../aims/docs/migration_v5.24_objective_cycle_mappings.sql")
	if err != nil {
		t.Fatal(err)
	}
	executeSQLScript(t, db, string(script))
	var count int
	if err = db.QueryRow(`SELECT COUNT(*) FROM product_objective_cycles WHERE JSON_UNQUOTE(JSON_EXTRACT(cycle_snapshot,'$.goal_summary'))='原周期摘要'`).Scan(&count); err != nil || count != 2 {
		t.Fatalf("history %d %v", count, err)
	}
}

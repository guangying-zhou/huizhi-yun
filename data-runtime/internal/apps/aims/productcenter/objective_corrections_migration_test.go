package productcenter

import (
	"os"
	"testing"
)

func TestMySQLProductObjectiveCorrectionMigration(t *testing.T) {
	db := mysqlTestDatabase(t)
	migrateProductCenter(t, db)
	workspaceFixture(t, db, "P-CORRECTION")
	for _, name := range []string{"migration_v5.22_product_objectives.sql", "migration_v5.23_objective_observation_corrections.sql"} {
		script, err := os.ReadFile("../../../../../aims/docs/" + name)
		if err != nil {
			t.Fatal(err)
		}
		executeSQLScript(t, db, string(script))
	}
	var goals []int64
	for i := 0; i < 2; i++ {
		r, err := db.Exec(`INSERT INTO product_objectives(biz_id,product_code,title,starts_on,ends_on,owner_uid,metric_name,metric_unit,measurement_definition,direction,baseline_value,target_value,created_by,updated_by,created_at,updated_at) VALUES(UUID(),'P-CORRECTION','降低失败率','2026-09-01','2026-12-31','pm','失败率','%','失败次数/总次数','decrease',5,2,'pm','pm',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))`)
		if err != nil {
			t.Fatal(err)
		}
		id, err := r.LastInsertId()
		if err != nil {
			t.Fatal(err)
		}
		goals = append(goals, id)
	}
	insert := `INSERT INTO product_objective_observations(biz_id,objective_id,product_code,objective_revision,metric_snapshot,observed_on,measured_value,evidence,created_by,created_at,correction_of_id,correction_reason) VALUES(UUID(),?,'P-CORRECTION',1,JSON_OBJECT('baseline',5,'target',2),'2026-09-08',4.5,'统计报表','pm',UTC_TIMESTAMP(3),?,?)`
	original, err := db.Exec(insert, goals[0], nil, nil)
	if err != nil {
		t.Fatal(err)
	}
	originalID, err := original.LastInsertId()
	if err != nil {
		t.Fatal(err)
	}
	if _, err = db.Exec(insert, goals[1], originalID, "纠正统计错误"); err == nil {
		t.Fatal("cross-objective correction accepted")
	}
	if _, err = db.Exec(insert, goals[0], originalID, nil); err == nil {
		t.Fatal("missing correction reason accepted")
	}
	if _, err = db.Exec(insert, goals[0], nil, "orphan reason"); err == nil {
		t.Fatal("orphan reason accepted")
	}
	corrected, err := db.Exec(insert, goals[0], originalID, "纠正统计错误")
	if err != nil {
		t.Fatal(err)
	}
	correctedID, err := corrected.LastInsertId()
	if err != nil {
		t.Fatal(err)
	}
	if _, err = db.Exec(insert, goals[0], originalID, "另一条更正"); err == nil {
		t.Fatal("competing correction accepted")
	}
	if _, err = db.Exec(insert, goals[0], correctedID, "再次更正"); err != nil {
		t.Fatal(err)
	}
	script, err := os.ReadFile("../../../../../aims/docs/migration_v5.23_objective_observation_corrections.sql")
	if err != nil {
		t.Fatal(err)
	}
	executeSQLScript(t, db, string(script))
	var count int
	if err = db.QueryRow(`SELECT COUNT(*) FROM product_objective_observations`).Scan(&count); err != nil || count != 3 {
		t.Fatalf("repeat %d %v", count, err)
	}
	if _, err = db.Exec(`UPDATE product_objective_observations SET correction_reason='覆盖' WHERE id=?`, correctedID); err == nil {
		t.Fatal("correction changed")
	}
	if _, err = db.Exec(`DELETE FROM product_objective_observations WHERE id=?`, originalID); err == nil {
		t.Fatal("original deleted")
	}
}

package productcenter

import (
	"os"
	"testing"
)

func TestMySQLProductObjectivesMigration(t *testing.T) {
	db := mysqlTestDatabase(t)
	migrateProductCenter(t, db)
	workspaceFixture(t, db, "P-GOAL")
	workspaceFixture(t, db, "P-OTHER-GOAL")
	script, err := os.ReadFile("../../../../../aims/docs/migration_v5.22_product_objectives.sql")
	if err != nil {
		t.Fatal(err)
	}
	executeSQLScript(t, db, string(script))
	insert := `INSERT INTO product_objectives(biz_id,product_code,title,starts_on,ends_on,owner_uid,metric_name,metric_unit,measurement_definition,direction,baseline_value,target_value,created_by,updated_by,created_at,updated_at) VALUES(UUID(),'P-GOAL','降低登录失败率','2026-09-01','2026-12-31','pm','登录失败率','%','失败次数/总登录次数','decrease',5,?,'pm','pm',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))`
	if _, err = db.Exec(insert, 6); err == nil {
		t.Fatal("invalid target direction accepted")
	}
	row, err := db.Exec(insert, 2)
	if err != nil {
		t.Fatal(err)
	}
	goal, err := row.LastInsertId()
	if err != nil {
		t.Fatal(err)
	}
	item := planningFixture(t, db, "P-GOAL")
	foreign := planningFixture(t, db, "P-OTHER-GOAL")
	link := `INSERT INTO product_objective_items(objective_id,planning_item_id,product_code,contribution_note,created_by,created_at) VALUES(?,?,'P-GOAL','改进登录可靠性','pm',UTC_TIMESTAMP(3))`
	if _, err = db.Exec(link, goal, foreign); err == nil {
		t.Fatal("cross-product planning link accepted")
	}
	if _, err = db.Exec(link, goal, item); err != nil {
		t.Fatal(err)
	}
	if _, err = db.Exec(`INSERT INTO product_objective_observations(biz_id,objective_id,product_code,objective_revision,metric_snapshot,observed_on,measured_value,evidence,created_by,created_at) VALUES(UUID(),?,'P-GOAL',1,JSON_OBJECT('baseline',5,'target',2),'2026-09-08',4.5,'统计报表','pm',UTC_TIMESTAMP(3))`, goal); err != nil {
		t.Fatal(err)
	}
	executeSQLScript(t, db, string(script))
	var count int
	if err = db.QueryRow(`SELECT COUNT(*) FROM product_objective_observations WHERE measured_value=4.5`).Scan(&count); err != nil || count != 1 {
		t.Fatalf("repeat migration %d %v", count, err)
	}
	if _, err = db.Exec(`UPDATE product_objective_observations SET measured_value=0`); err == nil {
		t.Fatal("observation updated")
	}
	if _, err = db.Exec(`DELETE FROM product_objective_observations`); err == nil {
		t.Fatal("observation deleted")
	}
	if _, err = db.Exec(`UPDATE product_objectives SET ends_on='2026-01-01' WHERE id=?`, goal); err == nil {
		t.Fatal("invalid period accepted")
	}
}

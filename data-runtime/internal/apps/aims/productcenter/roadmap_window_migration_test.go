package productcenter

import (
	"os"
	"testing"
)

func TestMySQLPlanningRoadmapWindowMigration(t *testing.T) {
	db := mysqlTestDatabase(t)
	migrateProductCenter(t, db)
	workspaceFixture(t, db, "P-WINDOW")
	itemID := planningFixture(t, db, "P-WINDOW")
	if _, err := db.Exec(`UPDATE product_planning_items SET deadline='2026-12-01',revision=5 WHERE id=?`, itemID); err != nil {
		t.Fatal(err)
	}
	script, err := os.ReadFile("../../../../../aims/docs/migration_v5.25_planning_roadmap_windows.sql")
	if err != nil {
		t.Fatal(err)
	}
	executeSQLScript(t, db, string(script))
	var absent bool
	if err = db.QueryRow(`SELECT roadmap_starts_on IS NULL AND roadmap_ends_on IS NULL FROM product_planning_items WHERE id=?`, itemID).Scan(&absent); err != nil || !absent {
		t.Fatalf("existing item window %v %v", absent, err)
	}
	for _, statement := range []string{`UPDATE product_planning_items SET roadmap_starts_on='2026-09-01' WHERE id=?`, `UPDATE product_planning_items SET roadmap_ends_on='2026-09-01' WHERE id=?`, `UPDATE product_planning_items SET roadmap_starts_on='2026-12-31',roadmap_ends_on='2026-09-01' WHERE id=?`} {
		if _, err = db.Exec(statement, itemID); err == nil {
			t.Fatalf("invalid window accepted %s", statement)
		}
	}
	if _, err = db.Exec(`UPDATE product_planning_items SET roadmap_starts_on='2026-09-01',roadmap_ends_on='2027-03-31' WHERE id=?`, itemID); err != nil {
		t.Fatal(err)
	}
	executeSQLScript(t, db, string(script))
	var start, end, deadline string
	var revision uint64
	if err = db.QueryRow(`SELECT DATE_FORMAT(roadmap_starts_on,'%Y-%m-%d'),DATE_FORMAT(roadmap_ends_on,'%Y-%m-%d'),DATE_FORMAT(deadline,'%Y-%m-%d'),revision FROM product_planning_items WHERE id=?`, itemID).Scan(&start, &end, &deadline, &revision); err != nil || start != "2026-09-01" || end != "2027-03-31" || deadline != "2026-12-01" || revision != 5 {
		t.Fatalf("repeat %s %s %s %d %v", start, end, deadline, revision, err)
	}
	if _, err = db.Exec(`UPDATE product_planning_items SET roadmap_starts_on=NULL,roadmap_ends_on=NULL WHERE id=?`, itemID); err != nil {
		t.Fatal(err)
	}
}

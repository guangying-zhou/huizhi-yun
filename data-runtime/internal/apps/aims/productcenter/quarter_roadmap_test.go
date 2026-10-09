package productcenter

import (
	"context"
	"github.com/google/uuid"
	"os"
	"testing"
)

func TestMySQLQuarterRoadmap(t *testing.T) {
	db := mysqlTestDatabase(t)
	migrateProductCenter(t, db)
	workspaceFixture(t, db, "P-QUARTER")
	script, err := os.ReadFile("../../../../../aims/docs/migration_v5.25_planning_roadmap_windows.sql")
	if err != nil {
		t.Fatal(err)
	}
	executeSQLScript(t, db, string(script))
	cycle := uuid.NewString()
	result, err := db.Exec(`INSERT INTO product_planning_cycles(biz_id,product_code,title,starts_on,ends_on,goal_summary,model_snapshot,created_by,updated_by,created_at,updated_at) VALUES(?,'P-QUARTER','周期','2026-01-01','2026-12-31','目标',JSON_OBJECT(),'pm','pm',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))`, cycle)
	if err != nil {
		t.Fatal(err)
	}
	cycleID, _ := result.LastInsertId()
	ids := []string{}
	for i, dates := range [][2]any{{"2026-10-01", "2027-03-31"}, {"2026-09-01", "2026-10-01"}, {nil, nil}, {"2027-04-01", "2027-06-30"}} {
		id := uuid.NewString()
		ids = append(ids, id)
		r, e := db.Exec(`INSERT INTO product_planning_items(biz_id,product_code,title,scope_summary,investment_category,roadmap_starts_on,roadmap_ends_on,created_by,updated_by,created_at,updated_at) VALUES(?,'P-QUARTER','事项','范围','growth',?,?,'pm','pm',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))`, id, dates[0], dates[1])
		if e != nil {
			t.Fatal(e)
		}
		item, _ := r.LastInsertId()
		if _, e = db.Exec(`INSERT INTO product_planning_cycle_items(cycle_id,planning_item_id,product_code,decision_rank,roadmap_bucket) VALUES(?,?,'P-QUARTER',?,'now')`, cycleID, item, 4-i); e != nil {
			t.Fatal(e)
		}
	}
	permit := workspacePermit(t, db, "P-QUARTER", "pm", "view")
	permit.Resource = "product_priorities"
	road := permit
	road.Resource = "product_roadmaps"
	q := QuarterRoadmapQuery{Year: 2026, Quarter: 4, CycleBizID: cycle, Page: 1, PageSize: 1}
	read := func() (QuarterRoadmapView, error) {
		return ReadQuarterRoadmap(context.Background(), db, "P-QUARTER", "pm", permit, road, q)
	}
	page, err := read()
	if err != nil || page.Total != 2 || len(page.Items) != 1 || page.Items[0].BizID != ids[1] || page.ByBucket["now"] != 2 {
		t.Fatalf("boundary and queue: %+v %v", page, err)
	}
	q.Page = 2
	page, err = read()
	if err != nil || len(page.Items) != 1 || page.Items[0].BizID != ids[0] {
		t.Fatalf("pagination: %+v %v", page, err)
	}
	q.Year = 2027
	q.Quarter = 1
	q.Page = 1
	page, err = read()
	if err != nil || page.Total != 1 || page.Items[0].BizID != ids[0] {
		t.Fatalf("cross year: %+v %v", page, err)
	}
	q.Unscheduled = true
	page, err = read()
	if err != nil || page.Total != 1 || page.Items[0].BizID != ids[2] || page.Items[0].StartsOn != nil {
		t.Fatalf("unscheduled: %+v %v", page, err)
	}
	road.Resource = "product_features"
	_, err = read()
	requireProductRule(t, err, "product_authorization_invalid")
	road.Resource = "product_roadmaps"
	q.Quarter = 5
	_, err = read()
	requireProductRule(t, err, "product_roadmap_query_invalid")
}

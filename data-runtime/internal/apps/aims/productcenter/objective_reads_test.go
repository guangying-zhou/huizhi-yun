package productcenter

import (
	"context"
	"database/sql"
	"errors"
	"os"
	"testing"
)

func TestMySQLProductObjectiveReads(t *testing.T) {
	db := mysqlTestDatabase(t)
	migrateProductCenter(t, db)
	script, err := os.ReadFile("../../../../../aims/docs/migration_v5.22_product_objectives.sql")
	if err != nil {
		t.Fatal(err)
	}
	executeSQLScript(t, db, string(script))
	for _, code := range []string{"P-READ-GOAL", "P-FOREIGN-GOAL"} {
		workspaceFixture(t, db, code)
	}
	insert := `INSERT INTO product_objectives(biz_id,product_code,title,starts_on,ends_on,owner_uid,metric_name,metric_unit,measurement_definition,direction,baseline_value,target_value,status,created_by,updated_by,created_at,updated_at) VALUES(UUID(),?,'降低失败率','2026-09-01','2026-12-31','pm','失败率','%','失败次数/总次数','decrease',5,2,?,'pm','pm',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))`
	var ids []int64
	for _, status := range []string{"draft", "active", "draft"} {
		r, e := db.Exec(insert, "P-READ-GOAL", status)
		if e != nil {
			t.Fatal(e)
		}
		id, e := r.LastInsertId()
		if e != nil {
			t.Fatal(e)
		}
		ids = append(ids, id)
	}
	r, err := db.Exec(insert, "P-FOREIGN-GOAL", "draft")
	if err != nil {
		t.Fatal(err)
	}
	foreign, err := r.LastInsertId()
	if err != nil {
		t.Fatal(err)
	}
	permit := workspacePermit(t, db, "P-READ-GOAL", "pm", "view")
	permit.Resource = "product_objectives"
	ctx := context.Background()
	first, err := ListProductObjectives(ctx, db, "P-READ-GOAL", "pm", permit, "", 1, 2)
	if err != nil || first.Total != 3 || len(first.Items) != 2 || first.Items[0].ID != ids[2] || first.WorkspaceRevision != 1 {
		t.Fatalf("first %+v %v", first, err)
	}
	second, err := ListProductObjectives(ctx, db, "P-READ-GOAL", "pm", permit, "", 2, 2)
	if err != nil || second.Total != 3 || len(second.Items) != 1 || second.Items[0].ID != ids[0] {
		t.Fatalf("second %+v %v", second, err)
	}
	filtered, err := ListProductObjectives(ctx, db, "P-READ-GOAL", "pm", permit, "active", 1, 2)
	if err != nil || filtered.Total != 1 || len(filtered.Items) != 1 || filtered.Items[0].ID != ids[1] {
		t.Fatalf("filter %+v %v", filtered, err)
	}
	empty, err := ListProductObjectives(ctx, db, "P-READ-GOAL", "pm", permit, "closed", 1, 2)
	if err != nil || empty.Total != 0 || empty.Items == nil || len(empty.Items) != 0 {
		t.Fatalf("empty %+v %v", empty, err)
	}
	detail, err := GetProductObjective(ctx, db, "P-READ-GOAL", "pm", permit, ids[0])
	if err != nil || detail.Objective.Metric.BaselineValue != "5.000000" || detail.Objective.Metric.TargetValue != "2.000000" || detail.Objective.StartsOn != "2026-09-01" || detail.Objective.EndsOn != "2026-12-31" || detail.Objective.Description != "" {
		t.Fatalf("detail %+v %v", detail, err)
	}
	_, err = GetProductObjective(ctx, db, "P-READ-GOAL", "pm", permit, foreign)
	if !errors.Is(err, sql.ErrNoRows) {
		t.Fatalf("foreign detail %v", err)
	}
	_, err = ListProductObjectives(ctx, db, "P-FOREIGN-GOAL", "pm", permit, "", 1, 2)
	requireProductRule(t, err, "product_authorization_invalid")
	permit.Resource = "product_components"
	_, err = GetProductObjective(ctx, db, "P-READ-GOAL", "pm", permit, ids[0])
	requireProductRule(t, err, "product_authorization_invalid")
	for _, q := range []struct {
		status     string
		page, size int
	}{{"unknown", 1, 20}, {"", 0, 20}, {"", 1, 101}, {"", 1000001, 20}} {
		_, err = ListProductObjectives(ctx, db, "P-READ-GOAL", "pm", permit, q.status, q.page, q.size)
		requireProductRule(t, err, "product_objective_list_invalid")
	}
}

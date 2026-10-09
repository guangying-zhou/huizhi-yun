package aims

import (
	"context"
	"encoding/json"
	"errors"
	"github.com/huizhi-yun/data-runtime/internal/apps/aims/productcenter"
	"github.com/huizhi-yun/data-runtime/internal/apps/compat"
	"github.com/huizhi-yun/data-runtime/internal/httperror"
	"net/http"
	"net/url"
	"os"
	"reflect"
	"testing"
	"time"
	"unsafe"
)

func TestMySQLPlanningRoadmapWindowThroughRuntime(t *testing.T) {
	db := handoffMySQLDatabase(t)
	migrateHandoffProductCenter(t, db)
	script, err := os.ReadFile("../../../../aims/docs/migration_v5.25_planning_roadmap_windows.sql")
	if err != nil {
		t.Fatal(err)
	}
	executeHandoffSQLScript(t, db, string(script))
	commitmentsSchema, e := os.ReadFile("../../../../aims/docs/migration_v5.26_roadmap_commitments.sql")
	if e != nil {
		t.Fatal(e)
	}
	executeHandoffSQLScript(t, db, string(commitmentsSchema))
	crossSchema, crossErr := os.ReadFile("../../../../aims/docs/migration_v5.28_roadmap_cross_dependency_snapshots.sql")
	if crossErr != nil {
		t.Fatal(crossErr)
	}
	executeHandoffSQLScript(t, db, string(crossSchema))
	const code = "P-ROADMAP-RUNTIME"
	if _, err = db.Exec(`INSERT INTO product_workspaces(product_code,biz_id,created_by,updated_by,created_at,updated_at) VALUES(?,UUID(),'pm','pm',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))`, code); err != nil {
		t.Fatal(err)
	}
	if _, err = db.Exec(`INSERT INTO product_members(product_code,uid,relation_type,status,valid_from,created_by,updated_by,created_at,updated_at) VALUES(?,'pm','manager','active',UTC_TIMESTAMP(3),'pm','pm',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))`, code); err != nil {
		t.Fatal(err)
	}
	adapter := &Adapter{Adapter: &compat.Adapter{}}
	field := reflect.ValueOf(adapter.Adapter).Elem().FieldByName("db")
	reflect.NewAt(field.Type(), unsafe.Pointer(field.UnsafeAddr())).Elem().Set(reflect.ValueOf(db))
	ctx := context.Background()
	query := url.Values{"current_user": {"pm"}, "hzy_runtime_actor_delegated": {"1"}, "hzy_runtime_source_app": {"aims"}, "hzy_runtime_tenant_code": {"t"}, "hzy_runtime_deployment_code": {"d"}, "hzy_runtime_service_client_id": {"aims.runtime"}}
	call := func(action, key string, input any) (any, error) {
		t.Helper()
		facts, err := productcenter.LoadAuthorizationFacts(ctx, db, code, "pm")
		if err != nil {
			t.Fatal(err)
		}
		permission := "edit"
		if action == "commit" {
			permission = "commit"
		}
		capability := action
		if action == "window-view" || action == "quarter-view" || action == "commitments" || action == "cross-snapshots" {
			permission = "view"
			capability = "read"
		}
		query.Set("current_user_scopes", "aims:product-roadmaps:"+capability)
		body := map[string]any{"input": input, "idempotency_key": key, "authorization": productcenter.AuthorizationPermit{Resource: "product_roadmaps", Action: permission, Facts: facts, ExpiresAt: time.Now().Add(15 * time.Second).UnixMilli()}}
		if action == "quarter-view" || action == "commitments" || action == "cross-snapshots" {
			body["planning_authorization"] = productcenter.AuthorizationPermit{Resource: "product_priorities", Action: "view", Facts: facts, ExpiresAt: time.Now().Add(15 * time.Second).UnixMilli()}
		}
		if action == "cross-snapshots" {
			body["predecessor_authorizations"] = map[string]productcenter.AuthorizationPermit{}
		}
		result, operation, err := adapter.HandleRuntime(ctx, http.MethodPost, "/v1/aims/internal/products/"+code+"/roadmaps:"+action, query, body)
		if err != nil {
			return nil, err
		}
		envelope, ok := result.(map[string]any)
		if !ok || envelope["code"] != 0 || operation != "aims.product-roadmaps."+action {
			t.Fatalf("envelope %#v %s", result, operation)
		}
		return envelope["data"], nil
	}

	const bizID = "00000000-0000-4000-8000-000000000025"
	if _, err = db.Exec(`INSERT INTO product_planning_items(biz_id,product_code,title,scope_summary,investment_category,created_by,updated_by,created_at,updated_at) VALUES(?,?,'登录探索','探索范围','reliability','pm','pm',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))`, bizID, code); err != nil {
		t.Fatal(err)
	}
	read := func() productcenter.PlanningRoadmapWindowView {
		t.Helper()
		raw, err := call("window-view", "", map[string]any{"biz_id": bizID})
		if err != nil {
			t.Fatal(err)
		}
		return raw.(productcenter.PlanningRoadmapWindowView)
	}
	emptyHistory, e := call("commitments", "", map[string]any{"biz_id": bizID, "page": 1, "page_size": 10})
	if e != nil {
		t.Fatal(e)
	}
	history := emptyHistory.(productcenter.RoadmapCommitmentPage)
	if history.Items == nil || len(history.Items) != 0 || history.Total != 0 || history.LatestID != 0 || history.ItemBizID != bizID {
		t.Fatalf("empty history %+v", history)
	}
	before := read()
	if before.StartsOn != nil || before.EndsOn != nil || before.Revision != 1 || before.WorkspaceRevision != 1 {
		t.Fatalf("initial %+v", before)
	}
	start, end := "2026-10-01", "2027-03-31"
	input := productcenter.PlanningRoadmapWindow{BizID: bizID, StartsOn: &start, EndsOn: &end, ExpectedRevision: 1, ExpectedItemRevision: 1, Reason: "季度探索"}
	raw, err := call("window-edit", "set-window", input)
	if err != nil {
		t.Fatal(err)
	}
	saved := raw.(productcenter.CommandResult)
	raw, err = call("window-edit", "set-window", input)
	if err != nil || !raw.(productcenter.CommandResult).Replayed || raw.(productcenter.CommandResult).ReceiptID != saved.ReceiptID {
		t.Fatalf("replay %v", err)
	}
	after := read()
	if after.StartsOn == nil || *after.StartsOn != start || after.EndsOn == nil || *after.EndsOn != end || after.Revision != 2 || after.WorkspaceRevision != 2 {
		t.Fatalf("saved %+v", after)
	}

	const cycleBizID = "00000000-0000-4000-8000-000000000026"
	if _, err = db.Exec(`INSERT INTO product_planning_cycles(biz_id,product_code,title,starts_on,ends_on,goal_summary,model_snapshot,created_by,updated_by,created_at,updated_at) VALUES(?,?,'周期','2026-01-01','2026-12-31','目标',JSON_OBJECT(),'pm','pm',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))`, cycleBizID, code); err != nil {
		t.Fatal(err)
	}
	if _, err = db.Exec(`INSERT INTO product_planning_cycle_items(cycle_id,planning_item_id,product_code,decision_rank,roadmap_bucket) SELECT c.id,i.id,c.product_code,1,'now' FROM product_planning_cycles c JOIN product_planning_items i ON i.product_code=c.product_code WHERE c.biz_id=? AND i.biz_id=?`, cycleBizID, bizID); err != nil {
		t.Fatal(err)
	}
	quarterInput := productcenter.QuarterRoadmapQuery{CycleBizID: cycleBizID, Year: 2027, Quarter: 1, Page: 1, PageSize: 10}
	raw, err = call("quarter-view", "", quarterInput)
	if err != nil {
		t.Fatal(err)
	}
	quarter := raw.(productcenter.QuarterRoadmapView)
	if quarter.Total != 1 || len(quarter.Items) != 1 || quarter.Items[0].BizID != bizID || quarter.Items[0].StartsOn == nil || *quarter.Items[0].StartsOn != start || quarter.WorkspaceRevision != 2 {
		t.Fatalf("quarter runtime %+v", quarter)
	}
	quarterInput.Quarter = 2
	raw, err = call("quarter-view", "", quarterInput)
	if err != nil || raw.(productcenter.QuarterRoadmapView).Total != 0 {
		t.Fatalf("nonoverlap %v %v", raw, err)
	}
	var response httperror.Error
	_, err = call("window-edit", "stale-window", input)
	if !errors.As(err, &response) || response.Status != 409 {
		t.Fatalf("root conflict %v", err)
	}
	input.ExpectedRevision = 2
	_, err = call("window-edit", "stale-item", input)
	if !errors.As(err, &response) || response.Status != 409 {
		t.Fatalf("item conflict %v", err)
	}
	input.ExpectedItemRevision = 2
	input.StartsOn = nil
	input.EndsOn = nil
	if _, err = call("window-edit", "clear-window", input); err != nil {
		t.Fatal(err)
	}
	cleared := read()
	if cleared.StartsOn != nil || cleared.EndsOn != nil || cleared.Revision != 3 || cleared.WorkspaceRevision != 3 {
		t.Fatalf("cleared %+v", cleared)
	}
	var count int
	if err = db.QueryRow(`SELECT COUNT(*) FROM product_command_receipts`).Scan(&count); err != nil || count != 2 {
		t.Fatalf("receipts %d %v", count, err)
	}

	if _, err = db.Exec(`UPDATE product_planning_cycles SET status='open',model_version='v1',total_person_days=10,reserve_person_days=0,reliability_person_days=10,usability_person_days=0,growth_person_days=0 WHERE biz_id=?`, cycleBizID); err != nil {
		t.Fatal(err)
	}
	if _, err = db.Exec(`UPDATE product_planning_items SET roadmap_starts_on='2026-10-01',roadmap_ends_on='2027-03-31' WHERE biz_id=?`, bizID); err != nil {
		t.Fatal(err)
	}
	assessmentResult, err := db.Exec(`INSERT INTO product_priority_assessments(cycle_id,planning_item_id,scope_revision,evidence_revision,model_version,model_snapshot,strategic,user_value,business,risk,confidence,effort_person_days,value_score,priority_score,evidence_snapshot,rationale,assessed_by,assessed_at) SELECT c.id,i.id,1,1,'v1',JSON_OBJECT(),1,1,1,1,1.00,1.00,20,20,JSON_OBJECT(),JSON_OBJECT(),'pm',UTC_TIMESTAMP(3) FROM product_planning_cycles c JOIN product_planning_items i ON i.product_code=c.product_code WHERE c.biz_id=? AND i.biz_id=?`, cycleBizID, bizID)
	if err != nil {
		t.Fatal(err)
	}
	assessmentID, _ := assessmentResult.LastInsertId()
	effort := productcenter.Hundredths(100)
	snapshot, err := json.Marshal(map[string]any{"capacity": productcenter.PlanningCapacityBaseline{Version: 1, ItemBizID: bizID, Category: productcenter.Reliability, Effort: &effort}, "assessment_id": assessmentID, "scope_revision": 1, "evidence_revision": 1, "model_version": "v1", "exceptions": []any{}})
	if err != nil {
		t.Fatal(err)
	}
	if _, err = db.Exec(`UPDATE product_planning_cycle_items SET selection_status='selected',current_assessment_id=?,decision_snapshot=? WHERE product_code=?`, assessmentID, snapshot, code); err != nil {
		t.Fatal(err)
	}
	commitInput := productcenter.RoadmapCommitmentInput{ItemBizID: bizID, CycleBizID: cycleBizID, ExpectedRevision: 3, ExpectedItemRevision: 3, ExpectedCycleRevision: 1, ExpectedQueueRevision: 1, Reason: "确认基线"}
	raw, err = call("commit", "runtime-commit", commitInput)
	if err != nil {
		t.Fatal(err)
	}
	committed := raw.(productcenter.CommandResult)
	raw, err = call("commit", "runtime-commit", commitInput)
	if err != nil || !raw.(productcenter.CommandResult).Replayed || raw.(productcenter.CommandResult).ReceiptID != committed.ReceiptID {
		t.Fatalf("commit replay %+v %v", raw, err)
	}
	raw, err = call("commitments", "", map[string]any{"biz_id": bizID, "page": 1, "page_size": 10})
	if err != nil {
		t.Fatal(err)
	}
	savedHistory := raw.(productcenter.RoadmapCommitmentPage)
	if savedHistory.Total != 1 || len(savedHistory.Items) != 1 || savedHistory.Items[0].StartsOn != "2026-10-01" || savedHistory.Items[0].RequiresReview || savedHistory.WorkspaceRevision != 4 {
		t.Fatalf("saved history %+v", savedHistory)
	}
	raw, err = call("cross-snapshots", "", map[string]any{"biz_id": savedHistory.Items[0].BizID, "page": 1, "page_size": 20})
	if err != nil {
		t.Fatal(err)
	}
	crossPage := raw.(productcenter.RoadmapCrossSnapshotPage)
	if crossPage.Total != 0 || len(crossPage.Items) != 0 || crossPage.CommitmentBizID != savedHistory.Items[0].BizID || crossPage.ItemBizID != bizID {
		t.Fatalf("cross snapshot dispatch %+v", crossPage)
	}
	commitInput.ExpectedRevision = 4
	_, err = call("commit", "runtime-stale-baseline", commitInput)
	if !errors.As(err, &response) || response.Status != 409 {
		t.Fatalf("baseline conflict %v", err)
	}
	if err = db.QueryRow(`SELECT COUNT(*) FROM product_command_receipts`).Scan(&count); err != nil || count != 3 {
		t.Fatalf("commit receipts %d %v", count, err)
	}
}
